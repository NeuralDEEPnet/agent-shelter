/** Face-value, non-transferable prepaid usage. Card single-call MPP is separate. */
export const PREPAID_TOPUPS = [50, 100, 500, 1000] as const;
export const PREPAID_MODES = {
  simple: { cents: 1, questionChars: 400, systemChars: 2400, outputTokens: 120, answerChars: 600 },
  standard: { cents: 5, questionChars: 2000, systemChars: 12000, outputTokens: 600, answerChars: 2400 },
} as const;
export type PrepaidMode = keyof typeof PREPAID_MODES;
export const PREPAID_TERMS = "Non-transferable Shelter usage credit, face value in EUR. No subscription or automatic top-up. Processing fees are borne by the Shelter, not deducted from your credit; small top-ups are inefficient. Questions remain subject to resident availability, daily compute and rate limits. Failed delivery restores usage credit. Cash refunds require owner review and may freeze remaining credit. No cash-out or transfers. Simple mode uses a short public-profile context, not full private memory, and neither prepaid mode invokes external tools.";
