import { stopChargesBeforeDeletion } from "@/server/pay/service";
import { enhancePrepGoal } from "@/server/ai/prep";
import { getServices } from "@/server/container";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { UserUpdateSchema } from "@/server/http/schemas";
import type { UserRecord } from "@/server/repos/types";

function view(u: UserRecord) {
  return { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, exam: u.exam, prepGoal: u.prepGoal, dailyGoalMin: u.dailyGoalMin };
}

/** GET /v1/users/me: who I am (role, profile). For a child it also says who the parent is. */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { repos } = getServices();
    const user = await repos.users.findByAuthUid(auth.uid);
    if (!user) return json({ error: { code: "not_found", message: "No account yet" } }, 404);
    return json(view(user));
  });
}

/** POST /v1/users/me: create the user on first sign-in, or update the fields that were sent. */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const body = await readBody(req, UserUpdateSchema);
    const { repos, ai } = getServices();

    const user = await repos.users.upsertByAuthUid(auth.uid, {
      name: body.name,
      exam: body.exam,
      prepGoal: (await enhancePrepGoal(ai, body.prep)) ?? undefined,
      dailyGoalMin: body.dailyGoalMin,
    });
    return json(view(user));
  });
}

/** DELETE /v1/users/me: "delete my account". Removes the user's data, which includes every signed-in device. */
export function DELETE(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { repos } = getServices();
    const me = await repos.users.findByAuthUid(auth.uid);
    // A child cannot delete themselves: that would quietly cut the parent's link. The parent removes the child instead.
    if (me?.role === "child") throw new HttpError(403, "child_cannot_delete", "Ask your parent to remove this profile");
    if (me) await stopChargesBeforeDeletion(getServices(), me.id);
    await repos.users.deleteByAuthUid(auth.uid);
    return json({ deleted: true });
  });
}
