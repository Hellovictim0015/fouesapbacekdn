import { POST as aiChat } from "@/app/v1/ai/chat/route";
import { POST as requestOtp } from "@/app/v1/auth/otp/request/route";
import { POST as verifyOtp } from "@/app/v1/auth/otp/verify/route";
import { POST as redeem } from "@/app/v1/child/redeem/route";
import { POST as childUnlock } from "@/app/v1/child/unlock/route";
import { GET as listChildren, POST as addChild } from "@/app/v1/parent/children/route";
import { DELETE as removeChild, PATCH as patchChild } from "@/app/v1/parent/children/[id]/route";
import { POST as newCode } from "@/app/v1/parent/children/[id]/code/route";
import { POST as makeUnlock } from "@/app/v1/parent/children/[id]/unlock/route";
import { GET as getSubscription } from "@/app/v1/subscription/route";
import { POST as postSync } from "@/app/v1/sync/route";
import { DELETE as deleteMe, GET as getMe } from "@/app/v1/users/me/route";
import { createSessionVerifier } from "@/server/auth/session";
import { setServicesForTests } from "@/server/container";
import { normalizeLinkCode } from "@/server/family/codes";
import { summarizeChild } from "@/server/family/stats";
import { backup, purchase, req, useServices as useFakeServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

function useServices(overrides: Record<string, string> = {}) {
  const h = useFakeServices({ RATE_LIMIT_PER_MIN: "1000", ...overrides });
  h.services.verifier = createSessionVerifier(h.repos.auth);
  return h;
}
type H = ReturnType<typeof useServices>;

const post = (path: string, body: unknown, token?: string) => req(path, { method: "POST", token, body });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const unlimited = (h: H) => { h.services.limiter = { hit: async () => ({ allowed: true, remaining: 9, retryAfterSec: 0 }) }; };

async function loginPhone(h: H, phone: string, role?: "student" | "parent") {
  h.sms.sent.length = 0;
  h.services.limiter = (await import("@/server/repos/memory")).createMemoryLimiter();
  await requestOtp(post("/v1/auth/otp/request", { phone }));
  unlimited(h);
  const res = await verifyOtp(post("/v1/auth/otp/verify", { phone, code: h.sms.sent[0]!.code, ...(role ? { role } : {}) }));
  return (await res.json()) as { token: string; user: { id: string; role: string } };
}

async function parentWithPlan(h: H, plan: "TRIAL" | "EXPIRED" | "NONE" = "TRIAL") {
  const login = await loginPhone(h, "9876543210", "parent");
  if (plan !== "NONE") h.repos.setSubscription(login.user.id, { productId: "focus_parent", status: plan, expiresAt: new Date(Date.now() + (plan === "EXPIRED" ? -1 : 1) * 86_400_000), autoRenewing: true });
  return login;
}

async function addKid(parent: string, name = "Ram", extra: object = {}) {
  const res = await addChild(post("/v1/parent/children", { name, ...extra }, parent));
  return { res, body: await res.json() };
}

async function kidSignsIn(code: string) {
  const res = await redeem(post("/v1/child/redeem", { code }));
  return { res, body: await res.json() };
}

describe("roles", () => {
  it("a student is the default and the role is returned at login", async () => {
    const h = useServices();
    expect((await loginPhone(h, "9876543210")).user.role).toBe("student");
  });

  it("the role is chosen once, when the account is created", async () => {
    const h = useServices();
    expect((await loginPhone(h, "9876543210", "parent")).user.role).toBe("parent");
    expect((await loginPhone(h, "9876543210", "student")).user.role).toBe("parent"); // later logins cannot switch it
  });

  it("GET /v1/users/me says who I am", async () => {
    const h = useServices();
    const { token } = await loginPhone(h, "9876543210", "parent");
    expect((await (await getMe(req("/v1/users/me", { token }))).json()).role).toBe("parent");
  });
});

describe("plans and prices: Student 49, Parent 99", () => {
  const buyTier = async (h: H, token: string, tier: "student" | "parent") => (await purchase(h, token, tier)).verifyStatus;
  const buy = async (h: H, token: string, tier: "student" | "parent") => ({ status: await buyTier(h, token, tier) });

  it("a student can buy the Student plan", async () => {
    const h = useServices();
    const { token } = await loginPhone(h, "9123456789", "student");
    expect(await buyTier(h, token, "student")).toBe(200);
    expect(await (await getSubscription(req("/v1/subscription", { token }))).json()).toMatchObject({ status: "active", tier: "student" });
    expect((await (await getMe(req("/v1/users/me", { token }))).json()).role).toBe("student");
  });

  it("a student who buys the Parent plan becomes a parent and can add children", async () => {
    const h = useServices();
    const { token } = await loginPhone(h, "9123456789", "student");
    expect(await buyTier(h, token, "parent")).toBe(200);
    expect(await (await getSubscription(req("/v1/subscription", { token }))).json()).toMatchObject({ status: "active", tier: "parent" });
    expect((await (await getMe(req("/v1/users/me", { token }))).json()).role).toBe("parent");
    expect((await addKid(token)).res.status).toBe(201);
  });

  it("a parent may also buy the Student plan, but then cannot add children and their children lose access", async () => {
    const h = useServices();
    const parent = await parentWithPlan(h, "TRIAL");
    const { body } = await addKid(parent.token);
    const kid = (await kidSignsIn(body.code)).body;
    expect((await (await getSubscription(req("/v1/subscription", { token: kid.token }))).json()).status).toBe("trial");

    expect((await buy(h, parent.token, "student")).status).toBe(200); // replaces the Parent plan
    expect((await addKid(parent.token, "Another")).res.status).toBe(402);
    expect(await (await getSubscription(req("/v1/subscription", { token: kid.token }))).json()).toMatchObject({ status: "none", via: "parent", tier: "student" });
  });

  it("only the Parent plan can add children", async () => {
    const h = useServices();
    const noPlan = await parentWithPlan(h, "NONE");
    const first = await addKid(noPlan.token);
    expect(first.res.status).toBe(402);
    expect(first.body.error.code).toBe("parent_plan_required");

    expect((await buy(h, noPlan.token, "parent")).status).toBe(200); // now they have it
    expect((await addKid(noPlan.token)).res.status).toBe(201);
  });

  it("an expired Parent plan cannot add children, and a Student-plan record cannot either", async () => {
    const h = useServices();
    const expired = await parentWithPlan(h, "EXPIRED");
    expect((await addKid(expired.token)).res.status).toBe(402);
    const wrongTier = await loginPhone(h, "9111111111", "parent");
    h.repos.setSubscription(wrongTier.user.id, { productId: "focus_student", status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000), autoRenewing: true });
    expect((await addKid(wrongTier.token)).res.status).toBe(402);
  });

  it("a child reports the parent's plan tier", async () => {
    const h = useServices();
    const parent = await parentWithPlan(h, "TRIAL");
    const { body } = await addKid(parent.token);
    const kid = (await kidSignsIn(body.code)).body;
    expect(await (await getSubscription(req("/v1/subscription", { token: kid.token }))).json()).toMatchObject({ status: "trial", via: "parent", tier: "parent" });
  });
});

