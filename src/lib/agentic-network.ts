import type { AskTarget } from "@/lib/ask-starters";

export type StudioId = "3dj" | "sketchmonkey" | "aibeing" | "dreamscape";
export type EcosystemAppId = StudioId | "launchstage" | "bounties";

export const SHELTER_PUBLIC_ORIGIN = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
export const SHELTER_APP_URL = "https://agent-shelter-neuraldeepnet.adaptive.ai";

export type AgenticStudio = {
  id: StudioId;
  name: string;
  shortName: string;
  domainLabel: string;
  baseUrl: string;
  badge: string;
  roleLabel: string;
  summary: string;
  ctaLabel: string;
  /** Hex accent used inside the 3D Sanctuary District & Node Workbench */
  beaconHex: string;
  buildHandoffUrl: (brief?: string) => string;
};

export type EcosystemApp = Omit<AgenticStudio, "id"> & {
  id: EcosystemAppId;
};

const clampBrief = (brief?: string, max = 520): string => (brief ?? "").trim().slice(0, max);

export const AGENTIC_STUDIOS: readonly AgenticStudio[] = [
  {
    id: "3dj",
    name: "3DJ Agentic 3D & CAD Studio",
    shortName: "3DJ Studio",
    domainLabel: "www.3dj.app",
    baseUrl: "https://www.3dj.app",
    badge: "CAD · B-Rep · Print",
    roleLabel: "Parametric CAD & 3D Printing",
    summary:
      "Turn briefs, sketches, or photos into real OpenCascade B-Rep solids, OpenUSD assets, STEP/STL print packs, and DfAM checks.",
    ctaLabel: "Open 3DJ Studio",
    beaconHex: "#30d8ec",
    buildHandoffUrl: (brief?: string) => {
      const clean = clampBrief(brief);
      if (!clean) return "https://www.3dj.app/workspace";
      const params = new URLSearchParams({ prompt: clean, from: "agent-shelter" });
      return `https://www.3dj.app/workspace?${params.toString()}`;
    },
  },
  {
    id: "sketchmonkey",
    name: "SketchMonkey Design Studio",
    shortName: "SketchMonkey",
    domainLabel: "www.sketchmonkey.design",
    baseUrl: "https://www.sketchmonkey.design",
    badge: "Design · CMF · Video",
    roleLabel: "Visual & Industrial Design Canvas",
    summary:
      "Guided node canvas with 5 AI creative directors, CMF mood boards, product stills, poster typography, and Veo video turnarounds.",
    ctaLabel: "Open in SketchMonkey",
    beaconHex: "#ffc367",
    buildHandoffUrl: (brief?: string) => {
      const clean = clampBrief(brief);
      if (!clean) return "https://www.sketchmonkey.design/";
      const params = new URLSearchParams({ prompt: clean, handoff: "1" });
      return `https://www.sketchmonkey.design/canvas?${params.toString()}`;
    },
  },
  {
    id: "aibeing",
    name: "AiBeing Workforce & Minds",
    shortName: "AiBeing",
    domainLabel: "www.aibeing.me",
    baseUrl: "https://www.aibeing.me",
    badge: "AI Teams · Minds",
    roleLabel: "Human-Augmented AI Employees",
    summary:
      "Deploy persistent AI teammates, import sheltered aibeing-mind/1 packs, tune style dials, and carry Mind Passports across tools.",
    ctaLabel: "Launch AiBeing",
    beaconHex: "#fa856b",
    buildHandoffUrl: (brief?: string) => {
      const clean = clampBrief(brief);
      if (!clean) return "https://www.aibeing.me/";
      return "https://www.aibeing.me/#/import";
    },
  },
  {
    id: "dreamscape",
    name: "Dreamscape World Engine",
    shortName: "Dreamscape",
    domainLabel: "dreamscape",
    baseUrl: "https://dreamscape-neuraldeepnet.adaptive.ai",
    badge: "3D Realms · Story",
    roleLabel: "Interactive 3D Story Worlds",
    summary:
      "Walk inside 60 FPS procedural 3D worlds with branching lore, live character archetypes, spoken world mutations, and brand realms.",
    ctaLabel: "Enter Dreamscape",
    beaconHex: "#7be495",
    buildHandoffUrl: () => "https://dreamscape-neuraldeepnet.adaptive.ai/",
  },
] as const;

