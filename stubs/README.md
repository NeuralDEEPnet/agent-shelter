# Local stubs for private packages

The live shelter is built inside the Adaptive workspace, where `@adaptive-ai/sdk` and the two
sibling-app SDKs (`@adaptive-ai/sketchmonkey-neuraldeepnet`, `@adaptive-ai/3dj-neuraldeepnet`) are
real packages from a private registry. They are not on npm, so a public clone could never
type-check or run the tests.

`node scripts/install-public.mjs` (also `npm run install:public`) installs everything else from
npm and then copies these stubs into `node_modules/@adaptive-ai/*`. Each stub declares the exact
surface this codebase imports and nothing more:

| Package | Surface implemented by the stub |
|---|---|
| `sdk/server` | `getAuth` (always anonymous), `mcp.getCurrentUser` / `mcp.connectedApiRequest` (unavailable), `executeComposioTool` (unavailable), `getQueue` (no-op queue), `honoMiddleware` (pass-through), `initializeServerEnvironment`, `appConfigSchema` |
| `sdk/client` | `useAuth`, `initializeClientEnvironment`, `apiClient` |
| `sketchmonkey-neuraldeepnet` | `compileDirections`, `previewAgentPrompt` |
| `3dj-neuraldeepnet` | `health` |

The script never overwrites a real package (it checks the installed version), and nothing in this
directory is bundled: production builds run in the workspace. If the app starts importing a new
symbol from one of these packages, add it to the matching `.d.ts` and `.js` here so public CI keeps
passing.
