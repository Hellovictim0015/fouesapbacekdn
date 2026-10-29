export const MAX_LOGO_BYTES = 150 * 1024;

export interface ValidLogo {
  type: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
}

/**
 * Accepts PNG, JPEG or WebP up to 150 KB. The type comes from the file's own first bytes, never from its name or the
 * browser's claim. SVG is refused on purpose: it can carry scripts.
 */
export function validateLogo(bytes: Buffer): ValidLogo | "too_big" | "bad_type" {
  if (bytes.length > MAX_LOGO_BYTES) return "too_big";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", bytes };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", bytes };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { type: "image/webp", bytes };
  return "bad_type";
}

/** Only https links, so a suggestion can never open something unexpected. */
export function validateAppUrl(input: string): string | null {
  if (input.length > 500) return null;
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}
