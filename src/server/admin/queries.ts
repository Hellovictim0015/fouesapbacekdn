import type { Pool, RowDataPacket } from "mysql2/promise";
import { getEnv } from "../config/env";
import { getPool } from "../db/pool";
import { effectiveStatus, type SubscriptionView } from "../domain/subscriptionStatus";
import type { StoredSubscriptionStatus } from "../repos/types";

/** The admin panel reads straight from MySQL, so it needs DATABASE_URL (the API alone can run in memory). */
export function adminPool(): Pool {
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("The admin panel needs DATABASE_URL to be set.");
  return getPool(url);
}

export interface AdminRow {
  id: string;
  email: string;
  passwordHash: string;
}

export async function findAdminByEmail(pool: Pool, email: string): Promise<AdminRow | null> {
  const [rows] = await pool.execute<(RowDataPacket & { id: string; email: string; password_hash: string })[]>(
    "SELECT id, email, password_hash FROM admins WHERE email = ?",
    [email.trim().toLowerCase()],
  );
  return rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash } : null;
}

export interface DashboardStats {
  users: number;
  newUsers7d: number;
  trials: number;
  active: number;
  grace: number;
  expired: number;
  backups: number;
  aiToday: number;
}

export async function dashboardStats(pool: Pool): Promise<DashboardStats> {
  const [rows] = await pool.query<(RowDataPacket & Record<string, number | string>)[]>(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY) AS newUsers7d,
      (SELECT COUNT(*) FROM subscriptions WHERE status = 'TRIAL'  AND expires_at > UTC_TIMESTAMP(3)) AS trials,
      (SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE' AND expires_at > UTC_TIMESTAMP(3)) AS active,
      (SELECT COUNT(*) FROM subscriptions WHERE status = 'GRACE'  AND expires_at > UTC_TIMESTAMP(3)) AS grace,
      (SELECT COUNT(*) FROM subscriptions
         WHERE status = 'EXPIRED' OR (status IN ('TRIAL','ACTIVE','GRACE') AND expires_at <= UTC_TIMESTAMP(3))) AS expired,
      (SELECT COUNT(*) FROM session_backups) AS backups,
      (SELECT COALESCE(SUM(chat_count), 0) FROM ai_usage WHERE day = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))) AS aiToday`);
  const r = rows[0]!;
  const num = (k: string) => Number(r[k]);
  return {
    users: num("users"), newUsers7d: num("newUsers7d"), trials: num("trials"), active: num("active"),
    grace: num("grace"), expired: num("expired"), backups: num("backups"), aiToday: num("aiToday"),
  };
}

export const PAGE_SIZE = 25;

export interface UserListRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  exam: string | null;
  prepGoal: string | null;
  createdAt: Date;
  plan: SubscriptionView;
}

/** `%`, `_` and `\` typed in the search box must match themselves, not act as wildcards. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listUsers(pool: Pool, q: string, page: number): Promise<{ rows: UserListRow[]; total: number }> {
  const search = q.trim().slice(0, 100);
  const like = likePattern(search);
  const where = search === "" ? "1 = 1" : "(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.auth_uid = ?)";
  const filter = search === "" ? [] : [like, like, like, search];

  const [[count]] = (await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, filter)) as unknown as [[{ n: number }]];
  const [rows] = await pool.query<
    (RowDataPacket & {
      id: string; name: string | null; email: string | null; phone: string | null; exam: string | null; prep_goal: string | null; created_at: Date;
      status: StoredSubscriptionStatus | null; expires_at: Date | null; auto_renewing: number | null;
    })[]
  >(
    `SELECT u.id, u.name, u.email, u.phone, u.exam, u.prep_goal, u.created_at, s.status, s.expires_at, s.auto_renewing
     FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
     WHERE ${where}
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...filter, PAGE_SIZE, Math.max(0, page - 1) * PAGE_SIZE],
  );

  const now = new Date();
  return {
    total: Number(count.n),
    rows: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, exam: r.exam, prepGoal: r.prep_goal, createdAt: r.created_at,
      plan: effectiveStatus(r.status ? { status: r.status, expiresAt: r.expires_at, autoRenewing: r.auto_renewing === 1 } : null, now),
    })),
  };
}

