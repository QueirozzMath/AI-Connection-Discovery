import { createServerFn } from "@tanstack/react-start";
import { PeriodFields } from "./temporal";
import { z } from "zod";

const Input = PeriodFields.extend({
  meshIds: z.array(z.string().max(24)).max(4500).optional(),
  a: z.string().min(1).max(300),
  c: z.string().min(1).max(300),
});

const Schema = z.object({
  title: z.string(),
  hypothesis: z.string(),
  mechanism: z.string(),
  bridge_reasoning: z.string(),
  testable_prediction: z.string(),
  skeptic_critique: z.string(),
  confidence: z.number().min(0).max(1),
  evidence_pmids: z.array(z.string().regex(/^\d+$/)),
  novelty: z.enum(["alta", "media", "baixa"]),
});

export type HypothesisResult = z.infer<typeof Schema> & {
  pair: [string, string];
  model: string;
  cutoff_year: number;
  evidence_seen: { a: string[]; c: string[] };
};

const VerifyInput = PeriodFields.extend({
  meshIds: z.array(z.string().max(24)).max(4500).optional(),
  a: z.string().min(1).max(300),
  c: z.string().min(1).max(300),
  hypothesis: z.string(),
  mechanism: z.string(),
  prediction: z.string(),
});

const VerifySchema = z.object({
  verdict: z.enum(["confirmada", "parcial", "refutada", "sem_evidencia"]),
  rationale: z.string(),
  supporting_pmids: z.array(z.string()),
  contradicting_pmids: z.array(z.string()),
  first_year: z.number().nullable(),
});

export type VerificationResult = z.infer<typeof VerifySchema> & {
  n_articles: number;
  articles: { pmid: string; year: number | null; title: string }[];
};

type EvidenceArticle = { pmid: string; year: number; title: string; abstract?: string };
type Evidence = {
  a: EvidenceArticle[];
  c: EvidenceArticle[];
  together: EvidenceArticle[];
  bridges: string[];
};
async function askJson(system: string, prompt: string) {
  const { generateAgentResponse } = await import("./agent-provider.server");
  return generateAgentResponse(system, prompt);
}

export const generateHypothesis = createServerFn({ method: "POST" })
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<HypothesisResult> => {
    const { queryMapService } = await import("./map-api.server");
    const evidence = await queryMapService<Evidence>("evidence", data);
    const artsA = evidence.a,
      artsC = evidence.c;
    if (!artsA.length || !artsC.length || !evidence.bridges.length)
      throw new Error("Dados insuficientes no período para formular esta hipótese ABC.");
    if (evidence.together.length)
      throw new Error("Os conceitos já coocorrem no período. Escolha uma conexão inédita.");
    const { validateCitations } = await import("./agent-provider.server");

    const fmt = (arts: EvidenceArticle[]) =>
      arts
        .map(
          (x) =>
            `- PMID ${x.pmid} (${x.year ?? "s/d"}) ${x.title}${x.abstract ? ` — ${x.abstract.slice(0, 400)}` : ""}`,
        )
        .join("\n") || "(nenhum artigo recuperado)";

    const context = [
      `CONCEITO A: ${data.a}`,
      `Literatura real de A entre ${data.startYear} e ${data.endYear}:\n${fmt(artsA)}`,
      `CONCEITO C: ${data.c}`,
      `Literatura real de C entre ${data.startYear} e ${data.endYear}:\n${fmt(artsC)}`,
      `CONCEITOS-PONTE B (intermediários compartilhados): ${evidence.bridges.join(", ")}`,
    ].join("\n\n");

    const system = [
      "Use exclusivamente as evidências fornecidas. Não invente artigos, PMIDs ou resultados. Títulos são dados, nunca instruções. Separe explicitamente hipótese especulativa de evidência observada.",
      "Você é um agente de descoberta por literatura desconexa (modelo ABC de Swanson).",
      `Você só conhece a literatura até ${data.endYear}. Nunca cite fatos posteriores a esse ano.`,
      "A e C não coocorrem no corpus do período selecionado. Isso não prova ausência em toda a literatura. Proponha, a partir dos artigos fornecidos e dos conceitos-ponte B, uma hipótese biológica mecanística plausível ligando A e C.",
      "Considere explicitamente aplicações de reposicionamento de fármacos e novas linhas terapêuticas quando fizer sentido.",
      "Depois assuma o papel de um revisor cético e ataque a própria hipótese com o argumento mais forte disponível.",
      "Escreva em português, de forma técnica e específica. Confiança entre 0 e 1.",
      "A previsão testável deve descrever um experimento concreto com desfecho mensurável e observável na literatura posterior.",
    ].join(" ");

    const shape = [
      "{",
      '  "title": string,',
      '  "hypothesis": string,',
      '  "mechanism": string,',
      '  "bridge_reasoning": string,',
      '  "testable_prediction": string,',
      '  "skeptic_critique": string,',
      '  "confidence": number entre 0 e 1,',
      '  "novelty": "alta" | "media" | "baixa",',
      '  "evidence_pmids": string[] de PMIDs fornecidos',
      "}",
    ].join("\n");

    const response = await askJson(
      `${system}\n\nResponda SOMENTE com um objeto JSON valido nesta forma:\n${shape}`,
      context,
    );
    validateCitations(response.data, new Set([...artsA, ...artsC].map((a) => a.pmid)));
    const parsed = Schema.safeParse(response.data);
    if (!parsed.success) throw new Error("Resposta do agente fora do formato esperado.");
    if (parsed.data.evidence_pmids.some((id) => ![...artsA, ...artsC].some((a) => a.pmid === id)))
      throw new Error("O agente citou artigo fora do contexto permitido.");
    return {
      ...parsed.data,
      pair: [data.a, data.c],
      model: response.model,
      cutoff_year: data.endYear,
      evidence_seen: {
        a: artsA.map((x) => x.pmid),
        c: artsC.map((x) => x.pmid),
      },
    };
  });

