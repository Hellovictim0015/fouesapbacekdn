import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyAdminSession } from "@/server/admin/session";

/**
 * Keeps signed-out visitors out of /admin. Every admin page and action checks the session again itself
 * (see requireAdmin), so this is the first gate, not the only one.
 */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();
  const session = await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.redirect(new URL("/admin/login", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
