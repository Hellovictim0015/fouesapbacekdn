import { getServices } from "@/server/container";
import { authenticate, handle, HttpError, json, readBody } from "@/server/http/respond";
import { BACKUP_MAX_BYTES, BackupSchema } from "@/server/http/schemas";

/** POST /v1/sync: replace this user's cloud backup with the one in the body. */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const backup = await readBody(req, BackupSchema, BACKUP_MAX_BYTES);
    const { repos } = getServices();
    // Backing up must work even if the app never called /users/me first.
    const user =
      (await repos.users.findByAuthUid(auth.uid)) ??
      (await repos.users.upsertByAuthUid(auth.uid, { phone: auth.phone }));
    const updatedAt = await repos.backups.put(user.id, backup);
    return json({ updatedAt: updatedAt.toISOString(), sessions: backup.sessions.length });
  });
}

/** GET /v1/sync: the last backup (used to restore after a reinstall), or 404 if there is none. */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { repos } = getServices();
    const user = await repos.users.findByAuthUid(auth.uid);
    const backup = user ? await repos.backups.get(user.id) : null;
    if (!backup) throw new HttpError(404, "no_backup", "No backup for this account yet");
    return json({ updatedAt: backup.updatedAt.toISOString(), payload: backup.payload });
  });
}
