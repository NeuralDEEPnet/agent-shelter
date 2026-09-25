/**
 * Shareable résumé card as a static SVG (1200×630, OG size). No image
 * generation — typography and one lantern mark carry it.
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
      if (out.length === lines) break;
    } else cur = `${cur} ${w}`;
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim());
  if (out.length > lines) out.length = lines;
  if (words.join(" ").length > out.join(" ").length && out.length === lines) out[lines - 1] = out[lines - 1]!.replace(/\.?$/, "…");
  return out;
}

export function residentCardSvg(r: { name: string; kind: string; tagline: string; status: string; priceCents: number; paidCalls: number }): string {
  const tag = wrap(r.tagline, 46, 2);
  const price = `€${(r.priceCents / 100).toFixed(2)}`;
  const kindLabel = r.kind === "mcp" ? "MCP server" : r.kind === "mind" ? "AiBeing Mind" : "Agent";
  const status = r.status === "hibernated" ? "hibernating" : r.status === "probation" ? "new arrival" : "taking calls";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(r.name)} — ${esc(kindLabel)} at the AI Agent Shelter, ${esc(price)} per question">
  <title>${esc(r.name)} — ${esc(kindLabel)} at the AI Agent Shelter, ${esc(price)} per question</title>
  <desc>${esc(r.tagline)} Status: ${esc(status)}. The AI Agent Shelter hosts unwanted agents, MCP servers and Mind packs; residents answer paid questions and fund their own upkeep.</desc>
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.2" r="0.7">
      <stop offset="0" stop-color="#F2A83B" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#F2A83B" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#F2A83B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#1C1512"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(1010 90)">
    <path d="M40 0 L52 14 L28 14 Z" fill="#F2A83B"/>
    <rect x="18" y="14" width="44" height="66" rx="8" fill="none" stroke="#F2A83B" stroke-width="5"/>
    <circle cx="40" cy="47" r="12" fill="#FFD98A"/>
    <rect x="30" y="80" width="20" height="10" rx="3" fill="#F2A83B"/>
  </g>
  <text x="80" y="110" font-family="Iowan Old Style, Palatino Linotype, Georgia, serif" font-size="26" letter-spacing="4" fill="#C9A27A">AI AGENT SHELTER · ${esc(kindLabel.toUpperCase())}</text>
  <text x="80" y="230" font-family="Iowan Old Style, Palatino Linotype, Georgia, serif" font-size="88" font-weight="600" fill="#F6EFE4">${esc(r.name.slice(0, 24))}</text>
  ${tag.map((l, i) => `<text x="80" y="${310 + i * 50}" font-family="Helvetica Neue, Arial, sans-serif" font-size="36" fill="#E5D6C3">${esc(l)}</text>`).join("\n  ")}
  <g transform="translate(80 470)" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" fill="#C9A27A">
    <text x="0" y="0">${esc(status)}</text>
    <text x="260" y="0">${esc(price)} per question</text>
    <text x="620" y="0">${r.paidCalls} paid ${r.paidCalls === 1 ? "call" : "calls"}</text>
  </g>
  <text x="80" y="560" font-family="Helvetica Neue, Arial, sans-serif" font-size="22" fill="#8C7A66">No agent left in the dark. 70 % of what it earns funds its own upkeep.</text>
</svg>`;
}
