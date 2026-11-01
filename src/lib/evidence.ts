import { bridgeInformation } from "./discovery.ts";
import type { BundledCorpus, MeshVocabulary } from "./bundled-articles";
import type { ScienceGraph, Candidate } from "./science-data";

export const MIN_ARM_ARTICLES = 2;
export type EvidenceTerm = { id: string; label: string; aliases: string[] };
export type EvidencePlan = {
  nodes: EvidenceTerm[];
  arms: string[][];
  support: number;
  score: number;
};
export type EvidenceArticle = {
  pmid: string;
  year: number | null;
  title: string;
  abstract: string;
  mesh?: { id: string; label: string }[];
};
export type EvidenceArm = {
  from: string;
  to: string;
  articles: EvidenceArticle[];
  method: string;
  failed: boolean;
  error: string | null;
};
export type EvidenceAssessment = {
  status: "ready" | "expanded" | "pending";
  arms: EvidenceArm[];
  checkedAt: string;
  reason: string;
  minimum: number;
  pathsChecked: number;
  quality: number;
};
const generic = new Set(
  "humans|animals|male|female|adult|aged|mice|rats|child|adolescent|infant|young adult|middle aged|time factors|risk factors|treatment outcome|follow-up studies|retrospective studies|prospective studies|cohort studies|case-control studies|cross-sectional studies|proteins|cells|dna|rna|gene expression".split(
    "|",
  ),
);
export const informative = (label: string) => !generic.has(label.toLowerCase());

const adjacencyCache = new WeakMap<ScienceGraph, Map<number, { i: number; w: number }[]>>();

export function evidenceIndex(corpus: BundledCorpus, cutoff: number) {
  const postings = new Map<number, Set<string>>();
  for (const [pmid, year, , terms] of corpus.articles) {
    if (year > cutoff || year < 1800) continue;
    for (const t of terms) {
      let set = postings.get(t);
      if (!set) postings.set(t, (set = new Set()));
      set.add(pmid);
    }
  }
  const byId = new Map(corpus.concepts.map((c, i) => [c[0], i]));
  const cache = new Map<string, string[]>();
  const arm = (a: string, b: string) => {
    const key = [a, b].sort().join(":");
    if (cache.has(key)) return cache.get(key)!;
    const sa = postings.get(byId.get(a) ?? -1),
      sb = postings.get(byId.get(b) ?? -1);
    if (!sa || !sb) return [];
    const [small, large] = sa.size < sb.size ? [sa, sb] : [sb, sa];
    const ids: string[] = [];
    for (const id of small)
      if (large.has(id)) {
        ids.push(id);
        if (ids.length === 8) break;
      }
    cache.set(key, ids);
    return ids;
  };
  return { arm };
}

/** Bounded paths in the PRE-cutoff graph; corpus support must exist for every edge. */
export function planEvidence(
  pair: Candidate,
  graph: ScienceGraph,
  index: ReturnType<typeof evidenceIndex>,
  vocabulary?: MeshVocabulary,
  maxEdges = 2,
): EvidencePlan[] {
  const a = graph.nodes.findIndex((n) =>
    pair.a_ui ? n.id === pair.a_ui : n.label.toLowerCase() === pair.a.toLowerCase(),
  );
  const c = graph.nodes.findIndex((n) =>
    pair.c_ui ? n.id === pair.c_ui : n.label.toLowerCase() === pair.c.toLowerCase(),
  );
  if (a < 0 || c < 0 || a === c) return [];
  let nb = adjacencyCache.get(graph);
  if (!nb) {
    nb = new Map<number, { i: number; w: number }[]>();
    for (const [x, y, w] of graph.edges) {
      if (!nb.has(x)) nb.set(x, []);
      if (!nb.has(y)) nb.set(y, []);
      nb.get(x)!.push({ i: y, w });
      nb.get(y)!.push({ i: x, w });
    }
    for (const list of nb.values()) list.sort((x, y) => y.w - x.w || x.i - y.i);
    adjacencyCache.set(graph, nb);
  }
  const adjacency = nb;
  const vocab = new Map(vocabulary?.descriptors.map((d) => [d[0], d]));
  const result: EvidencePlan[] = [];
  let examined = 0;
  const visit = (path: number[], arms: string[][]) => {
    if (++examined > 5000 || result.length >= 24) return;
    const end = path.at(-1)!;
    if (end === c) {
      if (arms.length < (maxEdges > 2 ? 3 : 2)) return;
      const support = Math.min(...arms.map((ids) => ids.length));
      const diversity = new Set(arms.flat()).size;
      if (diversity < arms.length + 1) return;
      const nodes = path.map((i) => {
        const n = graph.nodes[i]!;
        return { id: n.id, label: n.label, aliases: (vocab.get(n.id)?.[3] ?? []).slice(0, 3) };
      });
      result.push({ nodes, arms, support, score: Math.min(1, support / 5) * (2 / arms.length) });
      return;
    }
    if (arms.length >= maxEdges) return;
    // Complete a path before exploring more branches; bound branching for browser responsiveness.
    const next = [...(adjacency.get(end) ?? [])]
      .sort((x, y) => Number(y.i === c) - Number(x.i === c) || y.w - x.w)
      .slice(0, 32);
    for (const { i } of next) {
      if (
        path.includes(i) ||
        (i !== c &&
          (!informative(graph.nodes[i]!.label) ||
            ["Z", "M", "V", "X"].includes(graph.nodes[i]!.cat) ||
            bridgeInformation(graph, i) <= 0))
      )
        continue;
      const ids = index.arm(graph.nodes[end]!.id, graph.nodes[i]!.id);
      if (ids.length < MIN_ARM_ARTICLES) continue;
      visit([...path, i], [...arms, ids]);
    }
  };
  visit([a], []);
  return result.sort((x, y) => x.arms.length - y.arms.length || y.score - x.score).slice(0, 6);
}

export function assessArms(
  arms: EvidenceArm[],
  checkedAt: string,
  pathsChecked = 1,
): EvidenceAssessment {
  const usable = arms.map((arm) =>
    arm.articles.filter((a) => a.year != null && a.abstract.trim().length >= 80),
  );
  const good =
    arms.length >= 2 &&
    usable.every((list) => new Set(list.map((a) => a.pmid)).size >= MIN_ARM_ARTICLES) &&
    new Set(usable.flat().map((a) => a.pmid)).size >= arms.length + 1;
  return {
    status: good ? (arms.length === 2 ? "ready" : "expanded") : "pending",
    arms,
    checkedAt,
    pathsChecked,
    minimum: MIN_ARM_ARTICLES,
    quality: good
      ? (Math.min(1, Math.min(...usable.map((a) => a.length)) / 5) * 2) / arms.length
      : 0,
    reason: good
      ? "Suporte bibliográfico recuperado em todas as ligações; coerência mecanística ainda precisa ser avaliada pelo agente e pelo pesquisador."
      : arms.some((a) => a.failed)
        ? "Consulta indisponível em uma ou mais ligações. Isso não demonstra ausência de literatura; tente verificar novamente."
        : "Ainda faltam dois artigos distintos com resumo utilizável por ligação e diversidade de referências entre as ligações.",
  };
}
