import { efetch, esearch } from "./pubmed.server.ts";
import {
  assessArms,
  type EvidenceTerm,
  type EvidencePlan,
  type EvidenceArm,
  type EvidenceAssessment,
} from "./evidence.ts";

const armCache = new Map<string, { expires: number; value: EvidenceArm }>();
const safe = (s: string) => s.replace(/["\\\[\]()]/g, " ").trim();
const exact = (t: EvidenceTerm) => `"${safe(t.label)}"[MeSH Terms]`;
const broad = (t: EvidenceTerm) =>
  `(${[t.label, ...t.aliases]
    .slice(0, 4)
    .map((s) => `"${safe(s)}"[Title/Abstract]`)
    .join(" OR ")} OR ${exact(t)})`;
const fmtError = "O PubMed não respondeu ou limitou a consulta. Refaça a verificação.";
export async function retrieveArm(
  a: EvidenceTerm,
  b: EvidenceTerm,
  cutoff: number,
  localIds: string[],
): Promise<EvidenceArm> {
  const key = JSON.stringify([a, b, cutoff, localIds]);
  const cached = armCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  let articles: Awaited<ReturnType<typeof efetch>> = [],
    failed = false;
  const methods = new Set<string>();
  const add = (items: typeof articles, method: string) => {
    const ids = new Set(articles.map((x) => x.pmid));
    for (const item of items)
      if (item.year != null && item.year <= cutoff && item.year >= 1800 && !ids.has(item.pmid)) {
        articles.push(item);
        ids.add(item.pmid);
        methods.add(method);
      }
  };
  const usable = () => articles.filter((a) => a.abstract.trim().length >= 80).length;
  // Recover actual abstracts for corpus references, and independently validate their MeSH endpoints.
  if (localIds.length)
    try {
      const rows = await efetch(localIds.slice(0, 8));
      const has = (row: (typeof rows)[number], term: EvidenceTerm) =>
        row.mesh?.some(
          (m) => m.id === term.id || m.label.toLowerCase() === term.label.toLowerCase(),
        );
      add(
        rows.filter((r) => has(r, a) && has(r, b)),
        "Corpus local + registro PubMed validado",
      );
    } catch {
      failed = true;
    }
  for (const [query, method] of [
    [`${exact(a)} AND ${exact(b)}`, "MeSH"],
    [`${broad(a)} AND ${broad(b)}`, "MeSH + sinônimos em título/resumo"],
  ] as const) {
    if (usable() >= 2) break;
    try {
      const ids = await esearch(`${query} AND ("1800"[dp] : "${cutoff}"[dp])`, 8);
      add(await efetch(ids), method);
    } catch {
      failed = true;
    }
  }
  articles = articles
    .sort((x, y) => Number(Boolean(y.abstract)) - Number(Boolean(x.abstract)))
    .slice(0, 8);
  const value: EvidenceArm = {
    from: a.label,
    to: b.label,
    articles,
    method: [...methods].join("; ") || "Nenhum registro recuperado",
    failed,
    error: failed ? fmtError : null,
  };
  // Do not cache outages as absence. Cache only successful recoveries for five minutes.
  if (!failed) {
    if (armCache.size >= 80) armCache.delete(armCache.keys().next().value!);
    armCache.set(key, { expires: Date.now() + 300000, value });
  }
  return value;
}

export async function assessPlans(
  plans: Pick<EvidencePlan, "nodes" | "arms">[],
  cutoff: number,
): Promise<EvidenceAssessment> {
  let best: EvidenceAssessment = assessArms([], new Date().toISOString(), 0);
  let checked = 0;
  let outage = false;
  const started = Date.now();
  for (const plan of plans.slice(0, 3)) {
    const arms: EvidenceArm[] = [];
    for (let i = 0; i < plan.nodes.length - 1; i++) {
      if (Date.now() - started > 40000) {
        arms.push({
          from: plan.nodes[i]!.label,
          to: plan.nodes[i + 1]!.label,
          articles: [],
          method: "Consulta não concluída",
          failed: true,
          error: "Tempo de verificação excedido. Tente novamente.",
        });
        continue;
      }
      arms.push(await retrieveArm(plan.nodes[i]!, plan.nodes[i + 1]!, cutoff, plan.arms[i] ?? []));
    }
    checked++;
    const result = assessArms(arms, new Date().toISOString(), checked);
    outage ||= arms.some((a) => a.failed);
    if (result.status !== "pending") return result;
    if (Date.now() - started > 40000)
      return {
        ...result,
        reason:
          "A consulta excedeu o tempo disponível. As evidências continuam pendentes; tente novamente.",
      };
    if (
      !best.arms.length ||
      result.arms.reduce((s, a) => s + a.articles.length, 0) >
        best.arms.reduce((s, a) => s + a.articles.length, 0)
    )
      best = result;
  }
  return {
    ...best,
    pathsChecked: checked,
    reason: outage
      ? "Uma ou mais consultas falharam. Não foi possível concluir a checagem; isso não comprova falta de literatura. Tente novamente."
      : best.reason,
  };
}

export function validateCitations(value: unknown, allowed: Set<string>) {
  const text = JSON.stringify(value);
  for (const match of text.matchAll(/\bPMID[\s:#]*(\d{1,10})\b/gi))
    if (!allowed.has(match[1]!))
      throw new Error(
        "O agente citou um identificador que não está nas referências recuperadas. Gere novamente.",
      );
}
