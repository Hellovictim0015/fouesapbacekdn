import { POST as cancel } from "@/app/v1/payments/cancel/route";
import { POST as subscribe } from "@/app/v1/payments/subscribe/route";
import { POST as verify } from "@/app/v1/payments/verify/route";
import { POST as webhook } from "@/app/v1/payments/webhook/route";
import { GET as getSubscription } from "@/app/v1/subscription/route";
import { setServicesForTests } from "@/server/container";
import { decryptSecret, encryptSecret, hmacHex } from "@/server/pay/crypto";
import { mapRazorpaySubscription } from "@/server/pay/mapping";
import { clearRazorpayKeys, createPayGateway, razorpayStatus, saveRazorpayKeys } from "@/server/pay/settings";
import { parseEnv } from "@/server/config/env";
import { createMemoryRepos } from "@/server/repos/memory";
import { purchase, req, TEST_KEY_SECRET, TEST_WEBHOOK_SECRET, TEST_SECRET, useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);
const post = (path: string, body: unknown, token?: string) => req(path, { method: "POST", token, body });
const sub = async (token: string) => (await getSubscription(req("/v1/subscription", { token }))).json();

describe("POST /v1/payments/subscribe", () => {
  it("charges the admin's price in paise and gives a first-timer a 3-day trial", async () => {
    const h = useServices();
    await h.repos.planPrices.set({ student: 59, parent: 119 }, "admin");
    const res = await subscribe(post("/v1/payments/subscribe", { tier: "parent" }, "tok-alice"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ keyId: "rzp_test_abcdefgh1234", amountPaise: 11900, trialDays: 3, tier: "parent", fake: false });
    const created = h.rzp.subs.get(body.subscriptionId)!;
    expect(created.start_at! - nowSec()).toBeGreaterThan(3 * DAY - 60);
    expect(created.notes).toMatchObject({ tier: "parent" });
    expect(await h.repos.payments.findAttempt(body.subscriptionId)).toMatchObject({ tier: "parent", amountPaise: 11900, trial: true });
  });

  it("gives no trial to someone who has subscribed before", async () => {
    const h = useServices();
    const first = await purchase(h, "tok-alice", "student");
    expect(first.verifyStatus).toBe(200);
    h.repos.setSubscription((await h.repos.users.findByAuthUid("alice"))!.id, { productId: "focus_student", status: "EXPIRED", expiresAt: new Date(Date.now() - 1000), autoRenewing: false });
    const body = await (await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"))).json();
    expect(body.trialDays).toBe(0);
    expect(h.rzp.subs.get(body.subscriptionId)!.start_at).toBeNull();
  });

  it("refuses the same plan twice and unknown plans, and 503s without keys", async () => {
    const h = useServices();
    await purchase(h, "tok-alice", "student");
    const again = await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"));
    expect(again.status).toBe(409);
    expect((await subscribe(post("/v1/payments/subscribe", { tier: "gold" }, "tok-alice"))).status).toBe(400);
    h.services.pay = { get: async () => null };
    const none = await subscribe(post("/v1/payments/subscribe", { tier: "parent" }, "tok-alice"));
    expect(none.status).toBe(503);
    expect((await none.json()).error.code).toBe("payments_not_configured");
  });

  it("needs a signed-in user", async () => {
    useServices();
    expect((await subscribe(post("/v1/payments/subscribe", { tier: "student" }))).status).toBe(401);
  });
});

describe("POST /v1/payments/verify", () => {
  it("unlocks the plan and records the payment for the admin", async () => {
    const h = useServices();
    const bought = await purchase(h, "tok-alice", "student");
    expect(bought.verifyStatus).toBe(200);
    expect(await sub("tok-alice")).toMatchObject({ status: "active", tier: "student" });
    const user = (await h.repos.users.findByAuthUid("alice"))!;
    const [pay] = await h.repos.payments.listForUser(user.id, 5);
    expect(pay).toMatchObject({ paymentId: bought.paymentId, status: "captured", method: "upi", detail: "test@upi", tier: "student", amountPaise: 4900, subscriptionId: bought.subscriptionId });
  });

  it("starts a TRIAL until the first charge when the user authorised a free-trial subscription", async () => {
    const h = useServices();
    const body = await (await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"))).json();
    h.rzp.advance(body.subscriptionId, "authenticated");
    const paymentId = "pay_trial00001";
    const signature = hmacHex(TEST_KEY_SECRET, `${paymentId}|${body.subscriptionId}`);
    const res = await verify(post("/v1/payments/verify", { subscriptionId: body.subscriptionId, paymentId, signature }, "tok-alice"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "trial", tier: "student" });
  });

  it("a Parent purchase turns a student into a parent", async () => {
    const h = useServices();
    await purchase(h, "tok-alice", "parent");
    expect((await h.repos.users.findByAuthUid("alice"))!.role).toBe("parent");
  });

  it("rejects a wrong signature and gives nothing", async () => {
    const h = useServices();
    const body = await (await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"))).json();
    h.rzp.advance(body.subscriptionId, "active");
    const res = await verify(post("/v1/payments/verify", { subscriptionId: body.subscriptionId, paymentId: "pay_forged0001", signature: hmacHex("wrong-secret", `pay_forged0001|${body.subscriptionId}`) }, "tok-alice"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_signature");
    expect(await sub("tok-alice")).toMatchObject({ status: "none" });
  });

  it("will not let another account claim someone's checkout", async () => {
    const h = useServices();
    const body = await (await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"))).json();
    h.rzp.advance(body.subscriptionId, "active");
    const signature = hmacHex(TEST_KEY_SECRET, `pay_stolen00001|${body.subscriptionId}`);
    await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-bob")); // bob exists
    const res = await verify(post("/v1/payments/verify", { subscriptionId: body.subscriptionId, paymentId: "pay_stolen00001", signature }, "tok-bob"));
    expect(res.status).toBe(404);
    expect(await sub("tok-bob")).toMatchObject({ status: "none" });
  });

  it("does not unlock a subscription Razorpay says is still only created", async () => {
    const h = useServices();
    const body = await (await subscribe(post("/v1/payments/subscribe", { tier: "student" }, "tok-alice"))).json();
    const signature = hmacHex(TEST_KEY_SECRET, `pay_early000001|${body.subscriptionId}`);
    const res = await verify(post("/v1/payments/verify", { subscriptionId: body.subscriptionId, paymentId: "pay_early000001", signature }, "tok-alice"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "none" });
  });
});

describe("POST /v1/payments/cancel", () => {
  it("stops renewal but keeps access until the paid period ends", async () => {
    const h = useServices();
    await purchase(h, "tok-alice", "student");
    const res = await cancel(post("/v1/payments/cancel", {}, "tok-alice"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "active" });
    expect(h.rzp.cancelled).toHaveLength(1);
    const user = (await h.repos.users.findByAuthUid("alice"))!;
    expect((await h.repos.subscriptions.findByUserId(user.id))!.autoRenewing).toBe(false);
  });

  it("404s when there is nothing to cancel", async () => {
    useServices();
    expect((await cancel(post("/v1/payments/cancel", {}, "tok-alice"))).status).toBe(404);
  });
});

describe("POST /v1/payments/webhook", () => {
  const send = (body: unknown, opts: { secret?: string; eventId?: string; noSig?: boolean } = {}) => {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!opts.noSig) headers["x-razorpay-signature"] = hmacHex(opts.secret ?? TEST_WEBHOOK_SECRET, raw);
    if (opts.eventId) headers["x-razorpay-event-id"] = opts.eventId;
    return webhook(new Request("http://localhost/v1/payments/webhook", { method: "POST", headers, body: raw }));
  };

  it("rejects a missing or wrong signature", async () => {
    useServices();
    expect((await send({ event: "x" }, { noSig: true })).status).toBe(401);
    expect((await send({ event: "x" }, { secret: "nope" })).status).toBe(401);
  });

  it("moves the plan to grace when a renewal fails, and back to active when it is paid", async () => {
    const h = useServices();
    const bought = await purchase(h, "tok-alice", "student");
    const id = bought.subscriptionId!;
    h.rzp.advance(id, "pending");
    const failed = await send({ event: "subscription.pending", payload: { subscription: { entity: { id } } } }, { eventId: "evt_a" });
    expect(failed.status).toBe(200);
    expect(await sub("tok-alice")).toMatchObject({ status: "grace" });

    h.rzp.advance(id, "active", { current_end: nowSec() + 30 * DAY });
    await send({ event: "subscription.charged", payload: { subscription: { entity: { id } } } }, { eventId: "evt_b" });
    expect(await sub("tok-alice")).toMatchObject({ status: "active" });
  });

  it("ends access when Razorpay halts the subscription, and ignores a repeated event id", async () => {
    const h = useServices();
    const id = (await purchase(h, "tok-alice", "student")).subscriptionId!;
    h.rzp.advance(id, "halted");
    const first = await send({ event: "subscription.halted", payload: { subscription: { entity: { id } } } }, { eventId: "evt_c" });
    expect((await first.json()).result).toBe("ok");
    expect(await sub("tok-alice")).toMatchObject({ status: "expired" });
    h.rzp.advance(id, "active");
    const again = await send({ event: "subscription.halted", payload: { subscription: { entity: { id } } } }, { eventId: "evt_c" });
    expect((await again.json()).result).toBe("duplicate");
    expect(await sub("tok-alice")).toMatchObject({ status: "expired" });
  });

  it("logs a failed payment for the admin", async () => {
    const h = useServices();
    const id = (await purchase(h, "tok-alice", "student")).subscriptionId!;
    await send(
      { event: "payment.failed", payload: { payment: { entity: { id: "pay_failed00001", subscription_id: id, amount: 4900, currency: "INR", status: "failed", method: "card", card: { network: "Visa", last4: "4242" }, error_code: "BAD_REQUEST_ERROR", error_description: "Card declined" } } } },
      { eventId: "evt_d" },
    );
    const user = (await h.repos.users.findByAuthUid("alice"))!;
    const list = await h.repos.payments.listForUser(user.id, 10);
    expect(list.find((p) => p.paymentId === "pay_failed00001")).toMatchObject({ status: "failed", detail: "Visa ••4242", errorText: "Card declined" });
  });
});

describe("mapping Razorpay states", () => {
  const now = new Date("2030-06-01T00:00:00Z");
  const t = (d: string) => Math.floor(new Date(d).getTime() / 1000);

  it("trial: authenticated before start_at is TRIAL until start_at", () => {
    expect(mapRazorpaySubscription({ id: "s", status: "authenticated", start_at: t("2030-06-04T00:00:00Z") }, true, now)).toMatchObject({ status: "TRIAL", autoRenewing: true });
  });
  it("no trial: authenticated is not access yet", () => {
    expect(mapRazorpaySubscription({ id: "s", status: "authenticated" }, false, now).status).toBe("NONE");
  });
  it("active until current_end, expired after", () => {
    expect(mapRazorpaySubscription({ id: "s", status: "active", current_end: t("2030-06-20T00:00:00Z") }, false, now).status).toBe("ACTIVE");
    expect(mapRazorpaySubscription({ id: "s", status: "active", current_end: t("2030-05-20T00:00:00Z") }, false, now).status).toBe("EXPIRED");
  });
  it("pending gives 3 days of grace", () => {
    const m = mapRazorpaySubscription({ id: "s", status: "pending", current_end: t("2030-05-31T00:00:00Z") }, false, now);
    expect(m.status).toBe("GRACE");
    expect(m.expiresAt!.toISOString()).toBe("2030-06-03T00:00:00.000Z");
  });
  it("cancelled keeps what is paid, no renewal", () => {
    expect(mapRazorpaySubscription({ id: "s", status: "cancelled", current_end: t("2030-06-20T00:00:00Z") }, false, now)).toMatchObject({ status: "ACTIVE", autoRenewing: false });
    expect(mapRazorpaySubscription({ id: "s", status: "cancelled", current_end: t("2030-05-20T00:00:00Z") }, false, now).status).toBe("EXPIRED");
  });
  it("halted, paused, completed and unknown states give no access", () => {
    for (const status of ["halted", "paused", "completed", "expired", "something_new"]) {
      expect(mapRazorpaySubscription({ id: "s", status, current_end: t("2030-06-20T00:00:00Z") }, false, now).status).toBe("EXPIRED");
    }
  });
});

describe("keys saved in the admin panel", () => {
  const env = parseEnv({ NODE_ENV: "test" });

  it("encrypts secrets, never stores them in the clear, and rejects a changed AUTH_SECRET", async () => {
    const enc = encryptSecret(TEST_SECRET, "my-key-secret");
    expect(enc).not.toContain("my-key-secret");
    expect(decryptSecret(TEST_SECRET, enc)).toBe("my-key-secret");
    expect(decryptSecret("another-secret-another-secret-12345", enc)).toBeNull();
    expect(decryptSecret(TEST_SECRET, enc.replace(/:[^:]*$/, ":AAAA"))).toBeNull();
  });

  it("saves keys, reports only a hint, keeps the secret when left blank, and clears", async () => {
    const repos = createMemoryRepos();
    expect(await razorpayStatus(repos.settings, env, TEST_SECRET)).toMatchObject({ keyId: null, secretSet: false, source: "none" });
    await saveRazorpayKeys(repos.settings, TEST_SECRET, { keyId: "rzp_test_abcdefgh1234", keySecret: "secret-abcdef-9876", webhookSecret: "hook-1234" }, "admin@x");
    const st = await razorpayStatus(repos.settings, env, TEST_SECRET);
    expect(st).toMatchObject({ keyId: "rzp_test_abcdefgh1234", mode: "test", secretSet: true, secretHint: "••••9876", webhookSecretSet: true, source: "admin" });
    expect(JSON.stringify(st)).not.toContain("secret-abcdef");

    await saveRazorpayKeys(repos.settings, TEST_SECRET, { keyId: "rzp_live_abcdefgh1234", keySecret: "", webhookSecret: "" }, "admin@x");
    expect(await razorpayStatus(repos.settings, env, TEST_SECRET)).toMatchObject({ mode: "live", secretHint: "••••9876", webhookSecretSet: true });
    const gw = await createPayGateway(repos.settings, env, TEST_SECRET).get();
    expect(gw?.config).toMatchObject({ keyId: "rzp_live_abcdefgh1234", keySecret: "secret-abcdef-9876", webhookSecret: "hook-1234", mode: "live", fake: false });

    await clearRazorpayKeys(repos.settings);
    expect(await createPayGateway(repos.settings, env, TEST_SECRET).get()).toBeNull();
  });

  it("falls back to the environment, and PAY_MODE=fake needs no keys", async () => {
    const repos = createMemoryRepos();
    const withEnv = parseEnv({ NODE_ENV: "test", RAZORPAY_KEY_ID: "rzp_test_envkey123456", RAZORPAY_KEY_SECRET: "env-secret-0000" });
    expect(await razorpayStatus(repos.settings, withEnv, TEST_SECRET)).toMatchObject({ keyId: "rzp_test_envkey123456", source: "env" });
    const fake = await createPayGateway(repos.settings, parseEnv({ NODE_ENV: "test", PAY_MODE: "fake" }), TEST_SECRET).get();
    expect(fake?.config.fake).toBe(true);
  });

  it("PAY_MODE=fake is refused in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production", PAY_MODE: "fake", DATABASE_URL: "mysql://x", AUTH_SECRET: "a".repeat(32), SMS_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k" })).toThrow(/PAY_MODE/);
  });
});
