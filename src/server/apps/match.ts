import type { RecommendedApp } from "../repos/types";

/** Lower case, letters and digits only (Hindi letters too), single spaces, and a trailing "s" dropped from each word ("mains" -> "main"). */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

/**
 * Does the student's "preparing for" text fit one of the app's keywords? Whole words only, in either direction:
 * the goal "gate 2027 cse" contains the keyword "gate", and the short goal "psu" is contained in the keyword "psu exams".
 * "negate" never matches "gate".
 */
export function appMatchesGoal(keywords: string[], goal: string | null | undefined): boolean {
  const g = normalizeText(goal ?? "");
  if (g === "") return false;
  const paddedGoal = ` ${g} `;
  return keywords.some((k) => {
    const kw = normalizeText(k);
    if (kw.length < 2) return false;
    return paddedGoal.includes(` ${kw} `) || (g.length >= 3 && ` ${kw} `.includes(paddedGoal));
  });
}

/** The active apps that fit this student, newest first, at most [limit]. */
export function appsForGoal(apps: RecommendedApp[], goal: string | null | undefined, limit = 3): RecommendedApp[] {
  return apps
    .filter((a) => a.active && appMatchesGoal(a.keywords, goal))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

/** What counts as "the student's goal": their own words, or the exam they picked if they typed nothing. */
export function goalText(user: { prepGoal: string | null; exam: string | null }): string {
  return user.prepGoal ?? user.exam ?? "";
}

export interface Suggestion {
  app: RecommendedApp;
  /** True when the admin assigned it to this student by hand; false when it matched what they typed. */
  assigned: boolean;
}

/**
 * What one student is shown: the apps the admin assigned to them by hand (if still visible), then the apps that match what they
 * typed, no duplicates, at most [limit]. Hidden apps are never shown, assigned or not.
 */
export function suggestFor(apps: RecommendedApp[], assignedIds: number[], goal: string | null | undefined, limit = 3): Suggestion[] {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const out: Suggestion[] = [];
  for (const id of assignedIds) {
    const a = byId.get(id);
    if (a?.active && !out.some((s) => s.app.id === id)) out.push({ app: a, assigned: true });
  }
  for (const a of appsForGoal(apps, goal, limit)) {
    if (!out.some((s) => s.app.id === a.id)) out.push({ app: a, assigned: false });
  }
  return out.slice(0, limit);
}
