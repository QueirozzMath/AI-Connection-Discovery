import type { ScienceGraph } from "./science-data";

/** Stable category planes. Their ordinal height is categorical, never a ranking. */
export function categoryLayers(graph: ScienceGraph) {
  const ids = [...new Set(graph.nodes.map((node) => node.cat))].sort();
  const span = Math.max(
    30,
    ...graph.nodes.map((node) => Math.max(Math.abs(node.x), Math.abs(node.y))),
  );
  const gap = Math.max(18, span * 0.35);
  const heights = new Map(ids.map((id, i) => [id, (i - (ids.length - 1) / 2) * gap]));
  return {
    graph: { ...graph, nodes: graph.nodes.map((node) => ({ ...node, z: heights.get(node.cat)! })) },
    layers: ids.map((id) => ({
      id,
      label: graph.categories.find((c) => c.id === id)?.label ?? id,
      z: heights.get(id)!,
      span: span + 8,
    })),
  };
}
