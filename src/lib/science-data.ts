import { getLocale } from "./ui-language";
import { queryOptions } from "@tanstack/react-query";

export interface GraphNode {
  id: string;
  label: string;
  cat: string;
  tree: string;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  deg: number;
  pubs: number;
  growth: number;
  growthAvailable?: boolean;
}

export interface LinkModel {
  type: string;
  mean: number[];
  std: number[];
  coef: number[];
  intercept: number;
}

export interface ScienceGraph {
  meta: {
    source: string;
    demo?: boolean;
    cutoff_year: number;
    corpus_max_year: number;
    n_nodes: number;
    n_edges: number;
    n_articles: number;
  };
  categories: { id: string; label: string }[];
  features: string[];
  model: LinkModel;
  nodes: GraphNode[];
  edges: [number, number, number][];
}

export interface Candidate {
  priority?: number;
  bridgeSpecificity?: number;
  selection_method?: string;
  rank: number;
  a: string;
  c: string;
  a_ui?: string;
  c_ui?: string;
  prob: number;
  confirmed: boolean;
  first_year: number | null;
  lead_time_years: number | null;
  intermediaries: string[];
  features: Record<string, number>;
}

export interface Metrics {
  demo?: boolean;
  dynamic?: boolean;
  generated_at: string;
  source?: string;
  cutoff_year: number;
  train_cutoff?: number;
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
    mean_lead_time?: number | null;
    lead_time_histogram: { years: number; n: number }[];
  };
  hypothesis_eval?: { n: number; correct: number; partial: number; unsupported: number };
}

export interface DataIndex {
  generated_at: string;
  source: string;
  n_articles: number;
  corpus_years: [number, number];
  cutoffs: number[];
  default_cutoff: number;
  mesh_version?: number;
  mesh_descriptors?: number;
  mesh_terms?: number;
}

export interface TimelinePoint {
  cutoff_year: number;
  auc: number;
  auc_ci95: [number, number];
  n_predicted: number;
  n_confirmed: number;
  rate: number;
  median_lead_time: number | null;
  mean_lead_time: number | null;
  precision_at_50: number | null;
  positives_rate: number;
  nodes: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const indexQuery = queryOptions({
  queryKey: ["science", "index"],
  queryFn: () => getJson<DataIndex>("/data/index.json"),
  staleTime: Infinity,
});

export const timelineQuery = queryOptions({
  queryKey: ["science", "timeline"],
  queryFn: () => getJson<{ items: TimelinePoint[] }>("/data/timeline.json"),
  staleTime: Infinity,
});

export const graphQuery = (cutoff: number) =>
  queryOptions({
    queryKey: ["science", "graph", cutoff],
    queryFn: async () => {
      const { dynamicCutoffBundle, isPublishedCutoff } = await import("./dynamic-cutoff");
      return isPublishedCutoff(cutoff)
        ? getJson<ScienceGraph>(`/data/graph-${cutoff}.json`)
        : (await dynamicCutoffBundle(cutoff)).graph;
    },
    staleTime: Infinity,
  });

export const candidatesQuery = (cutoff: number) =>
  queryOptions({
    queryKey: ["science", "candidates", cutoff],
    queryFn: async () => {
      const { dynamicCutoffBundle, isPublishedCutoff } = await import("./dynamic-cutoff");
      return isPublishedCutoff(cutoff)
        ? getJson<{ cutoff_year: number; items: Candidate[] }>(`/data/candidates-${cutoff}.json`)
        : (await dynamicCutoffBundle(cutoff)).candidates;
    },
    staleTime: Infinity,
  });

export const metricsQuery = (cutoff: number) =>
  queryOptions({
    queryKey: ["science", "metrics", cutoff],
    queryFn: async () => {
      const { dynamicCutoffBundle, isPublishedCutoff } = await import("./dynamic-cutoff");
      return isPublishedCutoff(cutoff)
        ? getJson<Metrics>(`/data/metrics-${cutoff}.json`)
        : (await dynamicCutoffBundle(cutoff)).metrics;
    },
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
  X: "#94a3b8",
  Z: "#d4b483",
};

const LIGHT_CATEGORY_COLORS: Record<string, string> = {
  A: "#087b92",
  B: "#278653",
  C: "#c54862",
  D: "#a56808",
  E: "#4b6bb6",
  F: "#a34bb4",
  G: "#118775",
  H: "#727c18",
  I: "#bb6230",
  J: "#2384a5",
  K: "#8b5db2",
  L: "#267c62",
  M: "#b65b82",
  N: "#6267ac",
  V: "#64748b",
  X: "#64748b",
  Z: "#8e7040",
};
export const catColor = (cat: string) => {
  const light =
    typeof document !== "undefined" &&
    document.documentElement?.classList &&
    !document.documentElement.classList.contains("dark");
  return (light ? LIGHT_CATEGORY_COLORS : CATEGORY_COLORS)[cat] ?? "#64748b";
};

export const FEATURE_LABELS: Record<string, string> = {
  common_neighbors: "Vizinhos comuns",
  adamic_adar: "Adamic-Adar",
  resource_allocation: "Resource allocation",
  jaccard: "Jaccard",
  pref_attachment: "Preferential attachment",
  cosine_profile: "Cosseno de perfis",
  bridge_strength: "Força das pontes",
  bridge_max: "Ponte mais forte",
  deg_ratio: "Razão de graus",
  same_branch: "Mesmo ramo MeSH",
  tree_distance: "Distância hierárquica",
  growth_min: "Crescimento (mín.)",
  growth_max: "Crescimento (máx.)",
  drug_disease_pair: "Par fármaco-doença",
};

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const num = (v: number) => v.toLocaleString(getLocale());
