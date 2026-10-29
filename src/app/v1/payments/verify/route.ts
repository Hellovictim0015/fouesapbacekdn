import { getServices } from "@/server/container";
import { resolvePlan } from "@/server/family/plan";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { ConfirmPaymentSchema } from "@/server/http/schemas";
import { confirmCheckout } from "@/server/pay/service";

/**
 * POST /v1/payments/verify { subscriptionId, paymentId, signature }: the app calls this right after Razorpay's checkout
 * succeeds. The signature is checked, then Razorpay is asked what really happened; only that is stored.
 */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const input = await readBody(req, ConfirmPaymentSchema, 4 * 1024);
    const s = getServices();
    const user = await s.repos.users.findByAuthUid(auth.uid);
    if (!user) throw new HttpError(404, "not_found", "No account");
    await confirmCheckout(s, user, input);
    // Same shape as GET /v1/subscription (status, via, paused, tier), so the app saves one thing either way.
    const fresh = (await s.repos.users.findByAuthUid(auth.uid)) ?? user;
    const plan = await resolvePlan(s, fresh);
    return json({ ...plan.view, via: plan.via, paused: plan.paused, tier: plan.tier });
  });
}
