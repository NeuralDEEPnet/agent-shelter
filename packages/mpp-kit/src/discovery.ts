import { centsToAmount, CURRENCY, formatEur, type MachineProduct } from "./prices.ts";

/**
 * OpenAPI discovery document annotated with the MPP extensions
 * (`x-service-info` at the root, `x-payment-info` per operation). This is what
 * `npx mppx validate <base>` reads from `<base>/openapi.json` to find paid
 * endpoints — it is advisory; the runtime 402 is authoritative.
 */

export type DiscoveryOperation = {
  method: "get" | "post";
  path: string;
  summary: string;
  description: string;
  /** Omit for free endpoints. */
  product?: MachineProduct;
  /** JSON schema for the request body (POST) — plain object, no $refs. */
  requestBody?: Record<string, unknown>;
  /** JSON schema for the 200 response body. */
  response?: Record<string, unknown>;
  /** Example request body, used by `mppx validate` to exercise the endpoint. */
  example?: Record<string, unknown>;
  bearer?: boolean;
};

export function discoveryDocument(input: {
  title: string;
  version: string;
  description: string;
  serverUrl: string;
  homepage: string;
  llmsUrl: string;
  categories: string[];
  operations: DiscoveryOperation[];
}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of input.operations) {
    const operation: Record<string, unknown> = {
      summary: op.summary,
      description: op.description,
      responses: {
        "200": {
          description: "Success",
          ...(op.response
            ? { content: { "application/json": { schema: op.response } } }
            : {}),
        },
        "400": { description: "Invalid request (application/problem+json)" },
        ...(op.product
          ? {
              "402": {
                description:
                  "Payment required. Pay the challenge in the WWW-Authenticate header and retry with the credential.",
              },
              "409": { description: "This payment was already redeemed." },
            }
          : {}),
        ...(op.bearer ? { "401": { description: "Missing or invalid bearer token." } } : {}),
        "503": {
          description:
            "Machine payments not configured, or temporarily at capacity (see body).",
        },
      },
    };
    if (op.requestBody) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: op.requestBody,
            ...(op.example ? { example: op.example } : {}),
          },
        },
      };
    }
    if (op.bearer) {
      operation.security = [{ bearer: [] }];
    }
    if (op.product) {
      operation["x-payment-info"] = {
        method: "stripe",
        intent: "charge",
        amount: centsToAmount(op.product.amountCents),
        currency: CURRENCY,
        description: `${op.product.description} — ${formatEur(op.product.amountCents)}`,
      };
    }
    paths[op.path] = { ...(paths[op.path] ?? {}), [op.method]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: input.title,
      version: input.version,
      description: input.description,
    },
    servers: [{ url: input.serverUrl }],
    "x-service-info": {
      categories: input.categories,
      docs: {
        homepage: input.homepage,
        llms: input.llmsUrl,
        apiReference: `${input.serverUrl}/openapi.json`,
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
      },
    },
    paths,
  };
}
