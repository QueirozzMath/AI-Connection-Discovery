import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catColor, type ScienceGraph } from "@/lib/science-data";

interface View {
  scale: number;
  tx: number;
  ty: number;
}

export interface MapHighlight {
  a: number;
  c: number;
  bridges?: number[];
  confirmed?: boolean;
}

interface Props {
  graph: ScienceGraph;
  layout: "force" | "hierarchy";
  highlight?: MapHighlight | null;
  matches?: Set<number> | null;
  seeds?: Set<number>;
  colorMode: "category" | "degree" | "growth";
  showEdges: boolean;
  onSelect: (node: number | null) => void;
  selected: number | null;
}

export function ScienceMap({
  graph,
  layout,
  highlight,
  matches,
  seeds,
  colorMode,
  showEdges,
  onSelect,
  selected,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ scale: 3, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const maxDeg = useMemo(() => graph.nodes.reduce((m, n) => Math.max(m, n.deg), 1), [graph]);

  const X = useCallback(
    (i: number) => (layout === "hierarchy" ? graph.nodes[i]!.hx : graph.nodes[i]!.x),
    [graph, layout],
  );
  const Y = useCallback(
    (i: number) => (layout === "hierarchy" ? graph.nodes[i]!.hy : graph.nodes[i]!.y),
    [graph, layout],
  );

  // reenquadra ao trocar de layout ou de grafo
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let span = 1;
    for (let i = 0; i < graph.nodes.length; i++)
      span = Math.max(span, Math.abs(X(i)), Math.abs(Y(i)));
    const scale = (Math.min(wrap.clientWidth, wrap.clientHeight) * 0.46) / span;
    viewRef.current = { scale, tx: 0, ty: 0 };
  }, [graph, layout, X, Y]);

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

    const v = viewRef.current;
    const px = (i: number) => X(i) * v.scale + v.tx + w / 2;
    const py = (i: number) => Y(i) * v.scale + v.ty + h / 2;

    if (showEdges) {
      const limit = v.scale > 12 ? graph.edges.length : Math.min(graph.edges.length, 15000);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(140,180,220,0.08)";
      ctx.beginPath();
      for (let e = 0; e < limit; e++) {
        const [a, b] = graph.edges[e]!;
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(b), py(b));
      }
      ctx.stroke();
    }

    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i]!;
      const cx = px(i);
      const cy = py(i);
      if (cx < -20 || cy < -20 || cx > w + 20 || cy > h + 20) continue;
      const r = Math.max(1.1, Math.sqrt(n.deg) * 0.42 * Math.min(2.4, v.scale / 3));

      let alpha = 0.85;
      let color = catColor(n.cat);
      if (colorMode === "degree") {
        const t = Math.min(1, n.deg / (maxDeg * 0.4));
        color = `hsl(${200 - t * 160}, 85%, ${45 + t * 20}%)`;
      } else if (colorMode === "growth") {
        const t = Math.max(0, Math.min(1, (n.growth + 1) / 2));
        color = `hsl(${20 + t * 140}, 80%, ${45 + t * 15}%)`;
      }
      if (matches && matches.size) alpha = matches.has(i) ? 1 : 0.07;
      if (seeds?.has(i)) alpha = 1;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, seeds?.has(i) ? r + 2.5 : r, 0, Math.PI * 2);
      ctx.fill();
      if (seeds?.has(i)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (highlight) {
      const { a, c } = highlight;
      for (const b of highlight.bridges ?? []) {
        ctx.strokeStyle = "rgba(126,230,168,0.5)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(b), py(b));
        ctx.lineTo(px(c), py(c));
        ctx.stroke();
      }
      const x1 = px(a);
      const y1 = py(a);
      const x2 = px(c);
      const y2 = py(c);
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = highlight.confirmed ? "#ffc46b" : "#5ad1e6";
      ctx.shadowBlur = 14;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - 70, x2, y2);
      ctx.stroke();
      ctx.restore();
      for (const [x, y, label] of [
        [x1, y1, graph.nodes[a]!.label],
        [x2, y2, graph.nodes[c]!.label],
      ] as [number, number, string][]) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = highlight.confirmed ? "#ffc46b" : "#5ad1e6";
        ctx.fill();
        ctx.font = "600 12px 'Space Grotesk', sans-serif";
        ctx.fillStyle = "rgba(240,246,255,0.95)";
        ctx.fillText(label, x + 10, y - 8);
      }
    }

    const labelCount = v.scale > 6 ? 260 : 70;
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(226,236,250,0.72)";
    let drawn = 0;
    for (let i = 0; i < graph.nodes.length && drawn < labelCount; i++) {
      const cx = px(i);
      const cy = py(i);
      if (cx < 0 || cy < 0 || cx > w || cy > h) continue;
      if (matches && matches.size && !matches.has(i)) continue;
      ctx.fillText(graph.nodes[i]!.label, cx + 6, cy - 5);
      drawn++;
    }

    if (selected != null && graph.nodes[selected]) {
      ctx.beginPath();
      ctx.arc(px(selected), py(selected), 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [graph, showEdges, colorMode, matches, seeds, maxDeg, highlight, selected, X, Y]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // foca a conexão selecionada
  useEffect(() => {
    if (!highlight) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cx = (X(highlight.a) + X(highlight.c)) / 2;
    const cy = (Y(highlight.a) + Y(highlight.c)) / 2;
    const span = Math.max(
      Math.abs(X(highlight.a) - X(highlight.c)),
      Math.abs(Y(highlight.a) - Y(highlight.c)),
      8,
    );
    const scale = Math.min(60, (Math.min(wrap.clientWidth, wrap.clientHeight) * 0.7) / span);
    viewRef.current = { scale, tx: -cx * scale, ty: -cy * scale };
    draw();
  }, [highlight, draw, X, Y]);

  const pick = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const v = viewRef.current;
    let best: number | null = null;
    let bestD = 14 * 14;
    for (let i = 0; i < graph.nodes.length; i++) {
      const dx = X(i) * v.scale + v.tx + rect.width / 2 - mx;
      const dy = Y(i) * v.scale + v.ty + rect.height / 2 - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => {
        const v = viewRef.current;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const rect = wrapRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const ns = Math.min(400, Math.max(0.6, v.scale * factor));
        const k = ns / v.scale;
        viewRef.current = { scale: ns, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
        draw();
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          tx: viewRef.current.tx,
          ty: viewRef.current.ty,
        };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d) {
          viewRef.current = {
            ...viewRef.current,
            tx: d.tx + (e.clientX - d.x),
            ty: d.ty + (e.clientY - d.y),
          };
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
          <p className="font-display text-sm font-semibold text-foreground">
            {graph.nodes[hover.i]!.label}
          </p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.deg} conexões · {graph.nodes[hover.i]!.pubs} artigos · ramo{" "}
            {graph.nodes[hover.i]!.cat}
            {graph.nodes[hover.i]!.tree ? ` · ${graph.nodes[hover.i]!.tree}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
