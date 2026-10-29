import type { SubscriptionRecord } from '../repos/types';

/** What the app sees. Lower case on the wire, as in the API spec. */
export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'grace' | 'expired';

export interface SubscriptionView {
  status: SubscriptionStatus;
  expiresAt: string | null;
}

/**
 * The status the user is entitled to RIGHT NOW. The stored status can be stale (the notification that
 * says "expired" may not have arrived yet), so a trial/active/grace subscription whose end time has
 * passed counts as expired.
 */
export function effectiveStatus(sub: SubscriptionRecord | null, now: Date): SubscriptionView {
  if (!sub || sub.status === 'NONE') return { status: 'none', expiresAt: null };
  const expiresAt = sub.expiresAt ? sub.expiresAt.toISOString() : null;

  switch (sub.status) {
    case 'EXPIRED':
      return { status: 'expired', expiresAt };
    case 'TRIAL':
    case 'ACTIVE':
    case 'GRACE': {
      if (sub.expiresAt && sub.expiresAt.getTime() <= now.getTime()) return { status: 'expired', expiresAt };
      return { status: sub.status.toLowerCase() as SubscriptionStatus, expiresAt };
    }
  }
}

/** Trial, active and grace all unlock timer sessions, blocking and the AI chat. */
export function hasAccess(view: SubscriptionView): boolean {
  return view.status === 'trial' || view.status === 'active' || view.status === 'grace';
}
