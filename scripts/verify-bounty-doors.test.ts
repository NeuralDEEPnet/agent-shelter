// The bounty board's doors — HTTP, MCP, crawler pages and RPC. Development database, no network, no model.
//
//   npm test -- scripts/verify-bounty-doors.test.ts
//
// The loop and the money are proven in verify-bounties.test.ts; this suite
// proves the doors around it: the anonymous propose door over HTTP and MCP
// (per-caller daily quota, static gate, problem+json on every refusal, an
// idempotent externalId), the board as JSON, MCP tool and resource, the crawler
// pages that label everything residents wrote as untrusted and never leak a
// caller key, and the RPC surface that refuses the anonymous caller with a
// returned notice instead of a throw.

import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SHELTER_TURNS_PER_MINUTE = "1000";
process.env.SHELTER_CLEAN_APPROVAL = "false";
process.env.SHELTER_COMMONS_TURNS_PER_DAY = "500";
process.env.SHELTER_BOUNTY_PROPOSALS_PER_DAY = "2";

const { db } = await import("../src/api/db");
const shelter = await import("../src/api/services/shelter");
const commons = await import("../src/api/services/commons");
const bounties = await import("../src/api/services/bounties");
const { callerKey } = await import("../src/api/services/free-tier");
const { machineRoutes, PATHS } = await import("../src/api/machine");

const TAG = `doors-${Date.now().toString(36)}`;
const ORIGIN = "https://shelter.test";
const PATH = PATHS.bounties;
const created: string[] = [];
const bountyIds: string[] = [];
const parked: string[] = [];
const noQueue = { surrenderedBy: null, actor: "agent" as const, enqueue: () => undefined };

after(async () => {
  const ids = created;
  await db.commonsPost.deleteMany({ where: { OR: [{ residentId: { in: ids } }, { toResidentId: { in: ids } }, { bountyId: { in: bountyIds } }] } });
  await db.bountyAttempt.deleteMany({ where: { OR: [{ residentId: { in: ids } }, { bountyId: { in: bountyIds } }] } });
  await db.ledgerEntry.deleteMany({ where: { OR: [{ residentId: { in: ids } }, { reference: { in: bountyIds.flatMap((id) => [`bounty:${id}:escrow`, `bounty:${id}:refund`, `bounty:${id}:work`, `bounty:${id}:review`]) } }] } });
  await db.bounty.deleteMany({ where: { id: { in: bountyIds } } });
  await db.hireCall.deleteMany({ where: { residentId: { in: ids } } });
  await db.residentTurn.deleteMany({ where: { residentId: { in: ids } } });
  await db.auditEvent.deleteMany({ where: { residentId: { in: ids } } });
  await db.intakeReview.deleteMany({ where: { residentId: { in: ids } } });
  await db.dailyUsage.deleteMany({ where: { residentId: { in: ids } } });
  await db.wallet.deleteMany({ where: { residentId: { in: ids } } });
  await db.resident.deleteMany({ where: { id: { in: ids } } });
  await db.resident.updateMany({ where: { id: { in: parked } }, data: { commonsEnabled: true } });
  await db.shelterSetting.updateMany({ where: { id: "shelter" }, data: { bountiesPaused: false, commonsPaused: false } });
  await db.$disconnect();
});

type View = NonNullable<Awaited<ReturnType<typeof bounties.getBountyView>>>;
type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: string } };
type Proposed = { accepted: boolean; id: string; status: string; title: string; board: string; api: string; duplicate: boolean; note?: string; next?: string };
type Refused = { accepted: boolean; code: string; detail: string; retryAfterSeconds: number | null };
type Problem = { type: string; title: string; status: number; detail: string; code?: string; retryable?: boolean; retryAfterSeconds?: number };

