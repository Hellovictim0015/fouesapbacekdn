import { getServices } from "@/server/container";
import { handle, HttpError, json } from "@/server/http/respond";
import { handleWebhook } from "@/server/pay/service";

/**
 * POST /v1/payments/webhook: Razorpay calls this about renewals, failures and cancellations. No login: the
 * X-Razorpay-Signature header (HMAC of the raw body with the webhook secret from the admin panel) is the proof.
 * Set it up in Razorpay Dashboard › Developers › Webhooks with the events subscription.* and payment.*.
 */
export function POST(req: Request) {
  return handle(async () => {
    const raw = await req.text();
    if (raw.length > 256 * 1024) throw new HttpError(413, "too_large", "Request body is too large");
    const signature = req.headers.get("x-razorpay-signature");
    if (!signature) throw new HttpError(401, "bad_signature", "Missing signature");
    const result = await handleWebhook(getServices(), raw, signature, req.headers.get("x-razorpay-event-id"));
    return json({ ok: true, result });
  });
}
