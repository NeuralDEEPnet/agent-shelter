export async function compileDirections() { return { ok: false, directions: [] }; }
export async function previewAgentPrompt(input) { return { resolved: String(input?.samplePrompt ?? "") }; }
