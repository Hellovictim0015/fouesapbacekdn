import type { AuthUser } from "../auth/types";
import type { Services } from "../container";
import { HttpError } from "../http/respond";
import type { UserRecord } from "../repos/types";

/** Only parent accounts may manage children. Everyone else gets 403, even with a valid sign-in. */
export async function requireParent(s: Services, auth: AuthUser): Promise<UserRecord> {
  const user = await s.repos.users.findByAuthUid(auth.uid);
  if (!user || user.role !== "parent") throw new HttpError(403, "not_a_parent", "Only a parent account can do this");
  return user;
}

/** Only child accounts (signed in with a parent's code) use the child endpoints. */
export async function requireChild(s: Services, auth: AuthUser): Promise<UserRecord> {
  const user = await s.repos.users.findByAuthUid(auth.uid);
  if (!user || user.role !== "child") throw new HttpError(403, "not_a_child", "Only a child account can do this");
  return user;
}
