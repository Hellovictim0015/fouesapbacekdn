import { RazorpayError, type RazorpayApi, type RzpPayment, type RzpSubscription } from "./types";

const BASE = "https://api.razorpay.com/v1";

/** Razorpay REST API over fetch (Basic auth with the key id and secret). Nothing here logs the secret. */
export function createRazorpayApi(keyId: string, keySecret: string, fetchImpl: typeof fetch = fetch): RazorpayApi {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, allowNotFound = false): Promise<T | null> {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: { authorization: auth, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new RazorpayError(`Razorpay unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 404 && allowNotFound) return null;
    const data = (await res.json().catch(() => null)) as (T & { error?: { description?: string } }) | null;
    if (!res.ok || !data) {
      throw new RazorpayError(`Razorpay ${res.status}: ${data?.error?.description ?? "no details"}`, res.status);
    }
    return data;
  }

  return {
    async createPlan(tier, amountPaise) {
      const p = await call<{ id: string }>("POST", "/plans", {
        period: "monthly",
        interval: 1,
        item: { name: `FocusX ${tier} plan`, amount: amountPaise, currency: "INR", description: `FocusX ${tier} plan, monthly` },
      });
      return p!;
    },
    async createSubscription({ planId, startAt, notes }) {
      const s = await call<RzpSubscription>("POST", "/subscriptions", {
        plan_id: planId,
        total_count: 120, // ten years of months; the user can cancel any time
        quantity: 1,
        customer_notify: 1,
        notes,
        ...(startAt ? { start_at: startAt } : {}),
      });
      return s!;
    },
    getSubscription: (id) => call<RzpSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`, undefined, true),
    async cancelSubscription(id, atCycleEnd) {
      const s = await call<RzpSubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
      return s!;
    },
    getPayment: (id) => call<RzpPayment>("GET", `/payments/${encodeURIComponent(id)}`, undefined, true),
  };
}
