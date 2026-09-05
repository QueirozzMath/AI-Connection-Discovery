import { createServerFn } from "@tanstack/react-start";
import { streamText } from "ai";
import { z } from "zod";

const Input = z.object({
  a: z.string(),
  c: z.string(),
  intermediaries: z.array(z.string()),
  prob: z.number(),
  cutoffYear: z.number(),
});

const Schema = z.object({
  title: z.string(),
  hypothesis: z.string(),
  mechanism: z.string(),
  bridge_reasoning: z.string(),
  testable_prediction: z.string(),
  skeptic_critique: z.string(),
  confidence: z.number(),
  novelty: z.enum(["alta", "media", "baixa"]),
});

export type HypothesisResult = z.infer<typeof Schema> & {
  pair: [string, string];
  model: string;
  cutoff_year: number;
  evidence_seen: { a: string[]; c: string[] };
};

const VerifyInput = z.object({
  a: z.string(),
  c: z.string(),
  cutoffYear: z.number(),
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

const MODEL = "google/gemini-3.7-flash";

async function askJson(system: string, prompt: string, key: string) {
  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const gateway = createLovableAiGatewayProvider(key);
  const result = streamText({ model: gateway(MODEL), system, prompt });
  const raw = await result.text;
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("O agente nao retornou um JSON valido.");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

export const generateHypothesis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<HypothesisResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY ausente no ambiente do servidor.");

    const { conceptArticles } = await import("./pubmed.server");
    const [artsA, artsC] = await Promise.all([
      conceptArticles(data.a, data.cutoffYear).catch(() => []),
      conceptArticles(data.c, data.cutoffYear).catch(() => []),
    ]);

    const fmt = (arts: { year: number | null; title: string; abstract: string }[]) =>
      arts
        .map((x) => `- (${x.year ?? "s/d"}) ${x.title}${x.abstract ? ` — ${x.abstract.slice(0, 400)}` : ""}`)
        .join("\n") || "(nenhum artigo recuperado)";

    const context = [
      `CONCEITO A: ${data.a}`,
      `Literatura real de A até ${data.cutoffYear}:\n${fmt(artsA)}`,
      `CONCEITO C: ${data.c}`,
      `Literatura real de C até ${data.cutoffYear}:\n${fmt(artsC)}`,
      `CONCEITOS-PONTE B (intermediários compartilhados): ${data.intermediaries.join(", ")}`,
      `Probabilidade estimada pelo modelo de ligação: ${(data.prob * 100).toFixed(1)}%`,
    ].join("\n\n");

    const system = [
      "Você é um agente de descoberta por literatura desconexa (modelo ABC de Swanson).",
      `Você só conhece a literatura até ${data.cutoffYear}. Nunca cite fatos posteriores a esse ano.`,
      "A e C nunca foram citados juntos em um mesmo artigo. Proponha, a partir dos artigos fornecidos e dos conceitos-ponte B, uma hipótese biológica mecanística plausível ligando A e C.",
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
      "}",
    ].join("\n");

    const parsed = Schema.safeParse(
      await askJson(`${system}\n\nResponda SOMENTE com um objeto JSON valido nesta forma:\n${shape}`, context, key),
    );
    if (!parsed.success) throw new Error("Resposta do agente fora do formato esperado.");
    return {
      ...parsed.data,
      pair: [data.a, data.c],
      model: MODEL,
      cutoff_year: data.cutoffYear,
      evidence_seen: {
        a: artsA.map((x) => x.pmid),
        c: artsC.map((x) => x.pmid),
      },
    };
  });

export const verifyHypothesis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => VerifyInput.parse(input))
  .handler(async ({ data }): Promise<VerificationResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY ausente no ambiente do servidor.");

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

    const parsed = VerifySchema.safeParse(await askJson(system, prompt, key));
    if (!parsed.success) throw new Error("Resposta do avaliador fora do formato esperado.");
    const years = arts.map((x) => x.year).filter((y): y is number => !!y);
    return {
      ...parsed.data,
      first_year: parsed.data.first_year ?? (years.length ? Math.min(...years) : null),
      n_articles: arts.length,
      articles: brief,
    };
  });
