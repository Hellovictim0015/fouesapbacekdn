import { enhancePrepGoal } from "@/server/ai/prep";
import { hashCode, hashToken, newSessionToken, OTP_MAX_ATTEMPTS, safeEqualHex, SESSION_TTL_DAYS } from "@/server/auth/otp";
import { normalizePhone } from "@/server/auth/phone";
import { isReviewLogin, REVIEW_PLAN_DAYS } from "@/server/auth/review";
import { PRODUCT } from "@/server/pay/products";
import { getServices } from "@/server/container";
import { clientIp, HttpError, handle, json, readBody } from "@/server/http/respond";
import { OtpVerifySchema } from "@/server/http/schemas";

/** POST /v1/auth/otp/verify: trades a correct code for a session token. Creates the account on first login. */
export function POST(req: Request) {
  return handle(async () => {
    const { phone: raw, code, prep, role } = await readBody(req, OtpVerifySchema, 2 * 1024);
    const phone = normalizePhone(raw);
    if (!phone) throw new HttpError(400, "invalid_phone", "Enter a 10-digit Indian mobile number");

    const { limiter, repos, authSecret, ai, env } = getServices();
    const ip = await limiter.hit(`otp-verify:ip:${clientIp(req)}`, 60, 3600);
    if (!ip.allowed) {
      throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.", { "Retry-After": String(ip.retryAfterSec) });
    }

    const otp = await repos.auth.getOtp(phone);
    if (!otp || otp.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, "code_expired", "That code has expired. Ask for a new one.");
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await repos.auth.deleteOtp(phone);
      throw new HttpError(429, "too_many_attempts", "Too many wrong tries. Ask for a new code.");
    }
    if (!safeEqualHex(otp.codeHash, hashCode(authSecret, phone, code))) {
      await repos.auth.addOtpAttempt(phone);
      throw new HttpError(400, "wrong_code", "That code is not right.");
    }
    await repos.auth.deleteOtp(phone); // a code works once

    const authUid = `ph:${phone}`;
    const isNew = (await repos.users.findByAuthUid(authUid)) === null;
    // Optional "what are you preparing for" box: cleaned by the AI, never blocks the login.
    const prepGoal = (await enhancePrepGoal(ai, prep)) ?? undefined;
    const user = await repos.users.upsertByAuthUid(authUid, { phone, prepGoal, role }); // the role is only used when the account is created

    if (isReviewLogin(phone, env.REVIEW_LOGIN) && user.role !== "child") {
      await repos.subscriptions.save(user.id, {
        productId: user.role === "parent" ? PRODUCT.parent : PRODUCT.student,
        purchaseToken: "review-access",
        linkedPurchaseToken: null,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + REVIEW_PLAN_DAYS * 24 * 3600 * 1000),
        autoRenewing: false,
        acknowledged: true,
        latestOrderId: null,
        playState: "review",
      });
    }

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
    await repos.auth.createSession(user.id, hashToken(token), expiresAt);

    return json({
      token,
      expiresAt: expiresAt.toISOString(),
      isNewUser: isNew,
      user: { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone, exam: user.exam, prepGoal: user.prepGoal, dailyGoalMin: user.dailyGoalMin },
    });
  });
}