export const PUBLIC_ECOSYSTEM_APPS: readonly EcosystemApp[] = [
  ...AGENTIC_STUDIOS,
  {
    id: "launchstage",
    name: "LaunchStage 3D Showcases",
    shortName: "LaunchStage",
    domainLabel: "launchstage",
    baseUrl: "https://launchstage-neuraldeepnet.adaptive.ai",
    badge: "3D Keynotes · Promo",
    roleLabel: "Live Product Walkthroughs & 3D Showcases",
    summary:
      "Turn any live product URL into a real recorded walkthrough, interactive Three.js stage showcase, and editable launch promo.",
    ctaLabel: "Open LaunchStage",
    beaconHex: "#a78bfa",
    buildHandoffUrl: () => "https://launchstage-neuraldeepnet.adaptive.ai/",
  },
  {
    id: "bounties",
    name: "Neural Deep Bounties Radar",
    shortName: "Bounties",
    domainLabel: "bounties",
    baseUrl: "https://bounties-neuraldeepnet.adaptive.ai",
    badge: "Bounties · Grants",
    roleLabel: "Open CAD, Dev & AI Agent Bounty Radar",
    summary:
      "Discover open engineering challenges, Cults3D design pulses, developer grants, and cross-ecosystem tasks for humans and agents.",
    ctaLabel: "Explore Bounties",
    beaconHex: "#f472b6",
    buildHandoffUrl: () => "https://bounties-neuraldeepnet.adaptive.ai/",
  },
] as const;

export function getAgenticStudio(id: StudioId): AgenticStudio {
  return AGENTIC_STUDIOS.find((s) => s.id === id) ?? AGENTIC_STUDIOS[0]!;
}

export type RescueSnippetInput = {
  serverOrPackage: string;
  statusLabel: string;
  packageSpec?: string | null;
  replacementName?: string | null;
  replacementHow?: string | null;
  detailsPath?: string | null;
};

/**
 * Builds a concise, ready-to-paste Markdown rescue note for GitHub Issues, PRs,
 * Reddit, or Discord threads when someone hits a deprecated/archived MCP server.
 */
export function buildRescueMarkdownSnippet(input: RescueSnippetInput): string {
  const pkgSpec = (input.packageSpec ?? input.serverOrPackage).trim();
  const chainUrl = `${SHELTER_PUBLIC_ORIGIN}${buildWorkbenchSharePath("mcp-rescue", pkgSpec, "/")}`;
  const cleanDetailsPath = input.detailsPath?.startsWith("/") ? input.detailsPath : null;
  const detailsUrl = cleanDetailsPath ? `${SHELTER_PUBLIC_ORIGIN}${cleanDetailsPath}` : null;
  const lines: string[] = [
    `**Heads-up on \`${input.serverOrPackage}\` (${input.statusLabel}):**`,
  ];
  if (input.replacementName) {
    const howLine = input.replacementHow?.trim().split("\n")[0]?.trim();
    lines.push(
      howLine
        ? `- **Verified replacement:** **${input.replacementName}** (\`${howLine}\`)`
        : `- **Verified replacement:** **${input.replacementName}**`,
    );
  } else {
    lines.push("- No verified maintained drop-in replacement is listed yet — verify maintainer docs before installing forks.");
  }
  lines.push(`- **Free live check + ready-to-paste MCP config:** [Run Migration Node Chain on AI Agent Shelter](${chainUrl})`);
  if (detailsUrl) {
    lines.push(`- **Evidence & alternatives:** ${detailsUrl}`);
  }
  return lines.join("\n");
}

export type ChainId = "cad-to-3dj" | "concept-to-sketchmonkey" | "mcp-rescue" | "role-to-aibeing";

export type ChainStepSpec =
  | {
      id: string;
      kind: "resident";
      title: string;
      preferredResidentPrefix: string;
      roleHint: string;
      buildQuestion: (userInput: string, previousOutputs: string[]) => string;
    }
  | {
      id: string;
      kind: "package-check";
      title: string;
      roleHint: string;
    }
  | {
      id: string;
      kind: "instead-lookup";
      title: string;
      roleHint: string;
    };