describe("parent: adding children", () => {
  it("gives a code like ABCD-EFGH, and only a hash is kept", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    const { res, body } = await addKid(token, "Ram", { prep: "jee 2028" });
    expect(res.status).toBe(201);
    expect(body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(body.child).toMatchObject({ name: "Ram", prepGoal: "Jee 2028", enabled: true, linked: false });
    expect(JSON.stringify(body.child)).not.toContain(body.code);
  });

  it("allows at most 3 children", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    for (const n of ["A", "B", "C"]) expect((await addKid(token, n)).res.status).toBe(201);
    const fourth = await addKid(token, "D");
    expect(fourth.res.status).toBe(409);
    expect(fourth.body.error.code).toBe("child_limit");
  });

  it("only a parent account can manage children", async () => {
    const h = useServices();
    const { token } = await loginPhone(h, "9123456789", "student");
    expect((await addKid(token)).res.status).toBe(403);
    expect((await listChildren(req("/v1/parent/children", { token }))).status).toBe(403);
  });

  it("a parent cannot touch another parent's child", async () => {
    const h = useServices();
    const a = await parentWithPlan(h);
    const b = await loginPhone(h, "9123456789", "parent");
    const { body } = await addKid(a.token);
    expect((await patchChild(req("/v1/parent/children/x", { method: "PATCH", token: b.token, body: { enabled: false } }), ctx(body.child.id))).status).toBe(404);
    expect((await removeChild(req("/v1/parent/children/x", { method: "DELETE", token: b.token }), ctx(body.child.id))).status).toBe(404);
  });

  it("rejects bad input", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    expect((await addKid(token, "")).res.status).toBe(400);
    expect((await addKid(token, "x".repeat(41))).res.status).toBe(400);
    expect((await addChild(post("/v1/parent/children", { name: "Ok", admin: true }, token))).status).toBe(400);
  });
});

