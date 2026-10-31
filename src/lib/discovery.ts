import type { ScienceGraph } from "./science-data";

/** Adjacência esparsa do grafo pré-corte, usada para inferir conexões no navegador. */
export interface Adjacency {
  nb: Int32Array[];
  wt: Float32Array[];
  map: Map<number, number>[];
}

export function buildAdjacency(graph: ScienceGraph): Adjacency {
  // Node and edge indices are validated by the graph export; loops stay within allocated arrays.
  const n = graph.nodes.length;
  const counts = new Int32Array(n);
  for (const [a, b] of graph.edges) {
    counts[a]!++;
    counts[b]!++;
  }
  const nb: Int32Array[] = new Array(n);
  const wt: Float32Array[] = new Array(n);
  const fill = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    nb[i] = new Int32Array(counts[i]!);
    wt[i] = new Float32Array(counts[i]!);
  }
  for (const [a, b, w] of graph.edges) {
    nb[a]![fill[a]!] = b;
    wt[a]![fill[a]!++] = w;
    nb[b]![fill[b]!] = a;
    wt[b]![fill[b]!++] = w;
  }
  const map = nb.map((row, i) => {
    const m = new Map<number, number>();
    for (let k = 0; k < row.length; k++) m.set(row[k]!, wt[i]![k]!);
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
  priority: number;
  bridgeSpecificity: number;
}

const GENERIC = new Set(
  "humans|animals|male|female|adult|aged|middle aged|adolescent|child|infant|young adult|mice|rats|time factors|risk factors|treatment outcome|follow-up studies|retrospective studies|prospective studies|cohort studies|cross-sectional studies|case-control studies|sensitivity and specificity|reproducibility of results|public health".split(
    "|",
  ),
);
for (const label of [
  "gene expression",
  "proteins",
  "dna",
  "rna",
  "cells",
  "molecular sequence data",
  "amino acid sequence",
  "base sequence",
  "biological phenomena",
  "chemical phenomena",
  "chemistry, physical",
  "water",
  "water supply",
  "statistics as topic",
])
  GENERIC.add(label);

/** Full-network degree and publication prevalence remain the reference even
 * when a filter restricts the discovery subgraph. */
export function bridgeInformation(graph: ScienceGraph, b: number): number {
  const node = graph.nodes[b]!;
  if (
    GENERIC.has(node.label.toLowerCase()) ||
    /^(history(?:,| of|$)|research$|population(?:$| dynamics$)|demography$|developed countries$|developing countries$|forecasting$|anatomy$|medical illustration$|risk assessment$|rats, inbred strains$|mice, inbred strains$)/i.test(
      node.label,
    ) ||
    ["Z", "M", "V"].includes(node.cat)
  )
    return 0;
  const coverage = node.deg / Math.max(1, graph.nodes.length - 1);
  const prevalence = node.pubs / Math.max(1, graph.meta.n_articles);
  if (coverage >= 0.18 || prevalence >= 0.12) return 0;
  return Math.max(0, 1 - coverage / 0.18) * Math.max(0, 1 - prevalence / 0.12);
}

const log1p = Math.log1p;
const normCache = new WeakMap<Adjacency, Float64Array>();
function profileNorms(adj: Adjacency) {
  let norms = normCache.get(adj);
  if (!norms) {
    norms = Float64Array.from(adj.map, (neighbors) => {
      let square = 0;
      for (const weight of neighbors.values()) square += log1p(weight) ** 2;
      return Math.sqrt(square) || 1;
    });
    normCache.set(adj, norms);
  }
  return norms;
}

export function scorePair(
  graph: ScienceGraph,
  adj: Adjacency,
  a: number,
  c: number,
): InferredPair | null {
  const ma = adj.map[a]!;
  const mc = adj.map[c]!;
  if (a === c || ma.has(c) || !ma.size || !mc.size) return null;
  if (!bridgeInformation(graph, a) || !bridgeInformation(graph, c)) return null;
  const shared: number[] = [];
  const small = ma.size <= mc.size ? ma : mc;
  const other = small === ma ? mc : ma;
  for (const b of small.keys()) if (other.has(b)) shared.push(b);
  if (!shared.length) return null;
  const informative = shared
    .map((b) => {
      const specificity = bridgeInformation(graph, b);
      const support = Math.min(ma.get(b)!, mc.get(b)!);
      const association = Math.min(
        ma.get(b)! / Math.max(1, graph.nodes[a]!.pubs),
        mc.get(b)! / Math.max(1, graph.nodes[c]!.pubs),
      );
      return {
        b,
        specificity,
        value: specificity * Math.sqrt(association) * (1 - Math.exp(-support / 2)),
      };
    })
    .filter((bridge) => bridge.specificity > 0 && bridge.value > 0)
    .sort((x, y) => y.value - x.value || x.b - y.b);
  if (!informative.length) return null;

  let aa = 0;
  let ra = 0;
  let bstr = 0;
  let bmax = 0;
  let dot = 0;
  for (const b of shared) {
    const d = adj.map[b]!.size || 1;
    aa += 1 / Math.log(d + 1.5);
    ra += 1 / d;
    const wa = ma.get(b)!;
    const wc = mc.get(b)!;
    const m = Math.min(wa, wc);
    bstr += m;
    if (m > bmax) bmax = m;
    dot += log1p(wa) * log1p(wc);
  }
  const norms = profileNorms(adj);
  const normA = norms[a]!;
  const normC = norms[c]!;

  const da = ma.size;
  const dc = mc.size;
  const union = ma.size + mc.size - shared.length || 1;
  const na = graph.nodes[a]!;
  const nc = graph.nodes[c]!;
  const biomedical = new Set(["A", "B", "C", "D", "E", "F", "G"]);
  if (!biomedical.has(na.cat) || !biomedical.has(nc.cat)) return null;
  // Swanson seeks complementary literatures, not two near-identical profiles.
  const cosine = dot / (normA * normC);
  if (cosine > 0.65) return null;
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
    Math.min(
      na.growthAvailable === false ? 0 : na.growth,
      nc.growthAvailable === false ? 0 : nc.growth,
    ),
    Math.max(
      na.growthAvailable === false ? 0 : na.growth,
      nc.growthAvailable === false ? 0 : nc.growth,
    ),
    drugDisease,
  ];

  const { mean, std, coef, intercept } = graph.model;
  let z = intercept;
  for (let i = 0; i < f.length; i++) z += ((f[i]! - mean[i]!) / (std[i]! || 1)) * coef[i]!;
  const prob = 1 / (1 + Math.exp(-z));

  const signal = informative
    .slice(0, 3)
    .reduce((sum, bridge, index) => sum + bridge.value / (index + 1), 0);
  const distance = Math.min(
    1,
    treeDistance(na.tree || "", nc.tree || "") + (na.cat !== nc.cat ? 0.25 : 0),
  );
  const specificity = informative[0]!.specificity;
  const separation = Math.max(0, 1 - cosine);
  const priority = Math.min(
    1,
    (1 - Math.exp(-signal * 4)) * (0.45 + 0.55 * distance) * separation ** 3,
  );
  return {
    a,
    c,
    prob,
    priority,
    bridgeSpecificity: specificity,
    bridges: informative.slice(0, 6).map((bridge) => bridge.b),
    features: f,
  };
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
  allowed?: Set<number> | null;
}

