import { getServices } from "@/server/container";
import { authenticate, handle, json, readBody } from "@/server/http/respond";
import { SubscribeSchema } from "@/server/http/schemas";
import { startCheckout } from "@/server/pay/service";

/**
 * POST /v1/payments/subscribe { tier: "student" | "parent" } → what the app needs to open Razorpay's checkout:
 * { keyId, subscriptionId, amountPaise, trialDays }. First-time subscribers get a 3-day free trial.
 */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { tier } = await readBody(req, SubscribeSchema, 1024);
    const s = getServices();
    const user = (await s.repos.users.findByAuthUid(auth.uid)) ?? (await s.repos.users.upsertByAuthUid(auth.uid, { phone: auth.phone }));
    return json(await startCheckout(s, user, tier));
  });
}
