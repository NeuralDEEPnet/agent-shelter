/**
 * Configuration resolution for Stripe Machine Payments.
 *
 * Two independent credential pairs may be present:
 *   - live:    STRIPE_RESTRICTED_KEY  + STRIPE_PROFILE_ID          (rk_live_… / profile_…)
 *   - sandbox: STRIPE_SANDBOX_KEY     + STRIPE_SANDBOX_PROFILE_ID  (rk_test_… / profile_test_…)
 *
 * `MPP_MODE` picks between them explicitly ("live" | "sandbox"). When unset,
 * live wins if complete, else sandbox if complete, else unconfigured. Nothing
 * here ever invents a key: an incomplete pair is reported, not guessed.
 *
 * Only RESTRICTED keys are accepted. A full secret key (`sk_…`) in an app env is
 * against the standing rule for this computer (see
 * `.memory/specs/stripe-billing-rollout.md`), so it is refused with a clear
 * reason rather than silently used.
 */

export type MppEnv = {
  STRIPE_RESTRICTED_KEY?: string | undefined;
  STRIPE_PROFILE_ID?: string | undefined;
  STRIPE_SANDBOX_KEY?: string | undefined;
  STRIPE_SANDBOX_PROFILE_ID?: string | undefined;
  MPP_MODE?: string | undefined;
};

export type MppMode = "live" | "sandbox";

export type MppConfig =
  | {
      configured: true;
      mode: MppMode;
      livemode: boolean;
      /** Restricted Stripe API key. Never log it. */
      key: string;
      /** Stripe business profile id — the MPP `networkId`. */
      profileId: string;
    }
  | {
      configured: false;
      /** Human-readable, safe to show an operator. */
      reason: string;
    };

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function pairStatus(key: string, profile: string, label: string): string | null {
  if (!key && !profile) return `${label} credentials are not set.`;
  if (!key) return `${label}: profile id is set but the restricted key is missing.`;
  if (!profile) return `${label}: restricted key is set but the profile id is missing.`;
  if (key.startsWith("sk_")) {
    return `${label}: a full secret key (sk_…) was supplied. Only a restricted key (rk_…) is accepted here.`;
  }
  if (!key.startsWith("rk_")) {
    return `${label}: the key does not look like a Stripe restricted key (expected rk_…).`;
  }
  if (!profile.startsWith("profile_")) {
    return `${label}: the profile id does not look like a Stripe profile id (expected profile_…).`;
  }
  return null;
}

export function resolveMppConfig(env: MppEnv): MppConfig {
  const liveKey = clean(env.STRIPE_RESTRICTED_KEY);
  const liveProfile = clean(env.STRIPE_PROFILE_ID);
  const sandboxKey = clean(env.STRIPE_SANDBOX_KEY);
  const sandboxProfile = clean(env.STRIPE_SANDBOX_PROFILE_ID);
  const requested = clean(env.MPP_MODE).toLowerCase();

  const liveProblem = pairStatus(liveKey, liveProfile, "Live");
  const sandboxProblem = pairStatus(sandboxKey, sandboxProfile, "Sandbox");

  const live = (): MppConfig => ({
    configured: true,
    mode: "live",
    livemode: !liveKey.includes("_test_"),
    key: liveKey,
    profileId: liveProfile,
  });
  const sandbox = (): MppConfig => ({
    configured: true,
    mode: "sandbox",
    livemode: false,
    key: sandboxKey,
    profileId: sandboxProfile,
  });

  if (requested === "live") {
    return liveProblem ? { configured: false, reason: liveProblem } : live();
  }
  if (requested === "sandbox") {
    return sandboxProblem
      ? { configured: false, reason: sandboxProblem }
      : sandbox();
  }
  if (requested && requested !== "auto") {
    return {
      configured: false,
      reason: `MPP_MODE="${requested}" is not one of live | sandbox | auto.`,
    };
  }
  if (!liveProblem) return live();
  if (!sandboxProblem) return sandbox();
  return {
    configured: false,
    reason: `${liveProblem} ${sandboxProblem}`,
  };
}

/** `rk_live_51AB…` → `rk_live_…7f2a`. Safe for health payloads and logs. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "…";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}