/** Swanson A–B–C: rank by specific bridge evidence and complementary profiles.
 * Priority is an exploratory heuristic, independent of logistic calibration. */
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
      ? opts.seeds.filter((i) => !opts.allowed || opts.allowed.has(i))
      : (() => {
          const rnd = mulberry32(opts.randomSeed ?? 42);
          const order = Array.from({ length: n }, (_, i) => i)
            .filter(
              (i) =>
                (!opts.allowed || opts.allowed.has(i)) &&
                adj.map[i]!.size >= 1 &&
                bridgeInformation(graph, i) > 0,
            )
            .sort((x, y) => adj.map[y]!.size - adj.map[x]!.size)
            .slice(0, Math.min(n, 4000));
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [order[i], order[j]] = [order[j]!, order[i]!];
          }
          return order.slice(0, opts.sampleNodes ?? 600);
        })();

  for (const a of anchors) {
    const counts = new Map<number, number>();
    for (const b of adj.map[a]!.keys()) {
      if (opts.allowed && !opts.allowed.has(b)) continue;
      if (!bridgeInformation(graph, b)) continue;
      for (const c of adj.map[b]!.keys()) {
        if (opts.allowed && !opts.allowed.has(c)) continue;
        if (c === a || adj.map[a]!.has(c)) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    for (const [c, cn] of counts) {
      if (cn < 1) continue;
      const key = a < c ? a * n + c : c * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const scored = scorePair(graph, adj, a, c);
      if (scored) results.push(scored);
    }
  }
  results.sort(
    (x, y) =>
      y.priority - x.priority || y.bridgeSpecificity - x.bridgeSpecificity || y.prob - x.prob,
  );
  return results.slice(0, opts.limit ?? 300);
}
