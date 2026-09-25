import crypto from "node:crypto";
import { checkRemoteUrl } from "@/api/services/security";

/**
 * Minimal MCP *client* over Streamable HTTP (JSON-RPC 2.0). We never run a
 * resident's MCP server — we connect to it as a client, list its tools, and
 * proxy allow-listed calls with hard time and size caps.
 *
 * Kept dependency-free on purpose: initialize → tools/list → tools/call is
 * three POSTs, and a fetch-based client is easier to cap and to fake in tests.
 */

export type McpTool = { name: string; description: string; inputSchema?: unknown };

export type McpFetch = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TOOLS = 64;
const PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(
    message: string,
    readonly code: "url" | "timeout" | "http" | "protocol" | "size",
  ) {
    super(message);
    this.name = "McpError";
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new McpError(`Response exceeded ${MAX_RESPONSE_BYTES} bytes.`, "size");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Streamable HTTP may answer JSON or an SSE stream; take the first JSON-RPC result. */
function parseRpcBody(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const msg = JSON.parse(data) as { result?: unknown; error?: unknown };
          if (msg.result !== undefined || msg.error !== undefined) return msg;
        } catch {
          /* keep scanning */
        }
      }
    }
    throw new McpError("SSE stream carried no JSON-RPC response.", "protocol");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new McpError("Server did not answer with JSON.", "protocol");
  }
}

export function createMcpClient(endpoint: string, options: { fetch?: McpFetch; timeoutMs?: number } = {}) {
  const verdict = checkRemoteUrl(endpoint);
  if (!verdict.ok) throw new McpError(`Refused endpoint: ${verdict.reason}`, "url");
  const url = verdict.url.toString();
  const doFetch: McpFetch = options.fetch ?? ((i, init) => fetch(i, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let sessionId: string | null = null;
  let seq = 0;

  async function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++seq;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "user-agent": "agent-shelter-intake/1.0 (+https://agent-shelter-neuraldeepnet.adaptive.ai)",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/abort|timeout/i.test(msg)) throw new McpError(`No answer within ${timeoutMs / 1000}s.`, "timeout");
      throw new McpError(`Could not connect: ${msg}`, "http");
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (!res.ok) throw new McpError(`HTTP ${res.status} from the server.`, "http");
    const text = await readCapped(res);
    const msg = parseRpcBody(text, res.headers.get("content-type") ?? "") as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (msg.error) throw new McpError(`Server error ${msg.error.code ?? ""}: ${msg.error.message ?? "unknown"}`.trim(), "protocol");
    return msg.result;
  }

  async function notify(method: string): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    }).catch(() => undefined);
  }

  return {
    async initialize(): Promise<{ serverName: string; version: string }> {
      const result = (await rpc("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "agent-shelter", version: "1.0.0" },
      })) as { serverInfo?: { name?: string; version?: string } } | undefined;
      await notify("notifications/initialized");
      return { serverName: result?.serverInfo?.name ?? "unknown", version: result?.serverInfo?.version ?? "?" };
    },
    async listTools(): Promise<McpTool[]> {
      const result = (await rpc("tools/list", {})) as { tools?: unknown } | undefined;
      const raw = Array.isArray(result?.tools) ? (result!.tools as unknown[]) : [];
      const tools: McpTool[] = [];
      for (const t of raw.slice(0, MAX_TOOLS)) {
        if (!t || typeof t !== "object") continue;
        const o = t as Record<string, unknown>;
        if (typeof o.name !== "string" || !o.name.trim()) continue;
        tools.push({
          name: o.name.trim().slice(0, 80),
          description: typeof o.description === "string" ? o.description.slice(0, 500) : "",
          inputSchema: o.inputSchema,
        });
      }
      return tools;
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
      const result = (await rpc("tools/call", { name, arguments: args })) as
        | { content?: { type?: string; text?: string }[]; isError?: boolean }
        | undefined;
      const text = (result?.content ?? [])
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n")
        .slice(0, 8_000);
      if (result?.isError) throw new McpError(text || "Tool reported an error.", "protocol");
      return text;
    },
  };
}

/** Stable fingerprint over tool names + descriptions (order-independent). */
export function fingerprintTools(tools: McpTool[]): string {
  const canon = [...tools]
    .map((t) => `${t.name}\u0000${t.description}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canon).digest("hex");
}
