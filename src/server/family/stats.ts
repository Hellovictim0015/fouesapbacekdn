import { indianDay } from "../ai/prompts";

export interface ChildStats {
  /** Focused minutes today (Indian date). */
  todayMin: number;
  /** Focused minutes in the last 7 days including today. */
  weekMin: number;
  sessions7d: number;
  /** When the most recent session started, ISO, or null. */
  lastSessionAt: string | null;
}

interface BackupSession {
  startedAt?: unknown;
  focusedMin?: unknown;
}

/**
 * What a parent sees about a child: totals only, taken from the child's cloud backup. The parent never gets the
 * subjects, notes or timings of individual sessions. Anything malformed in the payload is ignored.
 */
export function summarizeChild(payload: unknown, now: Date = new Date()): ChildStats {
  const out: ChildStats = { todayMin: 0, weekMin: 0, sessions7d: 0, lastSessionAt: null };
  const sessions = (payload as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(sessions)) return out;

  const today = indianDay(now);
  const weekDays = new Set(Array.from({ length: 7 }, (_, i) => indianDay(new Date(now.getTime() - i * 86_400_000))));
  let last = 0;
  for (const raw of sessions as BackupSession[]) {
    const at = typeof raw?.startedAt === "number" ? raw.startedAt : NaN;
    const min = typeof raw?.focusedMin === "number" && raw.focusedMin > 0 ? Math.min(raw.focusedMin, 1440) : 0;
    if (!Number.isFinite(at) || at > now.getTime() + 86_400_000) continue;
    const day = indianDay(new Date(at));
    if (day === today) out.todayMin += min;
    if (weekDays.has(day)) {
      out.weekMin += min;
      out.sessions7d += 1;
    }
    last = Math.max(last, at);
  }
  out.lastSessionAt = last > 0 ? new Date(last).toISOString() : null;
  return out;
}
