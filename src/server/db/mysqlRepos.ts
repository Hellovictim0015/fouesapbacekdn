import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { AnnouncementRecord, AppLogo, RecommendedApp, Audience, ChildRecord, RateLimiter, Repos, Role, StoredSubscriptionStatus, UserRecord } from "../repos/types";

/** Plain-SQL repositories. No ORM: every query is visible here. */

interface UserRow extends RowDataPacket {
  id: string;
  auth_uid: string;
  role: Role;
  name: string | null;
  email: string | null;
  phone: string | null;
  exam: string | null;
  prep_goal: string | null;
  daily_goal_min: number;
  created_at: Date;
  updated_at: Date;
}

const USER_COLUMNS = "id, auth_uid, role, name, email, phone, exam, prep_goal, daily_goal_min, created_at, updated_at";

function toUser(r: UserRow): UserRecord {
  return {
    id: r.id,
    authUid: r.auth_uid,
    role: r.role,
    name: r.name,
    email: r.email,
    phone: r.phone,
    exam: r.exam,
    prepGoal: r.prep_goal,
    dailyGoalMin: r.daily_goal_min,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SubRow extends RowDataPacket {
  user_id: string;
  product_id: string;
  purchase_token: string;
  linked_purchase_token: string | null;
  status: StoredSubscriptionStatus;
  expires_at: Date | null;
  auto_renewing: number;
  acknowledged: number;
  latest_order_id: string | null;
  play_state: string | null;
}

const SUB_COLUMNS =
  "user_id, product_id, purchase_token, linked_purchase_token, status, expires_at, auto_renewing, acknowledged, latest_order_id, play_state";

export interface PaymentRow extends RowDataPacket {
  payment_id: string; user_id: string | null; subscription_id: string | null; tier: "student" | "parent" | null; amount_paise: number; currency: string;
  status: string; method: string | null; detail: string | null; phone: string | null; email: string | null; error_code: string | null;
  error_text: string | null; created_at: Date;
}

export function toPayment(r: PaymentRow): import("../repos/types").PaymentRecord {
  return {
    paymentId: r.payment_id, userId: r.user_id, subscriptionId: r.subscription_id, tier: r.tier, amountPaise: r.amount_paise, currency: r.currency,
    status: r.status, method: r.method, detail: r.detail, phone: r.phone, email: r.email, errorCode: r.error_code, errorText: r.error_text, createdAt: r.created_at,
  };
}

interface AppRow extends RowDataPacket {
  id: number;
  name: string;
  tagline: string;
  url: string;
  keywords: unknown;
  active: number;
  has_logo: number;
  updated_at: Date;
}

interface ChildRow extends RowDataPacket {
  id: string;
  parent_user_id: string;
  user_id: string;
  name: string;
  prep_goal: string | null;
  enabled: number;
  linked: number;
  created_at: Date;
}

/** `linked` = the child has signed in with a code at least once since the last code was made. */
const CHILD_SELECT = `SELECT c.id, c.parent_user_id, c.user_id, c.name, x.prep_goal, c.enabled, c.linked, c.created_at
  FROM children c JOIN users x ON x.id = c.user_id`;

const toChild = (r: ChildRow): ChildRecord => ({
  id: r.id, parentUserId: r.parent_user_id, userId: r.user_id, name: r.name, prepGoal: r.prep_goal,
  enabled: r.enabled === 1, linked: r.linked === 1, createdAt: r.created_at,
});

/** mysql2 rejects `undefined` parameters; "not provided" is NULL here and COALESCE keeps the old value. */
const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export function createMysqlRepos(pool: Pool): Repos {
  async function findUser(uid: string): Promise<UserRecord | null> {
    const [rows] = await pool.execute<UserRow[]>(`SELECT ${USER_COLUMNS} FROM users WHERE auth_uid = ?`, [uid]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  const getChildBy = async (where: string, params: (string | number)[]): Promise<ChildRecord | null> => {
    const [rows] = await pool.execute<ChildRow[]>(`${CHILD_SELECT} WHERE ${where}`, params);
    return rows[0] ? toChild(rows[0]) : null;
  };

  const toApp = (r: AppRow): RecommendedApp => ({
    id: r.id, name: r.name, tagline: r.tagline, url: r.url,
    keywords: (typeof r.keywords === "string" ? JSON.parse(r.keywords) : r.keywords) as string[],
    active: r.active === 1, hasLogo: r.has_logo === 1, updatedAt: r.updated_at,
  });
  const APP_COLS = "id, name, tagline, url, keywords, active, (logo IS NOT NULL) AS has_logo, updated_at";

  return {
    recommendedApps: {
      async list() {
        const [rows] = await pool.execute<AppRow[]>(`SELECT ${APP_COLS} FROM recommended_apps ORDER BY id`);
        return rows.map(toApp);
      },
      async get(id) {
        const [rows] = await pool.execute<AppRow[]>(`SELECT ${APP_COLS} FROM recommended_apps WHERE id = ?`, [id]);
        return rows[0] ? toApp(rows[0]) : null;
      },
      async create(n) {
        const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
          `INSERT INTO recommended_apps (name, tagline, url, keywords, logo, logo_type, created_by, created_at, updated_at)
           VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [n.name, n.tagline, n.url, JSON.stringify(n.keywords), n.logo?.bytes ?? null, n.logo?.type ?? null, n.createdBy],
        );
        const [rows] = await pool.execute<AppRow[]>(`SELECT ${APP_COLS} FROM recommended_apps WHERE id = ?`, [res.insertId]);
        return toApp(rows[0]!);
      },
      async update(id, p) {
        await pool.execute(
          `UPDATE recommended_apps SET name = COALESCE(?, name), tagline = COALESCE(?, tagline), url = COALESCE(?, url),
             keywords = COALESCE(CAST(? AS JSON), keywords), active = COALESCE(?, active),
             logo = COALESCE(?, logo), logo_type = COALESCE(?, logo_type), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
          [n(p.name), n(p.tagline), n(p.url), p.keywords ? JSON.stringify(p.keywords) : null, p.active === undefined ? null : p.active ? 1 : 0, p.logo?.bytes ?? null, p.logo?.type ?? null, id],
        );
      },
      async remove(id) {
        await pool.execute("DELETE FROM recommended_apps WHERE id = ?", [id]);
      },
      async assign(userId, appId, by) {
        await pool.execute(
          "INSERT IGNORE INTO user_app_assignments (user_id, app_id, created_by, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))",
          [userId, appId, by],
        );
      },
      async unassign(userId, appId) {
        await pool.execute("DELETE FROM user_app_assignments WHERE user_id = ? AND app_id = ?", [userId, appId]);
      },
      async assignedFor(userIds) {
        const out = new Map<string, number[]>();
        if (userIds.length === 0) return out;
        const marks = userIds.map(() => "?").join(",");
        const [rows] = await pool.query<(RowDataPacket & { user_id: string; app_id: number })[]>(
          `SELECT user_id, app_id FROM user_app_assignments WHERE user_id IN (${marks}) ORDER BY created_at`, userIds);
        for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.app_id]);
        return out;
      },
      async getLogo(id): Promise<AppLogo | null> {
        const [rows] = await pool.execute<(RowDataPacket & { logo: Buffer | null; logo_type: string | null; updated_at: Date })[]>(
          "SELECT logo, logo_type, updated_at FROM recommended_apps WHERE id = ?", [id]);
        const r = rows[0];
        return r?.logo && r.logo_type ? { type: r.logo_type, bytes: r.logo, updatedAt: r.updated_at } : null;
      },
    },
    settings: {
      async get(k) {
        const [rows] = await pool.execute<(RowDataPacket & { v: string })[]>("SELECT v FROM app_settings WHERE k = ?", [k]);
        return rows[0]?.v ?? null;
      },
      async set(k, v, isSecret, by) {
        await pool.execute(
          `INSERT INTO app_settings (k, v, is_secret, updated_at, updated_by) VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?)
           ON DUPLICATE KEY UPDATE v = VALUES(v), is_secret = VALUES(is_secret), updated_at = UTC_TIMESTAMP(3), updated_by = VALUES(updated_by)`,
          [k, v, isSecret ? 1 : 0, by],
        );
      },
      async remove(k) {
        await pool.execute("DELETE FROM app_settings WHERE k = ?", [k]);
      },
    },
    payments: {
      async addAttempt(a) {
        await pool.execute(
          `INSERT INTO pay_attempts (subscription_id, user_id, tier, amount_paise, trial, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
          [a.subscriptionId, a.userId, a.tier, a.amountPaise, a.trial ? 1 : 0],
        );
      },
      async findAttempt(id) {
        const [rows] = await pool.execute<(RowDataPacket & { subscription_id: string; user_id: string; tier: "student" | "parent"; amount_paise: number; trial: number })[]>(
          "SELECT subscription_id, user_id, tier, amount_paise, trial FROM pay_attempts WHERE subscription_id = ?", [id]);
        const r = rows[0];
        return r ? { subscriptionId: r.subscription_id, userId: r.user_id, tier: r.tier, amountPaise: r.amount_paise, trial: r.trial === 1 } : null;
      },
      async upsertPayment(p) {
        await pool.execute(
          `INSERT INTO payments (payment_id, user_id, subscription_id, tier, amount_paise, currency, status, method, detail, phone, email, error_code, error_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id), subscription_id = COALESCE(VALUES(subscription_id), subscription_id),
             tier = COALESCE(VALUES(tier), tier), amount_paise = VALUES(amount_paise), status = VALUES(status), method = COALESCE(VALUES(method), method),
             detail = COALESCE(VALUES(detail), detail), phone = COALESCE(VALUES(phone), phone), email = COALESCE(VALUES(email), email),
             error_code = VALUES(error_code), error_text = VALUES(error_text), updated_at = UTC_TIMESTAMP(3)`,
          [p.paymentId, p.userId, p.subscriptionId, p.tier, p.amountPaise, p.currency, p.status, p.method, p.detail, p.phone, p.email, p.errorCode, p.errorText, p.createdAt],
        );
      },
      async listForUser(userId, limit) {
        const [rows] = await pool.query<PaymentRow[]>(
          `SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ${Math.max(1, Math.floor(limit))}`, [userId]);
        return rows.map(toPayment);
      },
      async recordEvent(id) {
        const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
          "INSERT IGNORE INTO pay_events (event_id, received_at) VALUES (?, UTC_TIMESTAMP(3))", [id.slice(0, 128)]);
        return res.affectedRows > 0;
      },
    },
    planPrices: {
      async get() {
        const [rows] = await pool.execute<(RowDataPacket & { plan: "student" | "parent"; amount_inr: number })[]>("SELECT plan, amount_inr FROM plan_prices");
        const out = { student: 49, parent: 99 }; // used only if a row is missing
        for (const r of rows) out[r.plan] = r.amount_inr;
        return out;
      },
      async set(p, by) {
        for (const [plan, amount] of [["student", p.student], ["parent", p.parent]] as const) {
          await pool.execute(
            `INSERT INTO plan_prices (plan, amount_inr, updated_at, updated_by) VALUES (?, ?, UTC_TIMESTAMP(3), ?)
             ON DUPLICATE KEY UPDATE amount_inr = VALUES(amount_inr), updated_at = UTC_TIMESTAMP(3), updated_by = VALUES(updated_by)`,
            [plan, amount, by],
          );
        }
      },
    },
    announcements: {
      async create(a) {
        const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
          "INSERT INTO announcements (title, body, audience, target_user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
          [a.title, a.body, a.audience, a.targetUserId ?? null, a.createdBy],
        );
        return { id: res.insertId, title: a.title, body: a.body, audience: a.audience, createdAt: new Date() };
      },
      async listFor(user, afterId, since, limit) {
        const [rows] = await pool.execute<(RowDataPacket & { id: number; title: string; body: string; audience: Audience; created_at: Date })[]>(
          `SELECT id, title, body, audience, created_at FROM announcements
           WHERE id > ? AND created_at >= ?
             AND (audience = 'all'
               OR (audience = 'students' AND ? = 'student')
               OR (audience = 'parents' AND ? = 'parent')
               OR (audience = 'children' AND ? = 'child')
               OR (audience = 'user' AND target_user_id = ?))
           ORDER BY id LIMIT ${Math.max(1, Math.min(20, Math.floor(limit)))}`,
          [afterId, since, user.role, user.role, user.role, user.id],
        );
        return rows.map((r) => ({ id: Number(r.id), title: r.title, body: r.body, audience: r.audience, createdAt: r.created_at }));
      },
    },
    ai: {
      async useChat(userId, day, limit) {
        await pool.execute("INSERT IGNORE INTO ai_usage (id, user_id, day, chat_count) VALUES (?, ?, ?, 0)", [randomUUID(), userId, day]);
        // One statement both checks the limit and counts, so two simultaneous messages cannot both slip past it.
        const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
          "UPDATE ai_usage SET chat_count = chat_count + 1 WHERE user_id = ? AND day = ? AND chat_count < ?",
          [userId, day, limit],
        );
        const [rows] = await pool.execute<(RowDataPacket & { chat_count: number })[]>("SELECT chat_count FROM ai_usage WHERE user_id = ? AND day = ?", [userId, day]);
        const used = rows[0]?.chat_count ?? 0;
        return { allowed: res.affectedRows > 0, remaining: Math.max(0, limit - used) };
      },
      async refundChat(userId, day) {
        await pool.execute("UPDATE ai_usage SET chat_count = chat_count - 1 WHERE user_id = ? AND day = ? AND chat_count > 0", [userId, day]);
      },
      async getNudge(userId, day) {
        const [rows] = await pool.execute<(RowDataPacket & { nudge_text: string | null; nudge_at: Date | null })[]>(
          "SELECT nudge_text, nudge_at FROM ai_usage WHERE user_id = ? AND day = ?", [userId, day]);
        const r = rows[0];
        return r?.nudge_text && r.nudge_at ? { text: r.nudge_text, createdAt: r.nudge_at } : null;
      },
      async getTips(userId, day) {
        const [rows] = await pool.execute<(RowDataPacket & { tips: unknown })[]>("SELECT tips FROM ai_usage WHERE user_id = ? AND day = ?", [userId, day]);
        const t = rows[0]?.tips;
        if (t == null) return null;
        const arr = typeof t === "string" ? JSON.parse(t) : t;
        return Array.isArray(arr) ? (arr as string[]) : null;
      },
      async saveTips(userId, day, tips) {
        await pool.execute("INSERT IGNORE INTO ai_usage (id, user_id, day, chat_count) VALUES (?, ?, ?, 0)", [randomUUID(), userId, day]);
        await pool.execute("UPDATE ai_usage SET tips = CAST(? AS JSON), tips_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND day = ?", [JSON.stringify(tips), userId, day]);
      },
      async saveNudge(userId, day, text) {
        await pool.execute("INSERT IGNORE INTO ai_usage (id, user_id, day, chat_count) VALUES (?, ?, ?, 0)", [randomUUID(), userId, day]);
        await pool.execute("UPDATE ai_usage SET nudge_text = ?, nudge_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND day = ?", [text, userId, day]);
      },
    },
    family: {
      async countChildren(parentUserId) {
        const [rows] = await pool.execute<(RowDataPacket & { n: number })[]>("SELECT COUNT(*) AS n FROM children WHERE parent_user_id = ?", [parentUserId]);
        return Number(rows[0]?.n ?? 0);
      },
      async createChild(parentUserId, name, prepGoal, linkCodeHash, linkExpiresAt) {
        const childId = randomUUID();
        const userId = randomUUID();
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.execute(
            `INSERT INTO users (id, auth_uid, role, name, prep_goal, daily_goal_min, created_at, updated_at)
             VALUES (?, ?, 'child', ?, ?, 240, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [userId, `ch:${childId}`, name, prepGoal],
          );
          await conn.execute(
            `INSERT INTO children (id, parent_user_id, user_id, name, link_code_hash, link_code_expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
            [childId, parentUserId, userId, name, linkCodeHash, linkExpiresAt],
          );
          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
        const c = await getChildBy("c.id = ?", [childId]);
        if (!c) throw new Error("child vanished right after creation");
        return c;
      },
      async listChildren(parentUserId) {
        const [rows] = await pool.execute<ChildRow[]>(`${CHILD_SELECT} WHERE c.parent_user_id = ? ORDER BY c.created_at`, [parentUserId]);
        return rows.map(toChild);
      },
      getChild: (parentUserId, childId) => getChildBy("c.parent_user_id = ? AND c.id = ?", [parentUserId, childId]),
      findChildByUserId: (userId) => getChildBy("c.user_id = ?", [userId]),
      async updateChild(childId, u) {
        await pool.execute(
          "UPDATE children SET name = COALESCE(?, name), enabled = COALESCE(?, enabled) WHERE id = ?",
          [n(u.name), u.enabled === undefined ? null : u.enabled ? 1 : 0, childId],
        );
        await pool.execute(
          "UPDATE users x JOIN children c ON c.user_id = x.id SET x.name = COALESCE(?, x.name), x.prep_goal = COALESCE(?, x.prep_goal), x.updated_at = UTC_TIMESTAMP(3) WHERE c.id = ?",
          [n(u.name), n(u.prepGoal), childId],
        );
      },
      async setLinkCode(childId, codeHash, expiresAt) {
        await pool.execute("UPDATE children SET link_code_hash = ?, link_code_expires_at = ?, linked = 0 WHERE id = ?", [codeHash, expiresAt, childId]);
      },
      findByLinkCodeHash: (codeHash) => getChildBy("c.link_code_hash = ? AND c.link_code_expires_at > UTC_TIMESTAMP(3)", [codeHash]),
      async consumeLinkCode(childId) {
        await pool.execute("UPDATE children SET link_code_hash = NULL, link_code_expires_at = NULL, linked = 1 WHERE id = ?", [childId]);
      },
      async setUnlockCode(childId, codeHash, expiresAt) {
        await pool.execute("UPDATE children SET unlock_code_hash = ?, unlock_expires_at = ?, unlock_attempts = 0 WHERE id = ?", [codeHash, expiresAt, childId]);
      },
      async getUnlock(childId) {
        const [rows] = await pool.execute<(RowDataPacket & { unlock_code_hash: string | null; unlock_expires_at: Date | null; unlock_attempts: number })[]>(
          "SELECT unlock_code_hash, unlock_expires_at, unlock_attempts FROM children WHERE id = ?", [childId]);
        const r = rows[0];
        return r?.unlock_code_hash && r.unlock_expires_at ? { codeHash: r.unlock_code_hash, expiresAt: r.unlock_expires_at, attempts: r.unlock_attempts } : null;
      },
      async addUnlockAttempt(childId) {
        await pool.execute("UPDATE children SET unlock_attempts = unlock_attempts + 1 WHERE id = ?", [childId]);
      },
      async clearUnlock(childId) {
        await pool.execute("UPDATE children SET unlock_code_hash = NULL, unlock_expires_at = NULL, unlock_attempts = 0 WHERE id = ?", [childId]);
      },
      async deleteChild(childId) {
        // Deleting the child's user row removes the children row, their sessions and backup (ON DELETE CASCADE).
        await pool.execute("DELETE x FROM users x JOIN children c ON c.user_id = x.id WHERE c.id = ?", [childId]);
      },
    },
    auth: {
      async saveOtp(phone, codeHash, expiresAt) {
        await pool.execute(
          `INSERT INTO otp_codes (phone, code_hash, attempts, expires_at, created_at)
           VALUES (?, ?, 0, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0,
             expires_at = VALUES(expires_at), created_at = UTC_TIMESTAMP(3)`,
          [phone, codeHash, expiresAt],
        );
      },
      async getOtp(phone) {
        const [rows] = await pool.execute<(RowDataPacket & { code_hash: string; attempts: number; expires_at: Date })[]>(
          "SELECT code_hash, attempts, expires_at FROM otp_codes WHERE phone = ?",
          [phone],
        );
        const r = rows[0];
        return r ? { codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at } : null;
      },
      async addOtpAttempt(phone) {
        await pool.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?", [phone]);
        const [rows] = await pool.execute<(RowDataPacket & { attempts: number })[]>("SELECT attempts FROM otp_codes WHERE phone = ?", [phone]);
        return rows[0]?.attempts ?? 0;
      },
      async deleteOtp(phone) {
        await pool.execute("DELETE FROM otp_codes WHERE phone = ?", [phone]);
      },
      async createSession(userId, tokenHash, expiresAt) {
        await pool.execute(
          "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, UTC_TIMESTAMP(3), ?)",
          [tokenHash, userId, expiresAt],
        );
        // Expired rows are dead weight: sweep them now and then.
        if (Math.random() < 0.05) {
          await pool.execute("DELETE FROM auth_sessions WHERE expires_at < UTC_TIMESTAMP(3)").catch(() => undefined);
        }
      },
      async findSession(tokenHash) {
        const [rows] = await pool.execute<(RowDataPacket & { auth_uid: string; phone: string | null })[]>(
          `SELECT u.auth_uid, u.phone FROM auth_sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)`,
          [tokenHash],
        );
        return rows[0] ? { authUid: rows[0].auth_uid, phone: rows[0].phone } : null;
      },
      async deleteSession(tokenHash) {
        await pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
      },
      async deleteSessionsForUser(userId) {
        await pool.execute("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
      },
    },
    users: {
      findByAuthUid: findUser,

      async upsertByAuthUid(uid, u) {
        // Insert the row, or on a repeat call change only the fields that were actually sent.
        await pool.execute(
          `INSERT INTO users (id, auth_uid, role, name, email, phone, exam, prep_goal, daily_goal_min, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 240), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE
             name = COALESCE(?, name),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             exam = COALESCE(?, exam),
             prep_goal = COALESCE(?, prep_goal),
             daily_goal_min = COALESCE(?, daily_goal_min),
             updated_at = UTC_TIMESTAMP(3)`,
          [
            randomUUID(), uid, u.role ?? "student", n(u.name), n(u.email), n(u.phone), n(u.exam), n(u.prepGoal), n(u.dailyGoalMin),
            n(u.name), n(u.email), n(u.phone), n(u.exam), n(u.prepGoal), n(u.dailyGoalMin),
          ],
        );
        const user = await findUser(uid);
        if (!user) throw new Error("user vanished right after upsert");
        return user;
      },

      async setRole(userId, role) {
        await pool.execute("UPDATE users SET role = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND role <> 'child'", [role, userId]);
      },

      async deleteByAuthUid(uid) {
        // A parent's children are separate user rows (no phone number): remove those first, they are not covered by cascade.
        await pool.execute(
          "DELETE c FROM users c JOIN children k ON k.user_id = c.id JOIN users p ON p.id = k.parent_user_id WHERE p.auth_uid = ?",
          [uid],
        );
        // subscriptions, session_backups and ai_usage go with it (ON DELETE CASCADE).
        const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
          "DELETE FROM users WHERE auth_uid = ?",
          [uid],
        );
        return res.affectedRows > 0;
      },
    },

    subscriptions: {
      async findByToken(token) {
        const [rows] = await pool.execute<SubRow[]>(`SELECT ${SUB_COLUMNS} FROM subscriptions WHERE purchase_token = ?`, [token]);
        const r = rows[0];
        return r
          ? {
              userId: r.user_id, productId: r.product_id, purchaseToken: r.purchase_token, linkedPurchaseToken: r.linked_purchase_token,
              status: r.status, expiresAt: r.expires_at, autoRenewing: r.auto_renewing === 1, acknowledged: r.acknowledged === 1,
              latestOrderId: r.latest_order_id, playState: r.play_state,
            }
          : null;
      },

      async save(userId, s) {
        await pool.execute(
          `INSERT INTO subscriptions (id, user_id, product_id, purchase_token, linked_purchase_token, status, expires_at,
             auto_renewing, acknowledged, latest_order_id, play_state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), purchase_token = VALUES(purchase_token),
             linked_purchase_token = VALUES(linked_purchase_token), status = VALUES(status), expires_at = VALUES(expires_at),
             auto_renewing = VALUES(auto_renewing), acknowledged = VALUES(acknowledged), latest_order_id = VALUES(latest_order_id),
             play_state = VALUES(play_state), updated_at = UTC_TIMESTAMP(3)`,
          [
            randomUUID(), userId, s.productId, s.purchaseToken, s.linkedPurchaseToken, s.status, s.expiresAt,
            s.autoRenewing ? 1 : 0, s.acknowledged ? 1 : 0, s.latestOrderId, s.playState,
          ],
        );
      },

      async findRowByUserId(userId) {
        const [rows] = await pool.execute<SubRow[]>(`SELECT ${SUB_COLUMNS} FROM subscriptions WHERE user_id = ?`, [userId]);
        const r = rows[0];
        return r
          ? {
              userId: r.user_id, productId: r.product_id, purchaseToken: r.purchase_token, linkedPurchaseToken: r.linked_purchase_token,
              status: r.status, expiresAt: r.expires_at, autoRenewing: r.auto_renewing === 1, acknowledged: r.acknowledged === 1,
              latestOrderId: r.latest_order_id, playState: r.play_state,
            }
          : null;
      },

      async findByUserId(userId) {
        const [rows] = await pool.execute<(RowDataPacket & { product_id: string; status: StoredSubscriptionStatus; expires_at: Date | null; auto_renewing: number })[]>(
          "SELECT product_id, status, expires_at, auto_renewing FROM subscriptions WHERE user_id = ?",
          [userId],
        );
        const r = rows[0];
        return r ? { productId: r.product_id, status: r.status, expiresAt: r.expires_at, autoRenewing: r.auto_renewing === 1 } : null;
      },
    },

    backups: {
      async get(userId) {
        const [rows] = await pool.execute<(RowDataPacket & { payload: unknown; updated_at: Date })[]>(
          "SELECT payload, updated_at FROM session_backups WHERE user_id = ?",
          [userId],
        );
        const r = rows[0];
        if (!r) return null;
        // MySQL's JSON type comes back already parsed; tolerate a string from other drivers.
        return { payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload, updatedAt: r.updated_at };
      },

      async put(userId, payload) {
        const json = JSON.stringify(payload);
        await pool.execute(
          `INSERT INTO session_backups (user_id, schema_version, payload, updated_at)
           VALUES (?, 1, CAST(? AS JSON), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE payload = CAST(? AS JSON), updated_at = UTC_TIMESTAMP(3)`,
          [userId, json, json],
        );
        const [rows] = await pool.execute<(RowDataPacket & { updated_at: Date })[]>(
          "SELECT updated_at FROM session_backups WHERE user_id = ?",
          [userId],
        );
        return rows[0]!.updated_at;
      },
    },
  };
}

/** Counts requests per key per fixed time window in MySQL, so every server instance shares one count. */
export function createMysqlLimiter(pool: Pool, now: () => number = Date.now): RateLimiter {
  return {
    async hit(key, limit, windowSec) {
      const nowSec = Math.floor(now() / 1000);
      const windowStart = Math.floor(nowSec / windowSec) * windowSec;
      await pool.execute(
        `INSERT INTO rate_limits (key_name, window_start, hits) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE hits = hits + 1`,
        [key.slice(0, 190), windowStart],
      );
      const [rows] = await pool.execute<(RowDataPacket & { hits: number })[]>(
        "SELECT hits FROM rate_limits WHERE key_name = ? AND window_start = ?",
        [key.slice(0, 190), windowStart],
      );
      const hits = rows[0]?.hits ?? 1;
      // Old windows are useless: sweep them now and then (1 call in 50).
      if (Math.random() < 0.02) {
        await pool.execute("DELETE FROM rate_limits WHERE window_start < ?", [nowSec - 2 * windowSec]).catch(() => undefined);
      }
      return { allowed: hits <= limit, remaining: Math.max(0, limit - hits), retryAfterSec: windowStart + windowSec - nowSec };
    },
  };
}
