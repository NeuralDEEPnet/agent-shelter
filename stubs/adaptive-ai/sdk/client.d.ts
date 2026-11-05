// Local type stub for the private Adaptive SDK (type-check only; never shipped).
export declare function useAuth(): { status: "authenticated" | "unauthenticated" | "loading"; signIn(): void; signOut(): void };
export declare function initializeClientEnvironment(input: Record<string, unknown>): void;
type Promisify<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R extends Promise<unknown> ? R : Promise<R> : never };
export declare function apiClient<T>(): Promisify<T>;
