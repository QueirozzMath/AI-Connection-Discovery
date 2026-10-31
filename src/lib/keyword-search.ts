import type { GraphNode } from "./science-data";

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();

export function keywordSuggestions(
  nodes: GraphNode[],
  text: string,
  selected: number[],
  allowed?: Set<number> | null,
) {
  const query = normalize(text);
  if (!query) return [];
  const chosen = new Set(selected);
  return nodes
    .flatMap((node, i) => {
      if (chosen.has(i) || (allowed && !allowed.has(i))) return [];
      const label = normalize(node.label),
        id = normalize(node.id);
      if (!label.includes(query) && !id.includes(query)) return [];
      const score = id === query || label === query ? 0 : label.startsWith(query) ? 1 : 2;
      return [{ node, i, score }];
    })
    .sort(
      (a, b) =>
        a.score - b.score || b.node.pubs - a.node.pubs || a.node.label.localeCompare(b.node.label),
    )
    .slice(0, 8);
}
