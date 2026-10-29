import { generateCode, hashCode, OTP_TTL_SEC } from "@/server/auth/otp";
import { normalizePhone } from "@/server/auth/phone";
import { SmsSendError } from "@/server/auth/sms";
import { getServices } from "@/server/container";
import { clientIp, HttpError, handle, json, readBody } from "@/server/http/respond";
import { OtpRequestSchema } from "@/server/http/schemas";

/**
 * POST /v1/auth/otp/request: texts a 6-digit code to the phone. Public, so it is limited hard:
 * one code per 30 s and 3 per 10 min per number (stops SMS bombing a victim), 20 per hour per client address.
 */
export function POST(req: Request) {
  return handle(async () => {
    const { phone: raw } = await readBody(req, OtpRequestSchema, 2 * 1024);
    const phone = normalizePhone(raw);
    if (!phone) throw new HttpError(400, "invalid_phone", "Enter a 10-digit Indian mobile number");

    const { env, limiter, repos, sms, authSecret } = getServices();
    const gate = await Promise.all([
      limiter.hit(`otp:cool:${phone}`, 1, 30),
      limiter.hit(`otp:phone:${phone}`, 3, 600),
      limiter.hit(`otp:ip:${clientIp(req)}`, 20, 3600),
    ]);
    const blocked = gate.find((g) => !g.allowed);
    if (blocked) {
      throw new HttpError(429, "rate_limited", "Too many codes requested. Try again shortly.", {
        "Retry-After": String(blocked.retryAfterSec),
      });
    }

    const code = generateCode(env.OTP_DEV_CODE);
    await repos.auth.saveOtp(phone, hashCode(authSecret, phone, code), new Date(Date.now() + OTP_TTL_SEC * 1000));
    try {
      await sms.sendOtp(phone, code);
    } catch (e) {
      await repos.auth.deleteOtp(phone);
      if (e instanceof SmsSendError) console.error("[foues] sms failed:", e.message);
      throw new HttpError(502, "sms_failed", "Could not send the code. Try again in a minute.");
    }
    return json({ sent: true, expiresInSec: OTP_TTL_SEC, resendAfterSec: 30 });
  });
}