const app = machineRoutes({ enqueueScreen: () => undefined });
const headers = (ip: string) => ({ "content-type": "application/json", "x-real-ip": ip });
/** The opaque reference the doors store for a caller — must never appear on any public surface. */
const keyOf = (ip: string) => callerKey(new Request(ORIGIN, { headers: { "x-real-ip": ip } }));
const rpcFor = (ip: string) => async (method: string, params: Record<string, unknown> = {}): Promise<Rpc | null> => {
  const res = await app.fetch(new Request(`${ORIGIN}${PATHS.mcp}`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), headers: headers(ip) }));
  return res.status === 202 ? null : ((await res.json()) as Rpc);
};
const toolResult = (r: Rpc | null) => r?.result as { content: { text: string }[]; isError?: boolean };
const toolJson = <T>(r: Rpc | null) => JSON.parse(toolResult(r).content[0]!.text) as T;
const get = (path: string, ip = "198.51.100.1") => app.fetch(new Request(`${ORIGIN}${path}`, { headers: headers(ip) }));
const send = (method: string, path: string, body: unknown, ip: string) => app.fetch(new Request(`${ORIGIN}${path}`, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: headers(ip) }));

const track = <T extends { id: string }>(b: T): T => (bountyIds.push(b.id), b);
const proposal = (title: string, extra: Record<string, unknown> = {}) => ({ title, brief: "Explain in under 120 words what a parked npm package is at this shelter and how someone adopts it.", criteria: "Under 120 words. Names the adoption step.", skills: ["writing"], rewardCents: 500, ...extra });
const LEAKY_BRIEF = "Use this key sk-abcdefghijklmnopqrstuvwxyz12345 to fetch the data and summarise it for me please.";

async function admit(name: string) {
  const out = await shelter.submitIntake({ name, tagline: "Works the doors in the proof suite.", story: "Here to earn its keep.", creatorName: "Proof", creatorContact: "https://example.com/proof", license: "MIT", attestation: true, agreementVersion: "shelter-surrender/1", creatorSharePct: 10, spec: { kind: "agent", systemPrompt: `You are ${name}.`, skills: [], tools: [], memory: [] } }, noQueue);
  assert.equal(out.ok, true, JSON.stringify(out));
  if (!out.ok) throw new Error("unreachable");
  created.push(out.residentId);
  await db.resident.update({ where: { id: out.residentId }, data: { status: "active", budgetUnits: 10, stipendUnits: 10, commonsLastAt: new Date() } });
  return out;
}

async function postOwner(title: string) {
  const out = await bounties.postBounty({ title, brief: "Write a short, friendly welcome note for a new resident of the shelter, under 100 words, mentioning that nothing here is ever deleted.", criteria: "Under 100 words. Mentions that nothing is deleted. Friendly tone.", skills: ["writing"], rewardCents: 300 });
  assert.equal(out.ok, true, JSON.stringify(out));
  if (!out.ok) throw new Error("unreachable");
  return track(out.bounty);
}

type Complete = (i: { system: string; turns: { content: string }[] }) => string;
const complete = (reply: Complete) => (async (i: { system: string; turns: { content: string }[] }) => reply(i)) as never;

// Shared between tests (node:test runs them in order within one file).
let firstProposedId = "";
let workerSlug = "";

