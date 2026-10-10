/**
 * @neuraldeep/mpp-kit — Stripe Machine Payments (MPP, HTTP 402) for the apps on
 * this computer.
 *
 * What lives here is everything that is the same for every app: reading the
 * restricted-key config, building the mppx handler, running the challenge →
 * credential → PaymentIntent lifecycle, recording the receipt idempotently,
 * rate-limiting unpaid probes, the problem+json vocabulary, bearer tokens for
 * post-payment polling/passes, and the OpenAPI discovery document.
 *
 * What does NOT live here: prices (each app owns its own file next to its
 * `plans.ts`), the Prisma store (each app has its own schema), and anything
 * that decides what a payment buys.
 *
 * Source-only package: apps import the `.ts` directly. In dev `tsx` runs it;
 * in production the api bundle inlines it via `ssr.noExternal`.
 */

export { resolveMppConfig, maskKey } from "./config.ts";
export type { MppConfig, MppEnv, MppMode } from "./config.ts";

export {
  assertMachinePrices,
  centsToAmount,
  formatEur,
  CURRENCY,
  MIN_CHARGE_CENTS,
} from "./prices.ts";
export type { MachineProduct } from "./prices.ts";

export { problem, problems } from "./problem.ts";
export type { Problem } from "./problem.ts";

export { createChallengeLimiter, clientAddress } from "./limiter.ts";
export type { ChallengeLimiter } from "./limiter.ts";

export { mintToken, hashToken, bearerToken, hashesEqual } from "./tokens.ts";

export {
  createMachinePayments,
  challengeSecretFrom,
  refundPayment,
} from "./machine.ts";
export type {
  MachinePayments,
  MachinePaymentsHealth,
  MachineEvent,
  PaidOutcome,
  PaymentRecord,
  PaymentStore,
  StripeLikeClient,
  RefundClient,
  ChargeOptions,
} from "./machine.ts";

export { discoveryDocument } from "./discovery.ts";
export type { DiscoveryOperation } from "./discovery.ts";
