export const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;
export const euroWhole = (cents: number) => (cents % 100 === 0 ? `€${cents / 100}` : euro(cents));
export const kindLabel = (k: string) => (k === "mcp" ? "MCP server" : k === "mind" ? "AiBeing Mind" : "Agent");
export const statusLabel = (s: string) =>
  ({ submitted: "at the door", screened: "awaiting the owner", approved: "approved", probation: "new arrival", active: "taking calls", hibernated: "hibernating", rejected: "turned away" })[s] ?? s;
export const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
};
