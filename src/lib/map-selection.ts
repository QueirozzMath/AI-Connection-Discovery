import type { ScienceGraph } from "./science-data";

export const normalizeMapText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function mapSearchIndex(graph: ScienceGraph) {
  const categories = new Map(graph.categories.map((c) => [c.id, c.label]));
  return graph.nodes.map((n) =>
    normalizeMapText(`${n.label} ${n.id} ${n.tree} ${n.cat} ${categories.get(n.cat) ?? ""}`),
  );
}

export function selectMapNodes(
  graph: ScienceGraph,
  index: string[],
  query: string,
  categories: string[],
) {
  const q = normalizeMapText(query.trim());
  if (!q && !categories.length) return null;
  const cats = new Set(categories);
  const result = new Set<number>();
  graph.nodes.forEach((n, i) => {
    if ((!cats.size || cats.has(n.cat)) && index[i]!.includes(q)) result.add(i);
  });
  return result;
}

export function summarizeMap(graph: ScienceGraph, matches: Set<number> | null) {
  const indices = matches ? [...matches] : graph.nodes.map((_, i) => i);
  const categories = new Map<string, number>();
  let occurrences = 0,
    edges = 0,
    weight = 0;
  for (const i of indices) {
    const node = graph.nodes[i]!;
    occurrences += node.pubs;
    categories.set(node.cat, (categories.get(node.cat) ?? 0) + 1);
  }
  for (const [a, b, w] of graph.edges)
    if (!matches || (matches.has(a) && matches.has(b))) {
      edges++;
      weight += w;
    }
  const top = indices.sort((a, b) => graph.nodes[b]!.pubs - graph.nodes[a]!.pubs).slice(0, 5);
  return {
    count: indices.length,
    edges,
    weight,
    occurrences,
    top,
    categories: [...categories].sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}
