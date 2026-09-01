import { createServerFn } from "@tanstack/react-start";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

const Input = z.object({
  a: z.string(),
  c: z.string(),
  intermediaries: z.array(z.string()),
  prob: z.number(),
  cutoffYear: z.number(),
  articlesA: z.array(z.string()).optional(),
  articlesC: z.array(z.string()).optional(),
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
};

const MODEL = "google/gemini-3.7-flash";

export const generateHypothesis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<HypothesisResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY ausente no ambiente do servidor.");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const context = [
      `CONCEITO A: ${data.a}`,
      data.articlesA?.length
        ? `Artigos representativos de A (até ${data.cutoffYear}):\n- ${data.articlesA.join("\n- ")}`
        : "",
      `CONCEITO C: ${data.c}`,
      data.articlesC?.length
        ? `Artigos representativos de C (até ${data.cutoffYear}):\n- ${data.articlesC.join("\n- ")}`
        : "",
      `CONCEITOS-PONTE B (intermediários compartilhados): ${data.intermediaries.join(", ")}`,
      `Probabilidade estimada pelo modelo de ligação: ${(data.prob * 100).toFixed(1)}%`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const system = [
      "Você é um agente de descoberta por literatura desconexa (modelo ABC de Swanson).",
      `Você só conhece a literatura até ${data.cutoffYear}. Nunca cite fatos posteriores a esse ano.`,
      "A e C nunca foram citados juntos em um mesmo artigo. Sua tarefa é propor, a partir apenas dos conceitos-ponte B, uma hipótese biológica mecanística plausível ligando A e C.",
      "Depois assuma o papel de um revisor cético e ataque a própria hipótese com o argumento mais forte disponível.",
      "Escreva em português, de forma técnica e específica. Nada de generalidades. Confiança entre 0 e 1.",
      "A previsão testável deve descrever um experimento concreto com desfecho mensurável.",
    ].join(" ");

    try {
      const result = streamText({
        model: gateway(MODEL),
        system,
        prompt: context,
        output: Output.object({ schema: Schema }),
      });
      const output = await result.output;
      return { ...output, pair: [data.a, data.c], model: MODEL };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && error.text) {
        const cleaned = error.text.replace(/```json|```/g, "").trim();
        const parsed = Schema.safeParse(JSON.parse(cleaned));
        if (parsed.success) {
          return { ...parsed.data, pair: [data.a, data.c], model: MODEL };
        }
      }
      throw error;
    }
  });
