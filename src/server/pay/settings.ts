import type { Env } from "../config/env";
import type { SettingsRepo } from "../repos/types";
import { createRazorpayApi } from "./client";
import { decryptSecret, encryptSecret } from "./crypto";
import { createFakeRazorpay } from "./fake";
import type { PayGateway, RazorpayConfig } from "./types";

export const KEY_ID = "rzp_key_id";
export const KEY_SECRET = "rzp_key_secret";
export const WEBHOOK_SECRET = "rzp_webhook_secret";

const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{8,40}$/;

export function isValidKeyId(v: string): boolean {
  return KEY_ID_PATTERN.test(v);
}

/** What the admin panel may show about a saved key: never the secret itself. */
export interface RazorpayStatus {
  keyId: string | null;
  mode: "test" | "live" | null;
  secretSet: boolean;
  secretHint: string | null;
  webhookSecretSet: boolean;
  source: "admin" | "env" | "none";
}

interface Stored {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  source: "admin" | "env" | "none";
}

/** Keys saved in the admin panel win; the environment is the fallback for the first setup. */
async function load(repo: SettingsRepo, env: Env, authSecret: string): Promise<Stored> {
  const keyId = await repo.get(KEY_ID);
  const secretRaw = await repo.get(KEY_SECRET);
  const hookRaw = await repo.get(WEBHOOK_SECRET);
  if (keyId && secretRaw) {
    return {
      keyId,
      keySecret: decryptSecret(authSecret, secretRaw),
      webhookSecret: hookRaw ? decryptSecret(authSecret, hookRaw) : null,
      source: "admin",
    };
  }
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null, source: "env" };
  }
  return { keyId: null, keySecret: null, webhookSecret: null, source: "none" };
}

export async function razorpayStatus(repo: SettingsRepo, env: Env, authSecret: string): Promise<RazorpayStatus> {
  const s = await load(repo, env, authSecret);
  return {
    keyId: s.keyId,
    mode: s.keyId ? (s.keyId.startsWith("rzp_live_") ? "live" : "test") : null,
    secretSet: !!s.keySecret,
    secretHint: s.keySecret ? `••••${s.keySecret.slice(-4)}` : null,
    webhookSecretSet: !!s.webhookSecret,
    source: s.source,
  };
}

/** Saves what the admin typed. A blank secret field keeps the saved one, so the key id can be edited alone. */
export async function saveRazorpayKeys(
  repo: SettingsRepo,
  authSecret: string,
  input: { keyId: string; keySecret: string; webhookSecret: string },
  by: string,
): Promise<void> {
  await repo.set(KEY_ID, input.keyId, false, by);
  if (input.keySecret) await repo.set(KEY_SECRET, encryptSecret(authSecret, input.keySecret), true, by);
  if (input.webhookSecret) await repo.set(WEBHOOK_SECRET, encryptSecret(authSecret, input.webhookSecret), true, by);
}

export async function clearRazorpayKeys(repo: SettingsRepo): Promise<void> {
  await Promise.all([repo.remove(KEY_ID), repo.remove(KEY_SECRET), repo.remove(WEBHOOK_SECRET)]);
}

export function createPayGateway(repo: SettingsRepo, env: Env, authSecret: string, fetchImpl?: typeof fetch): PayGateway {
  if (env.PAY_MODE === "fake") {
    const api = createFakeRazorpay(Date.now, true);
    const config: RazorpayConfig = { keyId: "rzp_test_fakefakefake", keySecret: "fake", webhookSecret: "fake-webhook", mode: "test", fake: true };
    return { get: async () => ({ api, config }) };
  }
  return {
    async get() {
      const s = await load(repo, env, authSecret);
      if (!s.keyId || !s.keySecret) return null;
      const config: RazorpayConfig = {
        keyId: s.keyId,
        keySecret: s.keySecret,
        webhookSecret: s.webhookSecret,
        mode: s.keyId.startsWith("rzp_live_") ? "live" : "test",
        fake: false,
      };
      return { api: createRazorpayApi(s.keyId, s.keySecret, fetchImpl), config };
    },
  };
}
