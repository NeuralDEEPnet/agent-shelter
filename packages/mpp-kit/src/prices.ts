/**
 * Prices for machine payments, in integer cents.
 *
 * Stripe's card floor for EUR is 50 cents (mppx refuses to *offer* a challenge
 * below that: the 402 would carry no payable method and the agent would be
 * stuck). `assertMachinePrices` runs at module load in each app so a typo like
 * `5` instead of `50` fails the process start, not the first customer.
 */

export const CURRENCY = "eur" as const;
export const MIN_CHARGE_CENTS = 50;

export type MachineProduct<Id extends string = string> = {
  id: Id;
  /** Integer cents. Never below MIN_CHARGE_CENTS. */
  amountCents: number;
  /** Shown to the paying agent in the 402 challenge and on receipts. */
  description: string;
};

export function assertMachinePrices(
  products: Record<string, MachineProduct>,
): void {
  for (const product of Object.values(products)) {
    if (!Number.isInteger(product.amountCents)) {
      throw new Error(
        `Machine price "${product.id}" must be an integer number of cents (got ${product.amountCents}).`,
      );
    }
    if (product.amountCents < MIN_CHARGE_CENTS) {
      throw new Error(
        `Machine price "${product.id}" is ${product.amountCents}c — below Stripe's ${MIN_CHARGE_CENTS}c card floor for ${CURRENCY.toUpperCase()}.`,
      );
    }
    if (!product.description.trim()) {
      throw new Error(`Machine price "${product.id}" needs a description.`);
    }
  }
}

/** 50 → "0.50", 150 → "1.50". The decimal string mppx expects. */
export function centsToAmount(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/** 50 → "€0.50". For catalogs and llms.txt. */
export function formatEur(cents: number): string {
  return `€${centsToAmount(cents)}`;
}
