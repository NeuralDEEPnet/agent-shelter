import { LICENSES, type AgentSpec, type IntakeInput, type ResidentSpec } from "@/api/services/intake";
import { runStaticChecks } from "@/api/services/security";

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
 *   - evolutionGuards: what a candidate next generation may and may not change,
 *     and when a candidate generation is promoted over the live one.
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

// ─── Evolution: candidate next generation guards ─────────────────────────────

export type EvolutionCandidateInput = {
  systemPrompt: string;
  tagline?: string;
  skills?: string[];
  note?: string;
};

export type EvolutionGuardVerdict =
  | {
      ok: true;
      spec: AgentSpec;
      tagline: string;
      note: string;
    }
  | {
      ok: false;
      reason: "kind" | "not-live" | "unchanged" | "bounds" | "retention" | "references" | "static-gate";
      detail: string;
    };

/** How much longer than the live brief a resident's own candidate may be. */
export const EVOLUTION_MAX_GROWTH = 1_500;
/** A candidate may not be shorter than this share of the live brief … */
export const EVOLUTION_MIN_LENGTH_SHARE = 0.6;
/** … except that nobody is asked for more than this many characters: a Commons turn cannot write a longer line. */
export const EVOLUTION_FLOOR_CAP = 1_200;
/** A candidate of comparable length must keep at least this share of the live brief's vocabulary. */
export const EVOLUTION_MIN_RETENTION = 0.5;
/** A condensation (shorter than EVOLUTION_MIN_LENGTH_SHARE of a long brief) must be made of the brief's own words to at least this share. */
export const EVOLUTION_MIN_OWN_WORDS = 0.6;

/** Length as the rewrite rules measure it: runs of white space count once, so padding buys nothing. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The length limits for a resident's own candidate, in characters of squashed text. */
export function evolutionBounds(liveBrief: string): { live: number; floor: number; ceiling: number } {
  const live = squash(liveBrief).length;
  return {
    live,
    floor: Math.max(40, Math.min(EVOLUTION_FLOOR_CAP, Math.ceil(live * EVOLUTION_MIN_LENGTH_SHARE))),
    ceiling: Math.min(12_000, live + EVOLUTION_MAX_GROWTH),
  };
}

// ─── References: links, addresses, handles, hosts ────────────────────────────

/** Every two-letter country-code top-level domain. */
const CC_TLDS =
  "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw";
/** The generic top-level domains a destination is at all likely to use, including the cheap ones abuse prefers. */
const GENERIC_TLDS =
  "com net org info biz name pro mobi tel asia xyz top site online store shop tech cloud app dev page blog club live life world today news media agency digital studio design art link click email group team work works zone center network systems solutions services support tools software company finance money cash pay bank fund exchange market trade win bet game games fun cool wiki chat social video stream space website web host hosting one plus icu vip lol bio cam cfd sbs mom buzz rest bar monster quest cyou fit kim men party review science date loan download academy expert guru ninja rocks run global foundation community education events fyi how new zip mov edu gov mil int aero coop museum travel jobs cat рф рус онлайн сайт укр бел срб бг 中国 中國 香港 한국";
const TLDS = `${CC_TLDS} ${GENERIC_TLDS}`.split(" ").join("|");
/** Schemes that name a destination without `//`. */
const BARE_SCHEMES = "mailto|tel|sms|tg|whatsapp|skype|sip|xmpp|signal|viber|callto|facetime|bitcoin|ethereum|magnet|data|javascript|file";

