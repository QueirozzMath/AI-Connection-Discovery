import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catColor, type ScienceGraph } from "@/lib/science-data";
import { categoryLayers } from "@/lib/map-layers";
import type { MapHighlight } from "./ScienceMap";

import { exportMapCanvas, type MapCommand, type MapTool } from "@/lib/map-navigation";

interface Props {
  theme?: "light" | "dark";
  accent?: string;
  command?: MapCommand;
  tool?: MapTool;
  onHover?: (node: number | null) => void;
  graph: ScienceGraph;
  highlight?: MapHighlight | null;
  matches?: Set<number> | null;
  showUnselected?: boolean;
  focusRequest?: number;
  seeds?: Set<number>;
  showEdges: boolean;
  autoRotate: boolean;
  colorMode?: "category" | "degree" | "growth";
  onSelect: (node: number | null) => void;
  selected: number | null;
}

/** Renderizador 3D em canvas: projeção em perspectiva com rotação por arrasto. */
export function ScienceMap3D({
  theme = "dark",
  accent,
  command,
  tool = "navigate",
  onHover,
  graph: sourceGraph,
  highlight,
  matches,
  showUnselected = true,
  focusRequest = 0,
  seeds,
  showEdges,
  autoRotate,
  colorMode = "category",
  onSelect,
  selected,
}: Props) {
  const { graph, layers } = useMemo(() => categoryLayers(sourceGraph), [sourceGraph]);
  const primaryColor = accent || (theme === "light" ? "#086879" : "#5ad1e6");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef({ yaw: 0.25, pitch: 0.6, dist: 330, x: 0, y: 0, z: 0, tx: 0, ty: 0 });
  const projRef = useRef<Float32Array>(new Float32Array(0));
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const lastHover = useRef<number | null>(null);
  const publishHover = (node: number | null) => {
    if (lastHover.current !== node) {
      lastHover.current = node;
      onHover?.(node);
    }
  };
  const maxDeg = useMemo(
    () => graph.nodes.reduce((max, node) => Math.max(max, node.deg), 1),
    [graph],
  );
  const visibleEdges = useMemo(
    () =>
      matches ? graph.edges.filter(([a, b]) => matches.has(a) && matches.has(b)) : graph.edges,
    [graph, matches],
  );
  const layerVisibility = useMemo(
    () => new Set(graph.nodes.filter((_, i) => !matches || matches.has(i)).map((n) => n.cat)),
    [graph, matches],
  );
  const focusEdges = useMemo(
    () =>
      selected == null
        ? []
        : visibleEdges
            .filter(([a, b]) => a === selected || b === selected)
            .sort((a, b) => b[2] - a[2]),
    [selected, visibleEdges],
  );
  const focusNodes = useMemo(() => new Set(focusEdges.flatMap(([a, b]) => [a, b])), [focusEdges]);
  const order = useMemo(
    () => Int32Array.from({ length: graph.nodes.length }, (_, i) => i),
    [graph],
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

    const { yaw, pitch, dist } = camRef.current;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const n = graph.nodes.length;
    if (projRef.current.length !== n * 3) projRef.current = new Float32Array(n * 3);
    const P = projRef.current;
    const f = Math.min(w, h) * 1.15;

    const project = (x: number, y: number, z: number): [number, number, number] => {
      const x1 = (x - camRef.current.x) * cy + (y - camRef.current.y) * sy;
      const z1 = -(x - camRef.current.x) * sy + (y - camRef.current.y) * cy;
      const y1 = -(z - camRef.current.z) * cp - z1 * sp;
      const z2 = -(z - camRef.current.z) * sp + z1 * cp + dist;
      const k = z2 > 1 ? f / z2 : 0;
      return [x1 * k + w / 2 + camRef.current.tx, y1 * k + h / 2 + camRef.current.ty, z2];
    };
    // A bounded number of semantic planes, independent of the number of articles.
    for (const layer of layers) {
      if (!layerVisibility.has(layer.id)) continue;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => project(x! * layer.span, y! * layer.span, layer.z));
      if (corners.some((point) => point[2] <= 1)) continue;
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = catColor(layer.id);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = catColor(layer.id);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = catColor(layer.id);
      ctx.font = "500 10px sans-serif";
      ctx.fillText(layer.label, corners[0]![0], corners[0]![1] - 4);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      const nd = graph.nodes[i]!;
      const [x, y, z] = project(nd.x, nd.y, nd.z);
      P[i * 3] = x;
      P[i * 3 + 1] = y;
      P[i * 3 + 2] = z;
    }

    if (showEdges) {
      const limit = Math.min(visibleEdges.length, selected == null ? 4500 : 1000);
      ctx.strokeStyle =
        theme === "light"
          ? selected == null
            ? "rgba(45,75,105,0.18)"
            : "rgba(45,75,105,0.04)"
          : selected == null
            ? "rgba(140,190,235,0.13)"
            : "rgba(140,190,235,0.03)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let e = 0; e < limit; e++) {
        const [a, b] = visibleEdges[e]!;
        if (matches && (!matches.has(a) || !matches.has(b))) continue;
        if (P[a * 3 + 2]! <= 1 || P[b * 3 + 2]! <= 1) continue;
        ctx.moveTo(P[a * 3]!, P[a * 3 + 1]!);
        ctx.lineTo(P[b * 3]!, P[b * 3 + 1]!);
      }
      ctx.stroke();
    }

    if (selected != null && (!matches || matches.has(selected))) {
      ctx.lineWidth = 1.4;
      for (const [a, b] of focusEdges) {
        if (P[a * 3 + 2]! <= 1 || P[b * 3 + 2]! <= 1) continue;
        const neighbor = a === selected ? b : a;
        ctx.strokeStyle = catColor(graph.nodes[neighbor]!.cat);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(P[a * 3]!, P[a * 3 + 1]!);
        ctx.lineTo(P[b * 3]!, P[b * 3 + 1]!);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    order.sort((a, b) => P[b * 3 + 2]! - P[a * 3 + 2]!);
    for (const i of order) {
      if (matches && !showUnselected && !matches.has(i)) continue;
      const z = P[i * 3 + 2]!;
      if (z <= 1) continue;
      const nd = graph.nodes[i]!;
      const depth = Math.max(0.15, Math.min(1, 420 / z));
      const r = Math.max(0.9, Math.min(9, 1 + Math.log1p(nd.pubs) * 0.65) * depth);
      let alpha = 0.35 + 0.6 * depth;
      if (matches) alpha = matches.has(i) ? 1 : 0.05;
      if (seeds?.has(i) && (!matches || matches.has(i))) alpha = 1;
      if (selected != null && i !== selected && !focusNodes.has(i)) alpha *= 0.12;
      ctx.globalAlpha = alpha;
      let color = catColor(nd.cat);
      if (colorMode === "degree") {
        const t = Math.min(1, nd.deg / (maxDeg * 0.4));
        color = `hsl(${200 - t * 160}, 85%, ${45 + t * 20}%)`;
      } else if (colorMode === "growth") {
        const t = Math.max(0, Math.min(1, (nd.growth + 1) / 2));
        color = `hsl(${20 + t * 140}, 80%, ${45 + t * 15}%)`;
      }
      if (colorMode === "growth" && (nd.growthAvailable === false || !Number.isFinite(nd.growth)))
        color = "#9aa4b8";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(P[i * 3]!, P[i * 3 + 1]!, seeds?.has(i) ? r + 2 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (highlight && (!matches || (matches.has(highlight.a) && matches.has(highlight.c)))) {
      const { a, c } = highlight;
      for (const b of highlight.bridges ?? []) {
        if (matches && !matches.has(b)) continue;
        ctx.strokeStyle = theme === "light" ? "rgba(19,117,72,0.65)" : "rgba(126,230,168,0.45)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(P[a * 3]!, P[a * 3 + 1]!);
        ctx.lineTo(P[b * 3]!, P[b * 3 + 1]!);
        ctx.lineTo(P[c * 3]!, P[c * 3 + 1]!);
        ctx.stroke();
      }
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle =
        theme === "light"
          ? highlight.confirmed
            ? "#925800"
            : primaryColor
          : highlight.confirmed
            ? "#ffc46b"
            : primaryColor;
      ctx.shadowBlur = 14;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(P[a * 3]!, P[a * 3 + 1]!);
      ctx.lineTo(P[c * 3]!, P[c * 3 + 1]!);
      ctx.stroke();
      ctx.restore();
      for (const i of [a, c]) {
        ctx.beginPath();
        ctx.arc(P[i * 3]!, P[i * 3 + 1]!, 5, 0, Math.PI * 2);
        ctx.fillStyle =
          theme === "light"
            ? highlight.confirmed
              ? "#925800"
              : primaryColor
            : highlight.confirmed
              ? "#ffc46b"
              : primaryColor;
        ctx.fill();
        ctx.font = "600 12px 'Space Grotesk', sans-serif";
        ctx.fillStyle = theme === "light" ? "#172b42" : "rgba(240,246,255,0.95)";
        ctx.fillText(graph.nodes[i]!.label, P[i * 3]! + 9, P[i * 3 + 1]! - 7);
      }
    }

    // rótulos: apenas nós em destaque ou de maior grau
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = theme === "light" ? "rgba(23,43,66,0.86)" : "rgba(226,236,250,0.7)";
    let drawn = 0;
    const occupied = new Set<string>();
    for (let i = 0; i < n && drawn < 30; i++) {
      if (selected != null && i !== selected && !focusNodes.has(i)) continue;
      const cell = Math.floor(P[i * 3]! / 140) + "," + Math.floor(P[i * 3 + 1]! / 22);
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      if (matches && !matches.has(i)) continue;
      if (P[i * 3 + 2]! <= 1) continue;
      ctx.fillText(graph.nodes[i]!.label, P[i * 3]! + 6, P[i * 3 + 1]! - 5);
      drawn++;
    }

    if (selected != null && (!matches || matches.has(selected)) && P[selected * 3 + 2]! > 1) {
      ctx.beginPath();
      ctx.arc(P[selected * 3]!, P[selected * 3 + 1]!, 8, 0, Math.PI * 2);
      ctx.strokeStyle = theme === "light" ? "#172b42" : "#fff";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }, [
    theme,
    primaryColor,
    graph,
    layers,
    layerVisibility,
    focusEdges,
    focusNodes,
    order,
    visibleEdges,
    colorMode,
    maxDeg,
    showUnselected,
    showEdges,
    matches,
    seeds,
    highlight,
    selected,
  ]);

  const handledCommand = useRef(command?.sequence);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  const fitView = useCallback(
    (global = false) => {
      const indices = !global && matches ? [...matches] : graph.nodes.map((_, i) => i);
      if (!indices.length) return;
      let x = 0,
        y = 0,
        z = 0;
      for (const i of indices) {
        const n = graph.nodes[i]!;
        x += n.x;
        y += n.y;
        z += n.z;
      }
      x /= indices.length;
      y /= indices.length;
      z /= indices.length;
      let radius = 10;
      for (const i of indices) {
        const n = graph.nodes[i]!;
        radius = Math.max(radius, Math.hypot(n.x - x, n.y - y, n.z - z));
      }
      Object.assign(camRef.current, { x, y, z, dist: radius * 3.0, tx: 0, ty: 0 });
      setHover(null);
      drawRef.current();
    },
    [graph, matches],
  );
  useEffect(() => {
    fitView();
  }, [fitView, focusRequest]);
  useEffect(() => {
    if (!command || handledCommand.current === command.sequence) return;
    handledCommand.current = command.sequence;
    if (command.action === "export") {
      exportMapCanvas(canvasRef.current);
      return;
    }
    if (command.action === "fit" || command.action === "reset") {
      if (command.action === "reset") Object.assign(camRef.current, { yaw: 0.25, pitch: 0.6 });
      fitView(command.action === "reset");
      return;
    }
    camRef.current.dist = Math.min(
      10000,
      Math.max(20, camRef.current.dist * (command.action === "zoom-in" ? 1 / 1.35 : 1.35)),
    );
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

  const dragRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    tx: number;
    ty: number;
  } | null>(null);

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
      if (P[i * 3 + 2]! <= 1) continue;
      if (matches && !matches.has(i)) continue;
      const dx = P[i * 3]! - mx;
      const dy = P[i * 3 + 1]! - my;
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
      className="relative h-full w-full touch-none cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => {
        camRef.current.dist = Math.min(
          10000,
          Math.max(20, camRef.current.dist * Math.exp(e.deltaY * 0.0012)),
        );
        draw();
      }}
      onPointerDown={(e) => {
        setHover(null);
        publishHover(null);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: camRef.current.yaw,
          pitch: camRef.current.pitch,
          tx: camRef.current.tx,
          ty: camRef.current.ty,
        };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d) {
          if (tool === "pan") {
            camRef.current.tx = d.tx + e.clientX - d.x;
            camRef.current.ty = d.ty + e.clientY - d.y;
            draw();
            return;
          }
          camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
          camRef.current.pitch = Math.max(-1.4, Math.min(1.4, d.pitch + (e.clientY - d.y) * 0.006));
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
        if (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {
          onSelect(pick(e.clientX, e.clientY));
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setHover(null);
        publishHover(null);
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        setHover(null);
        publishHover(null);
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {!onHover && hover && (!matches || matches.has(hover.i)) && graph.nodes[hover.i] && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-panel backdrop-blur"
          style={{
            left: Math.max(4, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 300) - 264)),
            top: Math.max(4, Math.min(hover.y + 14, (wrapRef.current?.clientHeight ?? 200) - 140)),
          }}
        >
          <p className="font-display text-sm font-semibold">{graph.nodes[hover.i]!.label}</p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.id} ·{" "}
            {graph.categories.find((c) => c.id === graph.nodes[hover.i]!.cat)?.label ??
              graph.nodes[hover.i]!.cat}
          </p>
          <p className="mt-1 text-muted-foreground">
            {graph.nodes[hover.i]!.deg} conexões · {graph.nodes[hover.i]!.pubs} artigos
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