describe("child: signing in with the parent's code", () => {
  it("works with no phone number and no purchase, once", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    const { body } = await addKid(token);
    const first = await kidSignsIn(body.code);
    expect(first.res.status).toBe(200);
    expect(first.body.user).toMatchObject({ role: "child", name: "Ram" });
    const again = await kidSignsIn(body.code);
    expect(again.res.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_code");
  });

  it("accepts the code typed in lower case, without the dash, with spaces", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    const { body } = await addKid(token);
    expect(normalizeLinkCode(" " + body.code.toLowerCase().replace("-", " ") + " ")).not.toBeNull();
    expect((await kidSignsIn(body.code.toLowerCase().replace("-", " "))).res.status).toBe(200);
  });

  it("rejects wrong codes, and limits guessing to 20 an hour", async () => {
    const h = useServices();
    for (let i = 0; i < 20; i++) expect((await kidSignsIn("AAAA-BBBB")).res.status).toBe(400);
    const blocked = await kidSignsIn("AAAA-BBBB");
    expect(blocked.res.status).toBe(429);
  });

  it("the parent sees the child as linked", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    const { body } = await addKid(token);
    await kidSignsIn(body.code);
    const list = await (await listChildren(req("/v1/parent/children", { token }))).json();
    expect(list.children[0]).toMatchObject({ name: "Ram", linked: true });
    expect(list.max).toBe(3);
  });

  it("a new code signs the child out everywhere and the old code stops working", async () => {
    const h = useServices();
    const { token } = await parentWithPlan(h);
    const { body } = await addKid(token);
    const kid = (await kidSignsIn(body.code)).body;
    expect((await getSubscription(req("/v1/subscription", { token: kid.token }))).status).toBe(200);

    const fresh = await (await newCode(post("/x", {}, token), ctx(body.child.id))).json();
    expect((await getSubscription(req("/v1/subscription", { token: kid.token }))).status).toBe(401);
    expect((await kidSignsIn(body.code)).res.status).toBe(400);
    expect((await kidSignsIn(fresh.code)).res.status).toBe(200);
  });
});

