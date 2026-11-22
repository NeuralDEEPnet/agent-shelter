// Offline unit & SSR renderer proofs for Neural Deep Agentic Network, 3D District, and Node Workbench.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AGENTIC_STUDIOS,
  buildDistrictNodes,
  buildRescueMarkdownSnippet,
  buildWorkbenchSharePath,
  filterDistrictNodes,
  getAgenticStudio,
  NODE_CHAIN_PRESETS,
  parsePackageSpec,
  parseWorkbenchSearch,
  PUBLIC_ECOSYSTEM_APPS,
  resolveChainResident,
  SHELTER_PUBLIC_ORIGIN,
} from "../src/lib/agentic-network";
import { AgenticNetworkStrip, AgenticStudiosBand } from "../src/components/shelter/agentic-studios-bar";
import { District3D } from "../src/components/shelter/district-3d";
import { NodeWorkbench } from "../src/components/shelter/node-workbench";

test("AGENTIC_STUDIOS exposes verified live production origins and valid handoff deep links", () => {
  assert.equal(AGENTIC_STUDIOS.length, 4);
  assert.equal(getAgenticStudio("3dj").baseUrl, "https://www.3dj.app");
  assert.equal(getAgenticStudio("sketchmonkey").baseUrl, "https://www.sketchmonkey.design");
  assert.equal(getAgenticStudio("aibeing").baseUrl, "https://www.aibeing.me");
  assert.equal(getAgenticStudio("dreamscape").baseUrl, "https://dreamscape-neuraldeepnet.adaptive.ai");

  const smUrl = new URL(getAgenticStudio("sketchmonkey").buildHandoffUrl("Anodized aluminum desk lamp"));
  assert.equal(smUrl.origin, "https://www.sketchmonkey.design");
  assert.equal(smUrl.pathname, "/canvas");
  assert.equal(smUrl.searchParams.get("handoff"), "1");
  assert.equal(smUrl.searchParams.get("prompt"), "Anodized aluminum desk lamp");

  const cadUrl = new URL(getAgenticStudio("3dj").buildHandoffUrl("2020 corner bracket"));
  assert.equal(cadUrl.origin, "https://www.3dj.app");
  assert.equal(cadUrl.pathname, "/workspace");
  assert.equal(cadUrl.searchParams.get("prompt"), "2020 corner bracket");

  assert.equal(getAgenticStudio("aibeing").buildHandoffUrl("Support triage lead"), "https://www.aibeing.me/#/import");
  assert.equal(getAgenticStudio("aibeing").buildHandoffUrl(""), "https://www.aibeing.me/");
});

test("resolveChainResident matches full production slugs and falls back cleanly in single-resident dev DBs", () => {
  const prodTargets = [
    { slug: "minute", name: "Minute", kind: "agent" },
    { slug: "forge-neural-deep-idea-to-production-age", name: "Forge", kind: "agent" },
    { slug: "printready-neural-deep-prototype-reviewe", name: "PrintReady", kind: "agent" },
    { slug: "sketchpilot-neural-deep-design-director", name: "SketchPilot", kind: "agent" },
  ];
  assert.equal(resolveChainResident(prodTargets, "forge")?.slug, "forge-neural-deep-idea-to-production-age");
  assert.equal(resolveChainResident(prodTargets, "printready")?.slug, "printready-neural-deep-prototype-reviewe");
  assert.equal(resolveChainResident(prodTargets, "sketchpilot")?.slug, "sketchpilot-neural-deep-design-director");

  const devTargets = [{ slug: "minute", name: "Minute", kind: "agent" }];
  assert.equal(resolveChainResident(devTargets, "forge")?.slug, "minute");
  assert.equal(resolveChainResident([], "forge"), null);
});

test("parseWorkbenchSearch and buildWorkbenchSharePath round-trip safely and reject unknown chains", () => {
  const sharePath = buildWorkbenchSharePath("mcp-rescue", "pypi:office-word-mcp-server", "/");
  assert.ok(sharePath.startsWith("/?chain=mcp-rescue&q=pypi%3Aoffice-word-mcp-server#node-workbench"));

  const queryPart = sharePath.split("#")[0]!.slice(1);
  const parsed = parseWorkbenchSearch(queryPart);
  assert.equal(parsed.chainId, "mcp-rescue");
  assert.equal(parsed.query, "pypi:office-word-mcp-server");

  const unknown = parseWorkbenchSearch("?chain=evil-script&q=hello");
  assert.equal(unknown.chainId, null);
  assert.equal(unknown.query, "hello");

  assert.deepEqual(parsePackageSpec("pypi:office-word-mcp-server"), {
    registry: "pypi",
    name: "office-word-mcp-server",
  });
  assert.deepEqual(parsePackageSpec("@modelcontextprotocol/server-github"), {
    registry: "npm",
    name: "@modelcontextprotocol/server-github",
  });
});

