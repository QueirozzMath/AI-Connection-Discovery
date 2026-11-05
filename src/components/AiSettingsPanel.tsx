import { useState } from "react";
import { useAgentSession } from "./AgentSessionProvider";
import { useLanguage } from "./LanguageProvider";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import type { AiSettings } from "@/lib/ai-settings";
export function AiSettingsPanel({
  configuration,
}: {
  configuration?: { freeProvider: string; customEndpoints: string[] } | undefined;
}) {
  const { ai, setAi, apiKey, setApiKey } = useAgentSession();
  const { language } = useLanguage();
  const en = language === "en";
  const [draft, setDraft] = useState("");
  const change = (update: Partial<AiSettings>) => {
    if (
      update.provider !== undefined ||
      update.mode !== undefined ||
      update.baseUrl !== undefined
    ) {
      setApiKey("");
      setDraft("");
    }
    setAi({ ...ai, ...update });
  };
  const selectClass =
    "mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <section
      className="mt-4 rounded-lg border border-border bg-secondary/30 p-4"
      aria-label={en ? "AI settings" : "Configuração da IA"}
    >
      <h3 className="text-sm font-semibold">{en ? "AI model" : "Modelo de IA"}</h3>
      <label className="mt-3 block text-xs font-medium" htmlFor="ai-mode">
        {en ? "Access mode" : "Modo de acesso"}
      </label>
      <select
        id="ai-mode"
        value={ai.mode}
        onChange={(e) =>
          change({ mode: e.target.value as AiSettings["mode"], model: "", baseUrl: "" })
        }
        className={selectClass}
      >
        <option value="free">
          {en ? "Free · no personal key" : "Gratuito · sem chave pessoal"}
        </option>
        <option value="personal">{en ? "My API key" : "Minha chave de API"}</option>
        <option value="custom">{en ? "Custom model / LiteLLM" : "Modelo próprio / LiteLLM"}</option>
      </select>
      {ai.mode === "free" ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {en
            ? `Uses free models through ${configuration?.freeProvider ?? "OVHcloud"}. A full report may take up to 3 minutes. Shared quotas and availability apply. Never switches to a paid model. Selected evidence is sent to the provider; the actual model is shown in the result.`
            : `Usa modelos gratuitos via ${configuration?.freeProvider ?? "OVHcloud"}. Um relatório completo pode levar até 3 minutos. Sujeito a cotas compartilhadas e disponibilidade. Nunca troca para um modelo pago. As evidências selecionadas são enviadas ao provedor; o modelo utilizado aparece no resultado.`}
        </p>
      ) : (
        <>
          {ai.mode === "personal" && (
            <>
              <label className="mt-3 block text-xs font-medium" htmlFor="ai-provider">
                {en ? "Provider" : "Provedor"}
              </label>
              <select
                id="ai-provider"
                value={ai.provider}
                onChange={(e) =>
                  change({ provider: e.target.value as AiSettings["provider"], model: "" })
                }
                className={selectClass}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic · Claude</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </>
          )}
          {ai.mode === "custom" && (
            <>
              <label className="mt-3 block text-xs font-medium" htmlFor="ai-base-url">
                {en ? "API base URL" : "Endereço base da API"}
              </label>
              <Input
                id="ai-base-url"
                type="url"
                placeholder="https://api.example.org/v1"
                value={ai.baseUrl}
                onChange={(e) => change({ baseUrl: e.target.value })}
                className="mt-1 min-h-11"
                list="ai-approved-endpoints"
              />
              <datalist id="ai-approved-endpoints">
                {configuration?.customEndpoints.map((url) => (
                  <option key={url} value={url} />
                ))}
              </datalist>
              <p className="mt-2 text-xs text-muted-foreground">
                {en
                  ? "OpenAI-compatible Chat Completions endpoint (LiteLLM, vLLM, Ollama). The administrator must authorize the HTTPS address. Private network servers need an accessible gateway; localhost is not reachable from this site."
                  : "API Chat Completions compatível com OpenAI (LiteLLM, vLLM, Ollama). O administrador precisa autorizar o endereço HTTPS. Servidores na rede interna precisam de um gateway acessível; localhost não é acessível por este site."}
              </p>
            </>
          )}
          <label className="mt-3 block text-xs font-medium" htmlFor="ai-model">
            {en ? "Model identifier" : "Identificador do modelo"}
          </label>
          <Input
            id="ai-model"
            value={ai.model}
            onChange={(e) => change({ model: e.target.value })}
            placeholder={
              en ? "Exact model ID from your provider" : "ID exato do modelo no seu provedor"
            }
            maxLength={200}
            className="mt-1 min-h-11"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {en
              ? "Requires text generation with JSON output. Provider charges may apply. Your key is sent only to the selected provider and stays in memory until this page is reloaded."
              : "Requer geração de texto com saída JSON. Pode haver cobrança pelo provedor. Sua chave é enviada somente ao provedor escolhido e fica na memória até recarregar a página."}
          </p>
          {apiKey ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs" role="status">
                {en ? "Key available in this session" : "Chave disponível nesta sessão"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setApiKey("");
                  setDraft("");
                }}
              >
                {en ? "Remove key" : "Remover chave"}
              </Button>
            </div>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setApiKey(draft.trim());
                setDraft("");
              }}
            >
              <div className="min-w-40 flex-1">
                <label htmlFor="ai-api-key" className="text-xs">
                  {en ? "API key" : "Chave da API"}
                  {ai.mode === "custom" ? (en ? " (optional)" : " (opcional)") : ""}
                </label>
                <Input
                  id="ai-api-key"
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  className="mt-1 min-h-11"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={!draft.trim()}
                className="min-h-11"
              >
                {en ? "Use in this session" : "Usar nesta sessão"}
              </Button>
            </form>
          )}
          {ai.mode === "custom" &&
            !configuration?.customEndpoints.includes(ai.baseUrl.replace(/\/+$/, "")) && (
              <p role="status" className="mt-2 text-xs text-warning">
                {en
                  ? "This address is not yet authorized. Ask the administrator to register it before generating."
                  : "Este endereço ainda não está autorizado. Peça ao administrador para cadastrá-lo antes de gerar."}
              </p>
            )}
        </>
      )}
    </section>
  );
}
