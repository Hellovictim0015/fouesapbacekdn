import { getServices } from "@/server/container";
import { effectiveStatus } from "@/server/domain/subscriptionStatus";
import { resolvePlan } from "@/server/family/plan";
import { authenticate, handle, json } from "@/server/http/respond";

/** GET /v1/subscription → { status: none | trial | active | grace | expired, expiresAt }. */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const user = await s.repos.users.findByAuthUid(auth.uid);
    if (!user) return json({ ...effectiveStatus(null, new Date()), via: "self", paused: false, tier: null });
    const plan = await resolvePlan(s, user);
    // `via` = whose plan this is; `paused` = the parent has switched this child off.
    return json({ ...plan.view, via: plan.via, paused: plan.paused, tier: plan.tier });
  });
}
