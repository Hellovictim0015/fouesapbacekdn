import { randomBytes } from "node:crypto";
import type { RazorpayApi, RzpPayment, RzpSubscription } from "./types";

/**
 * Stand-in for Razorpay so the whole purchase flow can be tried without keys. Subscriptions start as `created`; a test can
 * move one on with `fake.advance(id, "active")`. Anyone can fake a signature in this mode, so production refuses PAY_MODE=fake.
 */
export interface FakeRazorpay extends RazorpayApi {
  advance(id: string, status: string, patch?: Partial<RzpSubscription>): void;
  addPayment(p: RzpPayment): void;
  readonly subs: Map<string, RzpSubscription>;
  readonly cancelled: string[];
}

/**
 * `shared` keeps the pretend subscriptions on globalThis: the dev server builds each route in its own module copy, and the
 * subscribe and verify routes must see the same ones. Tests leave it off so each gets a clean slate.
 */
export function createFakeRazorpay(now: () => number = Date.now, shared = false): FakeRazorpay {
  const g = globalThis as { __fakeRzp?: { subs: Map<string, RzpSubscription>; pays: Map<string, RzpPayment> } };
  const store = shared ? (g.__fakeRzp ??= { subs: new Map(), pays: new Map() }) : { subs: new Map<string, RzpSubscription>(), pays: new Map<string, RzpPayment>() };
  const subs = store.subs;
  const pays = store.pays;
  const cancelled: string[] = [];
  const sec = () => Math.floor(now() / 1000);

  return {
    subs,
    cancelled,
    async createPlan() {
      return { id: `plan_fake${randomBytes(4).toString("hex")}` };
    },
    async createSubscription({ planId, startAt, notes }) {
      const s: RzpSubscription = { id: `sub_fake${randomBytes(5).toString("hex")}`, status: "created", plan_id: planId, start_at: startAt ?? null, current_end: null, paid_count: 0, notes };
      subs.set(s.id, s);
      return { ...s };
    },
    async getSubscription(id) {
      const s = subs.get(id);
      return s ? { ...s } : null;
    },
    async cancelSubscription(id, atCycleEnd) {
      const s = subs.get(id);
      if (!s) throw new Error("no such subscription");
      cancelled.push(id);
      s.status = "cancelled";
      if (!atCycleEnd) s.current_end = sec();
      return { ...s };
    },
    async getPayment(id) {
      return pays.get(id) ?? null;
    },
    advance(id, status, patch = {}) {
      const s = subs.get(id);
      if (!s) throw new Error("no such subscription");
      Object.assign(s, { status }, patch);
      if (status === "active" && !s.current_end) s.current_end = sec() + 30 * 86400;
    },
    addPayment(p) {
      pays.set(p.id, p);
    },
  };
}
