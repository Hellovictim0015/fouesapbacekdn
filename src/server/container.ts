import { createFakeAiClient } from "./ai/fake";
import { createOpenAiClient } from "./ai/openai";
import type { AiClient } from "./ai/types";
import { createPayGateway } from "./pay/settings";
import type { PayGateway } from "./pay/types";
import { createConsoleSender, createFast2SmsSender, createFast2SmsWhatsAppSender, type SmsSender } from "./auth/sms";
import { createSessionVerifier } from "./auth/session";
import type { TokenVerifier } from "./auth/types";
import { getEnv, type Env } from "./config/env";
import { createMysqlLimiter, createMysqlRepos } from "./db/mysqlRepos";
import { getPool } from "./db/pool";
import { createMemoryLimiter, createMemoryRepos } from "./repos/memory";
import type { RateLimiter, Repos } from "./repos/types";

/** Everything a request handler needs, built once per process. Tests swap it with [setServicesForTests]. */
export interface Services {
  env: Env;
  verifier: TokenVerifier;
  sms: SmsSender;
  /** Razorpay, using the keys saved in the admin panel; the payment endpoints answer 503 until there are keys. */
  pay: PayGateway;
  /** Null until OPENAI_API_KEY is set; the AI endpoints then answer 503. */
  ai: AiClient | null;
  /** Key for hashing login codes. */
  authSecret: string;
  repos: Repos;
  limiter: RateLimiter;
  /** True when the database answers (always true with in-memory storage). */
  ping(): Promise<boolean>;
}

let services: Services | undefined;

export function getServices(): Services {
  if (services) return services;
  const env = getEnv();

  const sms =
    env.SMS_PROVIDER === "fast2sms" ? createFast2SmsSender(env.FAST2SMS_API_KEY!)
    : env.SMS_PROVIDER === "fast2sms_whatsapp" ? createFast2SmsWhatsAppSender(env.FAST2SMS_API_KEY!, env.FAST2SMS_WA_MESSAGE_ID)
    : createConsoleSender();
  const ai: AiClient | null =
    env.AI_MODE === "fake" ? createFakeAiClient() : env.OPENAI_API_KEY ? createOpenAiClient(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_REASONING_EFFORT) : null;
  // Outside production a missing secret falls back to a fixed one so `npm run dev` just works.
  const authSecret = env.AUTH_SECRET ?? "dev-only-secret-not-for-production-use!";

  if (env.DATABASE_URL) {
    const pool = getPool(env.DATABASE_URL);
    const repos = createMysqlRepos(pool);
    services = {
      env,
      verifier: createSessionVerifier(repos.auth),
      sms,
      pay: createPayGateway(repos.settings, env, authSecret),
      ai,
      authSecret,
      repos,
      limiter: createMysqlLimiter(pool),
      ping: () => pool.query("SELECT 1").then(() => true, () => false),
    };
  } else {
    console.warn("[foues] DATABASE_URL is not set: using in-memory storage. Data is lost on restart.");
    const repos = createMemoryRepos();
    services = { env, verifier: createSessionVerifier(repos.auth), sms, pay: createPayGateway(repos.settings, env, authSecret), ai, authSecret, repos, limiter: createMemoryLimiter(), ping: async () => true };
  }
  return services;
}

export function setServicesForTests(next: Services | undefined): void {
  services = next;
}
