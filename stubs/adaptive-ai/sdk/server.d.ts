// Local type stub for the private Adaptive SDK (type-check only; never shipped).
import type { z } from "zod";
export type AuthResult = { status: "authenticated"; userId: string } | { status: "unauthenticated" | "loading"; userId?: undefined };
export declare function getAuth(): Promise<AuthResult>;
export declare const mcp: {
  getCurrentUser(input: Record<string, unknown>): Promise<unknown>;
  connectedApiRequest(input: { connectionToken: string; url: string; method: string; body?: unknown; headers?: Record<string, string> }): Promise<unknown>;
};
export declare function executeComposioTool<T extends object>(input: T): Promise<unknown>;
export type Job = { id: string };
export type QueueHandlers = Record<string, (payload: never, job: Job) => Promise<void>>;
export declare function getQueue<T extends Record<string, (payload: any, job: Job) => Promise<void>>>(): { [K in keyof T]: (payload: Parameters<T[K]>[0]) => void };
export declare function honoMiddleware(input: { procedures: unknown; jobs: unknown; transcoder: unknown }): any;
export declare function initializeServerEnvironment(input: Record<string, unknown>): void;
export type AppConfig = { crons?: unknown[]; events?: unknown[]; webhooks?: unknown[] };
export declare const appConfigSchema: z.ZodType<AppConfig>;
