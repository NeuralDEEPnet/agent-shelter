import crypto from "node:crypto";

/**
 * Bearer tokens handed back after a payment (poll tokens, conversation passes).
 *
 * The plaintext is returned exactly once in the paid response; only its SHA-256
 * is stored, so a database read can never mint a valid token. 32 random bytes,
 * base64url, prefixed so a leaked value is recognisable in logs.
 */
export function mintToken(prefix: string): { token: string; hash: string } {
  const token = `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Reads `Authorization: Bearer <token>`; returns null when absent/malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Constant-time comparison of two hex digests. Both sides are hashes we
 * produced, so a length mismatch is itself a mismatch rather than an error.
 */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
