import { z } from "zod";

/**
 * Validated environment. A bad config fails loudly the first time it is read, not later in a request.
 * Next.js loads .env.local automatically; see .env.example.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** mysql://user:password@host:3306/database . Required in production. Without it (dev only) data lives in memory. */
    DATABASE_URL: z.string().optional(),

    /** Signs login codes (HMAC). At least 32 random characters. Required in production. */
    AUTH_SECRET: z.string().min(32).optional(),
    /** How login codes are delivered. `console` only prints them in the server log (development). */
    SMS_PROVIDER: z.enum(["console", "fast2sms", "fast2sms_whatsapp"]).default("console"),
    FAST2SMS_API_KEY: z.string().optional(),
    /** The approved WhatsApp template id from Fast2SMS (used by SMS_PROVIDER=fast2sms_whatsapp). */
    FAST2SMS_WA_MESSAGE_ID: z.string().default("38384"),
    /** Development only: every login code becomes this 6-digit value, so the emulator works with no SMS. */
    OTP_DEV_CODE: z.string().regex(/^\d{6}$/).optional(),

    /** `real` talks to Razorpay. `fake` accepts a made-up checkout so the purchase flow can be tried without keys. Refused in production. */
    PAY_MODE: z.enum(["real", "fake"]).default("real"),
    /** First-time setup only: the Razorpay keys are normally typed in the admin panel (Payments page), which wins over these. */
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    /** `real` calls OpenAI. `fake` answers with canned text so the chat can be tried for free. Refused in production. */
    AI_MODE: z.enum(["real", "fake"]).default("real"),
    OPENAI_API_KEY: z.string().optional(),
    /** Any chat model your OpenAI account can use. */
    OPENAI_MODEL: z.string().default("gpt-5-mini"),
    /** Reasoning models only (gpt-5 family): minimal | low | medium | high. Defaults to minimal for gpt-5 models. */
    OPENAI_REASONING_EFFORT: z.string().optional(),
    /** Buddy messages one student can send per day. */
    AI_DAILY_LIMIT: z.coerce.number().int().positive().default(40),

    /** Requests per minute per signed-in user. */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),

    /** Signs the admin-panel session cookie. At least 32 random characters. */
    ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.SMS_PROVIDER === "console") {
        ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "SMS_PROVIDER=console is not allowed in production" });
      }
      if (env.SMS_PROVIDER !== "console" && !env.FAST2SMS_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["FAST2SMS_API_KEY"], message: "FAST2SMS_API_KEY is required for fast2sms / fast2sms_whatsapp" });
      }
      if (env.AI_MODE === "fake") {
        ctx.addIssue({ code: "custom", path: ["AI_MODE"], message: "AI_MODE=fake is not allowed in production" });
      }
      if (env.PAY_MODE === "fake") {
        ctx.addIssue({ code: "custom", path: ["PAY_MODE"], message: "PAY_MODE=fake is not allowed in production" });
      }
      if (env.OTP_DEV_CODE) {
        ctx.addIssue({ code: "custom", path: ["OTP_DEV_CODE"], message: "OTP_DEV_CODE is not allowed in production" });
      }
      if (!env.AUTH_SECRET) {
        ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "AUTH_SECRET is required in production" });
      }
      if (!env.DATABASE_URL) {
        ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required in production" });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

let cached: Env | undefined;

/** The process environment, validated once. */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
