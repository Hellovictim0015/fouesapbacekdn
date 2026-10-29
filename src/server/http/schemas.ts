import { z } from "zod";
import { EXAMS } from "../repos/types";

/** POST /v1/users/me. Unknown fields are rejected so typos do not pass silently. */
export const UserUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    exam: z.enum(EXAMS).optional(),
    dailyGoalMin: z.number().int().min(15).max(720).optional(),
    /** What the student is preparing for, as typed. The server cleans it up before saving. */
    prep: z.string().trim().max(100).optional(),
  })
  .strict();

/** Auth bodies. The phone is normalised in the route; the code is exactly six digits. */
export const OtpRequestSchema = z.object({ phone: z.string().min(10).max(20) }).strict();
export const OtpVerifySchema = z
  .object({ phone: z.string().min(10).max(20), code: z.string().regex(/^\d{6}$/), prep: z.string().trim().max(100).optional(), role: z.enum(["student", "parent"]).optional() })
  .strict();

/** POST /v1/subscription/verify */
export const SubscribeSchema = z.object({ tier: z.enum(["student", "parent"]) }).strict();
/** What Razorpay's checkout returns after a successful payment: ids look like pay_xxx / sub_xxx. */
export const ConfirmPaymentSchema = z
  .object({
    subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]{6,40}$/),
    paymentId: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
    signature: z.string().min(4).max(200),
  })
  .strict();

/** What the app tells Buddy about the student today. Numbers only: no free text, so it cannot smuggle in instructions. */
const StatsSchema = z.object({
  todayMin: z.number().int().min(0).max(1440).optional(),
  goalMin: z.number().int().min(0).max(1440).optional(),
  streak: z.number().int().min(0).max(3650).optional(),
});

/** POST /v1/ai/chat. The app sends the last few turns; the server keeps no chat history. */
export const ChatSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(500) }).strict())
      .min(1)
      .max(12),
    context: StatsSchema.optional(),
  })
  .strict()
  .refine((b) => b.messages.at(-1)?.role === "user", { message: "The last message must be from the user" });

/** GET /v1/ai/nudge?todayMin=&goalMin=&streak= */
export const NudgeQuerySchema = StatsSchema;

/** Parent: add a child. The prep text is tidied by the AI like the sign-in box. */
export const CreateChildSchema = z.object({ name: z.string().trim().min(1).max(40), prep: z.string().trim().max(100).optional() }).strict();

export const UpdateChildSchema = z
  .object({ name: z.string().trim().min(1).max(40).optional(), prep: z.string().trim().max(100).optional(), enabled: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

/** Child: type the parent's link code once. */
export const RedeemSchema = z.object({ code: z.string().trim().min(6).max(24) }).strict();

/** Child: the one-time code the parent read out to allow uninstalling. */
export const UnlockSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

const ACCENTS = ["Lime", "Mint", "Pink", "Amber", "Dark"] as const;

/**
 * The cloud backup: exactly what the app keeps in Room (sessions, planner, subject tags) plus the goal.
 * Usage statistics (which other apps were used) are NOT part of it and never leave the phone.
 */
export const BackupSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z
    .array(
      z.object({
        startedAt: z.number().int().positive(),
        endedAt: z.number().int().positive(),
        mode: z.enum(["Timer", "Stopwatch", "Pomodoro"]),
        subject: z.string().max(40),
        plannedMin: z.number().int().min(0).max(1440),
        focusedMin: z.number().int().min(0).max(1440),
        completed: z.boolean(),
        note: z.string().max(500).default(""),
      }),
    )
    .max(20_000),
  planned: z
    .array(
      z.object({
        startMinute: z.number().int().min(0).max(1439),
        subject: z.string().max(40),
        durationMin: z.number().int().min(1).max(1440),
        repeatType: z.enum(["ONCE", "DAILY", "WEEKLY"]),
        daysMask: z.number().int().min(0).max(127),
        onceEpochDay: z.number().int().nullable().optional(),
        accent: z.enum(ACCENTS),
      }),
    )
    .max(500),
  tags: z.array(z.string().max(20)).max(50),
  profile: z
    .object({
      exam: z.enum(EXAMS).optional(),
      goalHours: z.number().int().min(1).max(12).optional(),
    })
    .optional(),
});

export type Backup = z.infer<typeof BackupSchema>;

/** Largest accepted backup body. 20,000 sessions at ~170 bytes each is about 3.5 MB; 5 MB leaves headroom. */
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
