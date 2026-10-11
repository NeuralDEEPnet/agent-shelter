import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { checkRemoteUrl } from "./security";

type Address = { address: string; family: number };
type Resolver = (host: string) => Promise<Address[]>;
const MAX_BYTES = 256 * 1024;

/** Conservative global-unicast policy. Special-use, mapped and transition IPs fail closed. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Normalize compressed notation before rejecting special 2001::/23 ranges.
  const parts = address.toLowerCase().split("::");
  const left = parts[0].split(":").filter(Boolean);
  const right = (parts[1] ?? "").split(":").filter(Boolean);
  const words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  const [a, b] = words.map(w => parseInt(w, 16));
  return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 &&
    !(a === 0x2001 && (b < 0x0200 || b === 0x0db8)) &&
    !(a === 0x3fff && b < 0x1000); // documentation 3fff::/20
}

/** Validate ALL DNS answers, not just the first. No network connection before this succeeds. */
export async function resolvePublicEndpoint(raw: string, resolveDns: Resolver = host => lookup(host, { all: true, verbatim: true })) {
  const verdict = checkRemoteUrl(raw);
  if (!verdict.ok) throw new Error(`Refused endpoint: ${verdict.reason}`);
  const addresses = await resolveDns(verdict.url.hostname);
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address) || isIP(a.address) !== a.family)) {
    throw new Error("Refused endpoint: DNS includes a non-public address.");
  }
  return { url: verdict.url, address: addresses[0] };
}

/** Never consult DNS again when opening the socket; TLS still authenticates the original host. */
export function pinnedLookup(address: Address): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

/** Bounded HTTPS fetch for untrusted remote MCP endpoints. No redirects or pooled sockets. */
export async function publicHttpsFetch(input: string, init: RequestInit, testDeps: { resolveDns?: Resolver; request?: typeof request } = {}): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  signal.throwIfAborted();
  // DNS resolution is covered by the same request signal/deadline as the response.
  const target = await new Promise<Awaited<ReturnType<typeof resolvePublicEndpoint>>>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    resolvePublicEndpoint(input, testDeps.resolveDns).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    const req = (testDeps.request ?? request)(target.url, {
      method: init.method ?? "GET", headers, signal,
      lookup: pinnedLookup(target.address), family: target.address.family,
      agent: false, // fresh vetted socket per request; no cross-endpoint reuse
      servername: target.url.hostname,
    }, res => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        res.destroy(); reject(new Error("Remote MCP redirects are refused.")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { res.destroy(new Error(`Response exceeded ${MAX_BYTES} bytes.`)); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("Remote MCP response ended prematurely.")));
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        try { resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: responseHeaders })); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    if (init.body != null && typeof init.body !== "string") { req.destroy(); reject(new Error("MCP body must be JSON text.")); return; }
    req.end(init.body ?? undefined);
  });
}