export interface UserDetail {
  id: string;
  authUid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  exam: string | null;
  prepGoal: string | null;
  dailyGoalMin: number;
  createdAt: Date;
  updatedAt: Date;
  plan: SubscriptionView;
  subscription: { productId: string; storedStatus: string; playState: string | null; autoRenewing: boolean; purchaseToken: string } | null;
  /** Counts only: the admin panel never shows what a user studied or wrote. */
  backup: { updatedAt: Date; sessions: number; bytes: number } | null;
  aiUsage: { day: string; chats: number }[];
}

export async function getUserDetail(pool: Pool, id: string): Promise<UserDetail | null> {
  const [users] = await pool.execute<(RowDataPacket & { id: string; auth_uid: string; name: string | null; email: string | null; phone: string | null; exam: string | null; prep_goal: string | null; daily_goal_min: number; created_at: Date; updated_at: Date })[]>(
    "SELECT id, auth_uid, name, email, phone, exam, prep_goal, daily_goal_min, created_at, updated_at FROM users WHERE id = ?",
    [id],
  );
  const u = users[0];
  if (!u) return null;

  const [subs] = await pool.execute<(RowDataPacket & { product_id: string; status: StoredSubscriptionStatus; expires_at: Date | null; auto_renewing: number; play_state: string | null; purchase_token: string })[]>(
    "SELECT product_id, status, expires_at, auto_renewing, play_state, purchase_token FROM subscriptions WHERE user_id = ?",
    [id],
  );
  const [backups] = await pool.execute<(RowDataPacket & { updated_at: Date; sessions: number | null; bytes: number })[]>(
    "SELECT updated_at, JSON_LENGTH(payload, '$.sessions') AS sessions, LENGTH(CAST(payload AS CHAR)) AS bytes FROM session_backups WHERE user_id = ?",
    [id],
  );
  const [ai] = await pool.execute<(RowDataPacket & { day: string; chat_count: number })[]>(
    "SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, chat_count FROM ai_usage WHERE user_id = ? ORDER BY day DESC LIMIT 7",
    [id],
  );
  const s = subs[0];
  const b = backups[0];
  return {
    id: u.id, authUid: u.auth_uid, name: u.name, email: u.email, phone: u.phone, exam: u.exam, prepGoal: u.prep_goal,
    dailyGoalMin: u.daily_goal_min, createdAt: u.created_at, updatedAt: u.updated_at,
    plan: effectiveStatus(s ? { status: s.status, expiresAt: s.expires_at, autoRenewing: s.auto_renewing === 1 } : null, new Date()),
    subscription: s ? { productId: s.product_id, storedStatus: s.status, playState: s.play_state, autoRenewing: s.auto_renewing === 1, purchaseToken: s.purchase_token } : null,
    backup: b ? { updatedAt: b.updated_at, sessions: Number(b.sessions ?? 0), bytes: Number(b.bytes) } : null,
    aiUsage: ai.map((r) => ({ day: r.day, chats: r.chat_count })),
  };
}

export async function authUidOf(pool: Pool, id: string): Promise<string | null> {
  const [rows] = await pool.execute<(RowDataPacket & { auth_uid: string })[]>("SELECT auth_uid FROM users WHERE id = ?", [id]);
  return rows[0]?.auth_uid ?? null;
}

export interface SentAnnouncement {
  id: number;
  title: string;
  body: string;
  audience: string;
  createdAt: Date;
}

