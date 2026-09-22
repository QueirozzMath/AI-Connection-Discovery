import type { ScienceGraph } from "./science-data";

/** Stable, sparse force layout. Association strength reduces ubiquitous hub bias.
 * Strongest neighbours provide a backbone; all edges remain available to the UI.
 * Bounded repulsion sampling keeps each iteration O(N + E), off the UI thread.
 */
export function computeMapLayout(graph: ScienceGraph): Float32Array {
  const n = graph.nodes.length;
  const positions = new Float32Array(n * 2);
  if (!n) return positions;
  const neighbours: { j: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (const [a, b, weight] of graph.edges) {
    const w = weight / Math.sqrt(Math.max(1, graph.nodes[a]!.pubs * graph.nodes[b]!.pubs));
    neighbours[a]!.push({ j: b, w });
    neighbours[b]!.push({ j: a, w });
  }
  const backbone = neighbours.map((list) =>
    list.sort((a, b) => b.w - a.w || a.j - b.j).slice(0, 10),
  );
  // Deterministic weighted label propagation identifies connected thematic regions.
  const communities = Int32Array.from({ length: n }, (_, i) => i);
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < n; i++) {
      const votes = new Map<number, number>();
      for (const { j, w } of backbone[i]!) {
        const c = communities[j]!;
        votes.set(c, (votes.get(c) ?? 0) + w);
      }
      let best = communities[i]!;
      let score = votes.get(best) ?? 0;
      for (const [c, value] of votes)
        if (value > score || (value === score && c < best)) {
          best = c;
          score = value;
        }
      communities[i] = best;
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = communities[i]!;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(i);
  }
  // Seed community centres from the existing data layout, retaining global context.
  for (const members of groups.values()) {
    let cx = 0,
      cy = 0;
    for (const i of members) {
      cx += graph.nodes[i]!.x;
      cy += graph.nodes[i]!.y;
    }
    cx /= members.length;
    cy /= members.length;
    members.forEach((i, k) => {
      const angle = k * 2.399963229728653;
      const radius = Math.sqrt(k + 1) * 1.5;
      positions[i * 2] = cx * 3 + Math.cos(angle) * radius;
      positions[i * 2 + 1] = cy * 3 + Math.sin(angle) * radius;
    });
  }
  const dx = new Float32Array(n),
    dy = new Float32Array(n);
  const sample = Math.min(48, n);
  for (let step = 0; step < 180; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      const x = positions[i * 2]!,
        y = positions[i * 2 + 1]!;
      const list = backbone[i]!;
      const total = list.reduce((sum, edge) => sum + edge.w, 0) || 1;
      for (const { j, w } of list) {
        const ax = positions[j * 2]! - x,
          ay = positions[j * 2 + 1]! - y;
        const distance = Math.hypot(ax, ay) || 1;
        const force = ((w / total) * 0.65 * Math.max(0, distance - 5)) / distance;
        dx[i] = dx[i]! + ax * force;
        dy[i] = dy[i]! + ay * force;
        dx[j] = dx[j]! - ax * force;
        dy[j] = dy[j]! - ay * force;
      }
      for (let k = 0; k < sample; k++) {
        const j = (k * 7919 + step * 104729) % n;
        if (i === j) continue;
        const ax = x - positions[j * 2]!,
          ay = y - positions[j * 2 + 1]!;
        const force = 1500 / sample / (ax * ax + ay * ay + 2);
        dx[i] = dx[i]! + ax * force;
        dy[i] = dy[i]! + ay * force;
      }
      dx[i] = dx[i]! - x * 0.002;
      dy[i] = dy[i]! - y * 0.002;
    }
    const temperature = 4 * (1 - step / 180) + 0.08;
    for (let i = 0; i < n; i++) {
      const scale = Math.min(1, temperature / (Math.hypot(dx[i]!, dy[i]!) || 1));
      positions[i * 2] = positions[i * 2]! + dx[i]! * scale;
      positions[i * 2 + 1] = positions[i * 2 + 1]! + dy[i]! * scale;
    }
  }
  return positions;
}
