import {
  AiSettingsSchema,
  type AiSettings,
  type AiAttempt,
  type AiProvenance,
} from "./ai-settings";
const OVH = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";
const OR = "https://openrouter.ai/api/v1";
const FREE_MODEL = "Meta-Llama-3_3-70B-Instruct";
const MAX_BODY = 1_000_000;
class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
function normalizeEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiError("endpoint", "Informe um endereço HTTPS válido para a API.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9.-]+$/.test(host) ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new AiError(
      "endpoint",
      "A API própria precisa usar um domínio HTTPS público, sem credenciais na URL.",
    );
  return url.href.replace(/\/+$/, "");
}
export function customEndpoints(): string[] {
  return (process.env["AI_CUSTOM_ENDPOINTS"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [normalizeEndpoint(s)];
      } catch {
        return [];
      }
    });
}
export function validateCustomEndpoint(raw: string): string {
  const normalized = normalizeEndpoint(raw);
  if (!customEndpoints().includes(normalized))
    throw new AiError(
      "endpoint",
      "Este endereço ainda não foi autorizado pelo administrador da plataforma. Cadastre a URL em AI_CUSTOM_ENDPOINTS para usar seu servidor ou LiteLLM.",
    );
  return normalized;
}
export function aiConfiguration() {
  return {
    configured: true,
    freeAvailable: true,
    freeProvider: process.env["OPENROUTER_API_KEY"] ? "OpenRouter / OVHcloud" : "OVHcloud",
    freeModel: FREE_MODEL,
    openRouterConfigured: Boolean(process.env["OPENROUTER_API_KEY"]?.trim()),
    customEndpoints: customEndpoints(),
    model: FREE_MODEL,
  };
}
type Target = {
  provider: string;
  model: string;
  url: string;
  key?: string | undefined;
  dialect: "chat" | "gemini" | "anthropic";
  free: boolean;
};
function targets(settings: AiSettings, key?: string): Target[] {
  if (settings.mode === "free") {
    // Personal credentials and model names are deliberately ignored in this mode.
    const routerKey = process.env["OPENROUTER_API_KEY"]?.trim();
    return [
      ...(routerKey
        ? [
            {
              provider: "openrouter",
              model: "openrouter/free",
              url: `${OR}/chat/completions`,
              key: routerKey,
              dialect: "chat" as const,
              free: true,
            },
          ]
        : []),
      {
        provider: "ovhcloud",
        model: FREE_MODEL,
        url: `${OVH}/chat/completions`,
        dialect: "chat",
        free: true,
      },
    ];
  }
  const model = settings.model.trim();
  if (!model)
    throw new AiError("model", "Informe o identificador do modelo disponível na sua API.");
  if (settings.mode === "custom")
    return [
      {
        provider: "custom",
        model,
        url: `${validateCustomEndpoint(settings.baseUrl)}/chat/completions`,
        key,
        dialect: "chat",
        free: false,
      },
    ];
  if (!key?.trim())
    throw new AiError(
      "key",
      "Informe a chave da API escolhida. A chave fica somente nesta sessão.",
    );
  const providers = {
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      dialect: "gemini" as const,
    },
    openai: { url: "https://api.openai.com/v1/chat/completions", dialect: "chat" as const },
    anthropic: { url: "https://api.anthropic.com/v1/messages", dialect: "anthropic" as const },
    openrouter: { url: `${OR}/chat/completions`, dialect: "chat" as const },
  };
  return [
    {
      provider: settings.provider,
      model,
      key: key.trim(),
      free: false,
      ...providers[settings.provider],
    },
  ];
}
function request(target: Target, system: string, prompt: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  let body: Record<string, unknown>;
  if (target.dialect === "gemini") {
    headers["x-goog-api-key"] = target.key!;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
    };
  } else if (target.dialect === "anthropic") {
    headers["x-api-key"] = target.key!;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: target.model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
    };
  } else {
    if (target.key) headers["Authorization"] = `Bearer ${target.key}`;
    body = {
      model: target.model,
      messages,
      stream: false,
      response_format: { type: "json_object" },
      ...(target.provider === "openai" ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
      ...(target.provider === "openrouter" && target.free
        ? { provider: { max_price: { prompt: 0, completion: 0 }, require_parameters: true } }
        : {}),
    };
  }
  return { headers, body: JSON.stringify(body) };
}
function httpError(status: number): AiError {
  if ([401, 403].includes(status))
    return new AiError(
      "credentials",
      "A API recusou a chave ou o acesso. Confira a chave, as permissões e a conta do provedor.",
    );
  if (status === 402)
    return new AiError(
      "credits",
      "O provedor informou falta de créditos. O modo gratuito não usa modelos pagos.",
    );
  if (status === 429)
    return new AiError(
      "quota",
      "O limite de uso do modelo foi atingido. Aguarde antes de tentar novamente ou use uma chave pessoal.",
      true,
    );
  if (status === 404)
    return new AiError(
      "model",
      "O modelo não está disponível nesta API. Confira o identificador do modelo.",
    );
  if (status === 400 || status === 422)
    return new AiError(
      "request",
      "A API não aceitou o modelo ou o formato JSON solicitado. Use um modelo compatível com Chat Completions e JSON.",
    );
  return new AiError(
    "unavailable",
    "O provedor está temporariamente indisponível. Tente novamente mais tarde.",
    status >= 500 || status === 408,
  );
}
async function readPayload(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new AiError("empty", "A API retornou uma resposta vazia.");
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY) {
        await reader.cancel();
        throw new AiError("size", "A resposta da API excedeu o limite de tamanho.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (
      error instanceof AiError ||
      (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        ["AbortError", "TimeoutError"].includes(String(error.name)))
    )
      throw error;
    throw new AiError("format", "A API não retornou uma resposta JSON válida.");
  }
}
function extract(payload: any, target: Target) {
  let text: unknown, finish: string | undefined;
  if (target.dialect === "gemini") {
    const candidate = payload.candidates?.[0];
    finish = candidate?.finishReason;
    text = candidate?.content?.parts
      ?.filter((p: any) => !p.thought)
      .map((p: any) => p.text || "")
      .join("");
    if (finish !== "STOP")
      throw new AiError(
        "incomplete",
        "O modelo não concluiu a resposta. Tente novamente ou escolha outro modelo.",
      );
  } else if (target.dialect === "anthropic") {
    finish = payload.stop_reason;
    if (finish !== "end_turn")
      throw new AiError(
        "incomplete",
        "O Claude não concluiu a resposta. Tente novamente ou escolha outro modelo.",
      );
    text = payload.content
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
  } else {
    finish = payload.choices?.[0]?.finish_reason;
    if (finish !== "stop")
      throw new AiError(
        "incomplete",
        "O modelo não concluiu a resposta. Tente novamente ou escolha outro modelo.",
      );
    text = payload.choices?.[0]?.message?.content;
  }
  if (typeof text !== "string")
    throw new AiError("format", "O modelo não retornou conteúdo textual válido.");
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim());
  } catch {
    throw new AiError(
      "format",
      "O modelo não retornou JSON válido. Tente novamente ou escolha outro modelo.",
    );
  }
}
export async function askAiJson(
  system: string,
  prompt: string,
  raw?: AiSettings,
  apiKey?: string,
): Promise<{ data: unknown; provenance: AiProvenance }> {
  const settings = AiSettingsSchema.parse(raw ?? {});
  const pool = targets(settings, apiKey);
  const attempts: AiAttempt[] = [];
  let last: AiError = new AiError("unavailable", "Nenhum modelo disponível.");
  for (let i = 0; i < Math.min(2, pool.length === 1 && !pool[0]!.free ? 2 : pool.length); i++) {
    const target = pool[Math.min(i, pool.length - 1)]!;
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), target.free ? 65000 : 120000);
      let payload: any;
      try {
        const response = await fetch(target.url, {
          method: "POST",
          ...request(target, system, prompt),
          signal: controller.signal,
          redirect: "manual",
        });
        // Workers supports manual/follow, not redirect:error. Never forward credentials.
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new AiError(
            "redirect",
            "A API tentou redirecionar a solicitação. Use o endereço final do provedor.",
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw httpError(response.status);
        }
        payload = await readPayload(response);
      } finally {
        clearTimeout(timer);
      }
      const data = extract(payload, target);
      // OpenRouter's router reports the actual serving model, rather than its routing alias.
      const model =
        typeof payload.model === "string" && /^[\w.\/:\-]{1,200}$/.test(payload.model)
          ? payload.model
          : target.model;
      attempts.push({
        provider: target.provider,
        model,
        outcome: "ok",
        elapsedMs: Date.now() - start,
      });
      return {
        data,
        provenance: { provider: target.provider, model, mode: settings.mode, attempts },
      };
    } catch (error) {
      last =
        error instanceof AiError
          ? error
          : new AiError(
              typeof error === "object" &&
                error !== null &&
                "name" in error &&
                ["AbortError", "TimeoutError"].includes(String(error.name))
                ? "timeout"
                : "network",
              typeof error === "object" &&
                error !== null &&
                "name" in error &&
                ["AbortError", "TimeoutError"].includes(String(error.name))
                ? "O modelo excedeu o tempo de resposta. Sua conexão selecionada foi mantida; tente novamente ou escolha outro modelo."
                : "Não foi possível conectar ao provedor. Confira a disponibilidade da API e tente novamente.",
              true,
            );
      attempts.push({
        provider: target.provider,
        model: target.model,
        outcome: last.code,
        elapsedMs: Date.now() - start,
      });
      console.warn("ai_attempt", {
        provider: target.provider,
        model: target.provider === "custom" ? "custom" : target.model,
        code: last.code,
        elapsedMs: Date.now() - start,
      });
      if (!target.free && (!last.retryable || last.code === "timeout" || last.code === "quota"))
        break;
      if (i === 0 && pool.length === 1 && !target.free)
        await new Promise((r) => setTimeout(r, 750 + Math.random() * 500));
    }
  }
  throw new Error(last.message);
}
