import { POST } from "@/app/v1/users/me/route";
import { GET as getSubscription } from "@/app/v1/subscription/route";
import { GET as getSync } from "@/app/v1/sync/route";
import { parseEnv } from "@/server/config/env";
import { setServicesForTests } from "@/server/container";
import { req, useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

describe("authentication on every /v1 route", () => {
  const routes: [string, (r: Request) => Promise<Response>, string][] = [
    ["POST /v1/users/me", POST, "POST"],
    ["GET /v1/subscription", getSubscription, "GET"],
    ["GET /v1/sync", getSync, "GET"],
  ];

  it.each(routes)("%s rejects a missing token with 401", async (_n, handler, method) => {
    useServices();
    const res = await handler(req("/v1/x", { method }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it.each(routes)("%s rejects a bad token with 401", async (_n, handler, method) => {
    useServices();
    const res = await handler(req("/v1/x", { method, token: "garbage" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_token");
  });

  it("rejects an Authorization header that is not a Bearer token", async () => {
    useServices();
    const r = new Request("http://localhost/v1/subscription", { headers: { authorization: "Basic abc" } });
    expect((await getSubscription(r)).status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After once a user passes the per-minute limit", async () => {
    useServices({ RATE_LIMIT_PER_MIN: "3" });
    for (let i = 0; i < 3; i++) {
      expect((await getSubscription(req("/v1/subscription", { token: "tok-alice" }))).status).toBe(200);
    }
    const res = await getSubscription(req("/v1/subscription", { token: "tok-alice" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another user is not affected.
    expect((await getSubscription(req("/v1/subscription", { token: "tok-bob" }))).status).toBe(200);
  });
});

describe("production configuration", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "mysql://x", AUTH_SECRET: "s".repeat(32) };

  it("refuses the console SMS provider and the fixed dev code", () => {
    expect(() => parseEnv({ ...prod })).toThrow(/SMS_PROVIDER/);
    expect(() => parseEnv({ ...prod, SMS_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k", OTP_DEV_CODE: "123456" })).toThrow(/OTP_DEV_CODE/);
  });

  it("requires DATABASE_URL, AUTH_SECRET and the SMS key", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...prod, AUTH_SECRET: undefined, SMS_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k" })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ ...prod, SMS_PROVIDER: "fast2sms" })).toThrow(/FAST2SMS_API_KEY/);
  });

  it("accepts a complete production setup", () => {
    expect(() => parseEnv({ ...prod, SMS_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k" })).not.toThrow();
  });
});
