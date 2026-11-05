export function useAuth() { return { status: "unauthenticated", signIn() {}, signOut() {} }; }
export function initializeClientEnvironment() {}
export function apiClient() { return new Proxy({}, { get: () => async () => undefined }); }