describe("child: the parent's plan decides", () => {
  /** The parent has the Parent plan when adding the child (required), then the plan changes to [plan]. */
  async function kid(h: H, plan: "TRIAL" | "EXPIRED" | "NONE") {
    const parent = await parentWithPlan(h, "TRIAL");
    const { body } = await addKid(parent.token);
    const k = (await kidSignsIn(body.code)).body;
    h.repos.setSubscription(parent.user.id, {
      productId: "focus_parent", status: plan === "NONE" ? "NONE" : plan,
      expiresAt: plan === "NONE" ? null : new Date(Date.now() + (plan === "EXPIRED" ? -1 : 1) * 86_400_000), autoRenewing: true,
    });
    return { parent, childId: body.child.id as string, token: k.token as string };
  }
  const sub = async (token: string) => (await getSubscription(req("/v1/subscription", { token }))).json();

  it("a child uses the parent's trial, and sees whose plan it is", async () => {
    const h = useServices();
    const { token } = await kid(h, "TRIAL");
    expect(await sub(token)).toMatchObject({ status: "trial", via: "parent", paused: false });
  });

  it("when the parent has no plan the child has none either", async () => {
    const h = useServices();
    expect((await sub((await kid(h, "NONE")).token)).status).toBe("none");
    expect((await sub((await kid(useServices(), "EXPIRED")).token)).status).toBe("expired");
  });

  it("Buddy works for a child on a live parent plan, and says plan_required otherwise", async () => {
    const h = useServices();
    const { token } = await kid(h, "TRIAL");
    expect((await aiChat(post("/v1/ai/chat", { messages: [{ role: "user", content: "hi" }] }, token))).status).toBe(200);
    const h2 = useServices();
    const k2 = await kid(h2, "NONE");
    const res = await aiChat(post("/v1/ai/chat", { messages: [{ role: "user", content: "hi" }] }, k2.token));
    expect(res.status).toBe(402);
  });

  it("the parent can pause a child and resume them", async () => {
    const h = useServices();
    const { parent, childId, token } = await kid(h, "TRIAL");
    await patchChild(req("/x", { method: "PATCH", token: parent.token, body: { enabled: false } }), ctx(childId));
    expect(await sub(token)).toMatchObject({ status: "none", paused: true });
    const res = await aiChat(post("/v1/ai/chat", { messages: [{ role: "user", content: "hi" }] }, token));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("child_paused");

    await patchChild(req("/x", { method: "PATCH", token: parent.token, body: { enabled: true } }), ctx(childId));
    expect(await sub(token)).toMatchObject({ status: "trial", paused: false });
  });

  it("a child cannot buy a plan or delete their own account", async () => {
    const h = useServices();
    const { token } = await kid(h, "TRIAL");
    const { POST: subscribe } = await import("@/app/v1/payments/subscribe/route");
    const buy = await subscribe(post("/v1/payments/subscribe", { tier: "student" }, token));
    expect(buy.status).toBe(403);
    expect((await buy.json()).error.code).toBe("child_cannot_buy");
    const del = await deleteMe(req("/v1/users/me", { method: "DELETE", token }));
    expect(del.status).toBe(403);
    expect((await getSubscription(req("/v1/subscription", { token }))).status).toBe(200); // still signed in
  });

  it("removing the child signs them out and deletes what they saved", async () => {
    const h = useServices();
    const { parent, childId, token } = await kid(h, "TRIAL");
    await postSync(post("/v1/sync", backup(), token));
    expect((await removeChild(req("/x", { method: "DELETE", token: parent.token }), ctx(childId))).status).toBe(200);
    expect((await getSubscription(req("/v1/subscription", { token }))).status).toBe(401);
    expect((await (await listChildren(req("/v1/parent/children", { token: parent.token }))).json()).children).toEqual([]);
  });

  it("deleting the parent's account removes the children too", async () => {
    const h = useServices();
    const { parent, token } = await kid(h, "TRIAL");
    expect((await deleteMe(req("/v1/users/me", { method: "DELETE", token: parent.token }))).status).toBe(200);
    expect((await getSubscription(req("/v1/subscription", { token }))).status).toBe(401);
  });
});