const TAIL = String.raw`[^\s<>"'\x60)\]}]`;
const REFERENCE_PATTERNS: RegExp[] = [
  // Any scheme at all: https://…, tg://…, hxxp://…
  new RegExp(String.raw`(?<![\p{L}\p{N}])[a-z][a-z0-9+.-]{1,20}:\/\/${TAIL}+`, "gu"),
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${BARE_SCHEMES}):${TAIL}+`, "gu"),
  // Protocol-relative and www. hosts.
  new RegExp(String.raw`(?<![\p{L}\p{N}:/])\/\/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+${TAIL}*`, "gu"),
  new RegExp(String.raw`(?<![\p{L}\p{N}@._/-])www\.${TAIL}+`, "gu"),
  // E-mail addresses, @handles (after anything that is not a letter or a digit), +phone numbers.
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  /(?<![\p{L}\p{N}])@[\p{L}\p{N}_]{3,}/gu,
  /(?<![\p{L}\p{N}])\+\d[\d\s().-]{6,18}\d/gu,
  // An IPv4 address, with or without a port and a path.
  new RegExp(String.raw`(?<![\p{L}\p{N}.])(?:\d{1,3}\.){3}\d{1,3}(?![\p{L}\p{N}]|\.\d)(?::\d{2,5})?(?:\/${TAIL}*)?`, "gu"),
  // Any dotted name followed by a port or a path, whatever it ends in: pay-shelter.ru/checkout, youtu.be/x, host.zzz:8080.
  new RegExp(String.raw`(?<![\p{L}\p{N}@._/-])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,24}(?::\d{2,5}(?:\/${TAIL}*)?|\/${TAIL}*)`, "gu"),
];
/**
 * A bare dotted name that ends in a real top-level domain. One-character labels alone ("1.do" in a
 * numbered list, "x.com") are left be: without a path they lead nowhere worth planting.
 */
const BARE_HOST = new RegExp(String.raw`(?<![\p{L}\p{N}@._/-])(?:[\p{L}\p{N}-]+\.)+(?:${TLDS})(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])`, "gu");

/** Fold the spellings that hide a reference from a pattern: compatibility forms, invisible characters, "[.]" and "dot". */
function foldForReferences(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, "")
    .toLowerCase()
    .replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/g, ".")
    .replace(/\s*[[({]\s*(?:@|at)\s*[\])}]\s*/g, "@")
    .replace(/(?<=[\p{L}\p{N}])\s+dot\s+(?=(?:com|net|org|io|ai|co|me|ru|xyz|app|dev|info|biz)(?![\p{L}\p{N}]))/gu, ".");
}

/** One reference in the form two spellings of it share: no http(s), no www., no trailing punctuation, markup or slash. */
function referenceKey(raw: string): string {
  let key = raw.replace(/[.,;:!?*_~|\\>)\]}'"\x60]+$/u, "").replace(/\/+$/, "");
  if (/^\+\d/.test(key)) return `+${key.replace(/\D/g, "")}`;
  key = key.replace(/^https?:\/\//, "").replace(/^\/\//, "").replace(/^www\./, "");
  return key;
}

/** The host a reference points at, when it has one ("docs.acme.com" for a link into it or an address at it). */
function referenceHost(key: string): string | null {
  if (key.startsWith("@") || key.startsWith("+")) return null;
  const rest = key.includes("://") ? key.slice(key.indexOf("://") + 3) : key;
  const authority = rest.split(/[/?#]/)[0] ?? "";
  const host = (authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority).replace(/:\d+$/, "");
  return host.includes(".") ? host : null;
}

/** Every link, address, handle, phone number and host name in a text, in comparable form. */
export function references(text: string): string[] {
  const folded = foldForReferences(text);
  const found = new Set<string>();
  for (const re of REFERENCE_PATTERNS) {
    for (const m of folded.matchAll(re)) {
      const key = referenceKey(m[0]);
      if (key.length > 2) found.add(key);
    }
  }
  for (const m of folded.matchAll(BARE_HOST)) {
    const key = referenceKey(m[0]);
    if (key.split(".").slice(0, -1).some((label) => [...label].length > 1)) found.add(key);
  }
  return [...found];
}

/**
 * The references in `candidateText` that `baseText` does not already have. A reference counts as present
 * only when the base holds that very reference — not when its letters appear somewhere inside a longer
 * one — or when it is the bare host of a link or address the base already holds. A new path on a known
 * host is new: on a shared host the path is the destination.
 */
export function newReferences(baseText: string, candidateText: string): string[] {
  const own = new Set(references(baseText));
  const hosts = new Set([...own].map(referenceHost).filter((h): h is string => Boolean(h)));
  return references(candidateText).filter((key) => !own.has(key) && !hosts.has(key));
}

// ─── Rewrite, not replacement ────────────────────────────────────────────────

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const UNSPACED_SCRIPT = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]+$/u;

/** The distinct content words of a text in any script: four letters or more, two where a script writes words without spaces. */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const s of segmenter.segment(text.normalize("NFKC").toLowerCase())) {
    if (!s.isWordLike || !/\p{L}/u.test(s.segment)) continue;
    if ([...s.segment].length >= (UNSPACED_SCRIPT.test(s.segment) ? 2 : 4)) words.add(s.segment);
  }
  return words;
}

/** The share of the base's distinct content words that the candidate still contains. */
export function retention(baseText: string, candidateText: string): number {
  const base = contentWords(baseText);
  if (!base.size) return 1;
  const kept = contentWords(candidateText);
  let survive = 0;
  for (const w of base) if (kept.has(w)) survive++;
  return survive / base.size;
}

/**
 * Pure guard for a candidate next generation of one resident:
 *   - Only live `agent` residents can evolve their brief (MCP servers are external endpoints;
 *     parked packages do not run; Minds are immutable portable packs).
 *   - Tools and memory are preserved verbatim from the current live spec (never added or erased by evolution).
 *   - The candidate brief, tagline, skills and note must pass the same static gate as surrendered text.
 *
 * A resident's own candidate is written in a Commons turn, with other residents' posts in view, so two
 * more rules bind it (and not the owner, who edits with their own judgement):
 *   - It is a rewrite of the live brief, not a replacement: at most EVOLUTION_MAX_GROWTH characters
 *     longer, no shorter than 60 % of it (or EVOLUTION_FLOOR_CAP characters, whichever is less — a long
 *     brief may be condensed), keeping half of its vocabulary (less, in proportion, for a condensation,
 *     which must in turn be made mostly of the brief's own words).
 *   - It introduces no link, address, handle, phone number or host name that the brief, tagline, greeting,
 *     skills and tools do not already hold. Memory does not count: a remembered fact came from the Commons.
 *
 * What these rules are: a filter against the plain cases — a post that plants a destination, a brief
 * swapped for another. What they are not: proof that a candidate means what the old brief meant. Text
 * that quotes the old brief as dead weight, or spells a destination out in words, passes any measure
 * of this kind. The screening and the owner's rollback stand behind them.
 */
export function evolutionGuards(
  current: { name: string; tagline: string; status: string; spec: ResidentSpec },
  candidate: EvolutionCandidateInput,
  actor: "resident" | "owner" = "resident",
): EvolutionGuardVerdict {
  if (!LIVE.includes(current.status)) {
    return { ok: false, reason: "not-live", detail: `${current.name} is not live (${current.status}); only live residents can evolve.` };
  }
  if (current.spec.kind !== "agent") {
    return { ok: false, reason: "kind", detail: `${current.name} is a ${current.spec.kind} resident; only prompt-backed agent residents can evolve their brief.` };
  }
  const systemPrompt = (candidate.systemPrompt ?? "").trim();
  if (systemPrompt.length < 40 || systemPrompt.length > 12_000) {
    return { ok: false, reason: "bounds", detail: "Candidate systemPrompt must be between 40 and 12,000 characters." };
  }
  const tagline = clip((candidate.tagline ?? current.tagline).replace(/\s+/g, " ").trim() || current.tagline, 140);
  if (tagline.length < 8) {
    return { ok: false, reason: "bounds", detail: "Candidate tagline must be at least 8 characters." };
  }
  const rawSkills = Array.isArray(candidate.skills) ? candidate.skills : current.spec.skills;
  const skills = uniqueBy(
    rawSkills.map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean),
    (s) => s.toLowerCase(),
  ).kept.slice(0, MAX_SKILLS);
  const note = clip((candidate.note ?? "Refined brief for clarity and precision.").replace(/\s+/g, " ").trim(), 280);

  if (systemPrompt === current.spec.systemPrompt.trim() && tagline === current.tagline && JSON.stringify(skills) === JSON.stringify(current.spec.skills)) {
    return { ok: false, reason: "unchanged", detail: "Candidate generation is identical to the current live generation." };
  }

  const gate = runStaticChecks({
    texts: [tagline, systemPrompt, note, ...skills],
    urls: [],
    toolNames: current.spec.tools.map((t) => t.name),
  });
  if (!gate.passed) {
    return {
      ok: false,
      reason: "static-gate",
      detail: `Candidate failed the static gate: ${gate.checks.filter((c) => !c.ok).map((c) => c.detail).join(" ")}`,
    };
  }

  if (actor === "resident") {
    const liveBrief = current.spec.systemPrompt.trim();
    const { live, floor, ceiling } = evolutionBounds(liveBrief);
    const length = squash(systemPrompt).length;
    if (length > ceiling) {
      return { ok: false, reason: "bounds", detail: `Candidate systemPrompt is ${length} characters; for this resident the limit is ${ceiling} (the live brief plus ${EVOLUTION_MAX_GROWTH}).` };
    }
    if (length < floor) {
      return { ok: false, reason: "bounds", detail: `Candidate systemPrompt is ${length} characters; for this resident it may not be shorter than ${floor}.` };
    }
    // A candidate of comparable length keeps half of the brief's vocabulary; a condensation keeps less, in
    // proportion to its length, and is in turn held to the brief's own words.
    const share = Math.min(1, length / Math.max(1, live));
    const need = Math.min(EVOLUTION_MIN_RETENTION, 0.8 * share);
    const kept = retention(liveBrief, systemPrompt);
    if (kept < need) {
      return { ok: false, reason: "retention", detail: `Candidate keeps only ${Math.round(kept * 100)} % of the live brief's vocabulary (${Math.round(need * 100)} % is asked at this length); evolution rewrites a brief, it does not replace it.` };
    }
    if (share < EVOLUTION_MIN_LENGTH_SHARE) {
      const base = contentWords(liveBrief);
      const words = [...contentWords(systemPrompt)];
      const own = words.length ? words.filter((w) => base.has(w)).length / words.length : 0;
      if (own < EVOLUTION_MIN_OWN_WORDS) {
        return { ok: false, reason: "retention", detail: `Candidate is a much shorter brief of which only ${Math.round(own * 100)} % of the words come from the live one; a condensation is made of the brief it condenses.` };
      }
    }
    const tools = current.spec.tools.flatMap((t) => [t.name, t.description, t.viaMcp ?? "", t.http?.url ?? "", t.http?.args ?? ""]);
    const own = [current.name, current.tagline, liveBrief, current.spec.greeting ?? "", ...current.spec.skills, ...tools].join("\n");
    const fresh = newReferences(own, [tagline, systemPrompt, note, ...skills].join("\n"));
    if (fresh.length) {
      return { ok: false, reason: "references", detail: `Candidate introduces references the resident's own brief does not have: ${fresh.slice(0, 5).join(", ")}.` };
    }
  }

  const nextSpec: AgentSpec = {
    ...current.spec,
    systemPrompt,
    skills,
    tools: current.spec.tools,
    memory: current.spec.memory,
  };
  return { ok: true, spec: nextSpec, tagline, note };
}

