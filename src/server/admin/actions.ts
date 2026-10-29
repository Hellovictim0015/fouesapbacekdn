"use server";

import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "../container";
import { requireAdmin } from "./auth";
import { generateKeywords, parseKeywordInput } from "../apps/keywords";
import { validateAppUrl, validateLogo, type ValidLogo } from "../apps/logo";
import { normalizePhone } from "../auth/phone";
import { stopChargesBeforeDeletion } from "../pay/service";
import { clearRazorpayKeys, isValidKeyId, saveRazorpayKeys } from "../pay/settings";
import { adminPool, findAdminByEmail, authUidOf, userIdByPhone } from "./queries";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, signAdminSession } from "./session";

export interface LoginState {
  error?: string;
}

// Checked against when the email is unknown, so a wrong email and a wrong password take equally long.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", 12));

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password || password.length > 200) return { error: "Enter your email and password." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limiter } = getServices();
  // 8 tries per 10 minutes per address, and 30 per 10 minutes per client, whatever the email.
  const [byEmail, byIp] = await Promise.all([
    limiter.hit(`admin-login:email:${email}`, 8, 600),
    limiter.hit(`admin-login:ip:${ip}`, 30, 600),
  ]);
  if (!byEmail.allowed || !byIp.allowed) return { error: "Too many attempts. Wait a few minutes and try again." };

  const admin = await findAdminByEmail(adminPool(), email);
  const ok = await bcrypt.compare(password, admin?.passwordHash ?? getDummyHash());
  if (!admin || !ok) return { error: "Wrong email or password." };

  const token = await signAdminSession({ adminId: admin.id, email: admin.email });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: ADMIN_SESSION_SECONDS,
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin/login");
}

/** Erases one user: their rows (subscription, backup, AI counters) and their sign-in. */
export async function deleteUserAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const confirm = String(form.get("confirm") ?? "").trim();
  if (!id || confirm !== "DELETE") redirect(`/admin/users/${encodeURIComponent(id)}?error=confirm`);

  const pool = adminPool();
  const uid = await authUidOf(pool, id);
  if (!uid) redirect("/admin/users");

  const s = getServices();
  const user = await s.repos.users.findByAuthUid(uid);
  if (user) await stopChargesBeforeDeletion(s, user.id);
  await s.repos.users.deleteByAuthUid(uid);
  redirect("/admin/users?deleted=1");
}

const AUDIENCES = ["all", "students", "parents", "children", "user"] as const;

/** "Send notification" form: stores the message; phones fetch it and show it. */
export async function sendAnnouncementAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const audience = String(form.get("audience") ?? "all") as (typeof AUDIENCES)[number];
  if (!title || title.length > 80 || !body || body.length > 300 || !AUDIENCES.includes(audience)) redirect("/admin/notify?error=invalid");

  let targetUserId: string | null = null;
  if (audience === "user") {
    const phone = normalizePhone(String(form.get("phone") ?? ""));
    targetUserId = phone ? await userIdByPhone(adminPool(), phone) : null;
    if (!targetUserId) redirect("/admin/notify?error=phone");
  }
  await getServices().repos.announcements.create({ title, body, audience, targetUserId, createdBy: admin.email });
  redirect("/admin/notify?sent=1");
}

/** "Plans" form: what people are charged (a new Razorpay plan is created the first time a price is used) and shown in the app. */
export async function savePlanPricesAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const student = Number(form.get("student"));
  const parent = Number(form.get("parent"));
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 9999;
  if (!ok(student) || !ok(parent)) redirect("/admin/plans?error=invalid");
  await getServices().repos.planPrices.set({ student, parent }, admin.email);
  redirect("/admin/plans?saved=1");
}