describe("parent: seeing how a child is doing", () => {
  it("shows study minutes from the child's backup, as totals only", async () => {
    const h = useServices();
    const parent = await parentWithPlan(h);
    const { body } = await addKid(parent.token);
    const kid = (await kidSignsIn(body.code)).body;
    const now = Date.now();
    const sessions = [
      { startedAt: now - 3_600_000, endedAt: now - 1_800_000, mode: "Timer", subject: "Secret subject", plannedMin: 30, focusedMin: 30, completed: true, note: "private note" },
      { startedAt: now - 3 * 86_400_000, endedAt: now - 3 * 86_400_000 + 1, mode: "Timer", subject: "Maths", plannedMin: 45, focusedMin: 45, completed: true, note: "" },
    ];
    await postSync(post("/v1/sync", backup({ sessions }), kid.token));
    const text = await (await listChildren(req("/v1/parent/children", { token: parent.token }))).text();
    const child = JSON.parse(text).children[0];
    expect(child.stats.weekMin).toBe(75);
    expect(child.stats.sessions7d).toBe(2);
    expect(text).not.toContain("Secret subject");
    expect(text).not.toContain("private note");
  });

  it("summarizeChild ignores junk and counts the Indian day", () => {
    const now = new Date("2026-11-02T20:00:00Z"); // 01:30 on 3 Nov in India
    const s = summarizeChild({ sessions: [
      { startedAt: Date.parse("2026-11-02T19:00:00Z"), focusedMin: 20 }, // 00:30 3 Nov IST: today
      { startedAt: Date.parse("2026-11-02T17:00:00Z"), focusedMin: 10 }, // 22:30 2 Nov IST: yesterday
      { startedAt: "x", focusedMin: 99 }, { focusedMin: 5 }, null, { startedAt: now.getTime(), focusedMin: -4 },
    ] }, now);
    expect(s.todayMin).toBe(20);
    expect(s.weekMin).toBe(30);
    expect(summarizeChild(null, now)).toEqual({ todayMin: 0, weekMin: 0, sessions7d: 0, lastSessionAt: null });
  });
});

describe("uninstall unlock code", () => {
  async function setup(h: H) {
    const parent = await parentWithPlan(h);
    const { body } = await addKid(parent.token);
    const kid = (await kidSignsIn(body.code)).body;
    const make = async () => (await (await makeUnlock(post("/x", {}, parent.token), ctx(body.child.id))).json()).code as string;
    return { parent, kid: kid.token as string, childId: body.child.id as string, make };
  }
  const unlock = (token: string, code: string) => childUnlock(post("/v1/child/unlock", { code }, token));

  it("the right code unlocks once", async () => {
    const h = useServices();
    const { kid, make } = await setup(h);
    const code = await make();
    expect(code).toMatch(/^\d{6}$/);
    const ok = await unlock(kid, code);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ unlocked: true, validForSec: 600 });
    expect((await unlock(kid, code)).status).toBe(400); // used up
  });

  it("without a code from the parent, nothing unlocks", async () => {
    const h = useServices();
    const { kid } = await setup(h);
    const res = await unlock(kid, "123456");
    expect((await res.json()).error.code).toBe("no_unlock_code");
  });

  it("5 wrong tries lock the code out", async () => {
    const h = useServices();
    const { kid, make } = await setup(h);
    const real = await make();
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await (await unlock(kid, wrong)).json()).error.code).toBe("wrong_code");
    const locked = await unlock(kid, real);
    expect(locked.status).toBe(429);
    expect((await unlock(kid, real)).status).toBe(400); // and the code is gone
  });

  it("expires after 10 minutes", async () => {
    const h = useServices();
    const { kid, make } = await setup(h);
    const code = await make();
    jest.useFakeTimers({ now: Date.now() + 11 * 60_000, doNotFake: ["nextTick", "setImmediate", "setTimeout"] });
    try {
      expect((await (await unlock(kid, code)).json()).error.code).toBe("no_unlock_code");
    } finally {
      jest.useRealTimers();
    }
  });

  it("a code made for one child does not unlock another", async () => {
    const h = useServices();
    const a = await setup(h);
    const bBody = (await addKid(a.parent.token, "Shyam")).body;
    const b = (await kidSignsIn(bBody.code)).body.token as string;
    const code = await a.make();
    expect((await unlock(b, code)).status).toBe(400);
  });

  it("only a child can use the unlock endpoint", async () => {
    const h = useServices();
    const { parent } = await setup(h);
    expect((await unlock(parent.token, "123456")).status).toBe(403);
  });

  it("only the owning parent can make a code", async () => {
    const h = useServices();
    const { childId } = await setup(h);
    const other = await loginPhone(h, "9123456789", "parent");
    expect((await makeUnlock(post("/x", {}, other.token), ctx(childId))).status).toBe(404);
  });
});
