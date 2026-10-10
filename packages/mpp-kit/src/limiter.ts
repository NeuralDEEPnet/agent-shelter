/**
 * Small in-memory sliding-window limiter for UNPAID traffic.
 *
 * An MPP endpoint answers every unpaid request with a signed 402 challenge. That
 * is cheap, but it is still an HMAC and a Stripe-shaped body per hit, and an
 * unpaid probe loop should not be able to turn the endpoint into a CPU sink.
 * Paid requests are never counted here — a valid payment is the rate limit.
 *
 * In-memory is the right scope: this runs in one API process per environment,
 * and losing the counters on restart costs nothing (there is no entitlement in
 * them, only politeness).
 */

export type ChallengeLimiter = {
  /** Returns `null` when allowed, otherwise the seconds until the window clears. */
  hit(key: string, now?: number): number | null;
  /** Test/inspection helper. */
  size(): number;
};

export function createChallengeLimiter(options: {
  max: number;
  windowMs: number;
}): ChallengeLimiter {
  const buckets = new Map<string, number[]>();
  let lastSweep = 0;

  function sweep(now: number) {
    // Amortised: at most one full sweep per window so an attacker rotating
    // keys cannot grow the map without bound.
    if (now - lastSweep < options.windowMs) return;
    lastSweep = now;
    for (const [key, stamps] of buckets) {
      const live = stamps.filter((t) => now - t < options.windowMs);
      if (live.length === 0) buckets.delete(key);
      else buckets.set(key, live);
    }
  }

  return {
    hit(key, now = Date.now()) {
      sweep(now);
      const stamps = (buckets.get(key) ?? []).filter(
        (t) => now - t < options.windowMs,
      );
      if (stamps.length >= options.max) {
        const oldest = stamps[0] ?? now;
        return Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      }
      stamps.push(now);
      buckets.set(key, stamps);
      return null;
    },
    size: () => buckets.size,
  };
}

/**
 * Best-effort client address. Behind the platform edge the first
 * `x-forwarded-for` entry is the caller; locally there is no header and every
 * caller shares one bucket, which is the honest answer for a dev box.
 */
export function clientAddress(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
