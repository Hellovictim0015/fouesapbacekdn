import { safeEqualHex } from "@/server/auth/otp";
import { getServices } from "@/server/container";
import { UNLOCK_CODE_TTL_MS, UNLOCK_MAX_ATTEMPTS, hashUnlockCode } from "@/server/family/codes";
import { requireChild } from "@/server/family/guard";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { UnlockSchema } from "@/server/http/schemas";

/**
 * POST /v1/child/unlock { code }: the child types the code their parent read out. On success the app may remove its
 * device-admin lock and be uninstalled for a short while (the phone remembers the time, the server just checks the code).
 */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const user = await requireChild(s, auth);
    const { code } = await readBody(req, UnlockSchema, 1024);

    const child = await s.repos.family.findChildByUserId(user.id);
    if (!child) throw new HttpError(404, "not_found", "No parent link");
    const unlock = await s.repos.family.getUnlock(child.id);
    if (!unlock || unlock.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, "no_unlock_code", "Ask your parent for an unlock code in their FocusX app.");
    }
    if (unlock.attempts >= UNLOCK_MAX_ATTEMPTS) {
      await s.repos.family.clearUnlock(child.id);
      throw new HttpError(429, "too_many_attempts", "Too many wrong tries. Ask your parent for a new code.");
    }
    if (!safeEqualHex(unlock.codeHash, hashUnlockCode(s.authSecret, child.id, code))) {
      await s.repos.family.addUnlockAttempt(child.id);
      throw new HttpError(400, "wrong_code", "That code is not right.");
    }
    await s.repos.family.clearUnlock(child.id); // works once
    return json({ unlocked: true, validForSec: UNLOCK_CODE_TTL_MS / 1000 });
  });
}
