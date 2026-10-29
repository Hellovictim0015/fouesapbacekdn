import { requireAiAccess } from "@/server/ai/access";
import { indianDay, tipsSystemPrompt } from "@/server/ai/prompts";
import { fallbackTips, parseTips } from "@/server/ai/tips";
import { AiError } from "@/server/ai/types";
import { getServices } from "@/server/container";
import { authenticate, handle, json } from "@/server/http/respond";

/**
 * GET /v1/ai/tips -> { tips: [3 short lines] }: the text for today's study-tip notifications. The app schedules
 * them itself on the phone (no push service), so this is asked once a day. Made once per student per day and then
 * served from the database, so asking again costs nothing.
 */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const { user, ai } = await requireAiAccess(s, auth);

    const day = indianDay();
    const cached = await s.repos.ai.getTips(user.id, day);
    if (cached) return json({ tips: cached });

    let tips: string[] | null = null;
    try {
      const label = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
      tips = parseTips(await ai.complete(tipsSystemPrompt({ exam: user.exam, prepGoal: user.prepGoal }, label), [{ role: "user", content: "Write today's 3 lines." }], 300));
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      console.error("[foues] ai tips:", e.message);
    }
    const result = tips ?? fallbackTips(user.prepGoal ?? user.exam);
    // Only a genuine AI answer is kept for the day; a fallback is retried on the next ask.
    if (tips) await s.repos.ai.saveTips(user.id, day, result);
    return json({ tips: result });
  });
}
