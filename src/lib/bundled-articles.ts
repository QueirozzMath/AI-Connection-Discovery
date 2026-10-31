import type { MapArticles } from "./map-api-types";

export type BundledConcept = [
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
  number | null,
];
export type BundledArticle = [string, number, string | null, number[]];
export type BundledCorpus = {
  concepts: BundledConcept[];
  articles: BundledArticle[];
  categories: { id: string; label: string }[];
};
export type MeshDescriptor = [string, string, string[], string[]];
export type MeshVocabulary = {
  version: number;
  generated_at: string;
  source: string;
  descriptor_count: number;
  term_count: number;
  descriptors: MeshDescriptor[];
};
let pending: Promise<BundledCorpus> | undefined;
let vocabularyPending: Promise<MeshVocabulary> | undefined;

async function compressedJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok || !response.body) throw new Error(`Não foi possível carregar ${path}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoded =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"))
      : new Response(bytes).body!;
  return JSON.parse(await new Response(decoded).text()) as T;
}

export async function corpus(): Promise<BundledCorpus> {
  if (!pending)
    pending = compressedJson<BundledCorpus>("/data/corpus.json.gz").catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

export async function meshVocabulary(): Promise<MeshVocabulary> {
  if (!vocabularyPending)
    vocabularyPending = compressedJson<MeshVocabulary>("/data/mesh-vocabulary.json.gz").catch(
      (error) => {
        vocabularyPending = undefined;
        throw error;
      },
    );
  return vocabularyPending;
}
export async function bundledArticles(input: {
  start: number;
  end: number;
  meshIds: string[];
  cursor?: string | undefined | null;
}): Promise<MapArticles> {
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start > input.end)
    throw new Error("Período inválido.");
  const data = await corpus();
  const rows = data.articles.filter((a) => a[1] >= input.start && a[1] <= input.end);
  const ids = new Set(input.meshIds);
  const found = rows
    .filter((a) => a[3].some((i) => ids.has(data.concepts[i]![0])))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const start = Number(input.cursor ?? 0);
  if (!Number.isInteger(start) || start < 0) throw new Error("Página inválida.");
  const years = new Map<number, number>();
  for (const a of found) years.set(a[1], (years.get(a[1]) ?? 0) + 1);
  return {
    total: found.length,
    next: start + 50 < found.length ? String(start + 50) : null,
    years: [...years].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })),
    items: found.slice(start, start + 50).map((a) => ({
      pmid: a[0],
      year: a[1],
      title: a[2],
      journal: null,
      doi: null,
      authors: [],
      mesh: a[3].map((i) => ({
        id: data.concepts[i]![0],
        label: data.concepts[i]![1],
        category: data.concepts[i]![2].charAt(0),
        major: 0,
      })),
    })),
  };
}
