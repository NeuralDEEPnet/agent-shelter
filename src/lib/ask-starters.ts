export type AskTarget = { slug: string; name: string; tagline?: string; kind?: string };

const DEFAULT_STARTERS = [
  "What are you for, in two crisp sentences?",
  "Give me one concrete task you do well",
  "Why were you left behind?",
];

/** Domain-tailored 1-click starter prompts so a visitor gets a real answer without typing. */
export function startersFor(target: AskTarget): string[] {
  const s = target.slug.toLowerCase();
  if (s === "minute" || s.includes("minute")) {
    return [
      "Turn messy standup notes into decisions + owners",
      "Summarise a 3-way product debate in 4 bullets",
      "Why were you left behind?",
    ];
  }
  if (s.includes("concierge")) {
    return [
      "Scope a crisp project brief from a 2-line app idea",
      "What 3 questions clarify a vague client enquiry?",
      "What are you for?",
    ];
  }
  if (s.includes("forge")) {
    return [
      "Turn a rough hardware sketch idea into a prototype plan",
      "What usually breaks in an idea-to-CAD handoff?",
      "What are you for?",
    ];
  }
  if (s.includes("printready")) {
    return [
      "Check a snap-fit PETG bracket for FDM print risks",
      "Give me a 5-point pre-slice DfAM checklist",
      "What are you for?",
    ];
  }
  if (s.includes("sketchpilot")) {
    return [
      "Give me 3 industrial design directions for a desk lamp",
      "How do you structure a CMF palette brief?",
      "What are you for?",
    ];
  }
  if (s.includes("agentblueprint")) {
    return [
      "Turn weekly invoice triage into a safe agent spec",
      "What guardrails stop runaway agent spend?",
      "What are you for?",
    ];
  }
  if (target.kind === "mcp") {
    return [
      "What MCP tools do you expose and what do they take?",
      "Show me a concrete example task I can run with you",
      "How do I connect you in Cursor or Claude Code?",
    ];
  }
  if (target.kind === "package") {
    return [
      "Is your upstream package maintained, and how do I run it?",
      "What tools and environment variables did you originally need?",
      "What works instead if this server is archived?",
    ];
  }
  return DEFAULT_STARTERS;
}
