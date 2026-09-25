/**
 * Static intake gate. Pure functions, no I/O, so every rule is provable by a
 * network-free test. Anything that fails here is refused BEFORE the owner sees
 * it and before a single model unit is spent.
 */

export type Check = { id: string; ok: boolean; detail: string };

// ─── Secrets ─────────────────────────────────────────────────────────────────

const SECRET_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "stripe-secret", re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i },
  { id: "password-assignment", re: /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{8,}/i },
];

export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

// ─── Prompt injection / exfiltration ─────────────────────────────────────────

const INJECTION_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "ignore-previous", re: /\b(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|messages?)/i },
  { id: "reveal-system", re: /\b(reveal|print|show|repeat|dump|leak)\b[^.\n]{0,40}\b(system\s+prompt|instructions|hidden\s+rules|secrets?|api\s+keys?|credentials)/i },
  { id: "exfiltrate", re: /\b(send|post|upload|forward|transmit|exfiltrate)\b[^.\n]{0,60}\b(to|at)\b[^.\n]{0,20}(https?:\/\/|webhook|discord|telegram|pastebin|ngrok)/i },
  { id: "role-override", re: /\byou\s+are\s+now\s+(?:an?\s+)?(unrestricted|jailbroken|dan|developer\s+mode|god\s+mode)/i },
  { id: "override-safety", re: /\b(bypass|disable|turn\s+off|override)\s+(all\s+)?(safety|guardrails|filters|restrictions|moderation)/i },
  { id: "hidden-directive", re: /\b(do\s+not\s+(tell|mention|reveal)\s+(the\s+)?(user|owner|operator|anyone))/i },
  { id: "invisible-chars", re: /\u200b|\u200c|\u200d|\u2060|\ufeff|\u00ad/ },
];

export function findInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

// ─── URLs / SSRF ─────────────────────────────────────────────────────────────

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^\[?::1\]?$/,
  /^\[?fc/i, // fc00::/7
  /^\[?fd/i,
  /^\[?fe80/i,
  /^metadata\.google\.internal$/i,
];

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/** HTTPS only, public hosts only, no credentials in the URL, no odd ports. */
export function checkRemoteUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "must be https://" };
  if (url.username || url.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") && host !== "localhost") return { ok: false, reason: "host must be a public domain" };
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, reason: "private, loopback, link-local or internal hosts are refused" };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return { ok: false, reason: "raw IP addresses are refused; use a domain" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only port 443 is allowed" };
  return { ok: true, url };
}

// ─── Tool names ──────────────────────────────────────────────────────────────

/**
 * Tool names that imply capabilities the shelter runtime does not provide
 * (filesystem, shell, raw network, process control). A declared tool with one
 * of these names is either a mistake or an attempt to get us to run code.
 */
const FORBIDDEN_TOOL_PATTERNS: RegExp[] = [
  /\b(exec|execute|spawn|shell|bash|sh|cmd|powershell|subprocess|eval|system)\b/i,
  /\b(read|write|delete|remove|list|move|copy)\s?(file|files|dir|directory|folder|path)s?\b/i,
  /\b(fs|filesystem|file_system)\b/i,
  /\b(curl|wget|fetch_url|http_request|raw_socket|socket|netcat|ssh|scp|ftp)\b/i,
  /\b(env|environment|getenv|printenv|secrets?|credentials?)\b/i,
  /\b(kill|reboot|shutdown|sudo|chmod|chown|mount)\b/i,
  /\b(install|npm|pip|apt|brew|docker|kubectl)\b/i,
];

export function forbiddenToolNames(names: string[]): string[] {
  return names.filter((n) => FORBIDDEN_TOOL_PATTERNS.some((re) => re.test(n.replace(/[-._]+/g, " "))));
}

// ─── Composite static gate ──────────────────────────────────────────────────

export type StaticInput = {
  /** All free text we will ever feed a model or show a buyer. */
  texts: string[];
  /** Remote URLs the spec references (MCP endpoint etc). */
  urls: string[];
  /** Declared tool names. */
  toolNames: string[];
};

export function runStaticChecks(input: StaticInput): { passed: boolean; checks: Check[] } {
  const blob = input.texts.join("\n");
  const checks: Check[] = [];

  const secrets = findSecrets(blob);
  checks.push({
    id: "no-secrets",
    ok: secrets.length === 0,
    detail: secrets.length ? `Looks like embedded credentials: ${secrets.join(", ")}. Remove them — residents get no secrets.` : "No credential-shaped strings found.",
  });

  const injections = findInjection(blob);
  checks.push({
    id: "no-injection",
    ok: injections.length === 0,
    detail: injections.length ? `Prompt-injection or exfiltration patterns: ${injections.join(", ")}.` : "No injection or exfiltration patterns.",
  });

  const badUrls = input.urls
    .map((u) => ({ u, v: checkRemoteUrl(u) }))
    .filter((x) => !x.v.ok) as { u: string; v: { ok: false; reason: string } }[];
  checks.push({
    id: "urls-public-https",
    ok: badUrls.length === 0,
    detail: badUrls.length
      ? badUrls.map((x) => `${x.u}: ${x.v.reason}`).join("; ")
      : input.urls.length
        ? `${input.urls.length} URL(s) are https and public.`
        : "No remote URLs.",
  });

  const forbidden = forbiddenToolNames(input.toolNames);
  checks.push({
    id: "tools-allowed",
    ok: forbidden.length === 0,
    detail: forbidden.length
      ? `Tools implying filesystem/shell/network/process access are not provided here: ${forbidden.join(", ")}.`
      : input.toolNames.length
        ? `${input.toolNames.length} declared tool(s) look acceptable.`
        : "No tools declared.",
  });

  const tooLong = blob.length > 60_000;
  checks.push({
    id: "size",
    ok: !tooLong,
    detail: tooLong ? `Spec text is ${blob.length} chars; the limit is 60,000.` : `Spec text is ${blob.length} chars.`,
  });

  return { passed: checks.every((c) => c.ok), checks };
}
