/**
 * RFC 9457 problem responses used on every non-payment failure path of an MPP
 * endpoint, so an agent sees ONE error shape whether the answer came from mppx
 * (402) or from us (400/409/429/503).
 */

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  [extra: string]: unknown;
};

const BASE = "https://neuraldeep.net/problems/";

export function problem(
  status: number,
  slug: string,
  title: string,
  detail: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const body: Problem = {
    type: `${BASE}${slug}`,
    title,
    status,
    detail,
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export const problems = {
  unconfigured: (reason: string) =>
    problem(
      503,
      "machine-payments-not-configured",
      "Machine payments not configured",
      `This service is not accepting machine payments yet: ${reason}`,
      { retryable: false },
    ),
  invalid: (detail: string, extra: Record<string, unknown> = {}) =>
    problem(400, "invalid-request", "Invalid request", detail, extra),
  notFound: (detail: string) =>
    problem(404, "not-found", "Not found", detail),
  unauthorized: (detail: string) =>
    problem(401, "unauthorized", "Unauthorized", detail),
  gone: (detail: string, extra: Record<string, unknown> = {}) =>
    problem(410, "gone", "Gone", detail, extra),
  duplicate: (reference: string) =>
    problem(
      409,
      "payment-already-used",
      "Payment already used",
      `Payment ${reference} has already been redeemed. A receipt buys one delivery.`,
      { reference },
    ),
  capacity: (detail: string, retryAfterSeconds: number) =>
    problem(
      503,
      "capacity",
      "Temporarily at capacity",
      detail,
      { retryable: true, retryAfterSeconds },
      { "retry-after": String(retryAfterSeconds) },
    ),
  tooMany: (retryAfterSeconds: number) =>
    problem(
      429,
      "too-many-requests",
      "Too many requests",
      "Too many unpaid requests from this address. Pay a challenge you already hold, or slow down.",
      { retryable: true, retryAfterSeconds },
      { "retry-after": String(retryAfterSeconds) },
    ),
  methodNotAllowed: (allowed: string[]) =>
    problem(
      405,
      "method-not-allowed",
      "Method not allowed",
      `Use ${allowed.join(" or ")}.`,
      {},
      { allow: allowed.join(", ") },
    ),
  failed: (detail: string, extra: Record<string, unknown> = {}) =>
    problem(500, "delivery-failed", "Delivery failed", detail, extra),
};
