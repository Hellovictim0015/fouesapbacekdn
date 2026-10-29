import { goalText, suggestFor } from "@/server/apps/match";
import { getServices } from "@/server/container";
import { authenticate, handle, json } from "@/server/http/respond";

/**
 * GET /v1/recommendations -> { apps: [{ id, name, tagline, url, logoUrl }] }: the apps the admin assigned to this student by hand, then
 * the ones that fit their "preparing for" text (at most 3). Someone preparing for GATE sees the GATE app, not the JEE/NEET one.
 * No data about the student is sent to those apps: the app only opens the link when the student taps it.
 */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const { repos } = getServices();
    const user = await repos.users.findByAuthUid(auth.uid);
    if (!user) return json({ apps: [] });

    const assigned = (await repos.recommendedApps.assignedFor([user.id])).get(user.id) ?? [];
    const suggestions = suggestFor(await repos.recommendedApps.list(), assigned, goalText(user));
    return json({
      apps: suggestions.map(({ app: a }) => ({
        id: a.id,
        name: a.name,
        tagline: a.tagline,
        url: a.url,
        logoUrl: a.hasLogo ? `/v1/recommended-apps/${a.id}/logo?v=${a.updatedAt.getTime()}` : null,
      })),
    });
  });
}