/** "Payments" form: the Razorpay keys. Secrets are encrypted before they reach the database and are never shown again. */
export async function saveRazorpayKeysAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const keyId = String(form.get("keyId") ?? "").trim();
  const keySecret = String(form.get("keySecret") ?? "").trim();
  const webhookSecret = String(form.get("webhookSecret") ?? "").trim();
  const s = getServices();
  const hadSecret = (await s.repos.settings.get("rzp_key_secret")) !== null;
  if (!isValidKeyId(keyId) || keySecret.length > 200 || webhookSecret.length > 200 || (!keySecret && !hadSecret)) redirect("/admin/payments?error=invalid");
  await saveRazorpayKeys(s.repos.settings, s.authSecret, { keyId, keySecret, webhookSecret }, admin.email);
  redirect("/admin/payments?saved=1");
}

export async function clearRazorpayKeysAction(): Promise<void> {
  await requireAdmin();
  await clearRazorpayKeys(getServices().repos.settings);
  redirect("/admin/payments?cleared=1");
}

// ---------------------------------------------------------------------------------------------------------------
// Recommended apps (Admin > Apps)

function readAppForm(form: FormData) {
  return {
    name: String(form.get("name") ?? "").trim(),
    tagline: String(form.get("tagline") ?? "").trim(),
    url: validateAppUrl(String(form.get("url") ?? "")),
    keywordsText: String(form.get("keywords") ?? ""),
  };
}

async function readLogo(form: FormData): Promise<ValidLogo | "none" | "too_big" | "bad_type"> {
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return "none";
  const r = validateLogo(Buffer.from(await file.arrayBuffer()));
  return r;
}

export async function createAppAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const { name, tagline, url, keywordsText } = readAppForm(form);
  if (!name || name.length > 60 || !tagline || tagline.length > 160 || !url) redirect("/admin/apps?error=invalid");
  const logo = await readLogo(form);
  if (logo === "too_big" || logo === "bad_type") redirect(`/admin/apps?error=${logo}`);

  // Left empty, the AI reads the name and description and lists the exams the app is for.
  const s = getServices();
  const typed = parseKeywordInput(keywordsText);
  const keywords = typed.length ? typed : await generateKeywords(s.ai, name, tagline);
  await s.repos.recommendedApps.create({ name, tagline, url, keywords, logo: logo === "none" ? undefined : logo, createdBy: admin.email });
  redirect("/admin/apps?saved=1");
}

export async function updateAppAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get("id"));
  const { name, tagline, url, keywordsText } = readAppForm(form);
  if (!Number.isInteger(id) || !name || name.length > 60 || !tagline || tagline.length > 160 || !url) redirect("/admin/apps?error=invalid");
  const logo = await readLogo(form);
  if (logo === "too_big" || logo === "bad_type") redirect(`/admin/apps?error=${logo}`);

  const s = getServices();
  const reanalyze = form.get("intent") === "reanalyze";
  const typed = parseKeywordInput(keywordsText);
  const keywords = reanalyze || typed.length === 0 ? await generateKeywords(s.ai, name, tagline) : typed;
  await s.repos.recommendedApps.update(id, { name, tagline, url, keywords, logo: logo === "none" ? undefined : logo });
  redirect("/admin/apps?saved=1");
}

export async function toggleAppAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get("id"));
  if (Number.isInteger(id)) await getServices().repos.recommendedApps.update(id, { active: form.get("active") === "1" });
  redirect("/admin/apps");
}

export async function deleteAppAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(form.get("id"));
  if (Number.isInteger(id)) await getServices().repos.recommendedApps.remove(id);
  redirect("/admin/apps?deleted=1");
}

/** Admin > a user: hand-assign an app to this student. It is shown to them whatever they typed. */
export async function assignAppAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(form.get("userId") ?? "");
  const appId = Number(form.get("appId"));
  const s = getServices();
  if (userId && Number.isInteger(appId) && (await s.repos.recommendedApps.get(appId))) {
    await s.repos.recommendedApps.assign(userId, appId, admin.email);
  }
  redirect(`/admin/users/${encodeURIComponent(userId)}?assigned=1`);
}

export async function unassignAppAction(form: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(form.get("userId") ?? "");
  const appId = Number(form.get("appId"));
  if (userId && Number.isInteger(appId)) await getServices().repos.recommendedApps.unassign(userId, appId);
  redirect(`/admin/users/${encodeURIComponent(userId)}`);
}
