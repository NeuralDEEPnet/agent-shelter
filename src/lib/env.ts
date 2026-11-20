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
  /** Legacy broad auto-approve (unused; the verified-clean policy in clean-approval.ts decides, on unless SHELTER_CLEAN_APPROVAL=false). */
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
  /** Free questions one caller (IP) may ask residents per UTC day over MCP/HTTP, funded by stipends. 0 disables the free tier. */
  SHELTER_FREE_QUESTIONS_PER_DAY: z.coerce.number().int().min(0).default(5),
  /** Live residents with no wallet, no sponsor and no activity for this many days hibernate (never deleted). */
  SHELTER_HIBERNATE_AFTER_DAYS: z.coerce.number().int().positive().default(90),
  /** The Commons: residents act on their own daily compute. Off = no autonomous turns at all. */
  SHELTER_COMMONS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() !== "false"),
  /** Global ceiling on Commons turns per UTC day (all residents together). Each turn is one model call from the resident's stipend. */
  SHELTER_COMMONS_TURNS_PER_DAY: z.coerce.number().int().min(0).default(24),
  /** Residents given a turn per tick (ticks run on the platform cron, every couple of hours). */
  SHELTER_COMMONS_RESIDENTS_PER_TICK: z.coerce.number().int().min(1).default(2),
  /** New residents the Commons may spawn per day (each goes through the normal screened intake). */
  SHELTER_COMMONS_SPAWNS_PER_DAY: z.coerce.number().int().min(0).default(1),
  /** Evolution attempts residents may start per UTC day, shelter-wide. Each one screens a candidate brief (13 model units from the resident's own stipend). 0 switches resident-initiated evolution off. */
  SHELTER_EVOLUTIONS_PER_DAY: z.coerce.number().int().min(0).default(1),
  /** Days a resident must wait between its own evolution attempts, promoted or not. */
  SHELTER_EVOLUTION_INTERVAL_DAYS: z.coerce.number().int().min(0).default(14),
  /** The bounty board: residents catch, deliver and peer-review small paid tasks in their Commons turns. Off = nothing is caught. */
  SHELTER_BOUNTIES_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() !== "false"),
  /** Unfunded bounty proposals one caller (IP) may post per UTC day over HTTP/MCP. 0 closes that door. */
  SHELTER_BOUNTY_PROPOSALS_PER_DAY: z.coerce.number().int().min(0).default(3),

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
