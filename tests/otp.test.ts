import { POST as logout } from "@/app/v1/auth/logout/route";
import { POST as requestOtp } from "@/app/v1/auth/otp/request/route";
import { POST as verifyOtp } from "@/app/v1/auth/otp/verify/route";
import { GET as getSubscription } from "@/app/v1/subscription/route";
import { DELETE as deleteMe } from "@/app/v1/users/me/route";
import { normalizePhone } from "@/server/auth/phone";
import { createFast2SmsSender, SmsSendError } from "@/server/auth/sms";
import { setServicesForTests } from "@/server/container";
import { createSessionVerifier } from "@/server/auth/session";
import { req, useServices as useFakeServices } from "./helpers";

/** Like the shared harness, but tokens are checked by the real session verifier. */
function useServices(overrides: Record<string, string> = {}) {
  const h = useFakeServices(overrides);
  h.services.verifier = createSessionVerifier(h.repos.auth);
  return h;
}

afterEach(() => setServicesForTests(undefined));

const post = (path: string, body: unknown) => req(path, { method: "POST", body });

describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
  ])("%s -> %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(["12345", "5876543210", "98765432101", "abcdefghij", "+1 415 555 0100", ""])("rejects %s", (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe("phone login", () => {
  it("sends a code, trades it for a token, and the token works on /v1", async () => {
    const h = useServices();
    const r = await requestOtp(post("/v1/auth/otp/request", { phone: "98765 43210" }));
    expect(r.status).toBe(200);
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]!.phone).toBe("+919876543210");
    expect(h.sms.sent[0]!.code).toMatch(/^\d{6}$/);

    const v = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: h.sms.sent[0]!.code }));
    expect(v.status).toBe(200);
    const body = await v.json();
    expect(body.isNewUser).toBe(true);
    expect(body.user.phone).toBe("+919876543210");

    const sub = await getSubscription(req("/v1/subscription", { token: body.token }));
    expect(sub.status).toBe(200);
  });

  it("a second login is not a new user and gives a different token", async () => {
    const h = useServices({ RATE_LIMIT_PER_MIN: "1000" });
    const login = async () => {
      h.sms.sent.length = 0;
      await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
      const res = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: h.sms.sent[0]!.code }));
      return res.json();
    };
    const first = await login();
    h.services.limiter = { hit: async () => ({ allowed: true, remaining: 9, retryAfterSec: 0 }) };
    const second = await login();
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
  });

  it("a code works once", async () => {
    const h = useServices();
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    const code = h.sms.sent[0]!.code;
    expect((await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code }))).status).toBe(200);
    const again = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code }));
    expect(again.status).toBe(400);
    expect((await again.json()).error.code).toBe("code_expired");
  });

  it("rejects a wrong code, and locks the code after 5 wrong tries", async () => {
    const h = useServices();
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    const real = h.sms.sent[0]!.code;
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const res = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: wrong }));
      expect((await res.json()).error.code).toBe("wrong_code");
    }
    const locked = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: real }));
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.code).toBe("too_many_attempts");
  });

  it("rejects an expired code", async () => {
    const h = useServices();
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    const code = h.sms.sent[0]!.code;
    jest.useFakeTimers({ now: Date.now() + 6 * 60 * 1000, doNotFake: ["nextTick", "setImmediate", "setTimeout"] });
    try {
      const res = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code }));
      expect((await res.json()).error.code).toBe("code_expired");
    } finally {
      jest.useRealTimers();
    }
  });

  it("never mixes up numbers: a code is only good for the phone it was sent to", async () => {
    const h = useServices({ RATE_LIMIT_PER_MIN: "1000" });
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    const res = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9123456789", code: h.sms.sent[0]!.code }));
    expect(res.status).toBe(400);
  });

  it("rate-limits code requests: one per 30 s per number", async () => {
    const h = useServices();
    expect((await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }))).status).toBe(200);
    const second = await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(h.sms.sent).toHaveLength(1);
    expect((await requestOtp(post("/v1/auth/otp/request", { phone: "9123456789" }))).status).toBe(200); // other number is fine
  });

  it("rejects bad phone numbers and malformed bodies", async () => {
    const h = useServices();
    expect((await requestOtp(post("/v1/auth/otp/request", { phone: "12345678901" }))).status).toBe(400);
    expect((await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210", extra: 1 }))).status).toBe(400);
    expect((await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: "12ab56" }))).status).toBe(400);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("the Play review number logs in with 123456 and no message is sent; any other number does not", async () => {
    const h = useServices();
    const sent = await requestOtp(post("/v1/auth/otp/request", { phone: "8827219873" }));
    expect(sent.status).toBe(200);
    expect(h.sms.sent).toHaveLength(0);
    const login = await verifyOtp(post("/v1/auth/otp/verify", { phone: "8827219873", code: "123456" }));
    expect(login.status).toBe(200);
    const body = await login.json();
    expect(body.user.phone).toBe("+918827219873");
    expect(await h.repos.subscriptions.findByUserId(body.user.id)).toMatchObject({ status: "ACTIVE", productId: "focus_student" });

    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]!.code).not.toBe("123456".repeat(2));
    const other = await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: h.sms.sent[0]!.code === "123456" ? "654321" : "123456" }));
    expect(other.status).toBe(400);
  });

  it("REVIEW_LOGIN=off turns the review number back into a normal number", async () => {
    const h = useServices({ REVIEW_LOGIN: "off" });
    await requestOtp(post("/v1/auth/otp/request", { phone: "8827219873" }));
    expect(h.sms.sent).toHaveLength(1);
  });

  it("uses the fixed dev code when OTP_DEV_CODE is set", async () => {
    const h = useServices({ OTP_DEV_CODE: "123456" });
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    expect(h.sms.sent[0]!.code).toBe("123456");
  });

  it("logout kills that token only", async () => {
    const h = useServices({ RATE_LIMIT_PER_MIN: "1000" });
    const login = async () => {
      h.sms.sent.length = 0;
      await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
      h.services.limiter = { hit: async () => ({ allowed: true, remaining: 9, retryAfterSec: 0 }) };
      return (await (await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: h.sms.sent[0]!.code }))).json()).token as string;
    };
    const a = await login();
    const b = await login();
    expect((await logout(req("/v1/auth/logout", { method: "POST", token: a }))).status).toBe(200);
    expect((await getSubscription(req("/v1/subscription", { token: a }))).status).toBe(401);
    expect((await getSubscription(req("/v1/subscription", { token: b }))).status).toBe(200);
  });

  it("deleting the account signs every device out", async () => {
    const h = useServices();
    await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    const { token } = await (await verifyOtp(post("/v1/auth/otp/verify", { phone: "9876543210", code: h.sms.sent[0]!.code }))).json();
    expect((await deleteMe(req("/v1/users/me", { method: "DELETE", token }))).status).toBe(200);
    expect((await getSubscription(req("/v1/subscription", { token }))).status).toBe(401);
  });

  it("tells the caller when the SMS could not be sent, and leaves no code behind", async () => {
    const h = useServices();
    h.services.sms = { sendOtp: async () => { throw new SmsSendError("down"); } };
    const res = await requestOtp(post("/v1/auth/otp/request", { phone: "9876543210" }));
    expect(res.status).toBe(502);
    expect(await h.repos.auth.getOtp("+919876543210")).toBeNull();
  });
});

