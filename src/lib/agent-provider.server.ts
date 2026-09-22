import { DEFAULT_AI_MODEL } from "./agent-config.ts";
export { DEFAULT_AI_MODEL } from "./agent-config.ts";
export interface AgentBinding {
  run(
    model: string,
    input: {
      messages: { role: string; content: string }[];
      max_tokens: number;
      temperature: number;
    },
  ): Promise<{ response?: string }>;
}
export async function generateAgentResponse(
  system: string,
  prompt: string,
  binding?: AgentBinding,
  model?: string,
) {
  if (!binding) {
    const { env } = await import("cloudflare:workers").catch(() => {
      throw new Error(
        "Workers AI indispon?vel neste ambiente. Execute o build no Worker com binding AI.",
      );
    });
    binding = env.AI;
    model = env.AI_MODEL;
  }
  if (!binding)
    throw new Error("Workers AI indisponível: configure o binding AI no servidor Cloudflare.");
  const selectedModel = model || DEFAULT_AI_MODEL;
  const result = await binding.run(selectedModel, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: 2048,
    temperature: 0.2,
  });
  if (!result.response) throw new Error("O modelo não retornou uma resposta textual.");
  const raw = result.response.replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{"),
    end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("O agente não retornou JSON válido.");
  return { data: JSON.parse(raw.slice(start, end + 1)) as unknown, model: selectedModel };
}
export function validateCitations(value: unknown, allowed: Set<string>) {
  for (const match of JSON.stringify(value).matchAll(/PMID\s*[:#]?\s*(\d+)/gi)) {
    if (!allowed.has(match[1]!))
      throw new Error("O agente citou um PMID fora das evidências fornecidas.");
  }
}
