import { getServices } from "@/server/container";
import { LINK_CODE_TTL_MS, generateLinkCode, hashLinkCode, normalizeLinkCode } from "@/server/family/codes";
import { requireParent } from "@/server/family/guard";
import { authenticate, HttpError, handle, json } from "@/server/http/respond";

/**
 * POST /v1/parent/children/:id/code: a new sign-in code for this child (new phone, or the old code was lost).
 * Making one signs the child out everywhere: only the phone that types the new code stays linked.
 */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const parent = await requireParent(s, auth);
    const { id } = await ctx.params;
    const child = await s.repos.family.getChild(parent.id, id);
    if (!child) throw new HttpError(404, "not_found", "No such child");

    const code = generateLinkCode();
    await s.repos.family.setLinkCode(child.id, hashLinkCode(s.authSecret, normalizeLinkCode(code)!), new Date(Date.now() + LINK_CODE_TTL_MS));
    await s.repos.auth.deleteSessionsForUser(child.userId);
    return json({ code });
  });
}
