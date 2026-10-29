import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "../config/env";

export const ADMIN_COOKIE = "foues_admin";
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

export interface AdminSession {
  adminId: string;
  email: string;
}

function key(): Uint8Array {
  const secret = getEnv().ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set (at least 32 random characters)");
  return new TextEncoder().encode(secret);
}

/** A signed, expiring session token for the admin cookie. Holds no secrets: just who logged in. */
export async function signAdminSession(s: AdminSession): Promise<string> {
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.adminId)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_SECONDS}s`)
    .sign(key());
}

/** The session behind a cookie value, or null if it is missing, forged or expired. */
export async function verifyAdminSession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { adminId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