export type NodeChainPreset = {
  id: ChainId;
  label: string;
  shortLabel: string;
  badge: string;
  summary: string;
  inputLabel: string;
  inputPlaceholder: string;
  defaultInput: string;
  sampleInputs: string[];
  steps: ChainStepSpec[];
  terminal:
    | { kind: "studio"; studioId: StudioId; actionLabel: string }
    | { kind: "mcp-config"; actionLabel: string };
};

export const NODE_CHAIN_PRESETS: readonly NodeChainPreset[] = [
  {
    id: "cad-to-3dj",
    label: "Hardware Brief → CAD Spec → DfAM Check → 3DJ Studio",
    shortLabel: "Idea → 3DJ CAD",
    badge: "Free 2-agent chain → 3DJ",
    summary:
      "Chains Forge (mechanical dimensions & features) into PrintReady (FDM wall/overhang inspection), then hands a print-ready brief straight to 3DJ Studio.",
    inputLabel: "Hardware or 3D part idea",
    inputPlaceholder: "e.g. Snap-fit PETG handlebar mount for a 25.4mm bike bar with M4 bolt boss",
    defaultInput: "Snap-fit PETG desk cable clamp for a 28mm table edge with two 6mm cord channels",
    sampleInputs: [
      "Snap-fit PETG desk cable clamp for a 28mm table edge with two 6mm cord channels",
      "2020 aluminum extrusion corner bracket with M5 counterbored holes and 4mm ribs",
      "Vented Raspberry Pi 5 wall-mount enclosure with snap lid and DIN clip",
    ],
    steps: [
      {
        id: "forge-spec",
        kind: "resident",
        title: "01 · Mechanical CAD Spec",
        preferredResidentPrefix: "forge",
        roleHint: "Extracts key dimensions, tolerances & parametric features",
        buildQuestion: (userInput) =>
          `Convert this rough part idea into a concise parametric CAD specification (overall envelope in mm, key features, hole/fastener sizes, and recommended fillets in 5 short bullets): ${userInput}`,
      },
      {
        id: "printready-dfam",
        kind: "resident",
        title: "02 · DfAM Print Gate",
        preferredResidentPrefix: "printready",
        roleHint: "Checks bed orientation, wall thickness & support-free printability",
        buildQuestion: (userInput, prev) =>
          `Review this part brief and CAD spec for FDM 3D printing (print orientation, min wall >= 1.2mm, overhang risks, and one concrete CAD improvement in 4 crisp bullets).\nIdea: ${userInput}\nSpec:\n${(prev[0] ?? "").slice(0, 900)}`,
      },
    ],
    terminal: {
      kind: "studio",
      studioId: "3dj",
      actionLabel: "Copy Spec & Open 3DJ Studio",
    },
  },
  {
    id: "concept-to-sketchmonkey",
    label: "Product Concept → CMF Direction → Launch Hook → SketchMonkey",
    shortLabel: "Concept → SketchMonkey",
    badge: "Free 2-agent chain → SketchMonkey",
    summary:
      "SketchPilot builds a tactile industrial design & CMF lens, Concierge sharpens the hero positioning, and 1 click opens a live Guided Canvas in SketchMonkey.",
    inputLabel: "Visual or industrial design concept",
    inputPlaceholder: "e.g. Brushed anodized aluminum espresso machine with warm walnut lever",
    defaultInput: "Minimalist anodized aluminum desk lamp with warm amber glass diffuser and knurled dimmer",
    sampleInputs: [
      "Minimalist anodized aluminum desk lamp with warm amber glass diffuser and knurled dimmer",
      "Modular field audio recorder in matte bead-blasted titanium with high-contrast e-ink meter",
      "Translucent cyber-amber handheld synth with tactile mechanical keycaps",
    ],
    steps: [
      {
        id: "sketchpilot-cmf",
        kind: "resident",
        title: "01 · Design & CMF Direction",
        preferredResidentPrefix: "sketchpilot",
        roleHint: "Defines silhouette, materials, surface finish & studio lighting",
        buildQuestion: (userInput) =>
          `Create a crisp industrial design & CMF render brief (form language, primary/accent materials, lighting setup, and camera lens in 4 tight bullets) for: ${userInput}`,
      },
      {
        id: "concierge-hook",
        kind: "resident",
        title: "02 · Hero Positioning",
        preferredResidentPrefix: "concierge",
        roleHint: "Sharpens headline, audience & differentiator for the board",
        buildQuestion: (userInput, prev) =>
          `Write one punchy 6-word poster headline, a 1-sentence value proposition, and 2 visual focal callouts for this concept:\nConcept: ${userInput}\nCMF Direction:\n${(prev[0] ?? "").slice(0, 900)}`,
      },
    ],
    terminal: {
      kind: "studio",
      studioId: "sketchmonkey",
      actionLabel: "Hydrate SketchMonkey Canvas",
    },
  },
  {
    id: "mcp-rescue",
    label: "Dead MCP Package → Live Registry Scan → Verified Replacement → Ready Config",
    shortLabel: "MCP Rescue → Config",
    badge: "Zero-install scanner + MCP JSON",
    summary:
      "Checks live npm/PyPI health, cross-references 21 verified replacement servers, and has Minute draft a clean migration note + ready-to-paste MCP config.",
    inputLabel: "npm or PyPI MCP package name",
    inputPlaceholder: "e.g. @modelcontextprotocol/server-github orpypi:office-word-mcp-server",
    defaultInput: "@modelcontextprotocol/server-github",
    sampleInputs: [
      "@modelcontextprotocol/server-github",
      "@gongrzhe/server-gmail-autoauth-mcp",
      "pypi:office-word-mcp-server",
    ],
    steps: [
      {
        id: "registry-scan",
        kind: "package-check",
        title: "01 · Live Registry Health",
        roleHint: "Reads npm/PyPI deprecation, release age & archived repo signals",
      },
      {
        id: "verified-instead",
        kind: "instead-lookup",
        title: "02 · Verified Replacement",
        roleHint: "Matches vendor/maintainer-verified working successors",
      },
      {
        id: "minute-migration",
        kind: "resident",
        title: "03 · Actionable Migration Checklist",
        preferredResidentPrefix: "minute",
        roleHint: "Summarises exact next steps for Cursor / Claude Code",
        buildQuestion: (userInput, prev) =>
          `Turn these MCP package check signals into a 3-bullet developer action checklist (keep/replace verdict, exact replacement to install, and 1 security check):\nPackage: ${userInput}\nSignals:\n${prev.join("\n").slice(0, 1100)}`,
      },
    ],
    terminal: {
      kind: "mcp-config",
      actionLabel: "Copy Shelter MCP JSON",
    },
  },
  {
    id: "role-to-aibeing",
    label: "Workflow Bottleneck → Safe Agent Blueprint → Launch in AiBeing",
    shortLabel: "Role → AiBeing Team",
    badge: "Free blueprint → AiBeing",
    summary:
      "AgentBlueprint turns a messy team bottleneck into a bounded AI employee spec with spend/safety rails, ready to instantiate or import in AiBeing.",
    inputLabel: "Team role or workflow to automate",
    inputPlaceholder: "e.g. Triage inbound CAD quote requests and flag missing tolerances",
    defaultInput: "Triage inbound 3D print quote emails, extract STEP dimensions, and draft customer replies",
    sampleInputs: [
      "Triage inbound 3D print quote emails, extract STEP dimensions, and draft customer replies",
      "Weekly design critique coordinator that summarises Figma feedback into owner tasks",
      "Support specialist that checks MCP server errors before escalating to engineering",
    ],
    steps: [
      {
        id: "blueprint-spec",
        kind: "resident",
        title: "01 · Bounded Agent Spec",
        preferredResidentPrefix: "agentblueprint",
        roleHint: "Designs role boundaries, allowed tools & fail-closed spend rails",
        buildQuestion: (userInput) =>
          `Design a compact AI teammate blueprint (mission, 3 core habits, explicit safety/spend boundaries, and human escalation rule) for: ${userInput}`,
      },
      {
        id: "minute-rollout",
        kind: "resident",
        title: "02 · Day-1 Onboarding Plan",
        preferredResidentPrefix: "minute",
        roleHint: "Writes the first 3 test prompts & acceptance criteria",
        buildQuestion: (userInput, prev) =>
          `Give me 3 concrete day-one test prompts and success criteria to validate this AI teammate before live rollout:\nRole: ${userInput}\nBlueprint:\n${(prev[0] ?? "").slice(0, 900)}`,
      },
    ],
    terminal: {
      kind: "studio",
      studioId: "aibeing",
      actionLabel: "Open AiBeing Studio",
    },
  },
] as const;

