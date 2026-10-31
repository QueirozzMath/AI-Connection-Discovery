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
  operator: "and" | "or" = "or",
  coverage?: Set<string>[],
) {
  const q = normalizeMapText(query.trim());
  if (!q && !categories.length) return null;
  const cats = new Set(categories);
  const neighbourhood =
    operator === "and" && cats.size ? (coverage ?? categoryCoverage(graph)) : undefined;
  const result = new Set<number>();
  graph.nodes.forEach((n, i) => {
    const inCategory =
      !cats.size ||
      (cats.has(n.cat) &&
        (operator === "or" || categories.every((cat) => neighbourhood![i]!.has(cat))));
    if (inCategory && index[i]!.includes(q)) result.add(i);
  });
  return result;
}

/** Closed one-hop neighbourhood: membership itself plus real co-occurrence neighbours.
 * A concept still has exactly one primary category. AND is a cross-category bridge,
 * not a claim that all categories co-occurred in the same article.
 */
export function categoryCoverage(graph: ScienceGraph) {
  const coverage = graph.nodes.map((node) => new Set([node.cat]));
  for (const [a, b] of graph.edges) {
    coverage[a]!.add(graph.nodes[b]!.cat);
    coverage[b]!.add(graph.nodes[a]!.cat);
  }
  return coverage;
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
    categories: [...categories].sort((a, b) => b[1] - a[1]),
  };
}
