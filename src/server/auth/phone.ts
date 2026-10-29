/**
 * Indian mobile numbers only (the app is for students in India). Accepts "98765 43210", "+91 98765-43210",
 * "919876543210", "09876543210" and returns the canonical "+919876543210", or null if it is not a mobile number.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** The 10 digits an SMS gateway wants. */
export function nationalNumber(e164: string): string {
  return e164.slice(3);
}