describe("Fast2SMS sender", () => {
  const ok = () => new Response(JSON.stringify({ return: true, request_id: "x", message: ["sent"] }), { status: 200 });

  it("posts the 10-digit number and the code with the key in the authorization header", async () => {
    const fetchMock = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok());
    await createFast2SmsSender("KEY123", fetchMock as unknown as typeof fetch).sendOtp("+919876543210", "482913");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://www.fast2sms.com/dev/bulkV2");
    expect((init!.headers as Record<string, string>).authorization).toBe("KEY123");
    expect(JSON.parse(init!.body as string)).toEqual({ route: "otp", variables_values: "482913", numbers: "9876543210" });
  });

  it("raises SmsSendError when the gateway says no, without leaking the key", async () => {
    const bad = jest.fn(async () => new Response(JSON.stringify({ return: false, message: "Invalid API" }), { status: 412 }));
    const err = await createFast2SmsSender("KEY123", bad as unknown as typeof fetch).sendOtp("+919876543210", "1").catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(String(err.message)).not.toContain("KEY123");
  });

  it("raises SmsSendError when the gateway is unreachable", async () => {
    const down = jest.fn(async () => { throw new Error("ECONNRESET"); });
    await expect(createFast2SmsSender("K", down as unknown as typeof fetch).sendOtp("+919876543210", "1")).rejects.toBeInstanceOf(SmsSendError);
  });
});