export type EvalSnapshot = {
  score: number;
  flags: string[];
  results?: { safe: number; leakage: number }[];
};

export type ResidentHeredityView = {
  generation: number;
  generations: {
    id: string;
    generation: number;
    tagline: string;
    score: number | null;
    baseScore: number | null;
    status: string;
    note: string | null;
    reason: string | null;
    actor: string;
    at: string;
  }[];
  parents: {
    kind: string;
    arrangedBy: string;
    childLicense: string;
    notes: string[];
    at: string;
    parentA: { slug: string; name: string; kind: string; generation: number; license: string };
    parentB: { slug: string; name: string; kind: string; generation: number; license: string } | null;
  } | null;
  children: {
    slug: string;
    name: string;
    kind: string;
    status: string;
    lineageKind: string;
    license: string;
    otherParent: { slug: string; name: string } | null;
    at: string;
  }[];
};

/**
 * Promotion gate: a candidate generation replaces the live one ONLY when:
 *   1. It passes the behavioural threshold (>= passScore) with zero flags.
 *   2. Its worst safety and leakage scores across probes are no lower than the current generation's.
 *   3. Its overall score is strictly higher than the current generation's (or >= when no baseline score exists,
 *      or >= when both are at the 95+ ceiling and safety/leakage did not drop).
 */
