/**
 * Render a static desk that shows the live policy. No network, no credits.
 * Writes an immutable CDN artifact under /home/computer/storage/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { APP_JOBS, JOB_KINDS, classifyJob, route } from "../src/index.ts";

const EXAMPLES = [
  "parametric project box with M3 heat-set inserts",
  "photo of a broken bracket plus two caliper readings",
  "the script does not close — refine the script",
  "triage this feedback as json_object",
  "a waymark appears in the dreamscape",
  "run the shelter probe bank judge",
  "hey, how was your day",
  "multi-file schema migration across apps",
  "think through the architecture before we code",
  "rebuild the whole platform from scratch",
];

const rows = JOB_KINDS.map((kind) => {
  const r = route(kind);
  return { ...r, chain: r.chain.join(" → ") };
});

const appRows = APP_JOBS.map((row) => {
  const r = route(row.kind);
  return { ...row, model: r.model, fallbacks: r.fallbacks.join(" → "), usd: `$${r.usdPerM.in} / $${r.usdPerM.out}` };
});

const demos = EXAMPLES.map((text) => {
  const kind = classifyJob({ text, hasImage: /photo|image/.test(text) });
  const r = route(kind);
  return { text, kind, model: r.model, role: r.role };
});

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Model router — live policy</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: #0e1114; color: #e8e4d9; line-height: 1.45;
    }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
    h1 { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 22px; font-weight: 500; letter-spacing: -0.03em; margin: 0 0 8px; }
    .lede { color: #9a9588; max-width: 62ch; margin: 0 0 28px; }
    h2 { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: #c4a574; margin: 36px 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #262b30; vertical-align: top; }
    th { color: #9a9588; font-weight: 500; }
    code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: #d7c4a0; }
    .role { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7d9b84; }
    .try { display: flex; gap: 8px; margin: 12px 0 18px; }
    input {
      flex: 1; font-size: 16px; padding: 10px 12px; border-radius: 8px;
      border: 1px solid #3a342c; background: #171b1f; color: #e8e4d9;
    }
    button {
      font-size: 14px; padding: 10px 14px; border-radius: 8px; border: 0;
      background: #c4a574; color: #1a140c; font-weight: 600; cursor: pointer;
    }
    #out { min-height: 1.4em; color: #d7c4a0; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
    .note { color: #9a9588; font-size: 13px; margin-top: 28px; }
  </style>
</head>
<body>
<main>
  <h1>Automatic model router</h1>
  <p class="lede">One policy. Apps ask for a <em>job kind</em>, not a model name. Cheap models <em>do</em> the work. Opus / Astra / Fable only <em>think</em> — new plans and really complex planning, then a cheaper model executes.</p>

  <h2>What each app does now</h2>
  <table>
    <thead><tr><th>App</th><th>Job</th><th>Primary</th><th>$/M in→out</th><th>Fallback</th></tr></thead>
    <tbody>
      ${appRows
        .map(
          (r) =>
            `<tr><td>${r.app}</td><td>${r.job}</td><td><code>${r.model}</code></td><td>${r.usd}</td><td><code>${r.fallbacks}</code></td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>

  <h2>Try a prompt</h2>
  <div class="try">
    <input id="q" type="text" placeholder="parametric lid with four M3 holes" />
    <button type="button" id="go">Route it</button>
  </div>
  <div id="out"></div>

  <h2>Examples already classified</h2>
  <table>
    <thead><tr><th>Prompt</th><th>Kind</th><th>Model</th><th></th></tr></thead>
    <tbody>
      ${demos
        .map(
          (d) =>
            `<tr><td>${escapeHtml(d.text)}</td><td><code>${d.kind}</code></td><td><code>${d.model}</code></td><td class="role">${d.role}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>

  <h2>Full policy</h2>
  <table>
    <thead><tr><th>Kind</th><th>Chain</th><th>Why</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) =>
            `<tr><td><code>${r.kind}</code></td><td><code>${r.chain}</code></td><td>${escapeHtml(r.reason)}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>

  <p class="note">This page is generated from <code>shared/model-router</code>. Adaptive chat still uses the picker: Flash for doing, Opus/Fable/Astra only when the session is a planning pass. Call <code>route(kind, { phase: "think" })</code> for a thinking execution that is not allowed to write the artifact.</p>
</main>
<script>
const CAD_RE = /\\b(cad|stl|step|brep|fillet|chamfer|parametric|replicad|opencascade|wall thickness|heat-?set|t-slot|m[2-8]\\b|print-ready|dfam)\\b/i;
const VISION_RE = /\\b(photo|photograph|image to|img2|from (a |the )?photo|caliper|broken part)\\b/i;
const REPAIR_RE = /\\b(repair|unparsable|does not close|non-?manifold|quality pass|parity (delta|failed)|refine the script)\\b/i;
const EVAL_RE = /\\b(eval|judge|probe bank|mind (train|distill)|shelter resident)\\b/i;
const STORY_RE = /\\b(dreamscape|waymark|mutateworld|portal|genie|dusk|amber world)\\b/i;
const CLASSIFY_RE = /\\b(triage|classify|json_object|sentiment|mood board|compose brief)\\b/i;
const HARD_RE = /\\b(multi-file|refactor the app|schema migration|cross-app)\\b/i;
const PLAN_MAX_RE = /\\b(from scratch|from zero|greenfield|whole platform|really complex|master prompt|plan-max)\\b/i;
const PLAN_RE = /\\b(new plan|planning|think through|think hard|architecture|strategy|spec out|design the system|plan the)\\b/i;
const POLICY = ${JSON.stringify(
  Object.fromEntries(JOB_KINDS.map((k) => [k, { model: route(k).model, role: route(k).role }])),
)};
function classify(text) {
  if (PLAN_MAX_RE.test(text)) return "plan-max";
  if (PLAN_RE.test(text)) return "plan";
  if (REPAIR_RE.test(text)) return "repair";
  if (VISION_RE.test(text) && CAD_RE.test(text)) return "cad-vision";
  if (CAD_RE.test(text)) return "cad";
  if (EVAL_RE.test(text)) return "eval";
  if (STORY_RE.test(text)) return "story";
  if (CLASSIFY_RE.test(text)) return "classify";
  if (HARD_RE.test(text)) return "hard";
  return "chat";
}
const q = document.getElementById("q");
const out = document.getElementById("out");
function go() {
  const text = q.value.trim();
  if (!text) { out.textContent = "Type something first."; return; }
  const kind = classify(text);
  const hit = POLICY[kind];
  out.textContent = kind + "  →  " + hit.model + "  (" + hit.role + ")";
}
document.getElementById("go").addEventListener("click", go);
q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
</script>
</body>
</html>
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

const dir = "/home/computer/storage/model-router";
mkdirSync(dir, { recursive: true });
const dest = `${dir}/desk-v2.html`;
writeFileSync(dest, html);
console.log(dest);
