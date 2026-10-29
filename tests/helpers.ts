import { InvalidTokenError, type AuthUser, type TokenVerifier } from "@/server/auth/types";
import { parseEnv } from "@/server/config/env";
import { setServicesForTests, type Services } from "@/server/container";
import { createFakeAiClient } from "@/server/ai/fake";
import { createFakeRazorpay, type FakeRazorpay } from "@/server/pay/fake";
import type { PayGateway } from "@/server/pay/types";
import type { SmsSender } from "@/server/auth/sms";
import { createMemoryLimiter, createMemoryRepos, type MemoryRepos } from "@/server/repos/memory";

/** Tokens look like "tok-alice". Anything else is rejected. */
export function fakeVerifier(): TokenVerifier {
  return {
    async verify(token): Promise<AuthUser> {
      const m = /^tok-([a-z0-9]+)$/.exec(token);
      if (!m) throw new InvalidTokenError();
      return { uid: m[1]! };
    },
  };
}

export const TEST_KEY_SECRET = "test-key-secret-0000";
export const TEST_WEBHOOK_SECRET = "test-webhook-secret-0000";

/** A Razorpay stand-in whose signatures are checked for real (only the network is fake). */
export function fakePay(now?: () => number): { gateway: PayGateway; rzp: FakeRazorpay } {
  const rzp = createFakeRazorpay(now);
  const config = { keyId: "rzp_test_abcdefgh1234", keySecret: TEST_KEY_SECRET, webhookSecret: TEST_WEBHOOK_SECRET, mode: "test" as const, fake: false };
  return { gateway: { get: async () => ({ api: rzp, config }) }, rzp };
}

export const TEST_SECRET = "test-secret-test-secret-test-secret-!!";

/** Remembers every code "sent", so a test can read it back. */
export function createRecordingSms(): SmsSender & { sent: { phone: string; code: string }[] } {
  const sent: { phone: string; code: string }[] = [];
  return {
    sent,
    async sendOtp(phone, code) {
      sent.push({ phone, code });
    },
  };
}

export interface Harness {
  services: Services;
  repos: MemoryRepos;
  verifier: TokenVerifier;
  sms: ReturnType<typeof createRecordingSms>;
  rzp: FakeRazorpay;
}

/** Fresh in-memory services for one test. */
export function useServices(overrides: Record<string, string> = {}): Harness {
  const repos = createMemoryRepos();
  const verifier = fakeVerifier();
  const sms = createRecordingSms();
  const pay = fakePay();
  const services: Services = {
    env: parseEnv({ NODE_ENV: "test", ...overrides }),
    verifier,
    sms,
    pay: pay.gateway,
    ai: createFakeAiClient(),
    authSecret: TEST_SECRET,
    repos,
    limiter: createMemoryLimiter(),
    ping: async () => true,
  };
  setServicesForTests(services);
  return { services, repos, verifier, sms, rzp: pay.rzp };
}

export function req(path: string, init: { method?: string; token?: string; body?: unknown; rawBody?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.rawBody !== undefined) body = init.rawBody;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${path}`, { method: init.method ?? "GET", headers, body });
}

/**
 * Buys a plan the way the app does: subscribe, then (what Razorpay's checkout would do) move the subscription on and confirm with a
 * correctly signed payment. `state` is the Razorpay status after the user pays: "authenticated" is the free-trial start.
 */
export async function purchase(
  h: Harness,
  token: string,
  tier: "student" | "parent",
  state: "authenticated" | "active" = "active",
): Promise<{ subscribeStatus: number; verifyStatus: number; subscriptionId: string | null; paymentId: string }> {
  const { POST: subscribe } = await import("@/app/v1/payments/subscribe/route");
  const { POST: verify } = await import("@/app/v1/payments/verify/route");
  const { hmacHex } = await import("@/server/pay/crypto");
  const sub = await subscribe(req("/v1/payments/subscribe", { method: "POST", token, body: { tier } }));
  const paymentId = `pay_${Math.random().toString(36).slice(2, 12).padEnd(10, "x")}`;
  if (sub.status !== 200) return { subscribeStatus: sub.status, verifyStatus: 0, subscriptionId: null, paymentId };
  const { subscriptionId, amountPaise } = (await sub.json()) as { subscriptionId: string; amountPaise: number };
  h.rzp.advance(subscriptionId, state);
  h.rzp.addPayment({ id: paymentId, amount: amountPaise, currency: "INR", status: "captured", method: "upi", vpa: "test@upi", contact: "+919876543210" });
  const signature = hmacHex(TEST_KEY_SECRET, `${paymentId}|${subscriptionId}`);
  const res = await verify(req("/v1/payments/verify", { method: "POST", token, body: { subscriptionId, paymentId, signature } }));
  return { subscribeStatus: 200, verifyStatus: res.status, subscriptionId, paymentId };
}

/** A minimal valid backup body. */
export function backup(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    sessions: [
      { startedAt: 1_760_000_000_000, endedAt: 1_760_000_900_000, mode: "Timer", subject: "Physics", plannedMin: 15, focusedMin: 15, completed: true, note: "ch 4" },
    ],
    planned: [{ startMinute: 1020, subject: "Physics", durationMin: 45, repeatType: "WEEKLY", daysMask: 21, onceEpochDay: null, accent: "Mint" }],
    tags: ["Physics", "Chemistry"],
    profile: { exam: "JEE", goalHours: 4 },
    ...overrides,
  };
}
