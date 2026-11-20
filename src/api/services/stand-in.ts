/**
 * Shelter stand-ins: MCP residents whose endpoint is the shelter's own
 * `/api/foster/<server>/mcp` (src/api/foster.ts). They are partial
 * re-implementations written by the operator, not the original package code,
 * so every public surface labels them and they never count as rescues.
 */
export const STAND_IN_PATH = "/api/foster/";

export const STAND_IN_NOTE =
  "Shelter stand-in: a partial re-implementation written by the shelter's operator, not the original package code. It offers a few of the original's tools, keeps state in memory shared by every caller, and stores nothing privately.";

export function isStandIn(spec: string | { kind?: unknown; endpoint?: unknown } | null | undefined): boolean {
  if (!spec) return false;
  let parsed: { kind?: unknown; endpoint?: unknown };
  try {
    parsed = typeof spec === "string" ? (JSON.parse(spec) as typeof parsed) : spec;
  } catch {
    return false;
  }
  return parsed.kind === "mcp" && typeof parsed.endpoint === "string" && parsed.endpoint.includes(STAND_IN_PATH);
}

/** Prisma filter: not a stand-in (used by the "rescued" counts). */
export const notStandIn = { NOT: { spec: { contains: STAND_IN_PATH } } } as const;
