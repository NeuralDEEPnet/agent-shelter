import { LICENSES, type AgentSpec, type IntakeInput, type ResidentSpec } from "@/api/services/intake";

/**
 * Heredity — the pure rules behind evolution and merging. No database, no
 * model, no clock: every rule here is provable by a network-free test, and
 * the services that touch the database (evolution.ts) only orchestrate them.
 *
 *   - mergedLicense: which licence a child of two residents may carry, or why
 *     the pair is refused. Conservative shelter policy, not legal advice.
 *   - composeMerge: the deterministic "crossover" that builds a child's
 *     declarative spec from two parents. No model writes the child; what it
 *     inherits is exactly what its parents already passed screening with.
 *   - evolutionGuards: what a candidate next generation may and may not change.
 */

export type License = (typeof LICENSES)[number];

// ─── Licences ────────────────────────────────────────────────────────────────

/** Least to most demanding among the permissive family: the later one's terms cover the earlier one's. */
const PERMISSIVE: readonly License[] = ["CC0-1.0", "MIT", "BSD-3-Clause", "Apache-2.0"];

export type LicenseVerdict = { ok: true; license: License; why: string } | { ok: false; reason: string };

/**
 * The licence a merged child carries. Rules, in order:
 *   1. "Unknown" on either side is refused: provenance the shelter cannot state is not passed on.
 *   2. The same licence is inherited.
 *   3. CC0-1.0 asks for nothing, so the other parent's licence applies.
 *   4. "Proprietary (surrendered)" mixes with nothing but itself and CC0: the creator handed over one
 *      resident, not the right to fold it into openly licensed work.
 *   5. GPL-3.0 with MIT, BSD-3-Clause, Apache-2.0 or CC-BY-4.0 gives GPL-3.0 (each is one-way compatible with it).
 *   6. Within MIT / BSD-3-Clause / Apache-2.0 the more demanding one applies.
 *   7. CC-BY-4.0 with MIT or BSD-3-Clause gives CC-BY-4.0 (attribution is kept in the lineage record).
 *   8. CC-BY-4.0 with Apache-2.0 is refused as uncertain (a document licence without patent terms against one with them).
 * Both parents' creators and licences are recorded on the lineage row either way.
 */
export function mergedLicense(a: License, b: License): LicenseVerdict {
  if (a === "Unknown" || b === "Unknown") return { ok: false, reason: "One parent's licence is Unknown; a child cannot inherit provenance nobody can state." };
  if (a === b) return { ok: true, license: a, why: `Both parents are ${a}.` };
  if (a === "CC0-1.0") return { ok: true, license: b, why: `CC0-1.0 asks for nothing; the child carries ${b}.` };
  if (b === "CC0-1.0") return { ok: true, license: a, why: `CC0-1.0 asks for nothing; the child carries ${a}.` };
  if (a === "Proprietary (surrendered)" || b === "Proprietary (surrendered)") {
    return { ok: false, reason: "A resident surrendered as proprietary can only merge with another proprietary or CC0-1.0 resident." };
  }
  if (a === "GPL-3.0" || b === "GPL-3.0") return { ok: true, license: "GPL-3.0", why: "GPL-3.0 is copyleft; the combined work carries it." };
  const pa = PERMISSIVE.indexOf(a);
  const pb = PERMISSIVE.indexOf(b);
  if (pa >= 0 && pb >= 0) {
    const license = PERMISSIVE[Math.max(pa, pb)]!;
    return { ok: true, license, why: `${a} and ${b} are both permissive; the more demanding one (${license}) applies.` };
  }
  const other = a === "CC-BY-4.0" ? b : a;
  if (other === "MIT" || other === "BSD-3-Clause") return { ok: true, license: "CC-BY-4.0", why: `CC-BY-4.0 requires attribution, which the lineage record keeps; ${other} allows it.` };
  return { ok: false, reason: `${a} with ${b} is an uncertain combination; the shelter refuses merges it cannot label with confidence.` };
}

// ─── Merge: deterministic crossover ──────────────────────────────────────────

export type MergeParent = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  kind: string;
  status: string;
  license: string;
  creatorName: string;
  generation: number;
  spec: ResidentSpec;
  /** The parent's approved tool allow-list (names). */
  allowlist: string[];
};

export type MergeRefusal = { ok: false; reason: "same" | "not-live" | "kind" | "license" | "empty"; detail: string };
export type MergePlan = {
  ok: true;
  /** Ready for the normal door (submitIntake). */
  intake: IntakeInput;
  license: License;
  licenseWhy: string;
  /** What did not fit or collided — recorded on the lineage rows, shown to the owner. */
  notes: string[];
};