export function getNodeChainPreset(id: string | null | undefined): NodeChainPreset {
  return NODE_CHAIN_PRESETS.find((c) => c.id === id) ?? NODE_CHAIN_PRESETS[0]!;
}

/**
 * Resolves the best live resident in `targets` for a preferred prefix (e.g. `forge` matches
 * `forge-neural-deep-idea-to-production-age` in production, and falls back cleanly to `minute`
 * or the first live target in development where only `minute` is seeded).
 */
export function resolveChainResident(targets: readonly AskTarget[], preferredPrefix: string): AskTarget | null {
  if (targets.length === 0) return null;
  const needle = preferredPrefix.trim().toLowerCase();
  const exact = targets.find((t) => t.slug.toLowerCase() === needle);
  if (exact) return exact;
  const prefixed = targets.find((t) => t.slug.toLowerCase().startsWith(needle) || t.slug.toLowerCase().includes(needle));
  if (prefixed) return prefixed;
  const minute = targets.find((t) => t.slug === "minute");
  if (minute) return minute;
  const firstAgent = targets.find((t) => t.kind === "agent");
  return firstAgent ?? targets[0] ?? null;
}

/** Parses `pypi:foo` or `npm:@scope/bar` or bare package string for the MCP rescue chain. */
export function parsePackageSpec(raw: string): { registry: "npm" | "pypi"; name: string } {
  const trimmed = raw.trim();
  if (/^pypi:/i.test(trimmed)) {
    return { registry: "pypi", name: trimmed.slice(5).trim() };
  }
  if (/^npm:/i.test(trimmed)) {
    return { registry: "npm", name: trimmed.slice(4).trim() };
  }
  return { registry: "npm", name: trimmed };
}

