import type { Role } from "../repos/types";

export type Tier = "student" | "parent";

/**
 * Two plans: the Student plan (for the student's own use) and the Parent plan (which also lets the parent add up to 3
 * children). The ids are stored with each subscription so we know which plan it is. A child buys nothing.
 */
export const PRODUCT: Record<Tier, string> = { student: "focus_student", parent: "focus_parent" };

export function tierOf(productId: string | undefined | null): Tier | null {
  if (productId === PRODUCT.parent) return "parent";
  if (productId === PRODUCT.student) return "student";
  return null;
}

export function canBuy(role: Role): boolean {
  return role !== "child";
}

/** Days of free trial for a first-time subscriber. */
export const TRIAL_DAYS = 3;
