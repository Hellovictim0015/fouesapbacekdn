import { randomUUID } from 'node:crypto';
import type { PayAttempt, PaymentRecord, AnnouncementRecord, AppLogo, RecommendedApp, BackupRecord, ChildRecord, OtpRecord, SubscriptionRow, RateLimiter, Repos, SubscriptionRecord, UserRecord } from './types';

/**
 * In-memory repositories: used by the tests, and by `npm run dev` when no DATABASE_URL is set.
 * Everything is lost on restart. Never used in production (loadEnv requires DATABASE_URL there).
 */
export interface MemoryRepos extends Repos {
  /** Test/dev helper: give a user a subscription. */
  setSubscription(userId: string, sub: SubscriptionRecord): void;
}

export function createMemoryRepos(): MemoryRepos {
  const users = new Map<string, UserRecord>(); // by authUid
  const subs = new Map<string, SubscriptionRow>(); // by user id
  const backups = new Map<string, BackupRecord>(); // by user id
  const aiDays = new Map<string, { chats: number; nudge?: { text: string; createdAt: Date }; tips?: string[] }>(); // by userId|day
  type ChildRow = ChildRecord & { linkHash: string | null; linkExpires: Date | null; unlock: { codeHash: string; expiresAt: Date; attempts: number } | null };
  const children = new Map<string, ChildRow>(); // by child id
  const announcements: (AnnouncementRecord & { targetUserId: string | null })[] = [];
  let planPrices = { student: 49, parent: 99 };
  const apps = new Map<number, RecommendedApp & { logo?: { type: string; bytes: Buffer } }>();
  let nextAppId = 1;
  const assignments = new Set<string>(); // `${userId}|${appId}`
  const settings = new Map<string, string>();
  const attempts = new Map<string, PayAttempt>();
  const payments = new Map<string, PaymentRecord>();
  const events = new Set<string>();
  const otps = new Map<string, OtpRecord>(); // by phone
  const sessions = new Map<string, { userId: string; expiresAt: Date }>(); // by token hash

  const ai = (u: string, d: string) => {
    const k = `${u}|${d}`;
    if (!aiDays.has(k)) aiDays.set(k, { chats: 0 });
    return aiDays.get(k)!;
  };

  /** Removes a child profile together with the child's own user row, sessions and backup. */
  function removeChild(childId: string) {
    const c = children.get(childId);
    if (!c) return;
    children.delete(childId);
    const u = [...users.values()].find((x) => x.id === c.userId);
    if (u) {
      users.delete(u.authUid);
      backups.delete(u.id);
      for (const [h, s] of sessions) if (s.userId === u.id) sessions.delete(h);
    }
  }

  return {
    recommendedApps: {
      async list() {
        return [...apps.values()].map(({ logo: _l, ...a }) => a);
      },
      async get(id) {
        const a = apps.get(id);
        if (!a) return null;
        const { logo: _l, ...rest } = a;
        return rest;
      },
      async create(n) {
        const now = new Date();
        const rec = { id: nextAppId++, name: n.name, tagline: n.tagline, url: n.url, keywords: n.keywords, active: true, hasLogo: !!n.logo, updatedAt: now, logo: n.logo };
        apps.set(rec.id, rec);
        const { logo: _l, ...rest } = rec;
        return rest;
      },
      async update(id, patch) {
        const a = apps.get(id);
        if (!a) return;
        Object.assign(a, Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== "logo" && v !== undefined)));
        if (patch.logo) { a.logo = patch.logo; a.hasLogo = true; }
        a.updatedAt = new Date();
      },
      async remove(id) {
        apps.delete(id);
        for (const k of [...assignments]) if (k.endsWith(`|${id}`)) assignments.delete(k);
      },
      async assign(userId, appId) {
        if (apps.has(appId)) assignments.add(`${userId}|${appId}`);
      },
      async unassign(userId, appId) {
        assignments.delete(`${userId}|${appId}`);
      },
      async assignedFor(userIds) {
        const out = new Map<string, number[]>();
        for (const k of assignments) {
          const [u, a] = k.split("|");
          if (userIds.includes(u!)) out.set(u!, [...(out.get(u!) ?? []), Number(a)]);
        }
        return out;
      },
      async getLogo(id): Promise<AppLogo | null> {
        const a = apps.get(id);
        return a?.logo ? { type: a.logo.type, bytes: a.logo.bytes, updatedAt: a.updatedAt } : null;
      },
    },
    settings: {
      async get(k) {
        return settings.get(k) ?? null;
      },
      async set(k, v) {
        settings.set(k, v);
      },
      async remove(k) {
        settings.delete(k);
      },
    },
    payments: {
      async addAttempt(a) {
        attempts.set(a.subscriptionId, { ...a });
      },
      async findAttempt(id) {
        return attempts.get(id) ?? null;
      },
      async upsertPayment(p) {
        const old = payments.get(p.paymentId);
        payments.set(p.paymentId, { ...p, createdAt: old?.createdAt ?? p.createdAt });
      },
      async listForUser(userId, limit) {
        return [...payments.values()].filter((p) => p.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
      },
      async recordEvent(id) {
        if (events.has(id)) return false;
        events.add(id);
        return true;
      },
    },
    planPrices: {
      async get() {
        return { ...planPrices };
      },
      async set(prices) {
        planPrices = { ...prices };
      },
    },
    announcements: {
      async create(a) {
        const rec = { id: announcements.length + 1, title: a.title, body: a.body, audience: a.audience, createdAt: new Date(), targetUserId: a.targetUserId ?? null };
        announcements.push(rec);
        return rec;
      },
      async listFor(user, afterId, since, limit) {
        const audienceMatches = (r: (typeof announcements)[number]) =>
          r.audience === "all" || (r.audience === "students" && user.role === "student") || (r.audience === "parents" && user.role === "parent") ||
          (r.audience === "children" && user.role === "child") || (r.audience === "user" && r.targetUserId === user.id);
        return announcements.filter((r) => r.id > afterId && r.createdAt >= since && audienceMatches(r)).slice(0, limit);
      },
    },
    ai: {
      async useChat(userId, day, limit) {
        const row = ai(userId, day);
        if (row.chats >= limit) return { allowed: false, remaining: 0 };
        row.chats += 1;
        return { allowed: true, remaining: limit - row.chats };
      },
      async refundChat(userId, day) {
        const row = ai(userId, day);
        row.chats = Math.max(0, row.chats - 1);
      },
      async getNudge(userId, day) {
        return ai(userId, day).nudge ?? null;
      },
      async saveNudge(userId, day, text) {
        ai(userId, day).nudge = { text, createdAt: new Date() };
      },
      async getTips(userId, day) {
        return ai(userId, day).tips ?? null;
      },
      async saveTips(userId, day, tips) {
        ai(userId, day).tips = tips;
      },
    },
    auth: {
      async saveOtp(phone, codeHash, expiresAt) {
        otps.set(phone, { codeHash, attempts: 0, expiresAt });
      },
      async getOtp(phone) {
        return otps.get(phone) ?? null;
      },
      async addOtpAttempt(phone) {
        const o = otps.get(phone);
        if (!o) return 0;
        o.attempts += 1;
        return o.attempts;
      },
      async deleteOtp(phone) {
        otps.delete(phone);
      },
      async createSession(userId, tokenHash, expiresAt) {
        sessions.set(tokenHash, { userId, expiresAt });
      },
      async findSession(tokenHash) {
        const s = sessions.get(tokenHash);
        if (!s || s.expiresAt.getTime() <= Date.now()) return null;
        const user = [...users.values()].find((u) => u.id === s.userId);
        return user ? { authUid: user.authUid, phone: user.phone } : null;
      },
      async deleteSession(tokenHash) {
        sessions.delete(tokenHash);
      },
      async deleteSessionsForUser(userId) {
        for (const [h, s] of sessions) if (s.userId === userId) sessions.delete(h);
      },
    },
    family: {
      async countChildren(parentUserId) {
        return [...children.values()].filter((c) => c.parentUserId === parentUserId).length;
      },
      async createChild(parentUserId, name, prepGoal, linkCodeHash, linkExpiresAt) {
        const now = new Date();
        const id = randomUUID();
        const user: UserRecord = {
          id: randomUUID(), authUid: `ch:${id}`, role: 'child', name, email: null, phone: null, exam: null, prepGoal,
          dailyGoalMin: 240, createdAt: now, updatedAt: now,
        };
        users.set(user.authUid, user);
        const row: ChildRow = {
          id, parentUserId, userId: user.id, name, prepGoal, enabled: true, linked: false, createdAt: now,
          linkHash: linkCodeHash, linkExpires: linkExpiresAt, unlock: null,
        };
        children.set(id, row);
        return row;
      },
      async listChildren(parentUserId) {
        return [...children.values()].filter((c) => c.parentUserId === parentUserId);
      },
      async getChild(parentUserId, childId) {
        const c = children.get(childId);
        return c && c.parentUserId === parentUserId ? c : null;
      },
      async findChildByUserId(userId) {
        return [...children.values()].find((c) => c.userId === userId) ?? null;
      },
      async updateChild(childId, update) {
        const c = children.get(childId);
        if (!c) return;
        if (update.name !== undefined) c.name = update.name;
        if (update.prepGoal !== undefined) c.prepGoal = update.prepGoal;
        if (update.enabled !== undefined) c.enabled = update.enabled;
        const u = [...users.values()].find((x) => x.id === c.userId);
        if (u) {
          if (update.name !== undefined) u.name = update.name;
          if (update.prepGoal !== undefined) u.prepGoal = update.prepGoal;
        }
      },
      async setLinkCode(childId, codeHash, expiresAt) {
        const c = children.get(childId);
        if (c) { c.linkHash = codeHash; c.linkExpires = expiresAt; c.linked = false; }
      },
      async findByLinkCodeHash(codeHash) {
        return [...children.values()].find((c) => c.linkHash === codeHash && c.linkExpires !== null && c.linkExpires.getTime() > Date.now()) ?? null;
      },
      async consumeLinkCode(childId) {
        const c = children.get(childId);
        if (c) { c.linkHash = null; c.linkExpires = null; c.linked = true; }
      },
      async setUnlockCode(childId, codeHash, expiresAt) {
        const c = children.get(childId);
        if (c) c.unlock = { codeHash, expiresAt, attempts: 0 };
      },
      async getUnlock(childId) {
        return children.get(childId)?.unlock ?? null;
      },
      async addUnlockAttempt(childId) {
        const u = children.get(childId)?.unlock;
        if (u) u.attempts += 1;
      },
      async clearUnlock(childId) {
        const c = children.get(childId);
        if (c) c.unlock = null;
      },
      async deleteChild(childId) {
        removeChild(childId);
      },
    },
    users: {
      async findByAuthUid(uid) {
        return users.get(uid) ?? null;
      },
      async setRole(userId, role) {
        const u = [...users.values()].find((x) => x.id === userId);
        if (u && u.role !== 'child') u.role = role;
      },
      async deleteByAuthUid(uid) {
        const u = users.get(uid);
        if (!u) return false;
        for (const c of [...children.values()]) if (c.parentUserId === u.id) removeChild(c.id);
        users.delete(uid);
        subs.delete(u.id);
        for (const [h, s] of sessions) if (s.userId === u.id) sessions.delete(h);
        backups.delete(u.id);
        return true;
      },
      async upsertByAuthUid(uid, update) {
        const now = new Date();
        const existing = users.get(uid);
        const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
        const { role: _ignored, ...definedNoRole } = defined as { role?: unknown };
        const next: UserRecord = existing
          ? { ...existing, ...definedNoRole, updatedAt: now }
          : {
              id: randomUUID(),
              authUid: uid,
              role: 'student',
              name: null,
              email: null,
              phone: null,
              exam: null,
              prepGoal: null,
              dailyGoalMin: 240,
              createdAt: now,
              updatedAt: now,
              ...defined,
            };
        users.set(uid, next);
        return next;
      },
    },
    subscriptions: {
      async findByUserId(userId) {
        const r = subs.get(userId);
        return r ? { productId: r.productId, status: r.status, expiresAt: r.expiresAt, autoRenewing: r.autoRenewing } : null;
      },
      async findByToken(token) {
        return [...subs.values()].find((r) => r.purchaseToken === token) ?? null;
      },
      async save(userId, sub) {
        subs.set(userId, { ...sub, userId });
      },
      async findRowByUserId(userId) {
        return subs.get(userId) ?? null;
      },
    },
    backups: {
      async get(userId) {
        return backups.get(userId) ?? null;
      },
      async put(userId, payload) {
        const updatedAt = new Date();
        backups.set(userId, { payload, updatedAt });
        return updatedAt;
      },
    },
    setSubscription: (userId, sub) =>
      void subs.set(userId, {
        userId, purchaseToken: `test-${userId}`, linkedPurchaseToken: null, acknowledged: true,
        latestOrderId: null, playState: null, productId: "focus_student", ...sub,
      }),
  };
}

/** Per-process counter. Fine for tests and a single dev server; production uses the MySQL limiter. */
export function createMemoryLimiter(now: () => number = Date.now): RateLimiter {
  const counts = new Map<string, { hits: number; endsAt: number }>();
  return {
    async hit(key, limit, windowSec) {
      const nowSec = Math.floor(now() / 1000);
      const windowStart = Math.floor(nowSec / windowSec) * windowSec;
      const id = `${key}:${windowSec}:${windowStart}`;
      const entry = counts.get(id) ?? { hits: 0, endsAt: windowStart + windowSec };
      entry.hits += 1;
      counts.set(id, entry);
      for (const [k, v] of counts) if (v.endsAt <= nowSec) counts.delete(k); // windows of any length that are over
      return { allowed: entry.hits <= limit, remaining: Math.max(0, limit - entry.hits), retryAfterSec: windowStart + windowSec - nowSec };
    },
  };
}
