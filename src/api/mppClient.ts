import {
  createMachinePayments,
  formatEur,
  resolveMppConfig,
  type MachinePayments,
  type PaymentStore,
  type RefundClient,
  type StripeLikeClient,
} from "@neuraldeep/mpp-kit";
import { db } from "@/api/db";
import { env } from "@/lib/env";

/** `https://agent-shelter-neuraldeepnet.adaptive.ai` → `…-neuraldeepnet.on.adaptive.ai` (where /api/* custom routes are reachable). */
export function servingOrigin(baseUrl: string = env.VITE_BASE_URL): string {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    if (host.includes(".on.")) return url.origin;
    const marker = ".adaptive.ai";
    if (!host.endsWith(marker)) return url.origin;
    const sub = host.slice(0, -marker.length);
    if (!sub || sub.includes(".")) return url.origin;
    url.hostname = `${sub}.on${marker}`;
    return url.origin;
  } catch {
    return baseUrl;
  }
}

/** Receipts redeem exactly once: PK = PaymentIntent id, P2002 = duplicate. */
const store: PaymentStore = {
  async record(payment) {
    try {
      await db.machinePayment.create({
        data: {
          id: payment.reference,
          product: payment.product,
          amountCents: payment.amountCents,
          currency: payment.currency,
          scope: payment.scope,
          livemode: payment.livemode,
          status: "paid",
          residentId: payment.meta.residentId ?? null,
          note: JSON.stringify(payment.meta),
        },
      });
      return "created";
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return "duplicate";
      throw error;
    }
  },
};

let instance: MachinePayments | null = null;

export function configureMachinePayments(options?: { env?: Parameters<typeof resolveMppConfig>[0]; stripeClient?: StripeLikeClient }): MachinePayments {
  const config = resolveMppConfig(options?.env ?? env);
  instance = createMachinePayments({
    config,
    realm: new URL(servingOrigin()).hostname,
    store,
    stripeClient: options?.stripeClient,
    onEvent: (event) => {
      if (event.kind === "paid") console.log(`[mpp] paid ${event.reference} ${event.product} ${formatEur(event.amountCents)} live=${event.livemode}`);
      else if (event.kind === "duplicate") console.warn(`[mpp] duplicate redemption refused ${event.reference}`);
    },
  });
  return instance;
}

export function machinePayments(): MachinePayments {
  return instance ?? configureMachinePayments();
}

export function stripeClientForRefunds(): RefundClient | null {
  return machinePayments().stripe;
}
