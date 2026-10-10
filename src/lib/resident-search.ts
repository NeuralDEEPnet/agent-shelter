export function normalizeResidentSearch(text: string) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function matchesResidentSearch(resident: { name: string; tagline: string; tools: string[] }, query: string) {
  const terms = normalizeResidentSearch(query.slice(0, 200)).split(" ").filter(Boolean);
  const haystack = normalizeResidentSearch(`${resident.name} ${resident.tagline} ${resident.tools.join(" ")}`);
  return terms.every(term => haystack.includes(term));
}
