/**
 * Runs the plain-SQL repositories against a real MySQL. Skipped unless TEST_DATABASE_URL is set:
 *   1. create an empty database, 2. DATABASE_URL=<url> npm run db:migrate, 3. TEST_DATABASE_URL=<url> npm test
 * It EMPTIES the tables it uses, so never point it at data you care about.
 */
import { createFakeAiClient } from "@/server/ai/fake";
import { GET as getSync, POST as postSync } from "@/app/v1/sync/route";
import { GET as getSubscription } from "@/app/v1/subscription/route";
import { DELETE as deleteMe, POST as upsertMe } from "@/app/v1/users/me/route";
import { parseEnv } from "@/server/config/env";
import { setServicesForTests } from "@/server/container";
import { getPool } from "@/server/db/pool";
import { createMysqlLimiter, createMysqlRepos } from "@/server/db/mysqlRepos";
import { backup, createRecordingSms, fakePay, fakeVerifier, req, TEST_SECRET } from "./helpers";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("MySQL repositories (real database)", () => {
  const pool = getPool(url ?? "mysql://unused");
  const repos = createMysqlRepos(pool);

  beforeEach(async () => {
    await pool.query("DELETE FROM users"); // cascades to subscriptions, session_backups, ai_usage
    await pool.query("DELETE FROM rate_limits");
    await pool.query("DELETE FROM payments");
    await pool.query("DELETE FROM pay_events");
    await pool.query("DELETE FROM app_settings");
    await pool.query("DELETE FROM announcements");
    await pool.query("DELETE FROM recommended_apps");
    setServicesForTests({
      env: parseEnv({ NODE_ENV: "test", RATE_LIMIT_PER_MIN: "1000" }),
      verifier: fakeVerifier(),
      sms: createRecordingSms(),
      pay: fakePay().gateway,
      ai: createFakeAiClient(),
      authSecret: TEST_SECRET,
      repos,
      limiter: createMysqlLimiter(pool),
      ping: async () => true,
    });
  });

  afterAll(async () => {
    setServicesForTests(undefined);
    await pool.end();
  });

  it("creates a user with defaults, then updates only the fields that were sent", async () => {
    const a = await repos.users.upsertByAuthUid("u1", { name: "Asha", email: "a@x.in", exam: "JEE", dailyGoalMin: 300 });
    expect(a).toMatchObject({ authUid: "u1", name: "Asha", email: "a@x.in", exam: "JEE", dailyGoalMin: 300 });
    expect(a.id).toHaveLength(36);

    const b = await repos.users.upsertByAuthUid("u1", { exam: "NEET" });
    expect(b).toMatchObject({ id: a.id, name: "Asha", email: "a@x.in", exam: "NEET", dailyGoalMin: 300 });

    const c = await repos.users.upsertByAuthUid("u2", {});
    expect(c).toMatchObject({ name: null, exam: null, dailyGoalMin: 240 });
    expect(await repos.users.findByAuthUid("nobody")).toBeNull();
  });

  it("reads a subscription with its UTC end time", async () => {
    const u = await repos.users.upsertByAuthUid("u1", {});
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, product_id, purchase_token, status, expires_at, auto_renewing, acknowledged, created_at, updated_at)
       VALUES (UUID(), ?, 'focus_student', 'tok-1', 'TRIAL', '2030-01-02 03:04:05.000', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [u.id],
    );
    const s = await repos.subscriptions.findByUserId(u.id);
    expect(s).toEqual({ productId: "focus_student", status: "TRIAL", expiresAt: new Date("2030-01-02T03:04:05.000Z"), autoRenewing: true });
    expect(await repos.subscriptions.findByUserId("0000")).toBeNull();
  });

  it("stores a backup as JSON, including Hindi text, and replaces it on the next put", async () => {
    const u = await repos.users.upsertByAuthUid("u1", {});
    const first = backup({ tags: ["भौतिकी", "Chemistry"] });
    const t1 = await repos.backups.put(u.id, first);
    expect((await repos.backups.get(u.id))?.payload).toEqual(first);

    await repos.backups.put(u.id, backup({ tags: ["Maths"] }));
    const got = await repos.backups.get(u.id);
    expect((got!.payload as { tags: string[] }).tags).toEqual(["Maths"]);
    expect(got!.updatedAt.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    const [[count]] = (await pool.query("SELECT COUNT(*) AS n FROM session_backups")) as unknown as [[{ n: number }]];
    expect(count.n).toBe(1);
  });

  it("deleting a user removes their subscription and backup too", async () => {
    const u = await repos.users.upsertByAuthUid("u1", {});
    await repos.backups.put(u.id, backup());
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, product_id, purchase_token, status, created_at, updated_at)
       VALUES (UUID(), ?, 'focus_student', 'tok-2', 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [u.id],
    );
    expect(await repos.users.deleteByAuthUid("u1")).toBe(true);
    expect(await repos.users.deleteByAuthUid("u1")).toBe(false);
    for (const table of ["subscriptions", "session_backups"]) {
      const [rows] = (await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)) as unknown as [[{ n: number }]];
      expect(rows[0].n).toBe(0);
    }
  });

  it("rate limiter counts per key and window", async () => {
    const limiter = createMysqlLimiter(pool, () => 1_800_000_000_000);
    const r1 = await limiter.hit("k", 2, 60);
    const r2 = await limiter.hit("k", 2, 60);
    const r3 = await limiter.hit("k", 2, 60);
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, false]);
    expect(r3.remaining).toBe(0);
    expect((await limiter.hit("other", 2, 60)).allowed).toBe(true);
    const later = createMysqlLimiter(pool, () => 1_800_000_000_000 + 61_000);
    expect((await later.hit("k", 2, 60)).allowed).toBe(true); // next window
  });

  it("the real routes work end to end on MySQL", async () => {
    const me = await upsertMe(req("/v1/users/me", { method: "POST", token: "tok-asha", body: { name: "Asha K", exam: "NEET" } }));
    expect(await me.json()).toMatchObject({ name: "Asha K", exam: "NEET" });

    expect(await (await getSubscription(req("/v1/subscription", { token: "tok-asha" }))).json()).toMatchObject({ status: "none", expiresAt: null });

    expect((await getSync(req("/v1/sync", { token: "tok-asha" }))).status).toBe(404);
    const body = backup({ tags: ["जीव विज्ञान"] });
    expect((await postSync(req("/v1/sync", { method: "POST", token: "tok-asha", body }))).status).toBe(200);
    expect((await (await getSync(req("/v1/sync", { token: "tok-asha" }))).json()).payload).toEqual(body);

    expect((await getSync(req("/v1/sync", { token: "tok-ravi" }))).status).toBe(404); // someone else sees nothing

    expect((await deleteMe(req("/v1/users/me", { method: "DELETE", token: "tok-asha" }))).status).toBe(200);
    expect((await getSync(req("/v1/sync", { token: "tok-asha" }))).status).toBe(404);
  });

  it("stores login codes and sessions, and deleting the user ends their sessions", async () => {
    const u = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    await repos.auth.saveOtp("+919876543210", "a".repeat(64), new Date(Date.now() + 60_000));
    expect(await repos.auth.addOtpAttempt("+919876543210")).toBe(1);
    expect((await repos.auth.getOtp("+919876543210"))?.attempts).toBe(1);
    await repos.auth.saveOtp("+919876543210", "b".repeat(64), new Date(Date.now() + 60_000)); // resets attempts
    expect(await repos.auth.getOtp("+919876543210")).toMatchObject({ codeHash: "b".repeat(64), attempts: 0 });
    await repos.auth.deleteOtp("+919876543210");
    expect(await repos.auth.getOtp("+919876543210")).toBeNull();

    await repos.auth.createSession(u.id, "c".repeat(64), new Date(Date.now() + 60_000));
    await repos.auth.createSession(u.id, "d".repeat(64), new Date(Date.now() - 1000)); // already expired
    expect(await repos.auth.findSession("c".repeat(64))).toEqual({ authUid: "ph:+919876543210", phone: "+919876543210" });
    expect(await repos.auth.findSession("d".repeat(64))).toBeNull();
    await repos.users.deleteByAuthUid("ph:+919876543210");
    expect(await repos.auth.findSession("c".repeat(64))).toBeNull();
  });

  it("saves a purchase, replaces it on re-subscribe, finds it by token, and dedupes notifications", async () => {
    const u = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    const base = {
      productId: "focus_student", linkedPurchaseToken: null, status: "TRIAL" as const, expiresAt: new Date("2030-01-02T03:04:05.000Z"),
      autoRenewing: true, acknowledged: false, latestOrderId: "GPA.1", playState: "SUBSCRIPTION_STATE_ACTIVE",
    };
    await repos.subscriptions.save(u.id, { ...base, purchaseToken: "token-one-0000" });
    expect(await repos.subscriptions.findByToken("token-one-0000")).toMatchObject({ userId: u.id, status: "TRIAL", acknowledged: false, autoRenewing: true });

    await repos.subscriptions.save(u.id, { ...base, purchaseToken: "token-two-0000", linkedPurchaseToken: "token-one-0000", status: "ACTIVE", acknowledged: true });
    expect(await repos.subscriptions.findByToken("token-one-0000")).toBeNull();
    expect(await repos.subscriptions.findByUserId(u.id)).toEqual({ productId: "focus_student", status: "ACTIVE", expiresAt: base.expiresAt, autoRenewing: true });
    const [[count]] = (await pool.query("SELECT COUNT(*) AS n FROM subscriptions")) as unknown as [[{ n: number }]];
    expect(count.n).toBe(1);
    expect(await repos.subscriptions.findRowByUserId(u.id)).toMatchObject({ purchaseToken: "token-two-0000", status: "ACTIVE" });
  });

  it("keeps settings, checkout attempts and payments; a payment outlives its user; webhook events dedupe", async () => {
    await repos.settings.set("rzp_key_id", "rzp_test_abcdefgh1234", false, "admin@x");
    await repos.settings.set("rzp_key_id", "rzp_test_zzzzzzzz9999", false, "admin@x");
    expect(await repos.settings.get("rzp_key_id")).toBe("rzp_test_zzzzzzzz9999");
    await repos.settings.remove("rzp_key_id");
    expect(await repos.settings.get("rzp_key_id")).toBeNull();

    const u = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    await repos.payments.addAttempt({ subscriptionId: "sub_test0001", userId: u.id, tier: "parent", amountPaise: 9900, trial: true });
    expect(await repos.payments.findAttempt("sub_test0001")).toEqual({ subscriptionId: "sub_test0001", userId: u.id, tier: "parent", amountPaise: 9900, trial: true });
    const base = {
      userId: u.id, subscriptionId: "sub_test0001", tier: "parent" as const, amountPaise: 9900, currency: "INR", method: "upi", detail: "a@upi",
      phone: "+919876543210", email: null, errorCode: null, errorText: null, createdAt: new Date("2030-01-02T03:04:05.000Z"),
    };
    await repos.payments.upsertPayment({ ...base, paymentId: "pay_test0001", status: "authorized" });
    await repos.payments.upsertPayment({ ...base, paymentId: "pay_test0001", status: "captured", method: null });
    const list = await repos.payments.listForUser(u.id, 10);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "captured", method: "upi", detail: "a@upi" });

    expect(await repos.payments.recordEvent("evt_1")).toBe(true);
    expect(await repos.payments.recordEvent("evt_1")).toBe(false);

    await repos.users.deleteByAuthUid("ph:+919876543210");
    expect(await repos.payments.findAttempt("sub_test0001")).toBeNull();
    const [[kept]] = (await pool.query("SELECT COUNT(*) AS n, MAX(user_id IS NULL) AS orphan FROM payments")) as unknown as [[{ n: number; orphan: number }]];
    expect(kept).toMatchObject({ n: 1, orphan: 1 });
  });

  it("counts AI chats atomically up to the limit, refunds, and caches the nudge", async () => {
    const u = await repos.users.upsertByAuthUid("ph:+919876543210", {});
    const day = "2026-11-02";
    const results = await Promise.all(Array.from({ length: 6 }, () => repos.ai.useChat(u.id, day, 3))); // simultaneous messages
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(await repos.ai.useChat(u.id, day, 3)).toEqual({ allowed: false, remaining: 0 });
    await repos.ai.refundChat(u.id, day);
    expect(await repos.ai.useChat(u.id, day, 3)).toEqual({ allowed: true, remaining: 0 });
    expect((await repos.ai.useChat(u.id, "2026-11-03", 3)).remaining).toBe(2); // a new day starts at zero

    expect(await repos.ai.getNudge(u.id, day)).toBeNull();
    await repos.ai.saveNudge(u.id, day, "Go, तुम कर सकते हो");
    expect((await repos.ai.getNudge(u.id, day))?.text).toBe("Go, तुम कर सकते हो");
  });

  it("stores the prep goal and the day's tip lines, including Hindi", async () => {
    const u = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210", prepGoal: "JEE Main 2027" });
    expect(u.prepGoal).toBe("JEE Main 2027");
    expect((await repos.users.upsertByAuthUid("ph:+919876543210", {})).prepGoal).toBe("JEE Main 2027"); // empty update keeps it
    expect((await repos.users.upsertByAuthUid("ph:+919876543210", { prepGoal: "NEET UG" })).prepGoal).toBe("NEET UG");

    expect(await repos.ai.getTips(u.id, "2026-11-02")).toBeNull();
    await repos.ai.saveTips(u.id, "2026-11-02", ["एक टिप", "two", "three"]);
    expect(await repos.ai.getTips(u.id, "2026-11-02")).toEqual(["एक टिप", "two", "three"]);
  });

  it("stores parents and children: codes, pausing, unlock codes, and cascades", async () => {
    const parent = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210", role: "parent" });
    expect(parent.role).toBe("parent");
    expect((await repos.users.upsertByAuthUid("ph:+919876543210", { role: "student" })).role).toBe("parent"); // role never changes

    const soon = new Date(Date.now() + 60_000);
    const kid = await repos.family.createChild(parent.id, "राम", "JEE 2028", "a".repeat(64), soon);
    expect(kid).toMatchObject({ name: "राम", prepGoal: "JEE 2028", enabled: true, linked: false, parentUserId: parent.id });
    expect(await repos.family.countChildren(parent.id)).toBe(1);
    expect((await repos.users.findByAuthUid(`ch:${kid.id}`))?.role).toBe("child");

    expect((await repos.family.findByLinkCodeHash("a".repeat(64)))?.id).toBe(kid.id);
    expect(await repos.family.findByLinkCodeHash("b".repeat(64))).toBeNull();
    await repos.family.consumeLinkCode(kid.id);
    expect(await repos.family.findByLinkCodeHash("a".repeat(64))).toBeNull();
    expect((await repos.family.getChild(parent.id, kid.id))?.linked).toBe(true);
    await repos.family.setLinkCode(kid.id, "c".repeat(64), new Date(Date.now() - 1000)); // already expired
    expect(await repos.family.findByLinkCodeHash("c".repeat(64))).toBeNull();

    await repos.family.updateChild(kid.id, { enabled: false, name: "Ram" });
    expect(await repos.family.findChildByUserId(kid.userId)).toMatchObject({ enabled: false, name: "Ram" });

    expect(await repos.family.getUnlock(kid.id)).toBeNull();
    await repos.family.setUnlockCode(kid.id, "d".repeat(64), soon);
    await repos.family.addUnlockAttempt(kid.id);
    expect(await repos.family.getUnlock(kid.id)).toMatchObject({ codeHash: "d".repeat(64), attempts: 1 });
    await repos.family.clearUnlock(kid.id);
    expect(await repos.family.getUnlock(kid.id)).toBeNull();

    await repos.auth.createSession(kid.userId, "e".repeat(64), soon);
    await repos.auth.deleteSessionsForUser(kid.userId);
    expect(await repos.auth.findSession("e".repeat(64))).toBeNull();

    const second = await repos.family.createChild(parent.id, "Shyam", null, "f".repeat(64), soon);
    await repos.family.deleteChild(kid.id);
    expect(await repos.users.findByAuthUid(`ch:${kid.id}`)).toBeNull();
    expect(await repos.family.countChildren(parent.id)).toBe(1);

    // deleting the parent removes the remaining child's own user row too
    expect(await repos.users.deleteByAuthUid("ph:+919876543210")).toBe(true);
    expect(await repos.users.findByAuthUid(`ch:${second.id}`)).toBeNull();
    const [[left]] = (await pool.query("SELECT COUNT(*) AS n FROM children")) as unknown as [[{ n: number }]];
    expect(left.n).toBe(0);
  });

  it("announcements: audience filter, cursor, age window, and the plan product in findByUserId", async () => {
    const stu = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    const par = await repos.users.upsertByAuthUid("ph:+919111111111", { phone: "+919111111111", role: "parent" });
    const a = await repos.announcements.create({ title: "hello", body: "all of you", audience: "all", createdBy: "admin@x" });
    const b = await repos.announcements.create({ title: "parents", body: "p", audience: "parents", createdBy: "admin@x" });
    const c = await repos.announcements.create({ title: "just stu", body: "s", audience: "user", targetUserId: stu.id, createdBy: "admin@x" });
    const long = new Date(Date.now() - 86_400_000);
    expect((await repos.announcements.listFor({ id: stu.id, role: "student" }, 0, long, 5)).map((x) => x.id)).toEqual([a.id, c.id]);
    expect((await repos.announcements.listFor({ id: par.id, role: "parent" }, 0, long, 5)).map((x) => x.id)).toEqual([a.id, b.id]);
    expect((await repos.announcements.listFor({ id: stu.id, role: "student" }, a.id, long, 5)).map((x) => x.id)).toEqual([c.id]);
    expect(await repos.announcements.listFor({ id: stu.id, role: "student" }, 0, new Date(Date.now() + 60_000), 5)).toEqual([]); // all older than the window

    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, product_id, purchase_token, status, expires_at, created_at, updated_at)
       VALUES (UUID(), ?, 'focus_parent', 'tok-parent-1', 'ACTIVE', '2030-01-01 00:00:00.000', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [par.id],
    );
    expect((await repos.subscriptions.findByUserId(par.id))?.productId).toBe("focus_parent");
  });

  it("plan prices start at 49 / 99 and can be changed", async () => {
    expect(await repos.planPrices.get()).toEqual({ student: 49, parent: 99 });
    await repos.planPrices.set({ student: 59, parent: 129 }, "admin@x");
    expect(await repos.planPrices.get()).toEqual({ student: 59, parent: 129 });
    await repos.planPrices.set({ student: 49, parent: 99 }, "admin@x"); // put the real defaults back
  });

  it("a student can be made a parent, but a child never changes role", async () => {
    const stu = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    await repos.users.setRole(stu.id, "parent");
    expect((await repos.users.findByAuthUid("ph:+919876543210"))?.role).toBe("parent");
    const kid = await repos.family.createChild(stu.id, "Ram", null, "9".repeat(64), new Date(Date.now() + 60_000));
    await repos.users.setRole(kid.userId, "parent");
    expect((await repos.users.findByAuthUid(`ch:${kid.id}`))?.role).toBe("child");
  });

  it("recommended apps: logo bytes, keywords as JSON, edits and delete", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([1, 2, 3, 250, 251])]);
    const a = await repos.recommendedApps.create({ name: "GATE Pro", tagline: "GATE mocks", url: "https://example.com/g", keywords: ["gate", "gate cse"], logo: { type: "image/png", bytes: png }, createdBy: "admin@x" });
    expect(a).toMatchObject({ name: "GATE Pro", keywords: ["gate", "gate cse"], hasLogo: true, active: true });
    const logo = await repos.recommendedApps.getLogo(a.id);
    expect(logo?.type).toBe("image/png");
    expect(logo?.bytes.equals(png)).toBe(true);

    const noLogo = await repos.recommendedApps.create({ name: "JEE", tagline: "t", url: "https://example.com/j", keywords: ["jee"], createdBy: "admin@x" });
    expect(noLogo.hasLogo).toBe(false);
    expect(await repos.recommendedApps.getLogo(noLogo.id)).toBeNull();

    await repos.recommendedApps.update(a.id, { name: "GATE Pro 2", keywords: ["gate", "psu"], active: false });
    expect(await repos.recommendedApps.get(a.id)).toMatchObject({ name: "GATE Pro 2", keywords: ["gate", "psu"], active: false, hasLogo: true }); // logo kept
    expect((await repos.recommendedApps.list()).map((x) => x.id)).toEqual([a.id, noLogo.id]);
    await repos.recommendedApps.remove(a.id);
    expect(await repos.recommendedApps.get(a.id)).toBeNull();
  });

  it("hand-assigned apps: assign twice is harmless, listed per user, removed with the app or the user", async () => {
    const u1 = await repos.users.upsertByAuthUid("ph:+919876543210", { phone: "+919876543210" });
    const u2 = await repos.users.upsertByAuthUid("ph:+919111111111", { phone: "+919111111111" });
    const a = await repos.recommendedApps.create({ name: "A", tagline: "t", url: "https://example.com/a", keywords: ["a1"], createdBy: "x" });
    const b = await repos.recommendedApps.create({ name: "B", tagline: "t", url: "https://example.com/b", keywords: ["b1"], createdBy: "x" });
    await repos.recommendedApps.assign(u1.id, a.id, "admin@x");
    await repos.recommendedApps.assign(u1.id, a.id, "admin@x");
    await repos.recommendedApps.assign(u1.id, b.id, "admin@x");
    await repos.recommendedApps.assign(u2.id, b.id, "admin@x");
    const m = await repos.recommendedApps.assignedFor([u1.id, u2.id, "nobody"]);
    expect(m.get(u1.id)).toEqual([a.id, b.id]);
    expect(m.get(u2.id)).toEqual([b.id]);
    expect(m.has("nobody")).toBe(false);
    expect((await repos.recommendedApps.assignedFor([])).size).toBe(0);

    await repos.recommendedApps.unassign(u1.id, a.id);
    expect((await repos.recommendedApps.assignedFor([u1.id])).get(u1.id)).toEqual([b.id]);
    await repos.recommendedApps.remove(b.id);
    expect((await repos.recommendedApps.assignedFor([u1.id, u2.id])).size).toBe(0);
  });
});