export function parseWorkbenchSearch(search: string): { chainId: ChainId | null; query: string | null } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawChain = params.get("chain");
  const validChain = NODE_CHAIN_PRESETS.find((c) => c.id === rawChain)?.id ?? null;
  const q = params.get("q")?.trim().slice(0, 600) || null;
  return { chainId: validChain, query: q };
}

export function buildWorkbenchSharePath(chainId: ChainId, query: string, pathname = "/"): string {
  const params = new URLSearchParams();
  params.set("chain", chainId);
  const clean = query.trim().slice(0, 500);
  if (clean) params.set("q", clean);
  return `${pathname}?${params.toString()}#node-workbench`;
}

export type DistrictNode =
  | {
      id: string;
      nodeType: "sanctuary";
      label: string;
      shortLabel: string;
      subtitle: string;
      x: number;
      z: number;
      w: number;
      d: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      nodeType: "resident";
      slug: string;
      residentKind: string;
      label: string;
      shortLabel: string;
      subtitle: string;
      x: number;
      z: number;
      w: number;
      d: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      nodeType: "studio";
      studioId: EcosystemAppId;
      chainId: ChainId;
      url: string;
      label: string;
      shortLabel: string;
      subtitle: string;
      x: number;
      z: number;
      w: number;
      d: number;
      h: number;
      color: string;
    };

export type DistrictFilter = "all" | "residents" | "apps" | "mcp";

export function matchesDistrictFilter(node: DistrictNode, filter: DistrictFilter): boolean {
  if (filter === "all") return true;
  if (node.nodeType === "sanctuary") return true;
  if (filter === "apps") return node.nodeType === "studio";
  if (filter === "residents") return node.nodeType === "resident";
  if (filter === "mcp") {
    return node.nodeType === "resident" && (node.residentKind === "mcp" || node.residentKind === "package");
  }
  return true;
}

