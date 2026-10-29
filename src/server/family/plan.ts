import type { Services } from "../container";
import { effectiveStatus, type SubscriptionView } from "../domain/subscriptionStatus";
import { tierOf, type Tier } from "../pay/products";
import type { UserRecord } from "../repos/types";

export interface ResolvedPlan {
  view: SubscriptionView;
  /** "parent": a child using the parent's plan. */
  via: "self" | "parent";
  /** The parent has paused this child (or removed the link): no access whatever the plan says. */
  paused: boolean;
  /** Which plan it is: student (49) or parent (99). Null when there is none. */
  tier: Tier | null;
}

/**
 * The plan that decides what this account may do. A normal account uses its own subscription. A child has none of
 * its own: it uses the PARENT's, and only while the parent has not paused it. This is the single place that rule lives,
 * so the Buddy endpoints and the subscription endpoint cannot disagree.
 */
export async function resolvePlan(s: Services, user: UserRecord, now = new Date()): Promise<ResolvedPlan> {
  if (user.role !== "child") {
    const sub = await s.repos.subscriptions.findByUserId(user.id);
    return { view: effectiveStatus(sub, now), via: "self", paused: false, tier: tierOf(sub?.productId) };
  }
  const child = await s.repos.family.findChildByUserId(user.id);
  if (!child || !child.enabled) return { view: { status: "none", expiresAt: null }, via: "parent", paused: true, tier: null };
  const sub = await s.repos.subscriptions.findByUserId(child.parentUserId);
  // Children are part of the Parent plan only: a parent who switched to the Student plan no longer covers them.
  const tier = tierOf(sub?.productId);
  if (tier !== "parent") return { view: { status: "none", expiresAt: null }, via: "parent", paused: false, tier };
  return { view: effectiveStatus(sub, now), via: "parent", paused: false, tier };
}
