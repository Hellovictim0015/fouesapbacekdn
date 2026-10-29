import { enhancePrepGoal } from "@/server/ai/prep";
import { getServices } from "@/server/container";
import { LINK_CODE_TTL_MS, MAX_CHILDREN, generateLinkCode, hashLinkCode, normalizeLinkCode } from "@/server/family/codes";
import { hasAccess } from "@/server/domain/subscriptionStatus";
import { resolvePlan } from "@/server/family/plan";
import { requireParent } from "@/server/family/guard";
import { summarizeChild } from "@/server/family/stats";
import { authenticate, HttpError, handle, json, readBody } from "@/server/http/respond";
import { CreateChildSchema } from "@/server/http/schemas";
import { childView } from "@/server/family/view";

/** GET /v1/parent/children: my children with today's and this week's study minutes (totals only). */
export function GET(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const parent = await requireParent(s, auth);
    const kids = await s.repos.family.listChildren(parent.id);
    const children = await Promise.all(
      kids.map(async (c) => childView(c, summarizeChild((await s.repos.backups.get(c.userId))?.payload))),
    );
    return json({ children, max: MAX_CHILDREN });
  });
}

/**
 * POST /v1/parent/children { name, prep? }: add a child and get the code they type to sign in. The code is shown
 * only now (we keep just a hash), so the app shows it at once; "new code" makes another.
 */
export function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticate(req);
    const s = getServices();
    const parent = await requireParent(s, auth);
    const body = await readBody(req, CreateChildSchema);

    // Adding children is part of the Parent plan (trial, active or grace). The Student plan does not include it.
    const plan = await resolvePlan(s, parent);
    if (plan.tier !== "parent" || !hasAccess(plan.view)) {
      throw new HttpError(402, "parent_plan_required", "Get the Parent plan to add children");
    }
    if ((await s.repos.family.countChildren(parent.id)) >= MAX_CHILDREN) {
      throw new HttpError(409, "child_limit", `You can add up to ${MAX_CHILDREN} children`);
    }
    const code = generateLinkCode();
    const hash = hashLinkCode(s.authSecret, normalizeLinkCode(code)!);
    const prep = (await enhancePrepGoal(s.ai, body.prep)) ?? null;
    const child = await s.repos.family.createChild(parent.id, body.name, prep, hash, new Date(Date.now() + LINK_CODE_TTL_MS));
    return json({ child: childView(child), code }, 201);
  });
}
