import type { ScienceGraph } from "./science-data";

export interface MapCatalog {
  start: number;
  end: number;
  articles: number;
  revision: string;
  source: string;
}
export interface MapArticle {
  pmid: string;
  year: number;
  title: string | null;
  journal: string | null;
  doi: string | null;
  authors: string[];
  mesh: { id: string; label: string; category: string; major: number }[];
}
export interface MapArticles {
  items: MapArticle[];
  total: number;
  years: { year: number; count: number }[];
  next: string | null;
}
export type TemporalGraph = ScienceGraph & {
  meta: ScienceGraph["meta"] & {
    period_start: number;
    period_end: number;
    total_concepts: number;
    node_limit: number;
    edge_limit: number;
    revision: string;
  };
};
