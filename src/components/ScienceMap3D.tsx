import { useCallback, useEffect, useRef, useState } from "react";
import { catColor, type ScienceGraph } from "@/lib/science-data";
import type { MapHighlight } from "./ScienceMap";

interface Props {
  graph: ScienceGraph;
  highlight?: MapHighlight | null;
  matches?: Set<number> | null;
  seeds?: Set<number>;
  showEdges: boolean;
  autoRotate: boolean;
  onSelect: (node: number | null) => void;
  selected: number | null;
}

/** Renderizador 3D em canvas: projeção em perspectiva com rotação por arrasto. */
export function ScienceMap3D({
  graph,
  highlight,
  matches,
  seeds,
  showEdges,
  autoRotate,
  onSelect,
  selected,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef({ yaw: 0.6, pitch: 0.35, dist: 330 });
  const projRef = useRef<Float32Array>(new Float32Array(0));
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { yaw, pitch, dist } = camRef.current;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const n = graph.nodes.length;
    if (projRef.current.length !== n * 3) projRef.current = new Float32Array(n * 3);
    const P = projRef.current;
    const f = Math.min(w, h) * 1.15;

    for (let i = 0; i < n; i++) {
      const nd = graph.nodes[i]!;
      const x1 = nd.x * cy + nd.z * sy;
      const z1 = -nd.x * sy + nd.z * cy;
      const y1 = nd.y * cp - z1 * sp;
      const z2 = nd.y * sp + z1 * cp + dist;
      const k = z2 > 1 ? f / z2 : 0;
      P[i * 3] = x1 * k + w / 2;
      P[i * 3 + 1] = y1 * k + h / 2;
      P[i * 3 + 2] = z2;
    }

    if (showEdges) {
      const limit = Math.min(graph.edges.length, 12000);
      ctx.strokeStyle = "rgba(140,190,235,0.07)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let e = 0; e < limit; e++) {
        const [a, b] = graph.edges[e]!;
        if (P[a * 3 + 2] <= 1 || P[b * 3 + 2] <= 1) continue;
        ctx.moveTo(P[a * 3], P[a * 3 + 1]);
        ctx.lineTo(P[b * 3], P[b * 3 + 1]);
      }
      ctx.stroke();
    }

    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => P[b * 3 + 2] - P[a * 3 + 2],
    );
    for (const i of order) {
      const z = P[i * 3 + 2];
      if (z <= 1) continue;
      const nd = graph.nodes[i]!;
      const depth = Math.max(0.15, Math.min(1, 420 / z));
      const r = Math.max(0.9, Math.sqrt(nd.deg) * 0.5 * depth);
      let alpha = 0.35 + 0.6 * depth;
      if (matches && matches.size) alpha = matches.has(i) ? 1 : 0.05;
      if (seeds?.has(i)) alpha = 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = catColor(nd.cat);
      ctx.beginPath();
      ctx.arc(P[i * 3], P[i * 3 + 1], seeds?.has(i) ? r + 2 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (highlight) {
      const { a, c } = highlight;
      for (const b of highlight.bridges ?? []) {
        ctx.strokeStyle = "rgba(126,230,168,0.45)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(P[a * 3], P[a * 3 + 1]);
        ctx.lineTo(P[b * 3], P[b * 3 + 1]);
        ctx.lineTo(P[c * 3], P[c * 3 + 1]);
        ctx.stroke();
      }
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = highlight.confirmed ? "#ffc46b" : "#5ad1e6";
      ctx.shadowBlur = 14;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(P[a * 3], P[a * 3 + 1]);
      ctx.lineTo(P[c * 3], P[c * 3 + 1]);
      ctx.stroke();
      ctx.restore();
      for (const i of [a, c]) {
        ctx.beginPath();
        ctx.arc(P[i * 3], P[i * 3 + 1], 5, 0, Math.PI * 2);
        ctx.fillStyle = highlight.confirmed ? "#ffc46b" : "#5ad1e6";
        ctx.fill();
        ctx.font = "600 12px 'Space Grotesk', sans-serif";
        ctx.fillStyle = "rgba(240,246,255,0.95)";
        ctx.fillText(graph.nodes[i]!.label, P[i * 3] + 9, P[i * 3 + 1] - 7);
      }
    }

    // rótulos: apenas nós em destaque ou de maior grau
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(226,236,250,0.7)";
    let drawn = 0;
    for (let i = 0; i < n && drawn < 90; i++) {
      if (matches && matches.size && !matches.has(i)) continue;
      if (P[i * 3 + 2] <= 1) continue;
      ctx.fillText(graph.nodes[i]!.label, P[i * 3] + 6, P[i * 3 + 1] - 5);
      drawn++;
    }

    if (selected != null && P[selected * 3 + 2] > 1) {
      ctx.beginPath();
      ctx.arc(P[selected * 3], P[selected * 3 + 1], 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }, [graph, showEdges, matches, seeds, highlight, selected]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    const tick = () => {
      camRef.current.yaw += 0.0025;
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, draw]);

  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const pick = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    const P = projRef.current;
    if (!wrap || !P.length) return null;
    const rect = wrap.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best: number | null = null;
    let bestD = 12 * 12;
    for (let i = 0; i < graph.nodes.length; i++) {
      if (P[i * 3 + 2] <= 1) continue;
      const dx = P[i * 3] - mx;
      const dy = P[i * 3 + 1] - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => {
        camRef.current.dist = Math.min(1600, Math.max(60, camRef.current.dist * Math.exp(e.deltaY * 0.0012)));
        draw();
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: camRef.current.yaw,
          pitch: camRef.current.pitch,
        };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d) {
          camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
          camRef.current.pitch = Math.max(
            -1.4,
            Math.min(1.4, d.pitch + (e.clientY - d.y) * 0.006),
          );
          draw();
          return;
        }
        const i = pick(e.clientX, e.clientY);
        const rect = wrapRef.current!.getBoundingClientRect();
        setHover(i == null ? null : { i, x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {
          onSelect(pick(e.clientX, e.clientY));
        }
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        setHover(null);
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {hover && graph.nodes[hover.i] && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-panel backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <p className="font-display text-sm font-semibold">{graph.nodes[hover.i]!.label}</p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.deg} conexões · {graph.nodes[hover.i]!.pubs} artigos
          </p>
        </div>
      )}
    </div>
  );
}
