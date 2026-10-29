import type { Services } from "../container";
import { HttpError } from "../http/respond";
import type { PayAttempt, PaymentRecord, UserRecord } from "../repos/types";
import { hmacHex, safeEqualText } from "./crypto";
import type { FakeRazorpay } from "./fake";
import { mapRazorpaySubscription } from "./mapping";
import { PRODUCT, TRIAL_DAYS, canBuy, type Tier } from "./products";
import { RazorpayError, type RazorpayApi, type RazorpayConfig, type RzpPayment, type RzpSubscription } from "./types";

const DAY_SEC = 24 * 3600;

export async function gateway(s: Services): Promise<{ api: RazorpayApi; config: RazorpayConfig }> {
  const g = await s.pay.get();
  if (!g) throw new HttpError(503, "payments_not_configured", "Payments are not set up on this server yet");
  return g;
}

/** Razorpay trouble becomes a retryable 502; the details stay in the server log. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof RazorpayError) {
      console.error("[foues] razorpay:", e.message);
      throw new HttpError(502, "payments_unavailable", "The payment service could not be reached. Try again shortly.");
    }
    throw e;
  }
}

/** The plan object for this price, created in Razorpay the first time and remembered. A new price means a new plan. */
async function planIdFor(s: Services, api: RazorpayApi, config: RazorpayConfig, tier: Tier, amountPaise: number): Promise<string> {
  const key = `rzp_plan:${tier}:${amountPaise}:${config.keyId}`.slice(0, 64);
  const known = await s.repos.settings.get(key);
  if (known) return known;
  const plan = await api.createPlan(tier, amountPaise);
  await s.repos.settings.set(key, plan.id, false, "system");
  return plan.id;
}

export interface Checkout {
  keyId: string;
  subscriptionId: string;
  amountPaise: number;
  trialDays: number;
  tier: Tier;
  /** Development stand-in: the app skips Razorpay's screen and confirms with a fake signature. */
  fake: boolean;
}

/** Step 1: make a Razorpay subscription for this user and plan. The app opens Razorpay's checkout with the returned ids. */
export async function startCheckout(s: Services, user: UserRecord, tier: Tier, now = new Date()): Promise<Checkout> {
  if (!canBuy(user.role)) throw new HttpError(403, "child_cannot_buy", "Children use their parent's plan");
  const { api, config } = await gateway(s);

  const existing = await s.repos.subscriptions.findByUserId(user.id);
  const liveNow = existing && (existing.status === "ACTIVE" || existing.status === "TRIAL" || existing.status === "GRACE") && existing.expiresAt !== null && existing.expiresAt > now;
  if (liveNow && existing.autoRenewing && existing.productId === PRODUCT[tier]) {
    throw new HttpError(409, "already_subscribed", "You already have this plan");
  }

  const prices = await s.repos.planPrices.get();
  const amountPaise = prices[tier] * 100;
  const trial = existing === null; // the free trial is for first-time subscribers only
  const startAt = trial ? Math.floor(now.getTime() / 1000) + TRIAL_DAYS * DAY_SEC + 300 : undefined; // +5 min: Razorpay wants a start time that is clearly in the future

  const sub = await guarded(async () => {
    const planId = await planIdFor(s, api, config, tier, amountPaise);
    return api.createSubscription({ planId, startAt, notes: { user_id: user.id, tier } });
  });
  await s.repos.payments.addAttempt({ subscriptionId: sub.id, userId: user.id, tier, amountPaise, trial });
  return { keyId: config.keyId, subscriptionId: sub.id, amountPaise, trialDays: trial ? TRIAL_DAYS : 0, tier, fake: config.fake };
}

/** What Razorpay's checkout hands the app after a successful authorisation. */
export function checkoutSignatureOk(config: RazorpayConfig, paymentId: string, subscriptionId: string, signature: string): boolean {
  if (config.fake) return signature === "fake";
  return safeEqualText(hmacHex(config.keySecret, `${paymentId}|${subscriptionId}`), signature);
}

/** Webhook bodies are signed with the webhook secret; the signature is over the exact raw body. */
export function webhookSignatureOk(config: RazorpayConfig, rawBody: string, signature: string): boolean {
  if (config.fake) return signature === "fake";
  if (!config.webhookSecret) return false;
  return safeEqualText(hmacHex(config.webhookSecret, rawBody), signature);
}

/** Saves what Razorpay says the subscription is now. Razorpay is asked directly; a request body is never trusted for this. */
export async function applySubscription(s: Services, attempt: PayAttempt, sub: RzpSubscription, now = new Date()): Promise<void> {
  const mapped = mapRazorpaySubscription(sub, attempt.trial, now);
  if (mapped.status === "NONE") return; // not paid or authorised yet: nothing to unlock
  await s.repos.subscriptions.save(attempt.userId, {
    productId: PRODUCT[attempt.tier],
    purchaseToken: sub.id,
    linkedPurchaseToken: null,
    status: mapped.status,
    expiresAt: mapped.expiresAt,
    autoRenewing: mapped.autoRenewing,
    acknowledged: true,
    latestOrderId: null,
    playState: mapped.rawState,
  });
  // Buying the Parent plan makes this a parent account, so the children screen opens for them.
  if (attempt.tier === "parent") await s.repos.users.setRole(attempt.userId, "parent");
}

