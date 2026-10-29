import { hashToken, newSessionToken, SESSION_TTL_DAYS } from "@/server/auth/otp";
import { getServices } from "@/server/container";
import { hashLinkCode, normalizeLinkCode } from "@/server/family/codes";
import { clientIp, HttpError, handle, json, readBody } from "@/server/http/respond";
import { RedeemSchema } from "@/server/http/schemas";

/**
 * POST /v1/child/redeem { code }: the child types the parent's code once and gets a session, with no phone number and
 * no purchase. A code works once. Public, so guessing is limited to 20 tries an hour per address.
 */
export function POST(req: Request) {
  return handle(async () => {
    const { code } = await readBody(req, RedeemSchema, 2 * 1024);
    const s = getServices();

    const gate = await s.limiter.hit(`redeem:ip:${clientIp(req)}`, 20, 3600);
    if (!gate.allowed) {
      throw new HttpError(429, "rate_limited", "Too many tries. Try again later.", { "Retry-After": String(gate.retryAfterSec) });
    }

    const normalized = normalizeLinkCode(code);
    const child = normalized ? await s.repos.family.findByLinkCodeHash(hashLinkCode(s.authSecret, normalized)) : null;
    if (!child) throw new HttpError(400, "invalid_code", "That code is not right, or it has expired. Ask your parent for a new one.");

    await s.repos.family.consumeLinkCode(child.id);
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
    await s.repos.auth.createSession(child.userId, hashToken(token), expiresAt);

    return json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: child.userId, role: "child", name: child.name, prepGoal: child.prepGoal },
    });
  });
}
