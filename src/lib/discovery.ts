import type { ScienceGraph } from "./science-data";

/** Adjacência esparsa do grafo pré-corte, usada para inferir conexões no navegador. */
export interface Adjacency {
  nb: Int32Array[];
  wt: Float32Array[];
  map: Map<number, number>[];
}

export function buildAdjacency(graph: ScienceGraph): Adjacency {
  const n = graph.nodes.length;
  const counts = new Int32Array(n);
  for (const [a, b] of graph.edges) {
    counts[a]++;
    counts[b]++;
  }
  const nb: Int32Array[] = new Array(n);
  const wt: Float32Array[] = new Array(n);
  const fill = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    nb[i] = new Int32Array(counts[i]);
    wt[i] = new Float32Array(counts[i]);
  }
  for (const [a, b, w] of graph.edges) {
    nb[a][fill[a]] = b;
    wt[a][fill[a]++] = w;
    nb[b][fill[b]] = a;
    wt[b][fill[b]++] = w;
  }
  const map = nb.map((row, i) => {
    const m = new Map<number, number>();
    for (let k = 0; k < row.length; k++) m.set(row[k], wt[i][k]);
    return m;
  });
  return { nb, wt, map };
}

function treeDistance(ta: string, tb: string): number {
  const pa = ta.split(".");
  const pb = tb.split(".");
  let common = 0;
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if (pa[i] === pb[i]) common++;
    else break;
  }
  return (pa.length + pb.length - 2 * common) / 12;
}

export interface InferredPair {
  a: number;
  c: number;
  prob: number;
  bridges: number[];
  features: number[];
}

const log1p = Math.log1p;

export function scorePair(
  graph: ScienceGraph,
  adj: Adjacency,
  a: number,
  c: number,
): InferredPair | null {
  const ma = adj.map[a];
  const mc = adj.map[c];
  if (ma.has(c) || ma.size < 2 || mc.size < 2) return null;
  const shared: number[] = [];
  const small = ma.size <= mc.size ? ma : mc;
  const other = small === ma ? mc : ma;
  for (const b of small.keys()) if (other.has(b)) shared.push(b);
  if (shared.length < 3) return null;

  let aa = 0;
  let ra = 0;
  let bstr = 0;
  let bmax = 0;
  let dot = 0;
  for (const b of shared) {
    const d = adj.map[b].size || 1;
    aa += 1 / Math.log(d + 1.5);
    ra += 1 / d;
    const wa = ma.get(b)!;
    const wc = mc.get(b)!;
    const m = Math.min(wa, wc);
    bstr += m;
    if (m > bmax) bmax = m;
    dot += log1p(wa) * log1p(wc);
  }
  let na2 = 0;
  for (const w of ma.values()) na2 += log1p(w) ** 2;
  let nc2 = 0;
  for (const w of mc.values()) nc2 += log1p(w) ** 2;
  const normA = Math.sqrt(na2) || 1;
  const normC = Math.sqrt(nc2) || 1;

  const da = ma.size;
  const dc = mc.size;
  const union = new Set([...ma.keys(), ...mc.keys()]).size || 1;
  const na = graph.nodes[a];
  const nc = graph.nodes[c];
  const drugDisease =
    (na.cat === "D" || nc.cat === "D") &&
    (na.cat === "C" || nc.cat === "C" || na.cat === "F" || nc.cat === "F")
      ? 1
      : 0;

  const f = [
    shared.length,
    aa,
    ra,
    shared.length / union,
    log1p(da * dc),
    dot / (normA * normC),
    log1p(bstr),
    log1p(bmax),
    Math.min(da, dc) / Math.max(da, dc),
    na.cat === nc.cat ? 1 : 0,
    treeDistance(na.tree || "", nc.tree || ""),
    Math.min(na.growth, nc.growth),
    Math.max(na.growth, nc.growth),
    drugDisease,
  ];

  const { mean, std, coef, intercept } = graph.model;
  let z = intercept;
  for (let i = 0; i < f.length; i++) z += ((f[i] - mean[i]) / (std[i] || 1)) * coef[i];
  const prob = 1 / (1 + Math.exp(-z));

  shared.sort((x, y) => Math.min(ma.get(y)!, mc.get(y)!) - Math.min(ma.get(x)!, mc.get(x)!));
  return { a, c, prob, bridges: shared.slice(0, 6), features: f };
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DiscoveryOptions {
  mode: "global" | "seeded";
  seeds?: number[];
  randomSeed?: number;
  sampleNodes?: number;
  limit?: number;
}

/** Infere pares A–C sem co-ocorrência e ranqueia pela probabilidade do modelo. */
export function discover(
  graph: ScienceGraph,
  adj: Adjacency,
  opts: DiscoveryOptions,
): InferredPair[] {
  const results: InferredPair[] = [];
  const seen = new Set<number>();
  const n = graph.nodes.length;

  const anchors: number[] =
    opts.mode === "seeded" && opts.seeds?.length
      ? opts.seeds
      : (() => {
          const rnd = mulberry32(opts.randomSeed ?? 42);
          const order = Array.from({ length: n }, (_, i) => i)
            .filter((i) => adj.map[i].size >= 4)
            .sort((x, y) => adj.map[y].size - adj.map[x].size)
            .slice(0, Math.min(n, 4000));
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }
          return order.slice(0, opts.sampleNodes ?? 600);
        })();

  for (const a of anchors) {
    const counts = new Map<number, number>();
    for (const b of adj.map[a].keys()) {
      for (const c of adj.map[b].keys()) {
        if (c === a || adj.map[a].has(c)) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    for (const [c, cn] of counts) {
      if (cn < 3) continue;
      const key = a < c ? a * n + c : c * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const scored = scorePair(graph, adj, a, c);
      if (scored) results.push(scored);
    }
  }
  results.sort((x, y) => y.prob - x.prob);
  return results.slice(0, opts.limit ?? 300);
}