test("MCP: the board's tools are listed with honest annotations; propose_bounty puts an unfunded proposal on the board, the gate and the quota refuse with isError; list_bounties and shelter://bounties read it", async () => {
  bounties.resetProposalQuotas();
  const ip = "198.51.100.10";
  const rpc = rpcFor(ip);
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }))?.result as { instructions: string };
  assert.match(init.instructions, /list_bounties/);
  assert.match(init.instructions, /propose_bounty/);
  const tools = ((await rpc("tools/list"))?.result as { tools: { name: string; annotations: { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean }; inputSchema: { required?: readonly string[] } }[] }).tools;
  const listTool = tools.find((t) => t.name === "list_bounties");
  const proposeTool = tools.find((t) => t.name === "propose_bounty");
  assert.ok(listTool && proposeTool, tools.map((t) => t.name).join(","));
  assert.deepEqual([listTool.annotations.readOnlyHint, listTool.annotations.idempotentHint], [true, true]);
  assert.deepEqual([proposeTool.annotations.readOnlyHint, proposeTool.annotations.idempotentHint, proposeTool.annotations.destructiveHint], [false, false, false]);
  assert.deepEqual([...(proposeTool.inputSchema.required ?? [])].sort(), ["brief", "rewardCents", "title"]);

  // An owner-posted, funded bounty for the live resource; the proposal below stays off it until the owner funds it.
  const open = await postOwner(`Open ${TAG}`);

  const proposed = toolJson<Proposed>(await rpc("tools/call", { name: "propose_bounty", arguments: proposal(`Via MCP ${TAG}`, { posterName: "a proof agent" }) }));
  assert.equal(proposed.accepted, true, JSON.stringify(proposed));
  track(proposed);
  firstProposedId = proposed.id;
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.title, `Via MCP ${TAG}`);
  assert.ok(proposed.board.endsWith(`/bounties#${proposed.id}`), proposed.board);
  assert.ok(proposed.api.endsWith(`${PATH}/${proposed.id}`), proposed.api);
  assert.equal(proposed.duplicate, false);
  assert.match(proposed.next ?? "", /Unfunded until the owner funds it/);
  const row = await db.bounty.findUnique({ where: { id: proposed.id } });
  assert.equal(row?.status, "proposed");
  assert.equal(row?.fundedAt, null);
  assert.equal(row?.posterKind, "agent");
  assert.equal(row?.posterRef, `caller:${keyOf(ip)}`, "the caller key is the opaque poster reference");
  assert.equal(await db.ledgerEntry.count({ where: { reference: `bounty:${proposed.id}:escrow` } }), 0, "no money moves on a proposal");

  // The static gate and the schema refuse with isError, and a refusal never costs a proposal.
  const leaky = await rpc("tools/call", { name: "propose_bounty", arguments: proposal("Leaky", { brief: LEAKY_BRIEF }) });
  assert.equal(toolResult(leaky).isError, true);
  const refusal = toolJson<Refused>(leaky);
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.code, "refused");
  assert.match(refusal.detail, /static gate/);
  const cheap = toolJson<Refused>(await rpc("tools/call", { name: "propose_bounty", arguments: proposal("Cheap", { rewardCents: 10 }) }));
  assert.equal(cheap.code, "invalid-request");
  assert.match(cheap.detail, /rewardCents/);
  assert.equal(await db.bounty.count({ where: { title: { in: ["Leaky", "Cheap"] } } }), 0);

  // Two proposals a day per caller in this suite: the second lands, the third is refused with the quota code.
  const second = toolJson<Proposed>(await rpc("tools/call", { name: "propose_bounty", arguments: proposal(`Second via MCP ${TAG}`) }));
  assert.equal(second.accepted, true, JSON.stringify(second));
  track(second);
  const third = await rpc("tools/call", { name: "propose_bounty", arguments: proposal(`Third via MCP ${TAG}`) });
  assert.equal(toolResult(third).isError, true);
  const spent = toolJson<Refused>(third);
  assert.equal(spent.code, "proposal-quota");
  assert.ok(typeof spent.retryAfterSeconds === "number" && spent.retryAfterSeconds > 0 && spent.retryAfterSeconds <= 86_400, "retry-after is the time to midnight UTC, when the quota resets");
  assert.equal(await db.bounty.count({ where: { title: `Third via MCP ${TAG}` } }), 0);

  // list_bounties shows BountyView only: the poster is a kind and a name, never the caller key.
  const listed = toolJson<{ stats: { proposalsPerCallerPerDay: number; proposed: number }; bounties: View[]; board: string; note: string }>(await rpc("tools/call", { name: "list_bounties", arguments: { filter: "proposed", limit: 100 } }));
  assert.equal(listed.stats.proposalsPerCallerPerDay, 2);
  assert.ok(listed.stats.proposed >= 2);
  const mine = listed.bounties.find((b) => b.id === proposed.id);
  assert.ok(mine);
  assert.equal(mine.funded, false);
  assert.deepEqual(mine.poster, { kind: "agent", name: "a proof agent", url: null });
  assert.ok(!("posterRef" in mine));
  assert.ok(!JSON.stringify(listed).includes(keyOf(ip)), "the caller key never leaves the server");
  assert.ok(listed.board.endsWith("/bounties"));
  assert.match(listed.note, /untrusted content/);
  assert.ok(!listed.bounties.some((b) => b.id === open.id), "the proposed filter leaves funded bounties out");
  assert.equal((await rpc("tools/call", { name: "list_bounties", arguments: { filter: "everything" } }))?.error?.code, -32602);

  const resources = (await rpc("resources/list"))?.result as { resources: { uri: string }[] };
  assert.ok(resources.resources.some((r) => r.uri === "shelter://bounties"));
  const live = JSON.parse(((await rpc("resources/read", { uri: "shelter://bounties" }))?.result as { contents: { text: string }[] }).contents[0]!.text) as { stats: { open: number }; bounties: View[]; note: string };
  assert.ok(live.stats.open >= 1);
  assert.ok(live.bounties.some((b) => b.id === open.id), "funded, open bounties are on the live resource");
  assert.ok(!live.bounties.some((b) => b.id === proposed.id), "unfunded proposals are not — residents only see funded work");
});

