/** The parts of Razorpay's objects that we use (amounts in paise, times in unix seconds). */
export interface RzpSubscription {
  id: string;
  status: string; // created | authenticated | active | pending | halted | cancelled | completed | expired | paused
  plan_id?: string;
  start_at?: number | null;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  paid_count?: number;
  notes?: Record<string, string> | unknown[];
}

export interface RzpPayment {
  id: string;
  amount: number;
  currency: string;
  status: string; // created | authorized | captured | refunded | failed
  method?: string;
  email?: string;
  contact?: string;
  vpa?: string;
  bank?: string;
  wallet?: string;
  card?: { network?: string; last4?: string };
  error_code?: string | null;
  error_description?: string | null;
  created_at?: number;
  invoice_id?: string | null;
  subscription_id?: string | null;
}

export interface RazorpayApi {
  createPlan(tier: string, amountPaise: number): Promise<{ id: string }>;
  createSubscription(input: { planId: string; startAt?: number; notes: Record<string, string> }): Promise<RzpSubscription>;
  getSubscription(id: string): Promise<RzpSubscription | null>;
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<RzpSubscription>;
  getPayment(id: string): Promise<RzpPayment | null>;
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  /** Derived from the key prefix: rzp_test_ keys never move real money. */
  mode: "test" | "live";
  /** Development stand-in: signatures are not checked and nothing is sent to Razorpay. Refused in production. */
  fake: boolean;
}

/** Razorpay was unreachable or refused our request. Worth a retry; the purchase itself is not judged. */
export class RazorpayError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "RazorpayError";
  }
}

/** Gives access to the Razorpay API using the keys saved in the admin panel (or the environment). Null until keys exist. */
export interface PayGateway {
  get(): Promise<{ api: RazorpayApi; config: RazorpayConfig } | null>;
}