export async function recentAnnouncements(pool: Pool, limit = 20): Promise<SentAnnouncement[]> {
  const [rows] = await pool.query<(RowDataPacket & { id: number; title: string; body: string; audience: string; created_at: Date })[]>(
    "SELECT id, title, body, audience, created_at FROM announcements ORDER BY id DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, body: r.body, audience: r.audience, createdAt: r.created_at }));
}

/** The user behind a phone number typed in the admin form (accepts 10 digits or +91...). */
export async function userIdByPhone(pool: Pool, e164: string): Promise<string | null> {
  const [rows] = await pool.execute<(RowDataPacket & { id: string })[]>("SELECT id FROM users WHERE phone = ?", [e164]);
  return rows[0]?.id ?? null;
}

/** What each student typed they are preparing for (for counting how many students an app would be shown to). */
export async function allGoals(pool: Pool): Promise<{ prepGoal: string | null; exam: string | null }[]> {
  const [rows] = await pool.query<(RowDataPacket & { prep_goal: string | null; exam: string | null })[]>(
    "SELECT prep_goal, exam FROM users WHERE role <> 'child' OR prep_goal IS NOT NULL LIMIT 50000",
  );
  return rows.map((r) => ({ prepGoal: r.prep_goal, exam: r.exam }));
}

export interface PaymentsSummary {
  collectedPaise30d: number;
  collectedPaiseAll: number;
  paid30d: number;
  failed30d: number;
  activeStudent: number;
  activeParent: number;
}

export async function paymentsSummary(pool: Pool): Promise<PaymentsSummary> {
  const [rows] = await pool.query<(RowDataPacket & Record<string, number | string>)[]>(`
    SELECT
      (SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'captured' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS collected30,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'captured') AS collectedAll,
      (SELECT COUNT(*) FROM payments WHERE status = 'captured' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS paid30,
      (SELECT COUNT(*) FROM payments WHERE status = 'failed' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS failed30,
      (SELECT COUNT(*) FROM subscriptions WHERE product_id = 'focus_student' AND status IN ('TRIAL','ACTIVE','GRACE') AND expires_at > UTC_TIMESTAMP(3)) AS activeStudent,
      (SELECT COUNT(*) FROM subscriptions WHERE product_id = 'focus_parent'  AND status IN ('TRIAL','ACTIVE','GRACE') AND expires_at > UTC_TIMESTAMP(3)) AS activeParent`);
  const r = rows[0]!;
  return {
    collectedPaise30d: Number(r.collected30), collectedPaiseAll: Number(r.collectedAll), paid30d: Number(r.paid30),
    failed30d: Number(r.failed30), activeStudent: Number(r.activeStudent), activeParent: Number(r.activeParent),
  };
}

export const PAYMENT_STATUSES = ["captured", "authorized", "failed", "refunded"] as const;

export interface PaymentListRow {
  paymentId: string;
  userId: string | null;
  userName: string | null;
  phone: string | null;
  tier: string | null;
  amountPaise: number;
  status: string;
  method: string | null;
  detail: string | null;
  errorText: string | null;
  subscriptionId: string | null;
  createdAt: Date;
}

export async function listPayments(pool: Pool, q: string, status: string, page: number): Promise<{ rows: PaymentListRow[]; total: number }> {
  const search = q.trim().slice(0, 100);
  const like = likePattern(search);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (search) {
    where.push("(p.payment_id = ? OR p.subscription_id = ? OR p.phone LIKE ? OR p.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)");
    args.push(search, search, like, like, like, like);
  }
  if ((PAYMENT_STATUSES as readonly string[]).includes(status)) {
    where.push("p.status = ?");
    args.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM payments p LEFT JOIN users u ON u.id = p.user_id ${clause}`;
  const [[count]] = (await pool.query<(RowDataPacket & { n: number })[]>(`SELECT COUNT(*) AS n ${from}`, args)) as unknown as [[{ n: number }]];
  const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
    `SELECT p.payment_id, p.user_id, u.name AS user_name, COALESCE(p.phone, u.phone) AS phone, p.tier, p.amount_paise, p.status, p.method, p.detail,
            p.error_text, p.subscription_id, p.created_at ${from} ORDER BY p.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(Math.max(1, page) - 1) * PAGE_SIZE}`,
    args,
  );
  return {
    total: Number(count.n),
    rows: rows.map((r) => ({
      paymentId: String(r.payment_id), userId: (r.user_id as string | null) ?? null, userName: (r.user_name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null, tier: (r.tier as string | null) ?? null, amountPaise: Number(r.amount_paise), status: String(r.status),
      method: (r.method as string | null) ?? null, detail: (r.detail as string | null) ?? null, errorText: (r.error_text as string | null) ?? null,
      subscriptionId: (r.subscription_id as string | null) ?? null, createdAt: r.created_at as Date,
    })),
  };
}