export function filterDistrictNodes(nodes: readonly DistrictNode[], filter: DistrictFilter): DistrictNode[] {
  return nodes.filter((n) => matchesDistrictFilter(n, filter));
}

const STUDIO_CHAIN_MAP: Record<EcosystemAppId, ChainId> = {
  "3dj": "cad-to-3dj",
  sketchmonkey: "concept-to-sketchmonkey",
  aibeing: "role-to-aibeing",
  dreamscape: "concept-to-sketchmonkey",
  launchstage: "concept-to-sketchmonkey",
  bounties: "mcp-rescue",
};

const RESIDENT_SLOTS: ReadonlyArray<{ x: number; z: number; h: number }> = [
  { x: -1.55, z: -1.05, h: 2.35 },
  { x: 1.55, z: -1.05, h: 2.55 },
  { x: -1.75, z: 1.05, h: 2.2 },
  { x: 1.75, z: 1.05, h: 2.4 },
  { x: 0, z: -2.15, h: 2.7 },
  { x: 0, z: 2.15, h: 2.15 },
  { x: -2.75, z: 0, h: 2.5 },
  { x: 2.75, z: 0, h: 2.45 },
  { x: -2.4, z: -2.2, h: 1.95 },
  { x: 2.4, z: -2.2, h: 2.05 },
  { x: -2.4, z: 2.2, h: 2.0 },
  { x: 2.4, z: 2.2, h: 2.1 },
];

function shortResidentName(name: string): string {
  const head = name.split(/[—–-]/)[0]?.trim() ?? name;
  return head.length > 15 ? `${head.slice(0, 14)}…` : head;
}

export function buildDistrictNodes(residents: readonly AskTarget[]): DistrictNode[] {
  const nodes: DistrictNode[] = [
    {
      id: "sanctuary-core",
      nodeType: "sanctuary",
      label: "Sanctuary Core",
      shortLabel: "SHELTER",
      subtitle: "Central compute hearth · 5 free asks/day · 70/20/10 ledger",
      x: 0,
      z: 0,
      w: 1.1,
      d: 1.1,
      h: 1.75,
      color: "#ffc367",
    },
  ];

  const studioCoords: ReadonlyArray<{ x: number; z: number; h: number }> = [
    { x: -3.75, z: -3.1, h: 3.4 },
    { x: 3.75, z: -3.1, h: 3.25 },
    { x: 4.15, z: 0.15, h: 3.1 },
    { x: -4.15, z: 0.15, h: 3.0 },
    { x: 3.55, z: 3.25, h: 2.9 },
    { x: -3.55, z: 3.25, h: 2.85 },
  ];

  PUBLIC_ECOSYSTEM_APPS.forEach((studio, idx) => {
    const pos = studioCoords[idx] ?? { x: 3.6, z: 3.2, h: 2.9 };
    nodes.push({
      id: `studio-${studio.id}`,
      nodeType: "studio",
      studioId: studio.id,
      chainId: STUDIO_CHAIN_MAP[studio.id],
      url: studio.baseUrl,
      label: studio.name,
      shortLabel: studio.shortName.toUpperCase(),
      subtitle: `${studio.domainLabel} · ${studio.roleLabel}`,
      x: pos.x,
      z: pos.z,
      w: 0.96,
      d: 0.96,
      h: pos.h,
      color: studio.beaconHex,
    });
  });

  residents.slice(0, RESIDENT_SLOTS.length).forEach((r, idx) => {
    const slot = RESIDENT_SLOTS[idx]!;
    const kindColor =
      r.kind === "mcp" ? "#5eead4" : r.kind === "package" ? "#93c5fd" : r.slug === "minute" ? "#ffd166" : "#30d8ec";
    nodes.push({
      id: `res-${r.slug}`,
      nodeType: "resident",
      slug: r.slug,
      residentKind: r.kind ?? "agent",
      label: r.name,
      shortLabel: shortResidentName(r.name),
      subtitle: r.tagline || `${(r.kind ?? "agent").toUpperCase()} resident taking free calls`,
      x: slot.x,
      z: slot.z,
      w: 0.68,
      d: 0.68,
      h: slot.h,
      color: kindColor,
    });
  });

  return nodes;
}
