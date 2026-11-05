// Local stub (type-check/tests only).
export type Direction = { lensName: string; title: string; rationale: string; composition: string; lighting: string; materials: string[]; palette: { name: string; hex: string }[]; promptProposal: string };
export declare function compileDirections(input: { brief: string }): Promise<{ ok: boolean; directions: Direction[] }>;
export declare function previewAgentPrompt(input: { samplePrompt: string; promptPrefix?: string; promptSuffix?: string; styleHints?: string[] }): Promise<{ resolved: string }>;