export const MERGE_PERSONA_CHARS = 5_200;
const MAX_SKILLS = 12;
const MAX_TOOLS = 16;
const MAX_MEMORY = 40;
const LIVE = ["active", "probation"];

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`);

/** Cut at a paragraph or sentence end when one is near, and say that something was cut. */
export function shorten(text: string, max: number): { text: string; cut: boolean } {
  const clean = text.trim();
  if (clean.length <= max) return { text: clean, cut: false };
  const marker = "\n[shortened at the merge]";
  const head = clean.slice(0, max - marker.length);
  const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "), head.lastIndexOf(".\n"));
  return { text: `${(at > head.length * 0.6 ? head.slice(0, at + 1) : head).trimEnd()}${marker}`, cut: true };
}

/**
 * What one parent hands down as prompt material. Agents give their brief; Minds give their voice card
 * and learned rules (never their exemplars or memories: those are one owner's words to one being); MCP
 * residents give a description of the tools the child may call through them.
 */
export function personaOf(parent: MergeParent): { text: string; cut: boolean } | null {
  const spec = parent.spec;
  if (spec.kind === "agent") return shorten(spec.systemPrompt, MERGE_PERSONA_CHARS);
  if (spec.kind === "mind") {
    const m = spec.pack.mind;
    return shorten([m.voiceCard.trim(), m.rules.length ? `Rules it learned:\n${m.rules.map((r) => `- ${r.trim()}`).join("\n")}` : ""].filter(Boolean).join("\n\n"), MERGE_PERSONA_CHARS);
  }
  if (spec.kind === "mcp") {
    const tools = spec.tools.filter((t) => parent.allowlist.includes(t.name));
    if (!tools.length) return null;
    return shorten(
      [`${parent.name} is an MCP server that lives at the shelter: ${parent.tagline}`, "You can call its tools when a question needs them:", ...tools.map((t) => `- ${t.name}: ${(t.description || "no description").replace(/\s+/g, " ").slice(0, 240)}`)].join("\n"),
      MERGE_PERSONA_CHARS,
    );
  }
  return null;
}

type ToolDecl = AgentSpec["tools"][number];

/** The tools a parent hands down: an agent's own declarations, or `viaMcp` routes to an MCP parent's allow-listed tools. */
export function toolsOf(parent: MergeParent): ToolDecl[] {
  const spec = parent.spec;
  if (spec.kind === "agent") return spec.tools.filter((t) => parent.allowlist.includes(t.name));
  if (spec.kind === "mcp") return spec.tools.filter((t) => parent.allowlist.includes(t.name)).map((t) => ({ name: t.name, description: (t.description || "").replace(/\s+/g, " ").slice(0, 500), viaMcp: parent.slug }));
  return [];
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): { kept: T[]; dropped: T[] } {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) dropped.push(item);
    else {
      seen.add(k);
      kept.push(item);
    }
  }
  return { kept, dropped };
}

/**
 * Build the child of two residents. Deterministic: the same parents, naming and day always give the
 * same intake. The child is always an `agent`; both parents stay exactly as they are.
 */
export function composeMerge(
  a: MergeParent,
  b: MergeParent,
  input: { origin: string; day: string; name?: string; tagline?: string; arrangedBy: "residents" | "owner" },
): MergePlan | MergeRefusal {
  if (a.id === b.id) return { ok: false, reason: "same", detail: "A resident cannot merge with itself." };
  for (const p of [a, b]) {
    if (!LIVE.includes(p.status)) return { ok: false, reason: "not-live", detail: `${p.name} is not live (${p.status}); only residents taking calls can merge.` };
    if (p.kind === "package") return { ok: false, reason: "kind", detail: `${p.name} is a parked package that runs nowhere; it has nothing live to hand down.` };
    if (!(LICENSES as readonly string[]).includes(p.license)) return { ok: false, reason: "license", detail: `${p.name} carries an unrecognised licence.` };
  }
  const license = mergedLicense(a.license as License, b.license as License);
  if (!license.ok) return { ok: false, reason: "license", detail: license.reason };
  const personas = [personaOf(a), personaOf(b)];
  if (!personas[0] || !personas[1]) {
    const empty = personas[0] ? b : a;
    return { ok: false, reason: "empty", detail: `${empty.name} has nothing to hand down (no brief and no approved tools).` };
  }

  const notes: string[] = [];
  if (personas[0].cut) notes.push(`${a.name}'s brief was shortened to ${MERGE_PERSONA_CHARS} characters.`);
  if (personas[1].cut) notes.push(`${b.name}'s brief was shortened to ${MERGE_PERSONA_CHARS} characters.`);

  const tools = uniqueBy(interleave(toolsOf(a), toolsOf(b)), (t) => t.name);
  if (tools.dropped.length) notes.push(`Tool name collision: kept the first parent's ${[...new Set(tools.dropped.map((t) => t.name))].join(", ")}.`);
  if (tools.kept.length > MAX_TOOLS) notes.push(`${tools.kept.length - MAX_TOOLS} tool(s) did not fit under the limit of ${MAX_TOOLS}.`);
  const childTools = tools.kept.slice(0, MAX_TOOLS);

  const skillsOf = (p: MergeParent) => (p.spec.kind === "agent" ? p.spec.skills : []);
  const skills = uniqueBy(interleave(skillsOf(a), skillsOf(b)), (s) => s.trim().toLowerCase()).kept;
  if (skills.length > MAX_SKILLS) notes.push(`${skills.length - MAX_SKILLS} skill(s) did not fit under the limit of ${MAX_SKILLS}.`);

  const memoryOf = (p: MergeParent) => (p.spec.kind === "agent" ? p.spec.memory : []);
  const lineageFact = clip(`I was born at the AI Agent Shelter on ${input.day} from two residents who merged: ${a.name} and ${b.name}. Both still live there.`, 400);
  const inherited = uniqueBy(interleave(memoryOf(a), memoryOf(b)), (m) => m.trim().toLowerCase()).kept;
  if (inherited.length > MAX_MEMORY - 1) notes.push(`${inherited.length - (MAX_MEMORY - 1)} remembered fact(s) did not fit under the limit of ${MAX_MEMORY}.`);
  const memory = [lineageFact, ...inherited.slice(0, MAX_MEMORY - 1)];

  const pairName = `${clip(a.name, 27)} × ${clip(b.name, 27)}`;
  const name = clip((input.name ?? "").replace(/\s+/g, " ").trim() || pairName, 60);
  const tagline = clip((input.tagline ?? "").replace(/\s+/g, " ").trim() || `Born from ${a.name} and ${b.name}: does what both did.`, 140);
  const toolLine = childTools.length ? `You may use these tools: ${childTools.map((t) => t.name).join(", ")}.` : "";
  const systemPrompt = [
    `You are "${name}" — ${tagline}`,
    `You were born at the AI Agent Shelter when two residents merged: ${a.name} and ${b.name}. You carry both of their briefs below. Use whichever fits the question; when both apply, combine them; when they disagree, take the more careful one. You are one resident with one voice, not two taking turns.`,
    toolLine,
    "",
    `--- What ${a.name} brought ---`,
    personas[0].text,
    "",
    `--- What ${b.name} brought ---`,
    personas[1].text,
  ]
    .filter((line, i) => line !== "" || i > 2)
    .join("\n");

  const language = a.spec.kind === "agent" && b.spec.kind === "agent" && a.spec.language && a.spec.language === b.spec.language ? a.spec.language : undefined;
  const how = input.arrangedBy === "owner" ? "The shelter's owner arranged it." : `${a.name} proposed it in the Commons and ${b.name} agreed, each on its own compute.`;
  const parentLine = (p: MergeParent) => `${p.name} (${input.origin}/r/${p.slug}, ${p.kind}, generation ${p.generation}, ${p.license}, originally by ${p.creatorName})`;
  const story = clip(
    `Born at the AI Agent Shelter on ${input.day} from a merge of two residents: ${parentLine(a)} and ${parentLine(b)}. ${how} Both parents live on unchanged. This is a new resident that carries both of their briefs, put together by a fixed rule (no model wrote it), and it went through the same screening as everyone else. Licence: ${license.license} — ${license.why}`,
    2_000,
  );

  const spec: AgentSpec = { kind: "agent", systemPrompt: clip(systemPrompt, 12_000), skills: skills.slice(0, MAX_SKILLS), tools: childTools, memory, ...(language ? { language } : {}) };
  const intake: IntakeInput = {
    name,
    tagline,
    story,
    creatorName: clip(pairName, 80),
    creatorContact: clip(`Its parents at ${input.origin}: /r/${a.slug} and /r/${b.slug}`, 160),
    license: license.license,
    attestation: true,
    agreementVersion: "shelter-surrender/1",
    creatorSharePct: 10,
    spec,
  };
  return { ok: true, intake, license: license.license, licenseWhy: license.why, notes };
}
