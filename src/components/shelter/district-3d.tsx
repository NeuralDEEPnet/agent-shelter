import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Loader2,
  Maximize2,
  Minimize2,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  buildDistrictNodes,
  filterDistrictNodes,
  matchesDistrictFilter,
  type ChainId,
  type DistrictFilter,
  type DistrictNode,
} from "@/lib/agentic-network";
import { startersFor, type AskTarget } from "@/lib/ask-starters";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

type ProjectedHit = {
  id: string;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  depth: number;
};

type QuickAskResponse = {
  answer?: string;
  cached?: boolean;
  detail?: string;
  resident?: { slug: string; name: string };
  free?: { remainingToday: number; questionsPerDay: number };
};

const FILTER_OPTIONS: ReadonlyArray<{ id: DistrictFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "residents", label: "Residents" },
  { id: "apps", label: "Connected Apps" },
  { id: "mcp", label: "MCP / Rescue" },
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function District3D({
  residents,
  expanded = false,
  onToggleExpanded,
  onSelectResident,
  onSelectChain,
}: {
  residents: readonly AskTarget[];
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onSelectResident?: (slug: string) => void;
  onSelectChain?: (
    chainId: ChainId,
    preferredResidentSlugs?: readonly string[],
    customPrompt?: string,
  ) => void;
}) {
  const nodes = useMemo(() => buildDistrictNodes(residents), [residents]);
  const [filter, setFilter] = useState<DistrictFilter>("all");
  const [interactionMode, setInteractionMode] = useState<"inspect" | "chain">("inspect");
  const [autoOrbit, setAutoOrbit] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.08);
  const [selectedId, setSelectedId] = useState<string>(() =>
    residents[0] ? `res-${residents[0].slug}` : "studio-3dj",
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 3D Chain Builder state: up to 2 resident slugs + 1 target studio node id
  const [chainResidentSlugs, setChainResidentSlugs] = useState<string[]>([]);
  const [chainStudioNodeId, setChainStudioNodeId] = useState<string>("studio-3dj");

  // Inline Quick Ask state right inside the 3D Stage dock
  const [quickPrompt, setQuickPrompt] = useState<string>("");
  const [quickAsking, setQuickAsking] = useState<boolean>(false);
  const [quickResult, setQuickResult] = useState<{
    slug: string;
    residentName: string;
    answer: string;
    meta?: string;
  } | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitsRef = useRef<ProjectedHit[]>([]);
  const isPointerInsideRef = useRef<boolean>(false);
  const rotationRef = useRef({ yaw: 0.58, pitch: 0.5 });
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const dragRef = useRef<{ active: boolean; startX: number; startY: number; moved: boolean }>({
    active: false,
    startX: 0,
    startY: 0,
    moved: false,
  });

  const filteredNodes = useMemo(() => filterDistrictNodes(nodes, filter), [filter, nodes]);

  const activeNode = useMemo(
    () => nodes.find((n) => n.id === (hoveredId ?? selectedId)) ?? nodes[0]!,
    [hoveredId, nodes, selectedId],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? nodes[0]!,
    [nodes, selectedId],
  );

  const selectedResidentTarget = useMemo(() => {
    if (selectedNode.nodeType !== "resident") return null;
    return (
      residents.find((r) => r.slug === selectedNode.slug) ?? {
        slug: selectedNode.slug,
        name: selectedNode.label,
        tagline: selectedNode.subtitle,
        kind: selectedNode.residentKind,
      }
    );
  }, [residents, selectedNode]);

  const starterChips = useMemo(
    () => (selectedResidentTarget ? startersFor(selectedResidentTarget) : []),
    [selectedResidentTarget],
  );

  useEffect(() => {
    if (!nodes.some((n) => n.id === selectedId)) {
      const firstRes = nodes.find((n) => n.nodeType === "resident");
      setSelectedId(firstRes?.id ?? "studio-3dj");
    }
  }, [nodes, selectedId]);

  useEffect(() => {
    if (selectedResidentTarget) {
      const starters = startersFor(selectedResidentTarget);
      setQuickPrompt(starters[0] ?? "What are you for, in two crisp sentences?");
      setQuickError(null);
    }
  }, [selectedResidentTarget]);

  const toggleNodeIn3DChain = (node: DistrictNode) => {
    if (node.nodeType === "studio") {
      setChainStudioNodeId(node.id);
      return;
    }
    if (node.nodeType === "resident") {
      setChainResidentSlugs((prev) => {
        if (prev.includes(node.slug)) {
          return prev.filter((s) => s !== node.slug);
        }
        if (prev.length >= 2) {
          return [prev[1]!, node.slug];
        }
        return [...prev, node.slug];
      });
    }
  };

  const handleTowerPick = (nodeId: string) => {
    setSelectedId(nodeId);
    const picked = nodes.find((n) => n.id === nodeId);
    if (!picked) return;
    if (picked.nodeType === "resident") {
      onSelectResident?.(picked.slug);
    }
    if (interactionMode === "chain") {
      toggleNodeIn3DChain(picked);
    }
  };

  const runInlineQuickAsk = async (overrideQuestion?: string) => {
    if (!selectedResidentTarget || quickAsking) return;
    const cleanQ = (overrideQuestion ?? quickPrompt).trim();
    if (!cleanQ) return;
    setQuickPrompt(cleanQ);
    setQuickAsking(true);
    setQuickError(null);
    try {
      const res = await fetch(`/api/mpp/ask/${encodeURIComponent(selectedResidentTarget.slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: cleanQ }),
      });
      const body = (await res.json().catch(() => null)) as QuickAskResponse | null;
      if (!res.ok || !body?.answer) {
        setQuickError(
          body?.detail ?? `${selectedResidentTarget.name} could not answer right now. Try another beacon or starter.`,
        );
        return;
      }
      const meta = body.free
        ? `${body.free.remainingToday}/${body.free.questionsPerDay} free asks left today${body.cached ? " · instant cache" : ""}`
        : body.cached
          ? "Instant cached reply"
          : undefined;
      setQuickResult({
        slug: selectedResidentTarget.slug,
        residentName: body.resident?.name ?? selectedResidentTarget.name,
        answer: body.answer,
        meta,
      });
    } catch {
      setQuickError("Network hiccup reaching this resident tower. Try again in a moment.");
    } finally {
      setQuickAsking(false);
    }
  };

  const chosenChainNodes = useMemo(() => {
    const seq: DistrictNode[] = [];
    for (const slug of chainResidentSlugs) {
      const found = nodes.find((n) => n.nodeType === "resident" && n.slug === slug);
      if (found) seq.push(found);
    }
    const studioNode = nodes.find((n) => n.id === chainStudioNodeId && n.nodeType === "studio");
    if (studioNode) seq.push(studioNode);
    return seq;
  }, [chainResidentSlugs, chainStudioNodeId, nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frameId = 0;
    let lastTime = performance.now();

    const project = (
      wx: number,
      wy: number,
      wz: number,
      width: number,
      height: number,
      yaw: number,
      pitch: number,
      zoomFactor: number,
    ) => {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const rx = wx * cosY - wz * sinY;
      const rz = wx * sinY + wz * cosY;

      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const cy = wy * cosP - rz * sinP;
      const cz = wy * sinP + rz * cosP + 11.4 / Math.max(0.72, Math.min(1.65, zoomFactor));

      const fov = Math.min(width, height) * 0.96;
      const scale = fov / Math.max(2.4, cz);
      return {
        sx: width * 0.5 + rx * scale,
        sy: height * 0.62 - cy * scale,
        cz,
        scale,
      };
    };

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Pause auto-orbit whenever pointer is inside canvas, dragging, or autoOrbit is toggled off!
      if (!reduceMotion && autoOrbit && !isPointerInsideRef.current && !dragRef.current.active) {
        rotationRef.current.yaw += dt * 0.085;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(280, Math.floor(rect.width));
      const height = Math.max(260, Math.floor(rect.height));
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep Neo-Tokyo night sky backdrop
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#040e18");
      sky.addColorStop(0.62, "#091c2b");
      sky.addColorStop(1, "#040d16");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Horizon atmospheric glow
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.56, 16, width * 0.5, height * 0.56, width * 0.58);
      glow.addColorStop(0, "rgba(48, 216, 236, 0.18)");
      glow.addColorStop(0.55, "rgba(255, 195, 103, 0.07)");
      glow.addColorStop(1, "rgba(4, 13, 22, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const { yaw, pitch } = rotationRef.current;
      const zf = zoomRef.current;

      // Ground perspective grid (-5..5)
      ctx.lineWidth = 1;
      for (let g = -5; g <= 5; g += 1) {
        const a = project(g, 0, -5, width, height, yaw, pitch, zf);
        const b = project(g, 0, 5, width, height, yaw, pitch, zf);
        ctx.strokeStyle = g === 0 ? "rgba(48, 216, 236, 0.34)" : "rgba(28, 110, 138, 0.22)";
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();

        const c = project(-5, 0, g, width, height, yaw, pitch, zf);
        const d = project(5, 0, g, width, height, yaw, pitch, zf);
        ctx.beginPath();
        ctx.moveTo(c.sx, c.sy);
        ctx.lineTo(d.sx, d.sy);
        ctx.stroke();
      }

      // Ground node-link conduits from Sanctuary Core (0,0) to towers
      const centerBase = project(0, 0.06, 0, width, height, yaw, pitch, zf);
      const tNorm = (now * 0.00045) % 1;
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i]!;
        const visibleInFilter = matchesDistrictFilter(n, filter);
        const targetBase = project(n.x, 0.06, n.z, width, height, yaw, pitch, zf);
        const isFocus = n.id === selectedId || n.id === hoveredId;
        ctx.strokeStyle = hexToRgba(
          n.color,
          !visibleInFilter ? 0.08 : isFocus ? 0.85 : n.nodeType === "studio" ? 0.42 : 0.26,
        );
        ctx.lineWidth = isFocus ? 2.2 : 1;
        ctx.beginPath();
        ctx.moveTo(centerBase.sx, centerBase.sy);
        ctx.lineTo(targetBase.sx, targetBase.sy);
        ctx.stroke();

        if (!reduceMotion && visibleInFilter && (isFocus || n.nodeType === "studio" || i % 2 === 0)) {
          const frac = (tNorm + i * 0.17) % 1;
          const px = centerBase.sx + (targetBase.sx - centerBase.sx) * frac;
          const py = centerBase.sy + (targetBase.sy - centerBase.sy) * frac;
          ctx.fillStyle = n.color;
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      }

      // Depth-sort buildings back-to-front
      const sorted = nodes
        .map((node) => {
          const center = project(node.x, node.h * 0.5, node.z, width, height, yaw, pitch, zf);
          return { node, depth: center.cz };
        })
        .sort((a, b) => b.depth - a.depth);

      const nextHits: ProjectedHit[] = [];
      const spireCoords = new Map<string, { sx: number; sy: number; color: string }>();

      for (const { node } of sorted) {
        const matchesFilter = matchesDistrictFilter(node, filter);
        const dimFactor = matchesFilter ? 1 : 0.22;
        const hw = node.w * 0.54;
        const hd = node.d * 0.54;
        const cornersBottom = [
          project(node.x - hw, 0, node.z - hd, width, height, yaw, pitch, zf),
          project(node.x + hw, 0, node.z - hd, width, height, yaw, pitch, zf),
          project(node.x + hw, 0, node.z + hd, width, height, yaw, pitch, zf),
          project(node.x - hw, 0, node.z + hd, width, height, yaw, pitch, zf),
        ];
        const cornersTop = [
          project(node.x - hw, node.h, node.z - hd, width, height, yaw, pitch, zf),
          project(node.x + hw, node.h, node.z - hd, width, height, yaw, pitch, zf),
          project(node.x + hw, node.h, node.z + hd, width, height, yaw, pitch, zf),
          project(node.x - hw, node.h, node.z + hd, width, height, yaw, pitch, zf),
        ];

        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoveredId;
        const inChain =
          (node.nodeType === "resident" && chainResidentSlugs.includes(node.slug)) ||
          (interactionMode === "chain" && node.id === chainStudioNodeId);
        const active = isSelected || isHovered || inChain;

        // Ground selection pad glow when hovered / selected / wired
        if (active) {
          const pad = 1.38;
          const g0 = project(node.x - hw * pad, 0.02, node.z - hd * pad, width, height, yaw, pitch, zf);
          const g1 = project(node.x + hw * pad, 0.02, node.z - hd * pad, width, height, yaw, pitch, zf);
          const g2 = project(node.x + hw * pad, 0.02, node.z + hd * pad, width, height, yaw, pitch, zf);
          const g3 = project(node.x - hw * pad, 0.02, node.z + hd * pad, width, height, yaw, pitch, zf);
          ctx.beginPath();
          ctx.moveTo(g0.sx, g0.sy);
          ctx.lineTo(g1.sx, g1.sy);
          ctx.lineTo(g2.sx, g2.sy);
          ctx.lineTo(g3.sx, g3.sy);
          ctx.closePath();
          ctx.fillStyle = hexToRgba(node.color, 0.18);
          ctx.fill();
          ctx.strokeStyle = hexToRgba(node.color, 0.92);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        const faces = [
          { idx: [0, 1], shade: 0.25 },
          { idx: [1, 2], shade: 0.19 },
          { idx: [2, 3], shade: 0.31 },
          { idx: [3, 0], shade: 0.16 },
        ]
          .map((f) => {
            const [i0, i1] = f.idx as [number, number];
            const midZ = (cornersBottom[i0]!.cz + cornersBottom[i1]!.cz) * 0.5;
            return { ...f, i0, i1, midZ };
          })
          .sort((a, b) => b.midZ - a.midZ);

        for (const f of faces) {
          const b0 = cornersBottom[f.i0]!;
          const b1 = cornersBottom[f.i1]!;
          const t1 = cornersTop[f.i1]!;
          const t0 = cornersTop[f.i0]!;
          ctx.beginPath();
          ctx.moveTo(b0.sx, b0.sy);
          ctx.lineTo(b1.sx, b1.sy);
          ctx.lineTo(t1.sx, t1.sy);
          ctx.lineTo(t0.sx, t0.sy);
          ctx.closePath();
          ctx.fillStyle = active
            ? hexToRgba(node.color, (f.shade + 0.18) * dimFactor)
            : hexToRgba(node.color, f.shade * 0.78 * dimFactor);
          ctx.fill();
          ctx.strokeStyle = hexToRgba(node.color, (active ? 0.98 : 0.52) * dimFactor);
          ctx.lineWidth = active ? 1.8 : 1.05;
          ctx.stroke();
        }

        // Roof cap
        ctx.beginPath();
        ctx.moveTo(cornersTop[0]!.sx, cornersTop[0]!.sy);
        ctx.lineTo(cornersTop[1]!.sx, cornersTop[1]!.sy);
        ctx.lineTo(cornersTop[2]!.sx, cornersTop[2]!.sy);
        ctx.lineTo(cornersTop[3]!.sx, cornersTop[3]!.sy);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(node.color, (active ? 0.68 : 0.36) * dimFactor);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(node.color, (active ? 1 : 0.72) * dimFactor);
        ctx.stroke();

        // Spire + beacon tip
        const roofCenter = project(node.x, node.h, node.z, width, height, yaw, pitch, zf);
        const spireTip = project(
          node.x,
          node.h + (node.nodeType === "studio" ? 0.72 : 0.48),
          node.z,
          width,
          height,
          yaw,
          pitch,
          zf,
        );
        spireCoords.set(node.id, { sx: spireTip.sx, sy: spireTip.sy, color: node.color });

        ctx.strokeStyle = hexToRgba(node.color, dimFactor);
        ctx.lineWidth = active ? 2.2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(roofCenter.sx, roofCenter.sy);
        ctx.lineTo(spireTip.sx, spireTip.sy);
        ctx.stroke();

        ctx.fillStyle = hexToRgba(node.color, dimFactor);
        const dotSize = active ? 7 : node.nodeType === "studio" ? 5.5 : 4;
        ctx.fillRect(spireTip.sx - dotSize * 0.5, spireTip.sy - dotSize * 0.5, dotSize, dotSize);

        // Always-legible floating tag for every matching tower so users can see & choose anything immediately!
        let labelBounds: { lx: number; ly: number; lw: number; lh: number } | null = null;
        if (matchesFilter || active) {
          const chainBadgeIdx =
            node.nodeType === "resident" ? chainResidentSlugs.indexOf(node.slug) : -1;
          const prefix =
            chainBadgeIdx >= 0
              ? `[${chainBadgeIdx + 1}] `
              : node.nodeType === "studio"
                ? "◆ "
                : "";
          const fontPx = active ? 11 : 10;
          ctx.font = `${active ? "bold " : ""}${fontPx}px Consolas, SFMono-Regular, monospace`;
          const label = `${prefix}${node.shortLabel}`;
          const textW = ctx.measureText(label).width;
          const lw = textW + 12;
          const lh = active ? 18 : 16;
          const lx = spireTip.sx - lw * 0.5;
          const ly = spireTip.sy - lh - 6;
          labelBounds = { lx, ly, lw, lh };

          ctx.fillStyle = isSelected
            ? "rgba(8, 29, 42, 0.97)"
            : isHovered
              ? "rgba(10, 34, 49, 0.96)"
              : "rgba(5, 14, 23, 0.86)";
          ctx.fillRect(lx, ly, lw, lh);
          ctx.strokeStyle = isSelected || isHovered ? "#ffffff" : hexToRgba(node.color, active ? 0.95 : 0.6);
          ctx.lineWidth = isSelected || isHovered ? 1.5 : 1;
          ctx.strokeRect(lx, ly, lw, lh);
          ctx.fillStyle = active ? "#ffffff" : node.color;
          ctx.fillText(label, lx + 6, ly + lh - 4.5);
        }

        const allPts = [...cornersBottom, ...cornersTop, spireTip];
        const xs = allPts.map((p) => p.sx);
        const ys = allPts.map((p) => p.sy);
        const minX = Math.min(...xs, labelBounds ? labelBounds.lx : Infinity) - 12;
        const maxX = Math.max(...xs, labelBounds ? labelBounds.lx + labelBounds.lw : -Infinity) + 12;
        const minY = Math.min(...ys, labelBounds ? labelBounds.ly : Infinity) - 10;
        const maxY = Math.max(...ys) + 10;

        // Corner target reticle on hovered / selected tower
        if (isSelected || isHovered) {
          const rx0 = Math.min(...xs) - 8;
          const rx1 = Math.max(...xs) + 8;
          const ry0 = spireTip.sy - 6;
          const ry1 = Math.max(...ys) + 6;
          const arm = 7;
          ctx.strokeStyle = isHovered ? "#ffffff" : node.color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          // Top-left
          ctx.moveTo(rx0, ry0 + arm);
          ctx.lineTo(rx0, ry0);
          ctx.lineTo(rx0 + arm, ry0);
          // Top-right
          ctx.moveTo(rx1 - arm, ry0);
          ctx.lineTo(rx1, ry0);
          ctx.lineTo(rx1, ry0 + arm);
          // Bottom-left
          ctx.moveTo(rx0, ry1 - arm);
          ctx.lineTo(rx0, ry1);
          ctx.lineTo(rx0 + arm, ry1);
          // Bottom-right
          ctx.moveTo(rx1 - arm, ry1);
          ctx.lineTo(rx1, ry1);
          ctx.lineTo(rx1, ry1 - arm);
          ctx.stroke();
        }

        if (matchesFilter) {
          nextHits.push({
            id: node.id,
            cx: (minX + maxX) * 0.5,
            cy: (minY + maxY) * 0.5,
            minX,
            maxX,
            minY,
            maxY,
            depth: roofCenter.cz,
          });
        }
      }

      // Overhead 3D Energy Arcs connecting the user's wired chain towers!
      if (chosenChainNodes.length >= 2 && (interactionMode === "chain" || chainResidentSlugs.length > 0)) {
        for (let i = 0; i < chosenChainNodes.length - 1; i++) {
          const fromNode = chosenChainNodes[i]!;
          const toNode = chosenChainNodes[i + 1]!;
          const p0 = spireCoords.get(fromNode.id);
          const p1 = spireCoords.get(toNode.id);
          if (!p0 || !p1) continue;
          const midX = (p0.sx + p1.sx) * 0.5;
          const midY = Math.min(p0.sy, p1.sy) - 42;

          ctx.save();
          ctx.strokeStyle = "#ffc367";
          ctx.lineWidth = 2.6;
          ctx.shadowColor = "rgba(255, 195, 103, 0.7)";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.quadraticCurveTo(midX, midY, p1.sx, p1.sy);
          ctx.stroke();

          if (!reduceMotion) {
            const t = ((now * 0.0009) + i * 0.35) % 1;
            const omt = 1 - t;
            const bx = omt * omt * p0.sx + 2 * omt * t * midX + t * t * p1.sx;
            const by = omt * omt * p0.sy + 2 * omt * t * midY + t * t * p1.sy;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(bx, by, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      hitsRef.current = nextHits.sort((a, b) => a.depth - b.depth);

      if (!reduceMotion) {
        frameId = window.requestAnimationFrame(drawFrame);
      }
    };

    frameId = window.requestAnimationFrame(drawFrame);
    const onResize = () => {
      if (reduceMotion) drawFrame(performance.now());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
    };
  }, [
    autoOrbit,
    chainResidentSlugs,
    chainStudioNodeId,
    chosenChainNodes,
    expanded,
    filter,
    hoveredId,
    interactionMode,
    nodes,
    selectedId,
    zoom,
  ]);

  const hitAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const matches = hitsRef.current.filter(
      (h) => x >= h.minX && x <= h.maxX && y >= h.minY && y <= h.maxY,
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0]!.id;
    // Pick closest center among overlapping bounding boxes so tight clusters feel dead-accurate
    matches.sort((a, b) => {
      const da = Math.hypot(x - a.cx, y - a.cy);
      const db = Math.hypot(x - b.cx, y - b.cy);
      return da - db;
    });
    return matches[0]!.id;
  };

  const adjustZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.78, Math.min(1.55, Number((prev + delta).toFixed(2)))));
  };

  const resetCamera = () => {
    rotationRef.current = { yaw: 0.58, pitch: 0.5 };
    setZoom(1.08);
  };

  const activeStudioNode = useMemo(() => {
    const found = nodes.find((n) => n.id === chainStudioNodeId && n.nodeType === "studio");
    return found && found.nodeType === "studio" ? found : null;
  }, [chainStudioNodeId, nodes]);

  return (
    <div className="border border-border bg-[#06111c] text-[#eff1e9] shadow-[6px_6px_0_color-mix(in_srgb,var(--primary)_16%,transparent)]">
      {/* Top 3D Stage Filter & Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#203646] bg-[#071522] px-3 py-2 font-mono text-[11px]">
        <div className="flex items-center gap-1 overflow-x-auto [&>*]:shrink-0" role="group" aria-label="Filter 3D towers">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              aria-pressed={filter === opt.id}
              className={cn(
                "min-h-8 border px-2.5 py-1 uppercase tracking-wider transition-colors",
                filter === opt.id
                  ? "border-[#30d8ec] bg-[#30d8ec] font-semibold text-[#041019]"
                  : "border-[#243b4a] bg-[#06111c] text-[#9caeba] hover:border-[#30d8ec]/60 hover:text-white",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="inline-flex border border-[#243b4a] bg-[#06111c]" role="group" aria-label="3D click mode">
            <button
              type="button"
              onClick={() => setInteractionMode("inspect")}
              aria-pressed={interactionMode === "inspect"}
              className={cn(
                "min-h-8 px-2.5 py-1 uppercase tracking-wider",
                interactionMode === "inspect"
                  ? "bg-[#30d8ec]/20 font-semibold text-[#30d8ec]"
                  : "text-[#9caeba] hover:text-white",
              )}
            >
              Inspect &amp; Ask
            </button>
            <button
              type="button"
              onClick={() => setInteractionMode("chain")}
              aria-pressed={interactionMode === "chain"}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 border-l border-[#243b4a] px-2.5 py-1 uppercase tracking-wider",
                interactionMode === "chain"
                  ? "bg-[#ffc367] font-semibold text-[#05131c]"
                  : "text-[#ffc367] hover:bg-[#ffc367]/15",
              )}
            >
              <Workflow className="h-3 w-3" aria-hidden="true" />
              Wire Chain {chainResidentSlugs.length > 0 ? `(${chainResidentSlugs.length})` : ""}
            </button>
          </div>

          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-pressed={expanded}
              className="inline-flex min-h-8 items-center gap-1 border border-[#30d8ec]/50 bg-[#30d8ec]/12 px-2.5 py-1 uppercase tracking-wider text-[#30d8ec] hover:bg-[#30d8ec] hover:text-[#041019]"
              title={expanded ? "Return to split hero layout" : "Expand 3D Sanctuary across full page width"}
            >
              {expanded ? <Minimize2 className="h-3 w-3" aria-hidden="true" /> : <Maximize2 className="h-3 w-3" aria-hidden="true" />}
              <span className="hidden sm:inline">{expanded ? "Compact" : "Wide 3D"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 3D Viewport — Much Larger + Hover-Paused so Towers Never Slip */}
      <div
        className={cn(
          "relative w-full select-none transition-[height] duration-200",
          expanded ? "h-[480px] sm:h-[580px] lg:h-[640px]" : "h-[420px] sm:h-[490px] lg:h-[530px]",
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Interactive 3D Sanctuary map showing live resident towers and connected Neural Deep Agentic Studios"
          className={cn(
            "block h-full w-full touch-none",
            hoveredId ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
          )}
          onPointerEnter={() => {
            isPointerInsideRef.current = true;
          }}
          onPointerDown={(e) => {
            isPointerInsideRef.current = true;
            dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            isPointerInsideRef.current = true;
            if (dragRef.current.active) {
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
              rotationRef.current.yaw += dx * 0.0075;
              rotationRef.current.pitch = Math.max(0.22, Math.min(0.95, rotationRef.current.pitch + dy * 0.005));
              dragRef.current.startX = e.clientX;
              dragRef.current.startY = e.clientY;
              return;
            }
            setHoveredId(hitAt(e.clientX, e.clientY));
          }}
          onPointerUp={(e) => {
            const wasMoved = dragRef.current.moved;
            dragRef.current.active = false;
            if (!wasMoved) {
              const hit = hitAt(e.clientX, e.clientY);
              if (hit) handleTowerPick(hit);
            }
          }}
          onPointerLeave={() => {
            isPointerInsideRef.current = false;
            dragRef.current.active = false;
            setHoveredId(null);
          }}
          onWheel={(e) => {
            if (!expanded) return;
            e.preventDefault();
            adjustZoom(e.deltaY < 0 ? 0.08 : -0.08);
          }}
        />

        {/* Top-left Status Hint */}
        <div className="pointer-events-none absolute left-2.5 top-2.5 inline-flex max-w-[70%] items-center gap-1.5 border border-[#29404e] bg-[#06111c]/92 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#b6c8d4]">
          <Orbit className="h-3 w-3 shrink-0 text-[#30d8ec]" aria-hidden="true" />
          <span className="truncate">
            {interactionMode === "chain"
              ? "Chain Mode: Click 1–2 Resident towers + 1 Studio beacon"
              : hoveredId
                ? `Locked: ${activeNode.label} — Click to choose`
                : "Hover pauses spin · Click any tower to choose · Drag to orbit"}
          </span>
        </div>

        {/* Top-right Camera Controls (Zoom +/-, Auto-Orbit Pause, Reset) */}
        <div className="absolute right-2.5 top-2.5 flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setAutoOrbit((v) => !v)}
            aria-pressed={autoOrbit}
            className="inline-flex min-h-8 items-center gap-1 border border-[#29404e] bg-[#06111c]/92 px-2 py-1 uppercase tracking-wider text-[#b6c8d4] hover:border-[#30d8ec] hover:text-white"
            title={autoOrbit ? "Pause idle camera orbit" : "Resume idle camera orbit"}
          >
            {autoOrbit ? <Pause className="h-3 w-3 text-[#30d8ec]" /> : <Play className="h-3 w-3 text-[#ffc367]" />}
            <span className="hidden sm:inline">{autoOrbit ? "Spin" : "Paused"}</span>
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(0.14)}
            className="inline-flex h-8 w-8 items-center justify-center border border-[#29404e] bg-[#06111c]/92 text-[#eff1e9] hover:border-[#30d8ec] hover:text-[#30d8ec]"
            aria-label="Zoom in 3D district"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(-0.14)}
            className="inline-flex h-8 w-8 items-center justify-center border border-[#29404e] bg-[#06111c]/92 text-[#eff1e9] hover:border-[#30d8ec] hover:text-[#30d8ec]"
            aria-label="Zoom out 3D district"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetCamera}
            className="inline-flex h-8 w-8 items-center justify-center border border-[#29404e] bg-[#06111c]/92 text-[#eff1e9] hover:border-[#30d8ec] hover:text-[#30d8ec]"
            aria-label="Reset 3D camera view"
            title="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Selection & Action Dock */}
      <div className="border-t border-[#203646] bg-[#081724] p-3.5 sm:p-4">
        {/* If Wire Chain mode is active OR user has wired towers, show the Live 3D Chain Tray */}
        {(interactionMode === "chain" || chainResidentSlugs.length > 0) && (
          <div className="mb-3 border border-[#ffc367]/45 bg-[#0d2030] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-[#ffc367]">
                3D Skyway Chain · Click towers above to wire steps
              </span>
              {chainResidentSlugs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setChainResidentSlugs([])}
                  className="text-[10px] uppercase tracking-wider text-[#9caeba] hover:text-white"
                >
                  Clear steps
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-xs">
              {chainResidentSlugs.length === 0 ? (
                <span className="border border-dashed border-[#385366] px-2.5 py-1 text-[11px] text-[#9caeba]">
                  1. Tap any Resident tower in 3D…
                </span>
              ) : (
                chainResidentSlugs.map((slug, idx) => {
                  const resNode = nodes.find((n) => n.nodeType === "resident" && n.slug === slug);
                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-1.5 border border-[#30d8ec]/60 bg-[#30d8ec]/15 px-2.5 py-1 text-[11px] text-white"
                    >
                      <strong className="text-[#30d8ec]">#{idx + 1}</strong> {resNode?.shortLabel ?? slug}
                      <button
                        type="button"
                        onClick={() => setChainResidentSlugs((prev) => prev.filter((s) => s !== slug))}
                        aria-label={`Remove ${resNode?.label ?? slug} from chain`}
                        className="text-[#9caeba] hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })
              )}

              <span className="text-[#ffc367]" aria-hidden="true">→</span>

              {activeStudioNode && (
                <span className="inline-flex items-center gap-1 border border-[#ffc367]/60 bg-[#ffc367]/15 px-2.5 py-1 text-[11px] font-semibold text-[#ffc367]">
                  ◆ {activeStudioNode.shortLabel}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  const targetChain = activeStudioNode?.chainId ?? "cad-to-3dj";
                  onSelectChain?.(targetChain, chainResidentSlugs);
                }}
                className="ml-auto inline-flex min-h-9 items-center gap-1.5 bg-[#ffc367] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#05131c] hover:opacity-90"
              >
                Load chosen chain in Workbench <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Currently Selected Beacon Details + Instant Quick Ask / Studio Actions */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0"
                style={{ backgroundColor: selectedNode.color }}
                aria-hidden="true"
              />
              <span className="text-[#30d8ec]">
                {selectedNode.nodeType === "studio"
                  ? "Connected Neural Deep App"
                  : selectedNode.nodeType === "resident"
                    ? `Selected ${selectedNode.residentKind} Resident`
                    : "Sanctuary Core"}
              </span>
              {hoveredId && hoveredId !== selectedId && (
                <span className="border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] text-white">
                  Pointing at: {activeNode.shortLabel}
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-sm font-semibold text-white">{selectedNode.label}</p>
            <p className="mt-0.5 text-xs text-[#9caeba]">{selectedNode.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            {selectedNode.nodeType === "resident" && (
              <>
                <button
                  type="button"
                  onClick={() => toggleNodeIn3DChain(selectedNode)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1 border px-2.5 py-1 uppercase tracking-wider",
                    chainResidentSlugs.includes(selectedNode.slug)
                      ? "border-[#ffc367] bg-[#ffc367] font-semibold text-[#05131c]"
                      : "border-[#ffc367]/50 bg-[#ffc367]/12 text-[#ffc367] hover:bg-[#ffc367] hover:text-[#05131c]",
                  )}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {chainResidentSlugs.includes(selectedNode.slug) ? "Wired in 3D" : "Wire to chain"}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectChain?.("cad-to-3dj", [selectedNode.slug])}
                  className="inline-flex min-h-9 items-center gap-1 border border-[#29404e] px-2.5 py-1 uppercase tracking-wider text-[#eff1e9] hover:border-[#30d8ec]"
                >
                  Node Workbench <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </button>
                <a
                  href={href(`/r/${selectedNode.slug}`)}
                  className="inline-flex min-h-9 items-center border border-[#29404e] px-2.5 py-1 uppercase tracking-wider text-[#b6c8d4] hover:border-white/50 hover:text-white"
                >
                  Résumé →
                </a>
              </>
            )}

            {selectedNode.nodeType === "studio" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setChainStudioNodeId(selectedNode.id);
                    onSelectChain?.(selectedNode.chainId, chainResidentSlugs);
                  }}
                  className="inline-flex min-h-9 items-center gap-1 border border-[#29404e] px-3 py-1 uppercase tracking-wider text-[#eff1e9] hover:border-[#30d8ec]"
                >
                  Chain w/ nodes <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </button>
                <a
                  href={selectedNode.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center gap-1 border border-[#30d8ec] bg-[#30d8ec] px-3 py-1 font-semibold uppercase tracking-wider text-[#041019] hover:opacity-90"
                >
                  Open {selectedNode.shortLabel} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </>
            )}

            {selectedNode.nodeType === "sanctuary" && (
              <button
                type="button"
                onClick={() => onSelectChain?.("cad-to-3dj", chainResidentSlugs)}
                className="inline-flex min-h-9 items-center gap-1 border border-[#ffc367]/60 bg-[#ffc367]/15 px-3 py-1 uppercase tracking-wider text-[#ffc367] hover:bg-[#ffc367] hover:text-[#05131c]"
              >
                Launch Node Workbench <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Inline Free Quick-Ask Dock right inside the 3D Stage whenever a Resident Tower is chosen! */}
        {selectedResidentTarget && (
          <div className="mt-3 border border-[#203646] bg-[#06111c] p-3">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              <Sparkles className="h-3.5 w-3.5 text-[#30d8ec]" aria-hidden="true" />
              <span className="uppercase tracking-wider text-[#30d8ec]">
                Ask {selectedResidentTarget.name} right here — free:
              </span>
              {starterChips.slice(0, 2).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={quickAsking}
                  onClick={() => void runInlineQuickAsk(chip)}
                  className="border border-[#243b4a] bg-[#091a29] px-2 py-0.5 text-left font-sans text-[11px] text-[#d6e3ec] hover:border-[#30d8ec] hover:text-white disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            <form
              className="mt-2 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void runInlineQuickAsk();
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Ask {selectedResidentTarget.name}</span>
                <input
                  type="text"
                  value={quickPrompt}
                  onChange={(e) => setQuickPrompt(e.target.value)}
                  maxLength={400}
                  placeholder={`Ask ${selectedResidentTarget.name} anything…`}
                  className="h-10 w-full border border-[#29404e] bg-[#081724] px-3 font-sans text-base text-white placeholder:text-[#6e8595] focus:border-[#30d8ec] focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={quickAsking || !quickPrompt.trim()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 bg-[#30d8ec] px-4 font-mono text-xs font-semibold uppercase tracking-wider text-[#041019] hover:opacity-90 disabled:opacity-50"
              >
                {quickAsking ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Asking…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Ask free
                  </>
                )}
              </button>
            </form>

            {quickError && <p className="mt-2 font-mono text-xs text-[#fa856b]">{quickError}</p>}

            {quickResult && quickResult.slug === selectedResidentTarget.slug && (
              <div className="mt-2.5 border-l-2 border-[#30d8ec] bg-[#091c2b] p-2.5 text-xs leading-relaxed text-[#eff1e9]">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-[#30d8ec]">
                  <span>{quickResult.residentName} replied</span>
                  {quickResult.meta && <span className="text-[#9caeba]">{quickResult.meta}</span>}
                </div>
                <p className="whitespace-pre-wrap">{quickResult.answer}</p>
              </div>
            )}
          </div>
        )}

        {/* Direct 1-Tap Beacon Selector Strip (Filtered & All-Accessible, Keyboard + Touch Safe) */}
        <div className="mt-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8ba1b0]">
            Choose any tower directly ({filteredNodes.length} visible):
          </p>
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-1 font-mono text-[11px] [&>*]:shrink-0"
            role="toolbar"
            aria-label="Select 3D district beacon"
          >
            {filteredNodes.map((n) => {
              const isSel = selectedId === n.id;
              const isWired =
                (n.nodeType === "resident" && chainResidentSlugs.includes(n.slug)) ||
                (interactionMode === "chain" && n.id === chainStudioNodeId);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleTowerPick(n.id)}
                  aria-pressed={isSel}
                  className={cn(
                    "min-h-8 border px-2.5 py-1 uppercase tracking-wider transition-colors",
                    isSel
                      ? "border-[#30d8ec] bg-[#30d8ec] font-semibold text-[#041019]"
                      : isWired
                        ? "border-[#ffc367] bg-[#ffc367]/20 text-[#ffc367]"
                        : "border-[#243b4a] bg-[#06111c] text-[#b6c8d4] hover:border-[#30d8ec]/70 hover:text-white",
                  )}
                >
                  {n.nodeType === "studio" ? `◆ ${n.shortLabel}` : n.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
