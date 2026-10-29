import type { StoredSubscriptionStatus } from "../repos/types";
import type { RzpSubscription } from "./types";

export interface MappedSubscription {
  status: StoredSubscriptionStatus;
  expiresAt: Date | null;
  autoRenewing: boolean;
  rawState: string;
}

/** After a failed charge Razorpay retries for a few days; the user keeps access meanwhile. */
const GRACE_MS = 3 * 24 * 3600 * 1000;

const at = (unix: number | null | undefined) => (unix ? new Date(unix * 1000) : null);

/**
 * Turns Razorpay's description of a subscription into our five statuses.
 *  - `authenticated`: the user approved the mandate. With a free trial the first charge is on `start_at`, and access runs until then (TRIAL);
 *    without a trial nothing is paid yet, so no access until `active`.
 *  - `active`: paid up to `current_end` (ACTIVE).
 *  - `pending`: a charge failed and is being retried: GRACE for 3 days.
 *  - `cancelled`: no more charges, but what was paid (or the trial) lasts until its end.
 *  - `halted`, `paused`, `completed`, `expired`, `created`: no access.
 */
export function mapRazorpaySubscription(sub: RzpSubscription, trial: boolean, now: Date): MappedSubscription {
  const end = at(sub.current_end);
  const startAt = at(sub.start_at);
  const live = (d: Date | null) => d !== null && d.getTime() > now.getTime();
  const none = (): MappedSubscription => ({ status: "NONE", expiresAt: null, autoRenewing: false, rawState: sub.status });
  const expired = (): MappedSubscription => ({ status: "EXPIRED", expiresAt: end ?? startAt, autoRenewing: false, rawState: sub.status });

  switch (sub.status) {
    case "authenticated":
      if (trial && live(startAt)) return { status: "TRIAL", expiresAt: startAt, autoRenewing: true, rawState: sub.status };
      if (trial && startAt && now.getTime() < startAt.getTime() + GRACE_MS) {
        return { status: "GRACE", expiresAt: new Date(startAt.getTime() + GRACE_MS), autoRenewing: true, rawState: sub.status };
      }
      return trial ? expired() : none();
    case "active":
      return live(end) ? { status: "ACTIVE", expiresAt: end, autoRenewing: true, rawState: sub.status } : expired();
    case "pending": {
      const until = new Date((end ?? now).getTime() + GRACE_MS);
      return live(until) ? { status: "GRACE", expiresAt: until, autoRenewing: true, rawState: sub.status } : expired();
    }
    case "cancelled":
      if (live(end)) return { status: "ACTIVE", expiresAt: end, autoRenewing: false, rawState: sub.status };
      if (trial && !end && live(startAt)) return { status: "TRIAL", expiresAt: startAt, autoRenewing: false, rawState: sub.status };
      return expired();
    case "created":
      return none();
    default: // halted, paused, completed, expired, or anything new Razorpay adds
      return expired();
  }
}