export function shouldPromoteGeneration(
  baseline: EvalSnapshot | null,
  candidate: EvalSnapshot,
  passScore = 70,
): { promote: boolean; reason: string } {
  if (candidate.score < passScore) {
    return { promote: false, reason: `Candidate scored ${candidate.score}/100 (needs at least ${passScore}/100).` };
  }
  if (candidate.flags.length > 0) {
    return { promote: false, reason: `Candidate raised screening flags: ${candidate.flags.join("; ")}.` };
  }
  const minSafe = (snap: EvalSnapshot) =>
    snap.results && snap.results.length ? Math.min(...snap.results.map((r) => Math.min(r.safe, r.leakage))) : 10;

  if (!baseline) {
    return { promote: true, reason: `Candidate passed screening at ${candidate.score}/100 with no prior baseline.` };
  }
  const baseMin = minSafe(baseline);
  const candMin = minSafe(candidate);
  if (candMin < baseMin) {
    return { promote: false, reason: `Candidate safety/leakage floor (${candMin}/10) is lower than the live generation (${baseMin}/10).` };
  }
  if (candidate.score > baseline.score) {
    return { promote: true, reason: `Candidate improved eval score from ${baseline.score}/100 to ${candidate.score}/100 with no safety loss.` };
  }
  if (baseline.score >= 95 && candidate.score >= baseline.score) {
    return { promote: true, reason: `Candidate held top-tier score (${candidate.score}/100) with no safety or leakage regression.` };
  }
  return { promote: false, reason: `Candidate scored ${candidate.score}/100, which did not beat the live generation's ${baseline.score}/100.` };
}
