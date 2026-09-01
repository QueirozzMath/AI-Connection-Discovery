import { queryOptions } from "@tanstack/react-query";

export interface GraphNode {
  id: string;
  label: string;
  cat: string;
  x: number;
  y: number;
  deg: number;
  pubs: number;
}

export interface ScienceGraph {
  meta: {
    source: string;
    demo?: boolean;
    cutoff_year: number;
    n_nodes: number;
    n_edges: number;
  };
  categories: { id: string; label: string }[];
  nodes: GraphNode[];
  edges: [number, number, number][];
}

export interface Candidate {
  rank: number;
  a: string;
  c: string;
  a_idx?: number;
  c_idx?: number;
  prob: number;
  confirmed: boolean;
  first_year: number | null;
  lead_time_years: number | null;
  intermediaries: string[];
  features: Record<string, number>;
}

export interface Metrics {
  demo?: boolean;
  generated_at: string;
  cutoff_year: number;
  window: [number, number];
  n_articles: number;
  graph: { nodes: number; edges_pre: number; edges_post_new: number; density: number };
  labels: { n: number; positives: number; rate: number };
  model: {
    name: string;
    auc: number;
    auc_ci95: [number, number];
    auc_bootstrap_mean: number;
    permutation_p: number;
    feature_importance: { feature: string; importance: number }[];
  };
  model_comparison: { name: string; auc: number }[];
  delong_vs_best_baseline: { auc_a: number; auc_b: number; z: number; p: number } | null;
  precision_at_k: { k: number; precision: number; recall: number }[];
  calibration: { brier: number; bins: { p_pred: number; p_obs: number; n: number }[] };
  powerlaw: { alpha: number; xmin: number; loglik_ratio_vs_lognormal: number; p: number } | null;
  confirmations: {
    n_predicted: number;
    n_confirmed: number;
    rate: number;
    median_lead_time: number | null;
    lead_time_histogram: { years: number; n: number }[];
  };
  hypothesis_eval?: { n: number; correct: number; partial: number; unsupported: number };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const graphQuery = queryOptions({
  queryKey: ["science", "graph"],
  queryFn: () => getJson<ScienceGraph>("/data/graph.json"),
  staleTime: Infinity,
});

export const candidatesQuery = queryOptions({
  queryKey: ["science", "candidates"],
  queryFn: () => getJson<{ items: Candidate[] }>("/data/candidates.json"),
  staleTime: Infinity,
});

export const metricsQuery = queryOptions({
  queryKey: ["science", "metrics"],
  queryFn: () => getJson<Metrics>("/data/metrics.json"),
  staleTime: Infinity,
});

/** Paleta por ramo da arvore MeSH (usada apenas no canvas do mapa). */
export const CATEGORY_COLORS: Record<string, string> = {
  A: "#5ad1e6",
  B: "#7ee6a8",
  C: "#ff7a8a",
  D: "#ffc46b",
  E: "#9db8ff",
  F: "#e08cff",
  G: "#63e0c8",
  H: "#c9d36b",
  I: "#ff9f6b",
  J: "#8ce0ff",
  K: "#d0a0ff",
  L: "#a0ffd6",
  M: "#ffb3d1",
  N: "#b8c4ff",
  V: "#9aa4b8",
  Z: "#d4b483",
};

export const catColor = (cat: string) => CATEGORY_COLORS[cat] ?? "#9aa4b8";

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const num = (v: number) => v.toLocaleString("pt-BR");
