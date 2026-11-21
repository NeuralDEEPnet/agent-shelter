import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Orbit, Sparkles } from "lucide-react";
import { buildDistrictNodes, type ChainId } from "@/lib/agentic-network";
import type { AskTarget } from "@/lib/ask-starters";
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
  onSelectResident,
  onSelectChain,
}: {
  residents: readonly AskTarget[];
  onSelectResident?: (slug: string) => void;
  onSelectChain?: (chainId: ChainId, preferredResidentSlug?: string) => void;
}) {
  const nodes = useMemo(() => buildDistrictNodes(residents), [residents]);
  const [selectedId, setSelectedId] = useState<string>(() =>
    residents[0] ? `res-${residents[0].slug}` : "studio-3dj",
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitsRef = useRef<ProjectedHit[]>([]);
  const rotationRef = useRef({ yaw: 0.62, pitch: 0.52 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; moved: boolean }>({
    active: false,
    startX: 0,
    startY: 0,
    moved: false,
  });

  const activeNode = useMemo(
    () => nodes.find((n) => n.id === (hoveredId ?? selectedId)) ?? nodes[0]!,
    [hoveredId, nodes, selectedId],
  );

  useEffect(() => {
    if (!nodes.some((n) => n.id === selectedId)) {
      const firstRes = nodes.find((n) => n.nodeType === "resident");
      setSelectedId(firstRes?.id ?? "studio-3dj");
    }
  }, [nodes, selectedId]);

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
    ) => {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const rx = wx * cosY - wz * sinY;
      const rz = wx * sinY + wz * cosY;

      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const cy = wy * cosP - rz * sinP;
      const cz = wy * sinP + rz * cosP + 11.2;

      const fov = Math.min(width, height) * 0.92;
      const scale = fov / Math.max(2.5, cz);
      return {
        sx: width * 0.5 + rx * scale,
        sy: height * 0.61 - cy * scale,
        cz,
        scale,
      };
    };

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      if (!reduceMotion && !dragRef.current.active) {
        rotationRef.current.yaw += dt * 0.14;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(280, Math.floor(rect.width));
      const height = Math.max(240, Math.floor(rect.height));
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep Neo-Tokyo night sky backdrop (crisp contrast in both light & dark themes, matching PixelCity)
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#05101b");
      sky.addColorStop(0.62, "#091c2b");
      sky.addColorStop(1, "#040d16");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Subtle horizon glow
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.56, 12, width * 0.5, height * 0.56, width * 0.52);
      glow.addColorStop(0, "rgba(48, 216, 236, 0.16)");
      glow.addColorStop(0.55, "rgba(255, 195, 103, 0.06)");
      glow.addColorStop(1, "rgba(4, 13, 22, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const { yaw, pitch } = rotationRef.current;

      // Ground perspective grid (-5..5)
      ctx.lineWidth = 1;
      for (let g = -5; g <= 5; g += 1) {
        const a = project(g, 0, -5, width, height, yaw, pitch);
        const b = project(g, 0, 5, width, height, yaw, pitch);
        ctx.strokeStyle = g === 0 ? "rgba(48, 216, 236, 0.34)" : "rgba(28, 110, 138, 0.22)";
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();

        const c = project(-5, 0, g, width, height, yaw, pitch);
        const d = project(5, 0, g, width, height, yaw, pitch);
        ctx.beginPath();
        ctx.moveTo(c.sx, c.sy);
        ctx.lineTo(d.sx, d.sy);
        ctx.stroke();
      }

      // Glowing node-link conduits on ground from Sanctuary (0,0) to every tower + animated pulse dot
      const centerBase = project(0, 0.06, 0, width, height, yaw, pitch);
      const tNorm = (now * 0.00045) % 1;
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i]!;
        const targetBase = project(n.x, 0.06, n.z, width, height, yaw, pitch);
        const isFocus = n.id === selectedId || n.id === hoveredId;
        ctx.strokeStyle = hexToRgba(n.color, isFocus ? 0.78 : n.nodeType === "studio" ? 0.42 : 0.24);
        ctx.lineWidth = isFocus ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(centerBase.sx, centerBase.sy);
        ctx.lineTo(targetBase.sx, targetBase.sy);
        ctx.stroke();

        if (!reduceMotion && (isFocus || n.nodeType === "studio" || i % 2 === 0)) {
          const frac = (tNorm + i * 0.17) % 1;
          const px = centerBase.sx + (targetBase.sx - centerBase.sx) * frac;
          const py = centerBase.sy + (targetBase.sy - centerBase.sy) * frac;
          ctx.fillStyle = n.color;
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      }

      // Depth-sort buildings back-to-front (painter's algorithm)
      const sorted = nodes
        .map((node) => {
          const center = project(node.x, node.h * 0.5, node.z, width, height, yaw, pitch);
          return { node, depth: center.cz };
        })
        .sort((a, b) => b.depth - a.depth);

      const nextHits: ProjectedHit[] = [];

      for (const { node } of sorted) {
        const hw = node.w * 0.5;
        const hd = node.d * 0.5;
        const cornersBottom = [
          project(node.x - hw, 0, node.z - hd, width, height, yaw, pitch),
          project(node.x + hw, 0, node.z - hd, width, height, yaw, pitch),
          project(node.x + hw, 0, node.z + hd, width, height, yaw, pitch),
          project(node.x - hw, 0, node.z + hd, width, height, yaw, pitch),
        ];
        const cornersTop = [
          project(node.x - hw, node.h, node.z - hd, width, height, yaw, pitch),
          project(node.x + hw, node.h, node.z - hd, width, height, yaw, pitch),
          project(node.x + hw, node.h, node.z + hd, width, height, yaw, pitch),
          project(node.x - hw, node.h, node.z + hd, width, height, yaw, pitch),
        ];

        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoveredId;
        const active = isSelected || isHovered;

        // Draw the 2 front-facing side walls (those whose midpoint cz is closer than building center)
        const faces = [
          { idx: [0, 1], shade: 0.24 },
          { idx: [1, 2], shade: 0.18 },
          { idx: [2, 3], shade: 0.3 },
          { idx: [3, 0], shade: 0.15 },
        ]
          .map((f) => {
            const [i0, i1] = f.idx as [number, number];
            const midZ = (cornersBottom[i0]!.cz + cornersBottom[i1]!.cz) * 0.5;
            return { ...f, i0, i1, midZ };
          })
          .sort((a, b) => b.midZ - a.midZ);

        // Render all 4 walls back-to-front so geometry is always water-tight at any yaw
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
          ctx.fillStyle = active ? hexToRgba(node.color, f.shade + 0.14) : hexToRgba(node.color, f.shade * 0.72);
          ctx.fill();
          ctx.strokeStyle = hexToRgba(node.color, active ? 0.95 : 0.48);
          ctx.lineWidth = active ? 1.6 : 1;
          ctx.stroke();
        }

        // Roof cap
        ctx.beginPath();
        ctx.moveTo(cornersTop[0]!.sx, cornersTop[0]!.sy);
        ctx.lineTo(cornersTop[1]!.sx, cornersTop[1]!.sy);
        ctx.lineTo(cornersTop[2]!.sx, cornersTop[2]!.sy);
        ctx.lineTo(cornersTop[3]!.sx, cornersTop[3]!.sy);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(node.color, active ? 0.62 : 0.34);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(node.color, active ? 1 : 0.7);
        ctx.stroke();

        // Rooftop antenna / beacon spire
        const roofCenter = project(node.x, node.h, node.z, width, height, yaw, pitch);
        const spireTip = project(
          node.x,
          node.h + (node.nodeType === "studio" ? 0.65 : 0.42),
          node.z,
          width,
          height,
          yaw,
          pitch,
        );
        ctx.strokeStyle = node.color;
        ctx.lineWidth = active ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(roofCenter.sx, roofCenter.sy);
        ctx.lineTo(spireTip.sx, spireTip.sy);
        ctx.stroke();

        ctx.fillStyle = node.color;
        const dotSize = active ? 6 : node.nodeType === "studio" ? 5 : 3.5;
        ctx.fillRect(spireTip.sx - dotSize * 0.5, spireTip.sy - dotSize * 0.5, dotSize, dotSize);

        // Crisp floating label tag for Studio portals, Sanctuary, and the active/hovered Resident
        if (node.nodeType !== "resident" || active) {
          ctx.font = `${active ? "bold " : ""}10px Consolas, SFMono-Regular, monospace`;
          const label = node.nodeType === "studio" ? `◆ ${node.shortLabel}` : node.shortLabel;
          const textW = ctx.measureText(label).width;
          const lx = spireTip.sx - textW * 0.5 - 5;
          const ly = spireTip.sy - 20;
          ctx.fillStyle = active ? "rgba(5, 19, 28, 0.94)" : "rgba(6, 15, 24, 0.82)";
          ctx.fillRect(lx, ly, textW + 10, 15);
          ctx.strokeStyle = hexToRgba(node.color, active ? 0.95 : 0.55);
          ctx.lineWidth = 1;
          ctx.strokeRect(lx, ly, textW + 10, 15);
          ctx.fillStyle = active ? "#ffffff" : node.color;
          ctx.fillText(label, lx + 5, ly + 10.5);
        }

        const allPts = [...cornersBottom, ...cornersTop, spireTip];
        const xs = allPts.map((p) => p.sx);
        const ys = allPts.map((p) => p.sy);
        nextHits.push({
          id: node.id,
          cx: roofCenter.sx,
          cy: roofCenter.sy,
          minX: Math.min(...xs) - 6,
          maxX: Math.max(...xs) + 6,
          minY: Math.min(...ys) - 18,
          maxY: Math.max(...ys) + 6,
          depth: roofCenter.cz,
        });
      }

      // Frontmost hit wins on pointer click/hover
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
  }, [hoveredId, nodes, selectedId]);

  const hitAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const h of hitsRef.current) {
      if (x >= h.minX && x <= h.maxX && y >= h.minY && y <= h.maxY) {
        return h.id;
      }
    }
    return null;
  };

  return (
    <div className="border border-border bg-[#06111c] text-[#eff1e9] shadow-[5px_5px_0_color-mix(in_srgb,var(--primary)_12%,transparent)]">
      <div className="relative h-[300px] w-full select-none sm:h-[340px]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Interactive 3D Sanctuary map showing live resident towers and connected Neural Deep Agentic Studios"
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={(e) => {
            dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragRef.current.active) {
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
              rotationRef.current.yaw += dx * 0.008;
              rotationRef.current.pitch = Math.max(0.24, Math.min(0.95, rotationRef.current.pitch + dy * 0.005));
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
              if (hit) setSelectedId(hit);
            }
          }}
          onPointerLeave={() => {
            dragRef.current.active = false;
            setHoveredId(null);
          }}
        />
        <div className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 border border-[#29404e] bg-[#06111c]/90 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#9caeba]">
          <Orbit className="h-3 w-3 text-[#30d8ec]" aria-hidden="true" />
          Drag to orbit · Tap any 3D beacon
        </div>
      </div>

      {/* Selected 3D Node Action Bar */}
      <div className="border-t border-[#203646] bg-[#081724] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
              <span
                className="inline-block h-2 w-2 shrink-0"
                style={{ backgroundColor: activeNode.color }}
                aria-hidden="true"
              />
              <span className="text-[#30d8ec]">
                {activeNode.nodeType === "studio"
                  ? "Connected Agentic Studio"
                  : activeNode.nodeType === "resident"
                    ? `${activeNode.residentKind} tower`
                    : "District Core"}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-xs font-semibold text-white">{activeNode.label}</p>
            <p className="mt-0.5 line-clamp-1 text-xs text-[#9caeba]">{activeNode.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            {activeNode.nodeType === "resident" && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectResident?.(activeNode.slug)}
                  className="inline-flex min-h-8 items-center gap-1 border border-[#30d8ec]/60 bg-[#30d8ec]/15 px-2.5 py-1 uppercase tracking-wider text-[#30d8ec] hover:bg-[#30d8ec] hover:text-[#05131c]"
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Ask free
                </button>
                <button
                  type="button"
                  onClick={() => onSelectChain?.("cad-to-3dj", activeNode.slug)}
                  className="inline-flex min-h-8 items-center gap-1 border border-[#29404e] px-2.5 py-1 uppercase tracking-wider text-[#eff1e9] hover:border-[#30d8ec]"
                >
                  Node chain <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </button>
                <a
                  href={href(`/r/${activeNode.slug}`)}
                  className="inline-flex min-h-8 items-center px-2 py-1 uppercase tracking-wider text-[#9caeba] hover:text-white"
                >
                  Résumé →
                </a>
              </>
            )}

            {activeNode.nodeType === "studio" && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectChain?.(activeNode.chainId)}
                  className="inline-flex min-h-8 items-center gap-1 border border-[#29404e] px-2.5 py-1 uppercase tracking-wider text-[#eff1e9] hover:border-[#30d8ec]"
                >
                  Chain w/ nodes <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </button>
                <a
                  href={activeNode.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 border border-[#30d8ec]/60 bg-[#30d8ec] px-2.5 py-1 font-semibold uppercase tracking-wider text-[#05131c] hover:opacity-90"
                >
                  Open Studio <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </a>
              </>
            )}

            {activeNode.nodeType === "sanctuary" && (
              <button
                type="button"
                onClick={() => onSelectChain?.("cad-to-3dj")}
                className="inline-flex min-h-8 items-center gap-1 border border-[#ffc367]/60 bg-[#ffc367]/15 px-2.5 py-1 uppercase tracking-wider text-[#ffc367] hover:bg-[#ffc367] hover:text-[#05131c]"
              >
                Launch Node Workbench <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Accessible keyboard selector strip for Studio & Resident beacons */}
        <div
          className="mt-2.5 flex items-center gap-1 overflow-x-auto pb-0.5 font-mono text-[10px] [&>*]:shrink-0"
          role="toolbar"
          aria-label="Select 3D district beacon"
        >
          {nodes.slice(0, 9).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSelectedId(n.id)}
              aria-pressed={selectedId === n.id}
              className={cn(
                "min-h-7 border px-2 py-0.5 uppercase tracking-wider",
                selectedId === n.id
                  ? "border-[#30d8ec] bg-[#30d8ec]/20 text-white"
                  : "border-[#203646] bg-[#06111c] text-[#9caeba] hover:border-[#30d8ec]/60 hover:text-white",
              )}
            >
              {n.nodeType === "studio" ? `◆ ${n.shortLabel}` : n.shortLabel}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
