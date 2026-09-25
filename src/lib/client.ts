import type { Procedures } from "@/api";
import { apiClient } from "@adaptive-ai/sdk/client";

export const client = apiClient<Procedures>();

export type inferRPCOutputType<K extends keyof Procedures> =
  Procedures[K] extends (...args: never[]) => Promise<infer R> ? R : never;