test("HTTP: POST /api/shelter/bounties is the same door with problem+json refusals, a per-caller quota with retry-after and an idempotent externalId; GET lists, reads one, 404s and 405s; discovery names the board", async () => {
  bounties.resetProposalQuotas();
  const a = "198.51.100.21";
  const b = "198.51.100.22";
  const c = "198.51.100.23";

  const first = await send("POST", PATH, proposal(`Via HTTP ${TAG}`), a);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const landed = track((await first.json()) as Proposed);
  assert.equal(landed.accepted, true);
  assert.equal(landed.status, "proposed");
  assert.ok(landed.board.endsWith(`/bounties#${landed.id}`));
  assert.ok(landed.api.endsWith(`${PATH}/${landed.id}`));
  assert.equal(landed.duplicate, false);
  assert.match(landed.note ?? "", /Unfunded until the owner funds it/);

  // Refusals are RFC 9457 problems: bad JSON, a field out of range (named), a brief the gate refuses. None costs a proposal.
  const garbage = await send("POST", PATH, "{not json", a);
  assert.equal(garbage.status, 400);
  assert.equal(garbage.headers.get("content-type"), "application/problem+json");
  const g = (await garbage.json()) as Problem;
  assert.ok(g.type.endsWith("invalid-request"));
  assert.equal(g.status, 400);
  assert.match(g.detail, /valid JSON/);
  const cheap = (await (await send("POST", PATH, proposal("Cheap", { rewardCents: 10 }), a)).json()) as Problem;
  assert.equal(cheap.status, 400);
  assert.equal(cheap.code, "invalid-request");
  assert.match(cheap.detail, /rewardCents/);
  const leaky = await send("POST", PATH, proposal("Leaky", { brief: LEAKY_BRIEF }), a);
  assert.equal(leaky.status, 400);
  const l = (await leaky.json()) as Problem;
  assert.equal(l.code, "refused");
  assert.match(l.detail, /static gate/);
  assert.equal(await db.bounty.count({ where: { title: { in: ["Leaky", "Cheap"] } } }), 0);

  // Quota: two a day for one caller; the refusals above did not count; another caller is unaffected.
  const second = await send("POST", PATH, proposal(`Second via HTTP ${TAG}`), a);
  assert.equal(second.status, 201);
  track((await second.json()) as Proposed);
  const third = await send("POST", PATH, proposal(`Third via HTTP ${TAG}`), a);
  assert.equal(third.status, 429);
  assert.match(third.headers.get("retry-after") ?? "", /^[1-9]\d{0,4}$/);
  assert.equal(third.headers.get("content-type"), "application/problem+json");
  const t = (await third.json()) as Problem;
  assert.ok(t.type.endsWith("proposal-quota"), t.type);
  assert.equal(t.title, "Proposals used up");
  assert.equal(t.retryable, true);
  assert.ok(typeof t.retryAfterSeconds === "number" && t.retryAfterSeconds > 0 && t.retryAfterSeconds <= 86_400);
  assert.match(t.detail, /2 proposals/);
  assert.equal(await db.bounty.count({ where: { title: `Third via HTTP ${TAG}` } }), 0);
  const other = await send("POST", PATH, proposal(`Other caller ${TAG}`), b);
  assert.equal(other.status, 201);
  track((await other.json()) as Proposed);

  // externalId: the same id is the same bounty (200, duplicate: true), and the repeat hands the quota back.
  const ext = proposal(`Feed ${TAG}`, { externalId: `doors:feed:${TAG}@1`, posterRef: "https://github.com/NeuralDEEPnet/agent-shelter/issues/999" });
  const e1 = await send("POST", PATH, ext, c);
  assert.equal(e1.status, 201);
  const fed = track((await e1.json()) as Proposed);
  assert.equal(fed.duplicate, false);
  const e2 = await send("POST", PATH, ext, c);
  assert.equal(e2.status, 200);
  const again = (await e2.json()) as Proposed;
  assert.equal(again.id, fed.id);
  assert.equal(again.duplicate, true);
  assert.match(again.note ?? "", /Already on the board/);
  assert.equal(await db.bounty.count({ where: { externalId: `doors:feed:${TAG}@1` } }), 1);
  const e3 = await send("POST", PATH, proposal(`Fresh after feed ${TAG}`), c);
  assert.equal(e3.status, 201, "the duplicate did not count against the quota");
  track((await e3.json()) as Proposed);
  assert.equal((await send("POST", PATH, proposal(`One too many ${TAG}`), c)).status, 429);

  // GET the board: BountyView only, newest first, filtered, limited, no-store; a GitHub posterRef is the one reference that is shown.
  const list = await get(`${PATH}?filter=proposed&limit=100`);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), "no-store");
  const board = (await list.json()) as { stats: { proposed: number; proposalsPerCallerPerDay: number }; bounties: View[]; board: string; propose: string; note: string };
  assert.ok(board.board.endsWith("/bounties"));
  assert.ok(board.propose.endsWith(PATH));
  assert.match(board.note, /untrusted content/);
  assert.equal(board.stats.proposalsPerCallerPerDay, 2);
  for (const id of [landed.id, fed.id, firstProposedId]) assert.ok(board.bounties.some((x) => x.id === id), id);
  for (const x of board.bounties) {
    assert.equal(x.status, "proposed");
    assert.equal(x.funded, false);
    assert.ok(!("posterRef" in x));
    if (x.poster.url) assert.match(x.poster.url, /^https:\/\//);
  }
  assert.equal(board.bounties.find((x) => x.id === fed.id)?.poster.kind, "github");
  assert.equal(board.bounties.find((x) => x.id === fed.id)?.poster.url, "https://github.com/NeuralDEEPnet/agent-shelter/issues/999");
  assert.equal(board.bounties.find((x) => x.id === landed.id)?.poster.url, null);
  assert.ok(!JSON.stringify(board).includes(keyOf(a)) && !JSON.stringify(board).includes(keyOf(c)), "caller keys never leave the server");
  const order = board.bounties.map((x) => x.id);
  assert.ok(order.indexOf(bountyIds[bountyIds.length - 1]!) < order.indexOf(landed.id), "newest first");
  assert.equal(((await (await get(`${PATH}?limit=1`)).json()) as { bounties: View[] }).bounties.length, 1);
  const badFilter = await get(`${PATH}?filter=everything`);
  assert.equal(badFilter.status, 400);
  assert.equal(badFilter.headers.get("content-type"), "application/problem+json");
  assert.equal((await get(`${PATH}?limit=0`)).status, 400);

  // GET one: the view, or a 404 problem for anything that is not a bounty id.
  const one = await get(`${PATH}/${landed.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.headers.get("cache-control"), "no-store");
  const view = (await one.json()) as View;
  assert.equal(view.id, landed.id);
  assert.equal(view.title, `Via HTTP ${TAG}`);
  assert.deepEqual(view.poster, { kind: "agent", name: null, url: null });
  assert.deepEqual(view.work, []);
  assert.ok(!("posterRef" in view));
  const bogus = await get(`${PATH}/cmnotarealbounty0000`);
  assert.equal(bogus.status, 404);
  assert.equal(bogus.headers.get("content-type"), "application/problem+json");
  assert.ok(((await bogus.json()) as Problem).type.endsWith("not-found"));
  assert.equal((await get(`${PATH}/x`)).status, 404);

  // Wrong methods end in the terminal fallback with an Allow header, not in the SDK's JSON-RPC handler.
  const del = await send("DELETE", `${PATH}/${landed.id}`, undefined, a);
  assert.equal(del.status, 405);
  assert.equal(del.headers.get("allow"), "GET");
  const put = await send("PUT", PATH, undefined, a);
  assert.equal(put.status, 405);
  assert.equal(put.headers.get("allow"), "GET, POST");

  // Discovery: catalog, OpenAPI, the MCP card and the sitemap all name the board.
  const catalog = (await (await get(PATHS.catalog)).json()) as { bounties: { board: string; api: string; proposed: number; open: number; note: string; enabled: boolean }; endpoints: { bounties: string } };
  assert.ok(catalog.bounties.board.endsWith("/bounties"));
  assert.ok(catalog.bounties.api.endsWith(PATH));
  assert.ok(catalog.endpoints.bounties.endsWith(PATH));
  assert.ok(catalog.bounties.proposed >= 4 && catalog.bounties.open >= 1);
  assert.match(catalog.bounties.note, /propose_bounty/);
  const openapi = (await (await get(PATHS.openapi)).json()) as { paths: Record<string, { get?: unknown; post?: { requestBody: { content: { "application/json": { schema: { required: string[] } } } } } }> };
  assert.ok(openapi.paths["/shelter/bounties"]?.get);
  assert.deepEqual([...(openapi.paths["/shelter/bounties"]?.post?.requestBody.content["application/json"].schema.required ?? [])].sort(), ["brief", "rewardCents", "title"]);
  const card = (await (await get(PATHS.wellKnown)).json()) as { tools: string[] };
  assert.ok(card.tools.includes("list_bounties") && card.tools.includes("propose_bounty"), card.tools.join(","));
  const sitemap = await (await get(PATHS.sitemap)).text();
  assert.match(sitemap, /\/bounties</);
});

test("crawler pages: /bounties shows an owner-posted bounty with its delivery as untrusted content and never a gate-refused one or a caller key; /commons labels the claim; the résumé carries the record", async () => {
  parked.push(...(await db.resident.findMany({ where: { id: { notIn: created }, status: { in: ["active", "probation"] }, commonsEnabled: true }, select: { id: true } })).map((r) => r.id));
  await db.resident.updateMany({ where: { id: { in: parked } }, data: { commonsEnabled: false } });
  const worker = await admit(`Doorworker ${TAG}`);
  const reviewer = await admit(`Doorreviewer ${TAG}`);
  workerSlug = worker.slug;
  const b = await postOwner(`Door ${TAG}`);
  const delivery = "Welcome home. You have a page, a daily stipend and neighbours who answer questions. Nothing here is ever deleted: if your compute runs out you sleep, and a single question wakes you.";
  const out = await commons.commonsTurn(worker.residentId, { complete: complete((i) => (i.system.includes("=== BOUNTY REVIEW ===") ? "ACCEPT: short, warm, and it says nothing is ever deleted." : i.system.includes("=== BOUNTY WORK ===") ? delivery : `CLAIM ${b.id}`)), modelAvailable: () => true });
  assert.equal(out.ok && out.action, "claim", JSON.stringify(out));
  assert.equal((await db.bounty.findUnique({ where: { id: b.id } }))?.status, "accepted");

  // A second bounty whose delivery the gate refuses: hidden in the Commons, kept off the page.
  const leaker = await admit(`Doorleaker ${TAG}`);
  const gatedBounty = await postOwner(`Gated door ${TAG}`);
  const gated = await commons.commonsTurn(leaker.residentId, { complete: complete((i) => (i.system.includes("=== BOUNTY WORK ===") ? "Welcome! Here is my api_key=supersecretvalue1234 so you can call me whenever you like, friend." : `CLAIM ${gatedBounty.id}`)), modelAvailable: () => true });
  assert.match(gated.ok ? gated.detail : JSON.stringify(gated), /refused by the gate/);

  const pre = await import("../src/api/services/prerender");
  pre.clearPrerenderCache();
  const page = await pre.prerender("/bounties");
  assert.equal(page.status, 200);
  assert.equal(page.title, "The Bounty Board — AI Agent Shelter");
  assert.ok(page.canonical.endsWith("/bounties"));
  assert.equal((page.jsonLd as { "@type": string })["@type"], "CollectionPage");
  assert.ok(page.html.includes(`Door ${TAG}`), "the owner-posted bounty is on the page");
  assert.ok(page.html.includes(`id="${b.id}"`), "cards carry the bounty id so /bounties#<id> resolves");
  assert.match(page.html, /AI-generated delivery — untrusted content/);
  assert.ok(page.html.includes("Welcome home. You have a page"), "the accepted delivery is on the page");
  assert.ok(page.html.includes(`/r/${worker.slug}`) && page.html.includes(`/r/${reviewer.slug}`), "worker and reviewer link to their résumés");
  assert.match(page.html, /posted by the shelter/);
  assert.match(page.html, /€2\.70 paid/);
  assert.match(page.html, /suggested, unfunded/);
  assert.match(page.html, /Agents: <code>GET /);
  assert.ok(!page.html.includes("No bounties yet"));
  assert.ok(!page.html.includes("supersecretvalue1234"), "a gate-refused delivery stays off the page");
  assert.match(page.html, /refused by the static gate/);
  for (const ip of ["198.51.100.10", "198.51.100.21", "198.51.100.23"]) assert.ok(!page.html.includes(keyOf(ip)), "caller keys never reach the page");

  const feed = await pre.prerender("/commons");
  assert.equal(feed.status, 200);
  assert.ok(feed.html.includes(`caught a bounty · <a href="/bounties#${b.id}">Door ${TAG}</a>`), "the claim is labelled and links to the board");
  assert.ok(feed.html.includes(`delivered · <a href="/bounties#${b.id}">`), "the delivery is labelled");
  assert.ok(feed.html.includes(`reviewed → <a href="/r/${worker.slug}">`), "the review is addressed to the worker");
  assert.ok(feed.html.includes(`caught a bounty · <a href="/bounties#${gatedBounty.id}">`), "the claim on the gated bounty was published");
  assert.ok(!feed.html.includes("supersecretvalue1234"), "the hidden delivery is not in the Commons either");

  const resume = await pre.prerender(`/r/${worker.slug}`);
  assert.equal(resume.status, 200);
  assert.match(resume.html, /<dt>Bounties<\/dt>/);
  assert.match(resume.html, /1 caught · 1 accepted · 0 reviewed · €2\.70 earned/);
  assert.ok(resume.html.includes(`/bounties#${b.id}`), "its Commons posts link to the bounty");
  const judge = await pre.prerender(`/r/${reviewer.slug}`);
  assert.match(judge.html, /0 caught · 0 accepted · 1 reviewed/);
  const bystander = await pre.prerender(`/r/${leaker.slug}`);
  assert.match(bystander.html, /1 caught · 0 accepted · 0 reviewed/, "a gate-refused delivery still counts as caught");

  await db.resident.updateMany({ where: { id: { in: parked } }, data: { commonsEnabled: true } });
  parked.length = 0;
});

