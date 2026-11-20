import { DEFAULT_SERVING_ORIGIN } from "@/lib/mcp-config";

/** One-click install links and commands for the shelter's single MCP URL. */
export function connectLinks(origin: string = DEFAULT_SERVING_ORIGIN) {
  const url = `${(origin || DEFAULT_SERVING_ORIGIN).replace(/\/+$/, "")}/api/mcp`;
  const name = "agent-shelter";
  const b64 = (s: string) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64"));
  return {
    url,
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${encodeURIComponent(b64(JSON.stringify({ url })))}`,
    vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url }))}`,
    claudeCode: `claude mcp add --transport http ${name} ${url}`,
    json: JSON.stringify({ mcpServers: { [name]: { type: "streamable-http", url } } }, null, 2),
  };
}