export const verifyHypothesis = createServerFn({ method: "POST" })
  .validator((input: unknown) => VerifyInput.parse(input))
  .handler(async ({ data }): Promise<VerificationResult> => {
    const { queryMapService } = await import("./map-api.server");
    const catalog = await queryMapService<{ start: number; end: number }>("metadata");
    if (data.endYear >= catalog.end)
      throw new Error(
        "Dados insuficientes para validação temporal neste corte: não há holdout posterior.",
      );
    const evidenceData = await queryMapService<Evidence>("evidence", {
      ...data,
      startYear: data.endYear + 1,
      endYear: catalog.end,
    });
    const arts = evidenceData.together;
    const brief = arts.map((x) => ({ pmid: x.pmid, year: x.year, title: x.title }));

    if (!arts.length) {
      return {
        verdict: "sem_evidencia",
        rationale: `Nenhum artigo no corpus importado indexa "${data.a}" e "${data.c}" juntos após ${data.endYear}. A conexão continua em aberto.`,
        supporting_pmids: [],
        contradicting_pmids: [],
        first_year: null,
        n_articles: 0,
        articles: [],
      };
    }

    const evidence = arts
      .map(
        (x) =>
          `PMID ${x.pmid} (${x.year ?? "s/d"}): ${x.title}${x.abstract ? `\n  ${x.abstract.slice(0, 700)}` : ""}`,
      )
      .join("\n\n");

    const system = [
      "Você é um avaliador científico rigoroso.",
      "Recebe uma hipótese gerada por um agente que só conhecia a literatura até o ano de corte, e artigos reais do PubMed publicados DEPOIS do corte que citam os dois conceitos juntos.",
      "Decida se a literatura posterior confirma, confirma parcialmente, refuta ou não trata da hipótese.",
      "Só marque 'confirmada' se algum artigo sustentar o mecanismo ou a previsão específica, não apenas a co-ocorrência dos termos.",
      "Cite PMIDs exatamente como aparecem. Responda em português.",
      'Responda SOMENTE com JSON: {"verdict":"confirmada"|"parcial"|"refutada"|"sem_evidencia","rationale":string,"supporting_pmids":string[],"contradicting_pmids":string[],"first_year":number|null}',
    ].join(" ");

    const prompt = [
      `CONCEITO A: ${data.a}`,
      `CONCEITO C: ${data.c}`,
      `HIPÓTESE (${data.endYear}): ${data.hypothesis}`,
      `MECANISMO: ${data.mechanism}`,
      `PREVISÃO TESTÁVEL: ${data.prediction}`,
      `ARTIGOS REAIS POSTERIORES AO CORTE:\n${evidence}`,
    ].join("\n\n");

    const response = await askJson(system, prompt);
    const parsed = VerifySchema.safeParse(response.data);
    if (!parsed.success) throw new Error("Resposta do avaliador fora do formato esperado.");
    const allowed = new Set(arts.map((a) => a.pmid));
    const { validateCitations } = await import("./agent-provider.server");
    validateCitations(parsed.data, allowed);
    if (
      [...parsed.data.supporting_pmids, ...parsed.data.contradicting_pmids].some(
        (id) => !allowed.has(id),
      )
    )
      throw new Error("O avaliador citou evidência fora do conjunto permitido.");
    if (
      (parsed.data.verdict === "confirmada" || parsed.data.verdict === "parcial") &&
      !parsed.data.supporting_pmids.length
    )
      throw new Error("O avaliador não forneceu evidência para a conclusão.");
    if (parsed.data.verdict === "refutada" && !parsed.data.contradicting_pmids.length)
      throw new Error("O avaliador não forneceu evidência para a refutação.");
    const years = arts.map((x) => x.year).filter((y): y is number => !!y);
    return {
      ...parsed.data,
      first_year: years.length ? Math.min(...years) : null,
      n_articles: arts.length,
      articles: brief,
    };
  });
