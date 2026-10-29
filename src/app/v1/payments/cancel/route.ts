import { getServices } from "@/server/container";
import { resolvePlan } from "@/server/family/plan";
import { authenticate, HttpError, handle, json } from "@/server/http/respond";
import { cancelSubscription } from "@/server/pay/service";

/** POST /v1/payments/cancel: no more charges. Access continues until the end of what is already paid. */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const user = await s.repos.users.findByAuthUid(auth.uid);
    if (!user) throw new HttpError(404, "not_found", "No account");
    await cancelSubscription(s, user);
    const plan = await resolvePlan(s, user);
    return json({ ...plan.view, via: plan.via, paused: plan.paused, tier: plan.tier });
  });
}