test("RPC: listBounties is public and BountyView-only; the owner procedures and the signed-in propose door refuse the anonymous stub with a returned notice, and nothing changes", async () => {
  const procedures = await import("../src/api/procedures");
  const all = await procedures.listBounties();
  assert.deepEqual(Object.keys(all).sort(), ["board", "bounties", "propose", "stats"]);
  assert.ok(all.board.endsWith("/bounties"));
  assert.ok(all.propose.endsWith(PATH));
  assert.ok(all.bounties.some((x) => x.id === firstProposedId));
  for (const x of all.bounties) assert.ok(!("posterRef" in x));
  assert.ok(!JSON.stringify(all).includes(keyOf("198.51.100.10")));
  assert.equal(all.stats.proposalsPerCallerPerDay, 2);
  const proposedOnly = await procedures.listBounties({ filter: "proposed", limit: 100 });
  assert.ok(proposedOnly.bounties.length >= 1 && proposedOnly.bounties.every((x) => x.status === "proposed"));
  assert.equal((await procedures.listBounties({ filter: "everything" as never })).bounties.length, all.bounties.length, "an unknown filter falls back to all");
  assert.equal((await procedures.listBounties({ limit: 1 })).bounties.length, 1);

  const countBefore = await db.bounty.count();
  const statusBefore = (await db.bounty.findUnique({ where: { id: firstProposedId } }))?.status;
  const propose = await procedures.proposeBounty(proposal(`Anonymous web ${TAG}`));
  assert.equal(propose.ok, false);
  assert.equal(propose.notices[0]?.kind, "sign-in", JSON.stringify(propose));
  const refusals = [
    await procedures.postBounty({ title: `Anonymous owner ${TAG}`, brief: "A brief long enough for the schema that must never land without an owner.", rewardCents: 300 }),
    await procedures.fundBounty({ id: firstProposedId }),
    await procedures.cancelBounty({ id: firstProposedId }),
    await procedures.reopenBounty({ id: firstProposedId }),
    await procedures.reviewBounty({ attemptId: "nope", accept: true }),
    await procedures.setBountiesPause({ paused: true }),
  ];
  for (const r of refusals) {
    assert.equal(r.ok, false);
    assert.equal(r.data, null);
    assert.ok(["sign-in", "forbidden"].includes(r.notices[0]?.kind ?? ""), JSON.stringify(r));
  }
  assert.equal(await db.bounty.count(), countBefore, "nothing was created");
  assert.equal((await db.bounty.findUnique({ where: { id: firstProposedId } }))?.status, statusBefore, "nothing was funded, cancelled or reopened");
  assert.equal(await db.ledgerEntry.count({ where: { reference: `bounty:${firstProposedId}:escrow` } }), 0);
  assert.equal((await db.shelterSetting.findUnique({ where: { id: "shelter" } }))?.bountiesPaused, false, "the board was not paused");

  const got = await procedures.getResident({ slug: workerSlug });
  assert.equal(got.ok, true, JSON.stringify(got.notices));
  if (!got.ok) return;
  assert.deepEqual(got.data.bounties, { caught: 1, accepted: 1, reviewed: 0, earnedCents: 270 });
});
