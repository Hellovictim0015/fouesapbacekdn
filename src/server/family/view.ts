import type { ChildRecord } from "../repos/types";
import type { summarizeChild } from "./stats";

/** A child as the parent's app sees it. Never includes codes. */
export function childView(c: ChildRecord, stats?: ReturnType<typeof summarizeChild>) {
  return { id: c.id, name: c.name, prepGoal: c.prepGoal, enabled: c.enabled, linked: c.linked, ...(stats ? { stats } : {}) };
}
