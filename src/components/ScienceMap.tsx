import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catColor, type Candidate, type ScienceGraph } from "@/lib/science-data";

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface Props {
  graph: ScienceGraph;
  highlight?: Candidate | null;
  query: string;
  colorMode: "category" | "degree" | "candidates";
  showEdges: boolean;
  onSelect: (node: number | null) => void;
  selected: number | null;
}

export function ScienceMap({
  graph,
  highlight,
  query,
  colorMode,
  showEdges,
  onSelect,
  selected,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ scale: 90, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [, forceRender] = useState(0);

  const maxDeg = useMemo(
    () => graph.nodes.reduce((m, n) => Math.max(m, n.deg), 1),
    [graph],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<number>();
    graph.nodes.forEach((n, i) => {
      if (n.label.toLowerCase().includes(q)) set.add(i);
    });
    return set;
  }, [graph, query]);

  const candidateNodes = useMemo(() => {
    if (!highlight) return null;
    const set = new Set<number>();
    if (highlight.a_idx != null) set.add(highlight.a_idx);
    if (highlight.c_idx != null) set.add(highlight.c_idx);
    return set;
  }, [highlight]);

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
    const px = (x: number) => x * v.scale + v.tx + w / 2;
    const py = (y: number) => y * v.scale + v.ty + h / 2;

    // arestas de backbone
    if (showEdges) {
      const limit = v.scale > 220 ? graph.edges.length : Math.min(graph.edges.length, 12000);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(140,180,220,0.09)";
      ctx.beginPath();
      for (let e = 0; e < limit; e++) {
        const [a, b] = graph.edges[e]!;
        const na = graph.nodes[a]!;
        const nb = graph.nodes[b]!;
        ctx.moveTo(px(na.x), py(na.y));
        ctx.lineTo(px(nb.x), py(nb.y));
      }
      ctx.stroke();
    }

    // nos
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i]!;
      const X = px(n.x);
      const Y = py(n.y);
      if (X < -20 || Y < -20 || X > w + 20 || Y > h + 20) continue;
      const r = Math.max(1.1, Math.sqrt(n.deg) * 0.42 * Math.min(2.4, v.scale / 90));

      let alpha = 0.85;
      let color = catColor(n.cat);
      if (colorMode === "degree") {
        const t = Math.min(1, n.deg / (maxDeg * 0.4));
        color = `hsl(${200 - t * 160}, 85%, ${45 + t * 20}%)`;
      }
      if (matches) alpha = matches.has(i) ? 1 : 0.08;
      if (colorMode === "candidates" && candidateNodes && !candidateNodes.has(i)) alpha *= 0.25;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // conexao candidata inferida
    if (highlight && highlight.a_idx != null && highlight.c_idx != null) {
      const a = graph.nodes[highlight.a_idx];
      const c = graph.nodes[highlight.c_idx];
      if (a && c) {
        const x1 = px(a.x);
        const y1 = py(a.y);
        const x2 = px(c.x);
        const y2 = py(c.y);
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
          [x1, y1, a.label],
          [x2, y2, c.label],
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
    }

    // rotulos dos maiores nos visiveis
    const labelCount = v.scale > 160 ? 220 : 60;
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(226,236,250,0.72)";
    let drawn = 0;
    for (let i = 0; i < graph.nodes.length && drawn < labelCount; i++) {
      const n = graph.nodes[i]!;
      const X = px(n.x);
      const Y = py(n.y);
      if (X < 0 || Y < 0 || X > w || Y > h) continue;
      if (matches && !matches.has(i)) continue;
      ctx.fillText(n.label, X + 6, Y - 5);
      drawn++;
    }

    if (selected != null) {
      const n = graph.nodes[selected];
      if (n) {
        ctx.beginPath();
        ctx.arc(px(n.x), py(n.y), 9, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [graph, showEdges, colorMode, matches, maxDeg, highlight, candidateNodes, selected]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // foca a conexao selecionada
  useEffect(() => {
    if (!highlight || highlight.a_idx == null || highlight.c_idx == null) return;
    const a = graph.nodes[highlight.a_idx];
    const c = graph.nodes[highlight.c_idx];
    const wrap = wrapRef.current;
    if (!a || !c || !wrap) return;
    const cx = (a.x + c.x) / 2;
    const cy = (a.y + c.y) / 2;
    const span = Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y), 0.6);
    const scale = Math.min(320, (Math.min(wrap.clientWidth, wrap.clientHeight) * 0.6) / span);
    viewRef.current = { scale, tx: -cx * scale, ty: -cy * scale };
    draw();
  }, [highlight, graph, draw]);

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
      const n = graph.nodes[i]!;
      const dx = n.x * v.scale + v.tx + rect.width / 2 - mx;
      const dy = n.y * v.scale + v.ty + rect.height / 2 - my;
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
        const ns = Math.min(4000, Math.max(20, v.scale * factor));
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
        forceRender((n) => n + 1);
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
            {graph.nodes[hover.i]!.deg} conexões · {graph.nodes[hover.i]!.pubs} artigos ·{" "}
            ramo {graph.nodes[hover.i]!.cat}
          </p>
        </div>
      )}
    </div>
  );
}
