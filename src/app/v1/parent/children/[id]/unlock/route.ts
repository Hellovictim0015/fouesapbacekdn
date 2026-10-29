import { getServices } from "@/server/container";
import { UNLOCK_CODE_TTL_MS, generateUnlockCode, hashUnlockCode } from "@/server/family/codes";
import { requireParent } from "@/server/family/guard";
import { authenticate, HttpError, handle, json } from "@/server/http/respond";

/**
 * POST /v1/parent/children/:id/unlock: a one-time 6-digit code the parent reads out when the child may uninstall FocusX
 * (valid 10 minutes, 5 tries). Without it the child's phone refuses to remove the app or its device-admin lock.
 */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const parent = await requireParent(s, auth);
    const { id } = await ctx.params;
    const child = await s.repos.family.getChild(parent.id, id);
    if (!child) throw new HttpError(404, "not_found", "No such child");

    const code = generateUnlockCode();
    await s.repos.family.setUnlockCode(child.id, hashUnlockCode(s.authSecret, child.id, code), new Date(Date.now() + UNLOCK_CODE_TTL_MS));
    return json({ code, expiresInSec: UNLOCK_CODE_TTL_MS / 1000 });
  });
}
