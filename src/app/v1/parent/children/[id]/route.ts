import { enhancePrepGoal } from "@/server/ai/prep";
import { getServices } from "@/server/container";
import { requireParent } from "@/server/family/guard";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { UpdateChildSchema } from "@/server/http/schemas";
import { childView } from "@/server/family/view";

type Ctx = { params: Promise<{ id: string }> };

async function ownChild(req: Request, ctx: Ctx) {
  const auth = await authenticate(req);
  const s = getServices();
  const parent = await requireParent(s, auth);
  const { id } = await ctx.params;
  const child = await s.repos.family.getChild(parent.id, id);
  if (!child) throw new HttpError(404, "not_found", "No such child");
  return { s, child };
}

/** PATCH /v1/parent/children/:id { name?, prep?, enabled? }: rename, change what they prepare for, pause or resume. */
export function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { s, child } = await ownChild(req, ctx);
    const body = await readBody(req, UpdateChildSchema);
    await s.repos.family.updateChild(child.id, {
      name: body.name,
      prepGoal: (await enhancePrepGoal(s.ai, body.prep)) ?? undefined,
      enabled: body.enabled,
    });
    const updated = await s.repos.family.getChild(child.parentUserId, child.id);
    return json(childView(updated!));
  });
}

/** DELETE /v1/parent/children/:id: remove the child and everything the child saved. The child is signed out at once. */
export function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { s, child } = await ownChild(req, ctx);
    await s.repos.family.deleteChild(child.id);
    return json({ deleted: true });
  });
}
