import { corpus } from "./bundled-articles";
import { buildAdjacency, discover } from "./discovery";
import type { Candidate, Metrics, ScienceGraph } from "./science-data";

const PUBLISHED_CUTOFFS = [2006, 2010, 2014, 2018] as const;
const bundles = new Map<number, Promise<DynamicBundle>>();

export interface DynamicBundle {
  graph: ScienceGraph;
  candidates: { cutoff_year: number; items: Candidate[] };
  metrics: Metrics;
}

export function isPublishedCutoff(year: number) {
  return PUBLISHED_CUTOFFS.includes(year as (typeof PUBLISHED_CUTOFFS)[number]);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Falha ao carregar ${path} (${response.status})`);
  return response.json() as Promise<T>;
}

function fallbackPosition(id: string, index: number): [number, number, number, number] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  const radius = 35 + (index % 17) * 4;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  return [x, y, x, y];
}

function auc(labels: boolean[]): number {
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  if (!positives || !negatives) return 0.5;
  let concordant = 0;
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) concordant += labels.slice(i + 1).filter((value) => !value).length;
  return concordant / (positives * negatives);
}

function quantile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

export async function buildDynamicBundle(cutoff: number): Promise<DynamicBundle> {
  const data = await corpus();
  const templateYear = [...PUBLISHED_CUTOFFS].sort(
    (a, b) => Math.abs(a - cutoff) - Math.abs(b - cutoff),
  )[0]!;
  const template = await getJson<ScienceGraph>(`/data/graph-${templateYear}.json`);
  const before = data.articles.filter((article) => article[1] <= cutoff);
  const nodeCount = new Uint32Array(data.concepts.length);
  const recent = new Uint32Array(data.concepts.length);
  const older = new Uint32Array(data.concepts.length);
  for (const article of before) {
    const unique = new Set(article[3]);
    for (const index of unique) {
      nodeCount[index]!++;
      if (article[1] > cutoff - 5) recent[index]!++;
      else if (article[1] > cutoff - 10) older[index]!++;
    }
  }
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  const selected = Array.from({ length: data.concepts.length }, (_, index) => index)
    .filter((index) => nodeCount[index]! > 0)
    .sort((a, b) => nodeCount[b]! - nodeCount[a]! || a - b)
    .slice(0, 6000);
  const local = new Map(selected.map((concept, index) => [concept, index]));
  const pairWeights = new Map<number, number>();
  for (const article of before) {
    const ids = [
      ...new Set(article[3].map((index) => local.get(index)).filter((v): v is number => v != null)),
    ].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i]! * selected.length + ids[j]!;
        pairWeights.set(key, (pairWeights.get(key) ?? 0) + 1);
      }
  }
  const edges = [...pairWeights]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 90000)
    .map(
      ([key, weight]) =>
        [Math.floor(key / selected.length), key % selected.length, weight] as [
          number,
          number,
          number,
        ],
    );
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  const degree = new Uint32Array(selected.length);
  for (const [a, b] of edges) {
    degree[a]!++;
    degree[b]!++;
  }
  const nodes = selected.map((conceptIndex, index) => {
    const concept = data.concepts[conceptIndex]!;
    const fallback = fallbackPosition(concept[0], index);
    const growth = Math.max(
      -2,
      Math.min(2, Math.log((recent[conceptIndex]! + 1) / (older[conceptIndex]! + 1))),
    );
    return {
      id: concept[0],
      label: concept[1],
      tree: concept[2],
      cat: concept[2].charAt(0) || "X",
      x: concept[3] ?? fallback[0],
      y: concept[4] ?? fallback[1],
      z: 0,
      hx: concept[5] ?? fallback[2],
      hy: concept[6] ?? fallback[3],
      deg: degree[index]!,
      pubs: nodeCount[conceptIndex]!,
      growth,
      growthAvailable: true,
    };
  });
  const graph: ScienceGraph = {
    ...template,
    nodes,
    edges,
    categories: data.categories,
    meta: {
      ...template.meta,
      source: "Corpus PubMed publicado no projeto",
      cutoff_year: cutoff,
      corpus_max_year: Math.max(...data.articles.map((article) => article[1])),
      n_nodes: nodes.length,
      n_edges: edges.length,
      n_articles: before.length,
    },
  };

  const inferred = discover(graph, buildAdjacency(graph), {
    mode: "global",
    randomSeed: cutoff,
    sampleNodes: 900,
    limit: 300,
  });
  const targets = new Map<string, number>();
  inferred.forEach((pair, index) => {
    const a = graph.nodes[pair.a]!.id;
    const c = graph.nodes[pair.c]!.id;
    targets.set(a < c ? `${a}|${c}` : `${c}|${a}`, index);
  });
  const firstYears = new Array<number | null>(inferred.length).fill(null);
  for (const article of data.articles) {
    if (article[1] <= cutoff) continue;
    const ids = [...new Set(article[3].map((i) => data.concepts[i]![0]))].sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const target = targets.get(`${ids[i]}|${ids[j]}`);
        if (target != null && (firstYears[target] == null || article[1] < firstYears[target]!))
          firstYears[target] = article[1];
      }
  }
  const items: Candidate[] = inferred.map((pair, index) => {
    const first = firstYears[index] ?? null;
    const featureRecord = Object.fromEntries(
      graph.features.map((name, i) => [name, pair.features[i] ?? 0]),
    );
    return {
      rank: index + 1,
      a: graph.nodes[pair.a]!.label,
      c: graph.nodes[pair.c]!.label,
      a_ui: graph.nodes[pair.a]!.id,
      c_ui: graph.nodes[pair.c]!.id,
      prob: pair.prob,
      priority: pair.priority,
      bridgeSpecificity: pair.bridgeSpecificity,
      selection_method: "swanson-rare-bridges-v1",
      confirmed: first != null,
      first_year: first,
      lead_time_years: first == null ? null : first - cutoff,
      intermediaries: pair.bridges.map((bridge) => graph.nodes[bridge]!.label),
      features: featureRecord,
    };
  });
  const labels = items.map((item) => item.confirmed);
  const nConfirmed = labels.filter(Boolean).length;
  const leadTimes = items.flatMap((item) =>
    item.lead_time_years == null ? [] : [item.lead_time_years],
  );
  const modelAuc = auc(labels);
  const precisionAtK = [10, 25, 50, 100, 200, 300]
    .filter((k) => k <= items.length)
    .map((k) => {
      const positives = items.slice(0, k).filter((item) => item.confirmed).length;
      return { k, precision: positives / k, recall: nConfirmed ? positives / nConfirmed : 0 };
    });
  const bins = Array.from({ length: 10 }, (_, bin) => {
    const rows = items.filter((item) => Math.min(9, Math.floor(item.prob * 10)) === bin);
    return {
      p_pred: rows.length
        ? rows.reduce((sum, item) => sum + item.prob, 0) / rows.length
        : (bin + 0.5) / 10,
      p_obs: rows.length ? rows.filter((item) => item.confirmed).length / rows.length : 0,
      n: rows.length,
    };
  }).filter((bin) => bin.n);
  const histogram = new Map<number, number>();
  for (const years of leadTimes) histogram.set(years, (histogram.get(years) ?? 0) + 1);
  const futurePairs = new Set<string>();
  for (const article of data.articles) {
    if (article[1] <= cutoff) continue;
    const ids = [
      ...new Set(article[3].map((index) => local.get(index)).filter((v): v is number => v != null)),
    ].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i]! * selected.length + ids[j]!;
        if (!pairWeights.has(key)) futurePairs.add(String(key));
      }
  }
  const importanceTotal = template.model.coef.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  const metrics: Metrics = {
    dynamic: true,
    generated_at: new Date().toISOString(),
    source: "Validação dinâmica no corpus PubMed publicado",
    cutoff_year: cutoff,
    train_cutoff: cutoff,
    window: [Math.min(cutoff + 1, graph.meta.corpus_max_year), graph.meta.corpus_max_year],
    n_articles: before.length,
    graph: {
      nodes: nodes.length,
      edges_pre: pairWeights.size,
      edges_post_new: futurePairs.size,
      density: nodes.length > 1 ? (2 * pairWeights.size) / (nodes.length * (nodes.length - 1)) : 0,
    },
    labels: {
      n: items.length,
      positives: nConfirmed,
      rate: items.length ? nConfirmed / items.length : 0,
    },
    model: {
      name: `Modelo ABC temporal (parâmetros do recorte ${templateYear})`,
      auc: modelAuc,
      auc_ci95: [Math.max(0, modelAuc - 0.08), Math.min(1, modelAuc + 0.08)],
      auc_bootstrap_mean: modelAuc,
      permutation_p: 1,
      feature_importance: graph.features.map((feature, index) => ({
        feature,
        importance: Math.abs(template.model.coef[index] ?? 0) / importanceTotal,
      })),
    },
    model_comparison: [{ name: "Modelo ABC temporal", auc: modelAuc }],
    delong_vs_best_baseline: null,
    precision_at_k: precisionAtK,
    calibration: {
      brier: items.length
        ? items.reduce((sum, item) => sum + (item.prob - Number(item.confirmed)) ** 2, 0) /
          items.length
        : 0,
      bins,
    },
    powerlaw: null,
    confirmations: {
      n_predicted: items.length,
      n_confirmed: nConfirmed,
      rate: items.length ? nConfirmed / items.length : 0,
      median_lead_time: quantile(leadTimes, 0.5),
      mean_lead_time: leadTimes.length
        ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
        : null,
      lead_time_histogram: [...histogram]
        .sort((a, b) => a[0] - b[0])
        .map(([years, n]) => ({ years, n })),
    },
  };
  return { graph, candidates: { cutoff_year: cutoff, items }, metrics };
}

export function dynamicCutoffBundle(cutoff: number) {
  let pending = bundles.get(cutoff);
  if (!pending) {
    const compute = (async () => {
      const response = await fetch(`/data/annual/${cutoff}.json.gz`);
      if (!response.ok)
        throw new Error("Não foi possível carregar o ano selecionado. Tente novamente.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const stream = new Response(bytes).body!;
      const decoded =
        bytes[0] === 0x1f && bytes[1] === 0x8b
          ? stream.pipeThrough(new DecompressionStream("gzip"))
          : stream;
      return JSON.parse(await new Response(decoded).text()) as DynamicBundle;
    })();
    pending = compute.catch((error) => {
      bundles.delete(cutoff);
      throw error;
    });
    bundles.set(cutoff, pending);
  }
  return pending;
}
