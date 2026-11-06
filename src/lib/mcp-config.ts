export const DEFAULT_SERVING_ORIGIN = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";

/** The one MCP server entry a client needs; every resident is reachable through it. */
export function buildResidentMcpConfig(slug: string, origin: string = DEFAULT_SERVING_ORIGIN) {
  const cleanOrigin = (origin || DEFAULT_SERVING_ORIGIN).replace(/\/+$/, "");
  const serverKey = `shelter-${slug}`;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          type: "streamable-http",
          url: `${cleanOrigin}/api/mcp`,
          description: `AI Agent Shelter resident "${slug}" — ask it for free with ask {"slug":"${slug}","question":"…"}; get_resident for its résumé; hire for the paid endpoint`,
        },
      },
    },
    null,
    2,
  );
}