test("3D district layout includes central sanctuary, all 6 connected app beacons, filtering, and inline picker UI", () => {
  const nodes = buildDistrictNodes([
    { slug: "minute", name: "Minute", kind: "agent", tagline: "Notes" },
    { slug: "excel-mcp-server", name: "Excel MCP Server", kind: "mcp", tagline: "Sheets" },
  ]);
  assert.equal(nodes[0]?.nodeType, "sanctuary");
  assert.equal(nodes.filter((n) => n.nodeType === "studio").length, 6);
  assert.equal(nodes.filter((n) => n.nodeType === "resident").length, 2);
  assert.equal(filterDistrictNodes(nodes, "apps").filter((n) => n.nodeType === "studio").length, 6);
  assert.equal(filterDistrictNodes(nodes, "residents").filter((n) => n.nodeType === "resident").length, 2);
  assert.equal(filterDistrictNodes(nodes, "mcp").filter((n) => n.nodeType === "resident").length, 1);

  const html = renderToStaticMarkup(
    createElement(District3D, {
      residents: [{ slug: "minute", name: "Minute", kind: "agent", tagline: "Meeting decisions" }],
      onToggleExpanded: () => {},
    }),
  );
  assert.ok(html.includes("<canvas"));
  assert.ok(html.includes("Interactive 3D Sanctuary map"));
  assert.ok(html.includes("◆ 3DJ STUDIO"));
  assert.ok(html.includes("◆ LAUNCHSTAGE"));
  assert.ok(html.includes("◆ BOUNTIES"));
  assert.ok(html.includes("Wire Chain"));
  assert.ok(html.includes("Wide 3D"));
  assert.ok(html.includes("Ask Minute right here — free"));
});

test("AgenticNetworkStrip, AgenticStudiosBand, and NodeWorkbench render accessible links and controls", () => {
  assert.equal(PUBLIC_ECOSYSTEM_APPS.length, 6);
  const stripHtml = renderToStaticMarkup(createElement(AgenticNetworkStrip));
  assert.ok(stripHtml.includes("https://www.3dj.app"));
  assert.ok(stripHtml.includes("https://www.sketchmonkey.design"));
  assert.ok(stripHtml.includes("https://www.aibeing.me"));
  assert.ok(stripHtml.includes("https://dreamscape-neuraldeepnet.adaptive.ai"));
  assert.ok(stripHtml.includes("https://launchstage-neuraldeepnet.adaptive.ai"));
  assert.ok(stripHtml.includes("https://bounties-neuraldeepnet.adaptive.ai"));
  assert.ok(!stripHtml.includes("shelter.neuraldeep.net"));

  const bandHtml = renderToStaticMarkup(createElement(AgenticStudiosBand, { brief: "Snap-fit mount" }));
  assert.ok(bandHtml.includes("Connected Neural Deep Agentic Studios"));
  assert.ok(bandHtml.includes("handoff=1"));
  assert.ok(bandHtml.includes("LaunchStage"));
  assert.ok(bandHtml.includes("Bounties"));

  assert.equal(NODE_CHAIN_PRESETS.length, 4);
  const workbenchHtml = renderToStaticMarkup(
    createElement(NodeWorkbench, {
      targets: [
        { slug: "minute", name: "Minute", kind: "agent" },
        { slug: "forge-neural-deep-idea-to-production-age", name: "Forge", kind: "agent" },
      ],
    }),
  );
  assert.ok(workbenchHtml.includes("Free Multi-Agent Node Workbench"));
  assert.ok(workbenchHtml.includes("Run free chain"));
  assert.ok(workbenchHtml.includes("Idea → 3DJ CAD"));
  assert.ok(workbenchHtml.includes("Concept → SketchMonkey"));
  assert.ok(workbenchHtml.includes("MCP Rescue → Config"));
  assert.ok(workbenchHtml.includes("Role → AiBeing Team"));
});

test("buildRescueMarkdownSnippet creates copyable Markdown on the Adaptive origin without custom-domain drift", () => {
  const md = buildRescueMarkdownSnippet({
    serverOrPackage: "@modelcontextprotocol/server-github",
    statusLabel: "archived",
    packageSpec: "@modelcontextprotocol/server-github",
    replacementName: "github/github-mcp-server",
    replacementHow: "https://api.githubcopilot.com/mcp/",
    detailsPath: "/instead/github",
  });
  assert.ok(md.includes(SHELTER_PUBLIC_ORIGIN));
  assert.ok(md.includes("?chain=mcp-rescue&q=%40modelcontextprotocol%2Fserver-github#node-workbench"));
  assert.ok(md.includes("github/github-mcp-server"));
  assert.ok(md.includes(`${SHELTER_PUBLIC_ORIGIN}/instead/github`));
  assert.ok(!md.includes("shelter.neuraldeep.net"));
});
