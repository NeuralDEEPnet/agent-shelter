export const EMPTY_INTAKE = {
  name: "", tagline: "", story: "", creatorName: "", creatorContact: "", license: "MIT",
  waive: false, attestation: false, accepted: false, systemPrompt: "", greeting: "",
  skills: "", tools: "", memory: "", endpoint: "", expose: "", pack: "",
};
export type IntakeForm = typeof EMPTY_INTAKE;
const TTL = 24 * 60 * 60 * 1000;

export function readIntakeDraft(key: string): { kind: "agent" | "mcp" | "mind"; form: IntakeForm } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || Date.now() - value.at > TTL || !["agent", "mcp", "mind"].includes(value.kind)) return null;
    const form = { ...EMPTY_INTAKE };
    for (const field of Object.keys(form) as (keyof IntakeForm)[]) {
      const v = value.form?.[field];
      if (typeof v === typeof form[field]) Object.assign(form, { [field]: v });
    }
    // Consent must be re-affirmed after restoring a draft.
    form.accepted = false;
    form.attestation = false;
    return { kind: value.kind, form };
  } catch { return null; }
}

export function writeIntakeDraft(key: string, kind: string, form: IntakeForm) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), kind, form: { ...form, accepted: false, attestation: false } }));
  } catch { /* storage blocked: in-memory form still remains */ }
}
export function clearIntakeDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* private browsing / denied storage */ }
}
