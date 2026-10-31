const DEFAULT_MODEL = "gemini-3.8-flash";

export function geminiConfiguration() {
  return {
    configured: Boolean(process.env["GEMINI_API_KEY"]?.trim()),
    model: process.env["GEMINI_MODEL"]?.trim() || DEFAULT_MODEL,
  };
}

export function resolveGeminiKey(sessionKey?: string): string {
  const key = sessionKey?.trim() || process.env["GEMINI_API_KEY"]?.trim();
  if (!key) {
    throw new Error("Informe sua chave do Gemini na seção de IA para gerar hipóteses.");
  }
  return key;
}

export async function askGeminiJson(system: string, prompt: string, apiKey: string): Promise<unknown> {
  const { model } = geminiConfiguration();
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(90000),
      },
    );
  } catch {
    throw new Error("Não foi possível acessar o Gemini. Tente novamente em alguns instantes.");
  }

  // Do not forward provider error bodies: they can contain credentials or request data.
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) {
      throw new Error("O Gemini recusou a chave ou a solicitação. Confira a chave e o acesso à API no Google AI Studio.");
    }
    if (response.status === 429) {
      throw new Error("A cota do Gemini foi atingida. Aguarde e confira os limites gratuitos no Google AI Studio.");
    }
    if (response.status === 404) {
      throw new Error("O modelo Gemini configurado não está disponível para esta chave.");
    }
    throw new Error("O Gemini está indisponível no momento. Tente novamente mais tarde.");
  }

  const payload = await response.json() as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error("O Gemini não concluiu a resposta. Tente gerar a hipótese novamente.");
  }
  const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("") || "";
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim()) as unknown;
  } catch {
    throw new Error("O Gemini não retornou uma resposta válida. Tente novamente.");
  }
}
