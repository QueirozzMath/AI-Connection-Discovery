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

import { exportMapCanvas, type MapCommand, type MapTool } from "@/lib/map-navigation";

interface Props {
  command?: MapCommand;
  tool?: MapTool;
  onHover?: (node: number | null) => void;
  graph: ScienceGraph;
  layout: "force" | "hierarchy";
  highlight?: MapHighlight | null;
  matches?: Set<number> | null;
  showUnselected?: boolean;
  focusRequest?: number;
  seeds?: Set<number>;
  colorMode: "category" | "degree" | "growth";
  showEdges: boolean;
  onSelect: (node: number | null) => void;
  selected: number | null;
}

export function ScienceMap({
  command,
  tool = "navigate",
  onHover,
  graph,
  layout,
  highlight,
  matches,
  showUnselected = true,
  focusRequest = 0,
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

  const lastHover = useRef<number | null>(null);
  const publishHover = (node: number | null) => {
    if (lastHover.current !== node) {
      lastHover.current = node;
      onHover?.(node);
    }
  };
  const maxDeg = useMemo(() => graph.nodes.reduce((m, n) => Math.max(m, n.deg), 1), [graph]);

  const X = useCallback(
    (i: number) => (layout === "hierarchy" ? graph.nodes[i]!.hx : graph.nodes[i]!.x),
    [graph, layout],
  );
  const Y = useCallback(
    (i: number) => (layout === "hierarchy" ? graph.nodes[i]!.hy : graph.nodes[i]!.y),
    [graph, layout],
  );

  const visibleEdges = useMemo(
    () =>
      matches ? graph.edges.filter(([a, b]) => matches.has(a) && matches.has(b)) : graph.edges,
    [graph, matches],
  );
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
      const limit = Math.min(visibleEdges.length, v.scale > 12 ? 25000 : 15000);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(140,180,220,0.08)";
      ctx.beginPath();
      for (let e = 0; e < limit; e++) {
        const [a, b] = visibleEdges[e]!;
        if (matches && (!matches.has(a) || !matches.has(b))) continue;
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(b), py(b));
      }
      ctx.stroke();
    }

    for (let i = 0; i < graph.nodes.length; i++) {
      if (matches && !showUnselected && !matches.has(i)) continue;
      const n = graph.nodes[i]!;
      const cx = px(i);
      const cy = py(i);
      if (cx < -20 || cy < -20 || cx > w + 20 || cy > h + 20) continue;
      const r = Math.max(
        1.1,
        Math.min(9, 1 + Math.log1p(n.pubs) * 0.65) * 0.7 * Math.min(2.4, v.scale / 3),
      );

      let alpha = 0.85;
      let color = catColor(n.cat);
      if (colorMode === "degree") {
        const t = Math.min(1, n.deg / (maxDeg * 0.4));
        color = `hsl(${200 - t * 160}, 85%, ${45 + t * 20}%)`;
      } else if (colorMode === "growth") {
        const t = Math.max(0, Math.min(1, (n.growth + 1) / 2));
        color = `hsl(${20 + t * 140}, 80%, ${45 + t * 15}%)`;
      }
      if (matches) alpha = matches.has(i) ? 1 : 0.07;
      if (seeds?.has(i) && (!matches || matches.has(i))) alpha = 1;

      ctx.globalAlpha = alpha;
      if (colorMode === "growth" && (n.growthAvailable === false || !Number.isFinite(n.growth)))
        color = "#9aa4b8";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, seeds?.has(i) ? r + 2.5 : r, 0, Math.PI * 2);
      ctx.fill();
      if (seeds?.has(i) && (!matches || matches.has(i))) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (highlight && (!matches || (matches.has(highlight.a) && matches.has(highlight.c)))) {
      const { a, c } = highlight;
      for (const b of highlight.bridges ?? []) {
        if (matches && !matches.has(b)) continue;
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

    const labelCount = v.scale > 6 ? 65 : 20;
    const occupied = new Set<string>();
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(226,236,250,0.72)";
    let drawn = 0;
    for (let i = 0; i < graph.nodes.length && drawn < labelCount; i++) {
      const cx = px(i);
      const cy = py(i);
      if (cx < 0 || cy < 0 || cx > w || cy > h) continue;
      if (matches && !matches.has(i)) continue;
      const cell = `${Math.floor(cx / 130)},${Math.floor(cy / 24)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      ctx.fillText(graph.nodes[i]!.label, cx + 6, cy - 5);
      drawn++;
    }

    if (selected != null && (!matches || matches.has(selected)) && graph.nodes[selected]) {
      ctx.beginPath();
      ctx.arc(px(selected), py(selected), 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [
    graph,
    visibleEdges,
    showUnselected,
    showEdges,
    colorMode,
    matches,
    seeds,
    maxDeg,
    highlight,
    selected,
    X,
    Y,
  ]);

  const handledCommand = useRef(command?.sequence);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const fitView = useCallback(
    (global = false) => {
      const wrap = wrapRef.current;
      if (!wrap || (!global && matches?.size === 0) || !graph.nodes.length) return;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let i = 0; i < graph.nodes.length; i++) {
        if (!global && matches && !matches.has(i)) continue;
        minX = Math.min(minX, X(i));
        maxX = Math.max(maxX, X(i));
        minY = Math.min(minY, Y(i));
        maxY = Math.max(maxY, Y(i));
      }
      const scale = Math.min(
        25,
        Math.max(
          0.1,
          Math.min(
            (wrap.clientWidth * 0.82) / Math.max(12, maxX - minX),
            (wrap.clientHeight * 0.78) / Math.max(12, maxY - minY),
          ),
        ),
      );
      viewRef.current = {
        scale,
        tx: (-(minX + maxX) / 2) * scale,
        ty: (-(minY + maxY) / 2) * scale,
      };
      setHover(null);
      drawRef.current();
    },
    [graph, matches, X, Y],
  );
  useEffect(() => {
    fitView();
  }, [fitView, layout, focusRequest]);

  useEffect(() => {
    if (!command || handledCommand.current === command.sequence) return;
    handledCommand.current = command.sequence;
    if (command.action === "export") {
      exportMapCanvas(canvasRef.current);
      return;
    }
    if (command.action === "fit" || command.action === "reset") {
      fitView(command.action === "reset");
      return;
    }
    const v = viewRef.current;
    const scale = Math.min(
      400,
      Math.max(0.1, v.scale * (command.action === "zoom-in" ? 1.35 : 1 / 1.35)),
    );
    const factor = scale / v.scale;
    viewRef.current = { scale, tx: v.tx * factor, ty: v.ty * factor };
    drawRef.current();
  }, [command, fitView]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    const observer = new ResizeObserver(onResize);
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [draw]);

  // foca a conexão selecionada
  useEffect(() => {
    if (!highlight || (matches && (!matches.has(highlight.a) || !matches.has(highlight.c)))) return;
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
  }, [highlight, draw, X, Y, matches]);

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
      if (matches && !matches.has(i)) continue;
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

  const [region, setRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => {
        const v = viewRef.current;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const rect = wrapRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const ns = Math.min(400, Math.max(0.1, v.scale * factor));
        const k = ns / v.scale;
        viewRef.current = { scale: ns, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
        draw();
      }}
      onPointerDown={(e) => {
        setHover(null);
        publishHover(null);
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
          if (tool === "region") {
            const rect = wrapRef.current!.getBoundingClientRect();
            setRegion({
              x: Math.min(d.x, e.clientX) - rect.left,
              y: Math.min(d.y, e.clientY) - rect.top,
              w: Math.abs(e.clientX - d.x),
              h: Math.abs(e.clientY - d.y),
            });
            return;
          }
          viewRef.current = {
            ...viewRef.current,
            tx: d.tx + (e.clientX - d.x),
            ty: d.ty + (e.clientY - d.y),
          };
          draw();
          return;
        }
        const i = pick(e.clientX, e.clientY);
        publishHover(i);
        const rect = wrapRef.current!.getBoundingClientRect();
        setHover(i == null ? null : { i, x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (tool === "region" && region && region.w > 8 && region.h > 8) {
          const wrap = wrapRef.current!;
          const v = viewRef.current;
          const x = (region.x + region.w / 2 - wrap.clientWidth / 2 - v.tx) / v.scale;
          const y = (region.y + region.h / 2 - wrap.clientHeight / 2 - v.ty) / v.scale;
          const scale = Math.min(
            400,
            v.scale * Math.min(wrap.clientWidth / region.w, wrap.clientHeight / region.h) * 0.85,
          );
          viewRef.current = { scale, tx: -x * scale, ty: -y * scale };
          setRegion(null);
          draw();
          return;
        }
        setRegion(null);
        if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {
          onSelect(pick(e.clientX, e.clientY));
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setRegion(null);
        setHover(null);
        publishHover(null);
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        setRegion(null);
        setHover(null);
        publishHover(null);
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {region && (
        <div
          className="pointer-events-none absolute border border-primary bg-primary/10"
          style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
        />
      )}
      {!onHover && hover && (!matches || matches.has(hover.i)) && graph.nodes[hover.i] && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-panel backdrop-blur"
          style={{
            left: Math.max(4, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 300) - 264)),
            top: Math.max(4, Math.min(hover.y + 14, (wrapRef.current?.clientHeight ?? 200) - 140)),
          }}
        >
          <p className="font-display text-sm font-semibold text-foreground">
            {graph.nodes[hover.i]!.label}
          </p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.id} ·{" "}
            {graph.categories.find((c) => c.id === graph.nodes[hover.i]!.cat)?.label ??
              graph.nodes[hover.i]!.cat}
          </p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.deg} conexões · {graph.nodes[hover.i]!.pubs} artigos · ramo{" "}
            {graph.nodes[hover.i]!.cat}
            {graph.nodes[hover.i]!.tree ? ` · ${graph.nodes[hover.i]!.tree}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Índice de crescimento:{" "}
            {graph.nodes[hover.i]!.growthAvailable !== false &&
            Number.isFinite(graph.nodes[hover.i]!.growth)
              ? graph.nodes[hover.i]!.growth.toFixed(3)
              : "indisponível"}
          </p>
        </div>
      )}
    </div>
  );
}
