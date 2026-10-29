const MAX_LINE = 140;

/** Reads the model's answer as 3 short lines. Returns null if it is not what we asked for. */
export function parseTips(text: string): string[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const lines = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.replace(/\s+/g, " ").trim().slice(0, MAX_LINE))
      .filter((x) => x.length > 0);
    return lines.length >= 3 ? lines.slice(0, 3) : null;
  } catch {
    return null;
  }
}

/** Used when the AI is down, so a student with a goal still gets something useful. */
export function fallbackTips(goal: string | null | undefined): string[] {
  const g = goal?.trim() || "your exam";
  return [
    `Pick one weak topic for ${g} and solve 10 questions on it today.`,
    `Small, steady days beat big, rare ones. ${g} is built one session at a time.`,
    `Phone down, timer on: a 25-minute focus session for ${g}?`,
  ];
}
