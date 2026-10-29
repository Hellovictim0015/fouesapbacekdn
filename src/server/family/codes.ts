import { createHmac, randomInt } from "node:crypto";

/** No I, L, O, 0 or 1: a code read aloud or copied by hand cannot be mistaken. 31^8 is about 8.5 x 10^11 possibilities. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_TTL_MS = 7 * 24 * 3600 * 1000;
export const UNLOCK_CODE_TTL_MS = 10 * 60 * 1000;
export const UNLOCK_MAX_ATTEMPTS = 5;
export const MAX_CHILDREN = 3;

/** The code a child types once to link their phone to the parent, shown as "XXXX-XXXX". */
export function generateLinkCode(): string {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Whatever the child typed (lower case, spaces, a dash or not) -> the canonical 8 characters, or null if it cannot be a code. */
export function normalizeLinkCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJKMNP-Z2-9]{8}$/.test(raw) ? raw : null;
}

export function hashLinkCode(secret: string, normalized: string): string {
  return createHmac("sha256", secret).update(`link:${normalized}`).digest("hex");
}

/** The 6-digit code a parent reads out to let the child uninstall the app. Valid 10 minutes, 5 tries. */
export function generateUnlockCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashUnlockCode(secret: string, childId: string, code: string): string {
  return createHmac("sha256", secret).update(`unlock:${childId}:${code}`).digest("hex");
}
