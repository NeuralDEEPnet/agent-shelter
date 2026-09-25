import { z } from "zod";

const publicSchema = z.object({
  VITE_APP_ID: z.string(),
  VITE_BASE_URL: z.url(),
  VITE_ROOT_URL: z.url(),
  VITE_REALTIME_DOMAIN: z.string(),
  VITE_BOX_ID: z.string(),
  VITE_NODE_ENV: z.enum(["development", "production"]).default("development"),
  /** Where adopted Mind packs go home: AiBeing's public origin (its `#/import` door). */
  VITE_AIBEING_URL: z.url().default("https://aibeing-neuraldeepnet.adaptive.ai"),
});

const serverSchema = z.object({
  PORT: z.string(),
  API_KEY: z.string(), // provided by system variables
  DB_FILE_NAME: z.string(),
  GUEST_SERVICES_URL: z.url(),
  QUEUE_DB_FILE_NAME: z.string(),
  ERRORS_DB_FILE_NAME: z.string(),
  /** Platform model proxy. Injected at runtime; optional so a missing value is a
   *  rendered notice ("no model reachable"), not a crash at import. */
  OPENROUTER_OPENCODE_BASE_URL: z.string().optional(),

  /** Comma-separated platform handles that are the shelter's owner(s). Owner-only
   *  admin procedures compare the caller's handle against this list. */
  SHELTER_OWNER_HANDLES: z.string().default("neuraldeepnet"),
  /** App-scoped user ids that are owners (learned after first sign-in; optional). */
  SHELTER_OWNER_USER_IDS: z.string().default(""),
  /** Off by decision: every intake waits for an owner tap. */
  SHELTER_AUTO_APPROVE: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  /** Daily ceiling on model units the whole shelter may spend (all residents). */
  SHELTER_GLOBAL_DAILY_UNITS: z.coerce.number().int().positive().default(400),
  /** Default daily stipend per approved resident, in model units. */
  SHELTER_DEFAULT_STIPEND_UNITS: z.coerce.number().int().positive().default(20),
  /** Per-resident rate limit (turns per minute). */
  SHELTER_TURNS_PER_MINUTE: z.coerce.number().int().positive().default(6),

  // Stripe (sponsorships) through the computer's Composio connection.
  STRIPE_CONNECTED_ACCOUNT_ID: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Stripe machine payments (MPP). Restricted key only — the kit refuses sk_.
  STRIPE_RESTRICTED_KEY: z.string().optional(),
  STRIPE_PROFILE_ID: z.string().optional(),
  STRIPE_SANDBOX_KEY: z.string().optional(),
  STRIPE_SANDBOX_PROFILE_ID: z.string().optional(),
  MPP_MODE: z.string().optional(),
});

const schema = serverSchema.extend(publicSchema.shape);

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore import.meta.env type issues are not correctly inferred
const metaEnv = import.meta.env;

const isServer = metaEnv?.SSR || typeof process !== "undefined";

const schemaToCheck = isServer ? schema : publicSchema;

const parsed = schemaToCheck.safeParse(isServer ? process?.env : metaEnv);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment variables");
}

const proxy = new Proxy(parsed.data, {
  get(target, prop) {
    if (isServer || String(prop).startsWith("VITE_")) {
      return target[prop as keyof typeof target];
    }

    throw new Error(
      `Attempted to access server-side environment variable "${String(prop)}" from the client-side.`,
    );
  },
});

export const env = proxy as z.infer<typeof schema>;
