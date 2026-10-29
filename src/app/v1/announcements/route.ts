import { getServices } from "@/server/container";
import { authenticate, HttpError, handle, json } from "@/server/http/respond";

const MAX_AGE_MS = 48 * 3600 * 1000;
const LIMIT = 5;

/**
 * GET /v1/announcements?after=<id> -> { announcements: [{ id, title, body }] }: messages the admin sent that this account
 * should see, oldest first. The app remembers the highest id it has shown and asks again with `after=<that id>`, so each
 * message appears once. Messages older than 2 days are skipped, so someone who installs today is not hit with last month's news.
 */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { repos } = getServices();
    const user = await repos.users.findByAuthUid(auth.uid);
    if (!user) return json({ announcements: [] });

    const raw = new URL(req.url).searchParams.get("after");
    const after = raw === null ? 0 : Number(raw);
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, "invalid_request", "after must be a whole number");

    const rows = await repos.announcements.listFor({ id: user.id, role: user.role }, after, new Date(Date.now() - MAX_AGE_MS), LIMIT);
    return json({ announcements: rows.map((r) => ({ id: r.id, title: r.title, body: r.body })) });
  });
}
