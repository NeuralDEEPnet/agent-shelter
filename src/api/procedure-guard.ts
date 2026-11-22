import type { MiddlewareHandler } from "hono";
import { deserialize } from "superjson";
import { isJsonRpcRequest } from "typed-rpc/server";

/**
 * Which JSON-RPC method names are procedures. Pure, so a proof can call it and
 * `server.ts` (which starts a server and queue worker when imported) does not
 * have to be loaded to test it.
 *
 * A name is a procedure only when the procedures module defines it ITSELF as a
 * function and it does not start with `_` (agent-only / in-process hooks).
 * `typeof procedures[name] === "function"` also answers true for every name
 * inherited from Object.prototype (`constructor`, `toString`, `valueOf`,
 * `hasOwnProperty`, ...) whenever the runtime's module namespace has a prototype.
 */
export function isOwnProcedure(procedures: object, method: unknown): boolean {
  return (
    typeof method === "string" &&
    !method.startsWith("_") &&
    Object.hasOwn(procedures, method) &&
    typeof (procedures as Record<string, unknown>)[method] === "function"
  );
}

export function isValidProcedureCall(procedures: object, body: unknown): boolean {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const decoded = deserialize(body as Parameters<typeof deserialize>[0]) ?? body;
    if (!isJsonRpcRequest(decoded)) return false;
    return isOwnProcedure(procedures, decoded.method);
  } catch {
    return false;
  }
}

export function createRpcGuard(procedures: object): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "POST") {
      return c.text("Not found", 404);
    }

    let raw: string;
    try {
      raw = await c.req.text();
    } catch {
      return c.text("Not found", 404);
    }

    if (raw.trim().length === 0) {
      return c.text("Not found", 404);
    }

    try {
      if (!isValidProcedureCall(procedures, JSON.parse(raw))) {
        return c.text("Not found", 404);
      }
    } catch {
      return c.text("Not found", 404);
    }

    return next();
  };
}
