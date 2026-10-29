import { requireAiAccess } from "@/server/ai/access";
import { indianDay, nudgeSystemPrompt } from "@/server/ai/prompts";
import { AiError } from "@/server/ai/types";
import { getServices } from "@/server/container";
import { authenticate, HttpError, handle, json } from "@/server/http/respond";
import { NudgeQuerySchema } from "@/server/http/schemas";

const REFRESH_MS = 3 * 3600 * 1000;

/**
 * GET /v1/ai/nudge?todayMin=&goalMin=&streak= -> { text }: the one-liner on the Home screen.
 * Generated at most once every 3 hours per student (then served from the database), so the home screen
 * can ask freely without costing a model call each time. Does not use up chat messages.
 */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const { user, ai } = await requireAiAccess(s, auth);

    const q = new URL(req.url).searchParams;
    const parsed = NudgeQuerySchema.safeParse(
      Object.fromEntries(["todayMin", "goalMin", "streak"].filter((k) => q.has(k)).map((k) => [k, Number(q.get(k))])),
    );
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid stats");

    const day = indianDay();
    const cached = await s.repos.ai.getNudge(user.id, day);
    if (cached && Date.now() - cached.createdAt.getTime() < REFRESH_MS) return json({ text: cached.text });

    try {
      const text = await ai.complete(nudgeSystemPrompt({ exam: user.exam, prepGoal: user.prepGoal, ...parsed.data }), [{ role: "user", content: "Write my line." }], 80);
      const line = text.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 160);
      await s.repos.ai.saveNudge(user.id, day, line);
      return json({ text: line });
    } catch (e) {
      if (e instanceof AiError) {
        console.error("[foues] ai nudge:", e.message);
        if (cached) return json({ text: cached.text }); // an old line beats an error on the home screen
        throw new HttpError(502, "ai_unavailable", "Buddy is taking a break.");
      }
      throw e;
    }
  });
}
