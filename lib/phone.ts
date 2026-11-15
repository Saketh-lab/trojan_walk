const SALT = process.env.NEXT_PUBLIC_PHONE_SALT ?? "";

export const phoneSaltConfigured = SALT.length > 0;

/** Best-effort E.164. A bare 10-digit number is assumed US (+1). Returns null if it cannot be a phone number. */
export function toE164(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** sha256(e164 + app salt) as lowercase hex. Numbers are never sent anywhere, only this. */
export async function hashPhone(e164: string): Promise<string> {
  if (!SALT) throw new Error("NEXT_PUBLIC_PHONE_SALT is not set");
  const bytes = new TextEncoder().encode(e164 + SALT);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
