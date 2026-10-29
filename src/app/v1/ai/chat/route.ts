import { goalText, suggestFor } from "@/server/apps/match";
import { stripUnknownLinks } from "@/server/apps/links";
import { requireAiAccess } from "@/server/ai/access";
import { chatSystemPrompt, indianDay } from "@/server/ai/prompts";
import { AiError } from "@/server/ai/types";
import { getServices } from "@/server/container";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { ChatSchema } from "@/server/http/schemas";

/**
 * POST /v1/ai/chat { messages, context? } -> { reply, remaining }.
 * Needs an active plan, 10 messages a minute and AI_DAILY_LIMIT a day. Chats are not stored: the app sends the
 * last few turns each time and the server forgets them once the reply is out.
 */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const { user, ai } = await requireAiAccess(s, auth);
    const body = await readBody(req, ChatSchema, 16 * 1024);

    const burst = await s.limiter.hit(`ai:${user.id}`, 10, 60);
    if (!burst.allowed) throw new HttpError(429, "rate_limited", "Slow down a little", { "Retry-After": String(burst.retryAfterSec) });

    const day = indianDay();
    const used = await s.repos.ai.useChat(user.id, day, s.env.AI_DAILY_LIMIT);
    if (!used.allowed) throw new HttpError(429, "daily_limit", "You have used today's Buddy messages. Come back tomorrow!");

    try {
      // Apps the admin made for this student's exam: Buddy may suggest them (with their link) and nothing else.
      const assigned = (await s.repos.recommendedApps.assignedFor([user.id])).get(user.id) ?? [];
      const apps = suggestFor(await s.repos.recommendedApps.list(), assigned, goalText(user), 2).map((x) => x.app);
      const raw = await ai.complete(
        chatSystemPrompt({ exam: user.exam, prepGoal: user.prepGoal, ...body.context, apps }),
        body.messages,
        400,
      );
      const reply = stripUnknownLinks(raw, apps.map((a) => a.url));
      return json({ reply, remaining: used.remaining });
    } catch (e) {
      await s.repos.ai.refundChat(user.id, day); // a failed call must not cost the student a message
      if (e instanceof AiError) {
        console.error("[foues] ai:", e.message);
        throw new HttpError(502, "ai_unavailable", "Buddy is taking a break. Try again in a minute.");
      }
      throw e;
    }
  });
}
