import { compileDirections, previewAgentPrompt } from "@adaptive-ai/sketchmonkey-neuraldeepnet";
import { health as cadHealth } from "@adaptive-ai/3dj-neuraldeepnet";
import type { PlaygroundTool } from "@/components/playground/contract";

export const PLAYGROUND_TOOLS: readonly PlaygroundTool[] = [
  { id: "shelter-brief", name: "Resident task brief", provider: "Shelter", description: "Structure your public brief with the resident's published scope. Deterministic; no model call.", enabled: true, operation: "deterministic" },
  { id: "sketch-directions", name: "Five design directions", provider: "SketchMonkey", description: "The public deterministic Creative Compiler. No projects, account history, rendering or paid generation.", enabled: true, operation: "deterministic" },
  { id: "sketch-preview", name: "Prompt preview", provider: "SketchMonkey", description: "A fixed public prompt composition preview, not an image or paid model output.", enabled: true, operation: "deterministic" },
  { id: "3dj-status", name: "3DJ discovery snapshot", provider: "3DJ", description: "Public API/database liveness and links only. CAD/SCAD, mesh, printing and paid generation remain off.", enabled: true, operation: "discovery" },
];
export const PLAYGROUND_OPS = ["talk-preview", ...PLAYGROUND_TOOLS.map(t => t.id)] as const;

export type BridgeDeps = {
  directions: typeof compileDirections;
  preview: typeof previewAgentPrompt;
  cadStatus: typeof cadHealth;
};
const defaults: BridgeDeps = { directions: compileDirections, preview: previewAgentPrompt, cadStatus: cadHealth };

/** Fixed projection only. No caller chooses a method, project/history/custom-agent ID or provider principal. */
export async function runPlaygroundBridge(input: { toolId: string; title: string; brief: string; resident: { name: string; tagline: string } }, overrides: Partial<BridgeDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  const publicScope = `${input.resident.name}: ${input.resident.tagline}`;
  if (input.toolId === "shelter-brief") return {
    sourceApp: "Shelter", kind: "brief" as const,
    body: `${input.title}\n\nOwner-assisted deterministic brief — no AI model call.\nResident public scope: ${publicScope}\n\nBrief\n${input.brief}\n\nHandoff checklist\n• Confirm the objective and intended audience.\n• Identify measured facts versus assumptions.\n• List constraints, materials and acceptance criteria.\n• Review unresolved risks before manufacturing or deployment.\n\nNo CAD, fabrication, external actions or private resident memories were used.`,
  };
  if (input.toolId === "sketch-directions") {
    const result = await deps.directions({ brief: input.brief }); // NEVER pass projectId
    if (!result.ok || result.directions.length !== 5) throw new Error("Public compiler unavailable.");
    return { sourceApp: "SketchMonkey", kind: "design" as const,
      body: `${input.title}\n\nOwner-assisted deterministic SketchMonkey Creative Compiler — no image or paid AI generation.\nResident attribution: ${publicScope}\n\n${result.directions.map(d => `${d.lensName} — ${d.title}\n${d.rationale}\nComposition: ${d.composition}\nLighting: ${d.lighting}\nMaterials: ${d.materials.join(", ")}\nPalette: ${d.palette.map(p => `${p.name} ${p.hex}`).join(", ")}\nPrompt proposal: ${d.promptProposal}`).join("\n\n")}`,
    };
  }
  if (input.toolId === "sketch-preview") {
    const result = await deps.preview({ samplePrompt: input.brief, promptPrefix: "Product concept study. ", promptSuffix: " Communicate functional clarity and measured-versus-assumed details.", styleHints: ["industrial design", "clear concept presentation"] });
    return { sourceApp: "SketchMonkey", kind: "brief" as const, body: `${input.title}\n\nOwner-assisted public prompt composition preview — not an image and no model call.\nResident attribution: ${publicScope}\n\n${result.resolved}` };
  }
  if (input.toolId === "3dj-status") {
    const result = await deps.cadStatus();
    return { sourceApp: "3DJ", kind: "guide" as const, body: `${input.title}\n\nPublic 3DJ discovery snapshot; no CAD/model/printing action was executed.\nAPI: ${result.status === "ok" ? "responsive" : "unconfirmed"}\nDatabase: ${result.db === "connected" ? "responsive" : "unconfirmed"}\n3DJ: https://www.3dj.app\nMachine discovery: https://3dj-neuraldeepnet.on.adaptive.ai/about.md\n\nRequested brief (not executed): ${input.brief}` };
  }
  throw new Error("Operation not allowlisted.");
}
