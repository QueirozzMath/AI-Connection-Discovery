import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { manifestoPrompt } from "./discovery-manifesto";

const Input = z.object({
  a: z.string(),
  c: z.string(),
  intermediaries: z.array(z.string().max(200)).max(6),
  prob: z.number(),
  cutoffYear: z.number(),
  apiKey: z.string().trim().min(20).max(200).optional(),
});

const Schema = z.object({
  title: z.string(),
  hypothesis: z.string(),
  mechanism: z.string(),
  bridge_reasoning: z.string(),
  testable_prediction: z.string(),
  skeptic_critique: z.string(),
  confidence: z.number().min(0).max(1),
  novelty: z.enum(["alta", "media", "baixa"]),
  innovation_value: z.string(),
  falsification: z.string(),
  evidence_limitations: z.string(),
});

export type HypothesisResult = z.infer<typeof Schema> & {
  pair: [string, string];
  model: string;
  cutoff_year: number;
  evidence_seen: {
    a: string[];
    c: string[];
    bridges: { term: string; ab: string[]; bc: string[] }[];
  };
};

const VerifyInput = z.object({
  a: z.string(),
  c: z.string(),
  cutoffYear: z.number(),
  apiKey: z.string().trim().min(20).max(200).optional(),
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

export const getAiConfiguration = createServerFn({ method: "GET" }).handler(async () => {
  const { geminiConfiguration } = await import("./gemini.server");
  return geminiConfiguration();
});

export const generateHypothesis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<HypothesisResult> => {
    const { askGeminiJson, resolveGeminiKey, geminiConfiguration } =
      await import("./gemini.server");
    const key = resolveGeminiKey(data.apiKey);

    const { conceptArticles, bridgeArticles } = await import("./pubmed.server");
    const [artsA, artsC] = await Promise.all([
      conceptArticles(data.a, data.cutoffYear).catch(() => []),
      conceptArticles(data.c, data.cutoffYear).catch(() => []),
    ]);
    const bridgeEvidence = [];
    for (const term of data.intermediaries.slice(0, 3)) {
      const ab = await bridgeArticles(data.a, term, data.cutoffYear).catch(() => []);
      const bc = await bridgeArticles(term, data.c, data.cutoffYear).catch(() => []);
      bridgeEvidence.push({ term, ab, bc });
    }
    if (!bridgeEvidence.some((bridge) => bridge.ab.length && bridge.bc.length))
      throw new Error(
        "Evidência insuficiente: não foi possível recuperar artigos para os dois braços A–B e B–C de uma ponte. Escolha outro par ou tente novamente.",
      );

    const fmt = (arts: { pmid: string; year: number | null; title: string; abstract: string }[]) =>
      arts
        .map(
          (x) =>
            `- PMID ${x.pmid} (${x.year ?? "s/d"}) ${x.title}${x.abstract ? ` — ${x.abstract.slice(0, 700)}` : ""}`,
        )
        .join("\n") || "(nenhum artigo recuperado)";

    const context = [
      `CONCEITO A: ${data.a}`,
      `Literatura real de A até ${data.cutoffYear}:\n${fmt(artsA)}`,
      `CONCEITO C: ${data.c}`,
      `Literatura real de C até ${data.cutoffYear}:\n${fmt(artsC)}`,
      `CONCEITOS-PONTE B (intermediários compartilhados): ${data.intermediaries.join(", ")}`,
      ...bridgeEvidence.map(
        (bridge) => `PONTE ${bridge.term}\nA–B:\n${fmt(bridge.ab)}\nB–C:\n${fmt(bridge.bc)}`,
      ),
      `Probabilidade estimada pelo modelo de ligação: ${(data.prob * 100).toFixed(1)}%`,
    ].join("\n\n");

    const system = [
      manifestoPrompt(data.cutoffYear),
      "Você é um agente de descoberta por literatura desconexa (modelo ABC de Swanson).",
      `Você só conhece a literatura até ${data.cutoffYear}. Nunca cite fatos posteriores a esse ano.`,
      "A–C não foi observado no grafo amostrado do corte; isso não garante ineditismo global. Use exclusivamente a evidência fornecida para construir uma hipótese mecanística, distinguindo fatos documentados de extrapolações.",
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
      '  "novelty": "alta" | "media" | "baixa"',
      '  ,"innovation_value": string descrevendo a função transferida e o ganho potencial sobre a abordagem existente,',
      '  "falsification": string com hipótese alternativa e resultado que refutaria a proposta,',
      '  "evidence_limitations": string com lacunas de cada braço A–B e B–C e limites da extrapolação',
      "}",
    ].join("\n");

    const parsed = Schema.safeParse(
      await askGeminiJson(
        `${system}\n\nResponda SOMENTE com um objeto JSON valido nesta forma:\n${shape}`,
        context,
        key,
      ),
    );
    if (!parsed.success) throw new Error("Resposta do agente fora do formato esperado.");
    return {
      ...parsed.data,
      pair: [data.a, data.c],
      model: geminiConfiguration().model,
      cutoff_year: data.cutoffYear,
      evidence_seen: {
        a: artsA.map((x) => x.pmid),
        c: artsC.map((x) => x.pmid),
        bridges: bridgeEvidence.map((bridge) => ({
          term: bridge.term,
          ab: bridge.ab.map((article) => article.pmid),
          bc: bridge.bc.map((article) => article.pmid),
        })),
      },
    };
  });

export const verifyHypothesis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => VerifyInput.parse(input))
  .handler(async ({ data }): Promise<VerificationResult> => {
    const { askGeminiJson, resolveGeminiKey } = await import("./gemini.server");

    const { coOccurrenceArticles } = await import("./pubmed.server");
    const arts = await coOccurrenceArticles(data.a, data.c, data.cutoffYear);
    const brief = arts.map((x) => ({ pmid: x.pmid, year: x.year, title: x.title }));

    if (!arts.length) {
      return {
        verdict: "sem_evidencia",
        rationale: `Nenhum artigo no PubMed indexa "${data.a}" e "${data.c}" juntos após ${data.cutoffYear}. A conexão continua em aberto.`,
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
      `HIPÓTESE (${data.cutoffYear}): ${data.hypothesis}`,
      `MECANISMO: ${data.mechanism}`,
      `PREVISÃO TESTÁVEL: ${data.prediction}`,
      `ARTIGOS REAIS POSTERIORES AO CORTE:\n${evidence}`,
    ].join("\n\n");

    const parsed = VerifySchema.safeParse(
      await askGeminiJson(system, prompt, resolveGeminiKey(data.apiKey)),
    );
    if (!parsed.success) throw new Error("Resposta do avaliador fora do formato esperado.");
    const years = arts.map((x) => x.year).filter((y): y is number => !!y);
    return {
      ...parsed.data,
      first_year: parsed.data.first_year ?? (years.length ? Math.min(...years) : null),
      n_articles: arts.length,
      articles: brief,
    };
  });