function describe(p: RzpPayment): string | null {
  if (p.method === "upi") return p.vpa ?? "upi";
  if (p.method === "card") return [p.card?.network, p.card?.last4 ? `••${p.card.last4}` : ""].filter(Boolean).join(" ") || "card";
  if (p.method === "netbanking") return p.bank ?? "netbanking";
  if (p.method === "wallet") return p.wallet ?? "wallet";
  return p.method ?? null;
}

/** Writes one payment into the admin's payment list. */
export async function recordPayment(s: Services, p: RzpPayment, attempt: PayAttempt | null, now = new Date()): Promise<void> {
  const rec: PaymentRecord = {
    paymentId: p.id,
    userId: attempt?.userId ?? null,
    subscriptionId: attempt?.subscriptionId ?? p.subscription_id ?? null,
    tier: attempt?.tier ?? null,
    amountPaise: p.amount,
    currency: p.currency || "INR",
    status: p.status,
    method: p.method ?? null,
    detail: describe(p),
    phone: p.contact ?? null,
    email: p.email ?? null,
    errorCode: p.error_code ?? null,
    errorText: p.error_description ? p.error_description.slice(0, 255) : null,
    createdAt: p.created_at ? new Date(p.created_at * 1000) : now,
  };
  await s.repos.payments.upsertPayment(rec);
}

/** Step 2: the app reports the checkout result. We check the signature, then ask Razorpay what really happened. */
export async function confirmCheckout(
  s: Services,
  user: UserRecord,
  input: { subscriptionId: string; paymentId: string; signature: string },
  now = new Date(),
): Promise<void> {
  const { api, config } = await gateway(s);
  const attempt = await s.repos.payments.findAttempt(input.subscriptionId);
  if (!attempt || attempt.userId !== user.id) throw new HttpError(404, "unknown_checkout", "This payment does not belong to your account");
  if (!checkoutSignatureOk(config, input.paymentId, input.subscriptionId, input.signature)) {
    throw new HttpError(400, "bad_signature", "The payment could not be verified");
  }
  // Development stand-in only: the pretend user "pays", so the fake subscription moves on like Razorpay's would.
  if (config.fake) (api as Partial<FakeRazorpay>).advance?.(input.subscriptionId, attempt.trial ? "authenticated" : "active");
  await guarded(async () => {
    const sub = await api.getSubscription(input.subscriptionId);
    if (!sub) throw new HttpError(400, "unknown_checkout", "Razorpay does not know this subscription");
    await applySubscription(s, attempt, sub, now);
    const pay = await api.getPayment(input.paymentId);
    if (pay) await recordPayment(s, pay, attempt, now);
  });
}

/** Stops future charges. What is already paid for (or the trial) stays valid until its end. */
export async function cancelSubscription(s: Services, user: UserRecord, now = new Date()): Promise<void> {
  const row = await s.repos.subscriptions.findRowByUserId(user.id);
  const token = row?.purchaseToken;
  if (!row || !token || !token.startsWith("sub_")) throw new HttpError(404, "no_subscription", "You have no subscription to cancel");
  const { api } = await gateway(s);
  const attempt = await s.repos.payments.findAttempt(token);
  await guarded(async () => {
    const after = await api.cancelSubscription(token, true);
    if (attempt) await applySubscription(s, attempt, after, now);
  });
}

/**
 * Called just before an account is deleted so Razorpay stops charging it. Best effort: if Razorpay cannot be reached the
 * deletion still goes ahead and the failure is logged, because a person asking to be deleted must not be blocked.
 */
export async function stopChargesBeforeDeletion(s: Services, userId: string): Promise<void> {
  try {
    const token = (await s.repos.subscriptions.findRowByUserId(userId))?.purchaseToken;
    if (!token || !token.startsWith("sub_")) return;
    const g = await s.pay.get();
    if (g && !g.config.fake) await g.api.cancelSubscription(token, false);
  } catch (e) {
    console.error("[foues] could not cancel the subscription of a deleted account:", e instanceof Error ? e.message : e);
  }
}

interface WebhookBody {
  event?: string;
  created_at?: number;
  payload?: { subscription?: { entity?: RzpSubscription }; payment?: { entity?: RzpPayment } };
}

/**
 * Razorpay tells us about renewals, failures and cancellations here. The signature proves it is Razorpay; the subscription
 * is then re-read from Razorpay's API so a replayed or reordered event cannot move the state backwards.
 */
export async function handleWebhook(s: Services, rawBody: string, signature: string, eventId: string | null, now = new Date()): Promise<"ok" | "duplicate" | "ignored"> {
  const { api, config } = await gateway(s);
  if (!webhookSignatureOk(config, rawBody, signature)) throw new HttpError(401, "bad_signature", "Bad webhook signature");
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    throw new HttpError(400, "invalid_json", "Body is not valid JSON");
  }
  if (eventId && !(await s.repos.payments.recordEvent(eventId))) return "duplicate";

  const subId = body.payload?.subscription?.entity?.id ?? body.payload?.payment?.entity?.subscription_id ?? null;
  const attempt = subId ? await s.repos.payments.findAttempt(subId) : null;
  const payment = body.payload?.payment?.entity;
  if (payment) await recordPayment(s, payment, attempt, now);
  if (!attempt || !subId) return payment ? "ok" : "ignored";

  await guarded(async () => {
    const sub = await api.getSubscription(subId);
    if (sub) await applySubscription(s, attempt, sub, now);
  });
  return "ok";
}
