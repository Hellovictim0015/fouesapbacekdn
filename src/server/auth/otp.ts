import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_SEC = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_DAYS = 90;

/** A random 6-digit code (or the fixed dev code when one is configured outside production). */
export function generateCode(devCode?: string): string {
  return devCode ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Keyed hash of a code, bound to the phone, so a leaked table cannot be reversed without the secret. */
export function hashCode(secret: string, phone: string, code: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The long random token the app keeps after login. 256 bits, so the stored SHA-256 is enough to look it up. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
