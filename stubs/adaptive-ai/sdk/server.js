// Local runtime stub for the private Adaptive SDK (tests only; never shipped).
export async function getAuth() { return { status: "unauthenticated" }; }
export const mcp = {
  async getCurrentUser() { return null; },
  async connectedApiRequest() { throw new Error("connectedApiRequest unavailable in local stub"); },
};
export async function executeComposioTool() { throw new Error("Composio unavailable in local stub"); }
export function getQueue() {
  return new Proxy({}, { get: () => () => undefined });
}
export function honoMiddleware() { return async (_c, next) => next(); }
export function initializeServerEnvironment() {}
import { z } from "zod";
export const appConfigSchema = z.object({ crons: z.array(z.any()).optional(), events: z.array(z.any()).optional(), webhooks: z.array(z.any()).optional() }).passthrough();
