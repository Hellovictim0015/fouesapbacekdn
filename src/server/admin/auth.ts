import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyAdminSession, type AdminSession } from "./session";

/** For admin pages and actions: the signed-in admin, or a redirect to the login page. */
export async function requireAdmin(): Promise<AdminSession> {
  const jar = await cookies();
  const session = await verifyAdminSession(jar.get(ADMIN_COOKIE)?.value).catch(() => null);
  if (!session) redirect("/admin/login");
  return session;
}
