import type { AuthUser } from "../auth/types";
import type { Services } from "../container";
import { hasAccess } from "../domain/subscriptionStatus";
import { resolvePlan } from "../family/plan";
import { HttpError } from "../http/respond";
import type { UserRecord } from "../repos/types";
import type { AiClient } from "./types";

/**
 * Buddy is part of the paid plan. Trial, active and grace pass; everyone else gets 402 and the app shows the
 * paywall. The check is on the server, so editing the app cannot unlock it.
 */
export async function requireAiAccess(s: Services, auth: AuthUser): Promise<{ user: UserRecord; ai: AiClient }> {
  if (!s.ai) throw new HttpError(503, "ai_not_configured", "Buddy is not set up on this server yet");
  const user = (await s.repos.users.findByAuthUid(auth.uid)) ?? (await s.repos.users.upsertByAuthUid(auth.uid, { phone: auth.phone }));
  const plan = await resolvePlan(s, user);
  if (plan.paused) throw new HttpError(403, "child_paused", "Your parent has paused FocusX for now");
  if (!hasAccess(plan.view)) throw new HttpError(402, "plan_required", plan.via === "parent" ? "Your parent's plan has ended" : "Buddy needs the FocusX plan");
  return { user, ai: s.ai };
}
