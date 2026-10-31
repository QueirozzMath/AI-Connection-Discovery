import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { BrainCircuit, FlaskConical, Loader2, SearchCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { candidatesQuery, indexQuery, pct, type Candidate } from "@/lib/science-data";
import {
  generateHypothesis,
  getAiConfiguration,
  verifyHypothesis,
  type HypothesisResult,
  type VerificationResult,
} from "@/lib/hypothesis.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { DISCOVERY_MANIFESTO } from "@/lib/discovery-manifesto";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const searchSchema = z.object({
  a: fallback(z.string(), "").default(""),
  c: fallback(z.string(), "").default(""),
  cutoff: fallback(z.number(), 0).default(0),
  b: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/hypotheses")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Agentes de hipótese — AI Connection Discovery" },
      {
        name: "description",
        content:
          "Agentes de IA leem só a literatura anterior ao corte, formulam hipóteses mecanísticas e depois buscam artigos reais no PubMed para confirmar ou refutar cada uma.",
      },
      { property: "og:title", content: "Agentes de hipótese — AI Connection Discovery" },
      {
        property: "og:description",
        content:
          "Hipóteses geradas por IA para conexões inéditas entre MeSH terms, com revisão cética e verificação no PubMed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  ssr: false,
  component: () => (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando pares…</div>}>
      <HypothesesPage />
    </Suspense>
  ),
});

const VERDICTS: Record<string, { label: string; className: string }> = {
  confirmada: { label: "hipótese confirmada", className: "bg-accent text-accent-foreground" },
  parcial: { label: "parcialmente confirmada", className: "bg-chart-3 text-background" },
  refutada: { label: "refutada", className: "bg-destructive text-destructive-foreground" },
  sem_evidencia: { label: "sem evidência ainda", className: "" },
};

function HypothesesPage() {
  const { data: idx } = useSuspenseQuery(indexQuery);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const cutoff = idx.cutoffs.includes(search.cutoff) ? search.cutoff : idx.default_cutoff;
  const { data } = useSuspenseQuery(candidatesQuery(cutoff));
  const runGenerate = useServerFn(generateHypothesis);
  const runVerify = useServerFn(verifyHypothesis);
  const readConfiguration = useServerFn(getAiConfiguration);
  const { data: aiConfiguration, isPending: configurationPending } = useQuery({
    queryKey: ["ai-configuration"],
    queryFn: () => readConfiguration(),
    staleTime: 60000,
  });
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const aiReady = Boolean(aiConfiguration?.configured || apiKey);

  const initial = useMemo(() => {
    if (search.a && search.c) {
      return (
        data.items.find((i) => i.a === search.a && i.c === search.c) ?? {
          rank: 0,
          a: search.a,
          c: search.c,
          prob: 0.5,
          confirmed: false,
          first_year: null,
          lead_time_years: null,
          intermediaries: search.b.split("|").filter(Boolean).slice(0, 6),
          features: {},
        }
      );
    }
    return (
      data.items[0] ?? {
        rank: 0,
        a: "",
        c: "",
        prob: 0,
        confirmed: false,
        first_year: null,
        lead_time_years: null,
        intermediaries: [],
        features: {},
      }
    );
  }, [data.items, search.a, search.c, search.b]);

  const [pair, setPair] = useState<Candidate>(initial);
  useEffect(() => setPair(initial), [initial]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<Record<string, HypothesisResult>>({});
  const [checks, setChecks] = useState<Record<string, VerificationResult>>({});

  const key = `${cutoff}::${pair.a}::${pair.c}`;
  const result = results[key];
  const check = checks[key];

  const generate = async () => {
    setLoading(true);
    try {
      const res = await runGenerate({
        data: {
          apiKey: apiKey || undefined,
          a: pair.a,
          c: pair.c,
          intermediaries: pair.intermediaries,
          prob: pair.prob,
          cutoffYear: cutoff,
        },
      });
      setResults((r) => ({ ...r, [key]: res }));
      setChecks((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar hipótese");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!result) return;
    setVerifying(true);
    try {
      const res = await runVerify({
        data: {
          apiKey: apiKey || undefined,
          a: pair.a,
          c: pair.c,
          cutoffYear: cutoff,
          hypothesis: result.hypothesis,
          mechanism: result.mechanism,
          prediction: result.testable_prediction,
        },
      });
      setChecks((c) => ({ ...c, [key]: res }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao verificar no PubMed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div data-tour="agents" className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-sidebar p-4 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        <h1 className="font-display text-lg font-semibold">Agentes de hipótese</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Corte {cutoff}: cada agente vê apenas artigos reais do PubMed publicados até esse ano.
        </p>
        <Select
          value={String(cutoff)}
          onValueChange={(value) =>
            void navigate({
              search: (previous) => ({ ...previous, cutoff: Number(value), a: "", c: "" }),
            })
          }
        >
          <SelectTrigger className="mt-3 h-9">
            <SelectValue aria-label="Ano de corte" />
          </SelectTrigger>
          <SelectContent>
            {idx.cutoffs.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScrollArea className="mt-3 h-[calc(100%-8rem)] rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {data.items.slice(0, 120).map((c) => (
              <li key={`${c.a}-${c.c}`}>
                <button
                  onClick={() => setPair(c)}
                  className="w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-secondary"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted-foreground">#{c.rank}</span>
                    <span className="font-mono text-[11px] text-primary">
                      prioridade {((c.priority ?? 0) * 100).toFixed(1)}/100
                    </span>
                  </div>
                  <p className="mt-1 leading-snug">
                    {c.a} <span className="text-muted-foreground">⇢</span> {c.c}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {!data.items.length && (
            <p className="p-4 text-xs text-muted-foreground">
              Não há pares elegíveis neste corte. Escolha outro ano ou volte ao Mapa para selecionar
              conceitos.
            </p>
          )}
        </ScrollArea>
      </aside>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <details className="panel p-5" open>
            <summary className="cursor-pointer font-display text-lg font-semibold">
              Manifesto de descoberta disruptiva
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Transferir funções entre campos, reconstruir pontes raras e propor experimentos
              capazes de refutar a ideia. A ambição é inovação mecanística; o ranking é uma
              prioridade exploratória, sem garantia de descoberta.
            </p>
            <ol className="mt-3 space-y-3">
              {DISCOVERY_MANIFESTO.map(([title, body]) => (
                <li key={title}>
                  <strong className="text-sm">{title}</strong>
                  <p className="text-xs text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Referências de transferência de função:{" "}
              <a
                className="text-primary underline"
                href="https://pubmed.ncbi.nlm.nih.gov/16116447/"
                target="_blank"
                rel="noreferrer"
              >
                canalrodopsina e controle neuronal (2005)
              </a>
              ;{" "}
              <a
                className="text-primary underline"
                href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5626408/"
                target="_blank"
                rel="noreferrer"
              >
                Zika contra células-tronco de glioblastoma, evidência pré-clínica (2017)
              </a>
              . Exemplos posteriores ao corte não são usados como evidência.
            </p>
          </details>
          <section className="panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              {pair.rank > 0 && <Badge variant="secondary">#{pair.rank}</Badge>}
              {pair.confirmed ? (
                <Badge className="bg-accent text-accent-foreground">
                  conexão surgiu em {pair.first_year} (+{pair.lead_time_years} anos)
                </Badge>
              ) : (
                <Badge variant="outline">conexão ainda não observada</Badge>
              )}
              {pair.priority != null && (
                <Badge variant="outline">
                  prioridade Swanson {(pair.priority * 100).toFixed(1)}/100
                </Badge>
              )}
              <Badge variant="outline">modelo estrutural {pct(pair.prob)}</Badge>
              <Badge variant="outline">corte {cutoff}</Badge>
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold">
              {pair.a} <span className="text-muted-foreground">⇢</span> {pair.c}
            </h2>
            {pair.intermediaries.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Conceitos-ponte: {pair.intermediaries.join(", ")}
              </p>
            )}
            <Progress value={(pair.priority ?? 0) * 100} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">
              Ranking por especificidade das pontes, suporte dos dois braços e distância temática. O
              escore não mede sucesso terapêutico; ausência de A–C na amostra não comprova
              ineditismo.
            </p>
            {!aiConfiguration?.configured && (
              <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 text-sm">
                <p className="font-medium">IA com Gemini</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Use sua chave do Google AI Studio. A API oferece uma faixa gratuita, sujeita a
                  cotas.{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Criar chave
                  </a>
                  . A chave fica apenas na memória desta aba e é enviada ao servidor para acessar o
                  Gemini; não é salva no navegador. Recarregar a página remove a chave.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Na faixa gratuita, o Google pode usar os dados enviados para melhorar seus
                  produtos.
                </p>
                {apiKey ? (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-xs">Chave disponível nesta sessão</span>
                    <Button variant="outline" size="sm" onClick={() => setApiKey("")}>
                      Remover chave
                    </Button>
                  </div>
                ) : (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setApiKey(keyDraft.trim());
                      setKeyDraft("");
                    }}
                  >
                    <label htmlFor="gemini-api-key" className="sr-only">
                      Chave da API Gemini
                    </label>
                    <Input
                      id="gemini-api-key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Chave da API Gemini"
                      value={keyDraft}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      className="min-w-48 flex-1"
                      minLength={20}
                      maxLength={200}
                      required
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={keyDraft.trim().length < 20}
                    >
                      Usar nesta sessão
                    </Button>
                  </form>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={generate}
                disabled={loading || !aiReady || configurationPending || !pair.a || !pair.c}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Agentes trabalhando…
                  </>
                ) : (
                  <>
                    <BrainCircuit className="size-4" /> {result ? "Regerar" : "Gerar"} hipótese
                  </>
                )}
              </Button>
              {result && (
                <Button variant="secondary" onClick={verify} disabled={verifying || !aiReady}>
                  {verifying ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Buscando no PubMed…
                    </>
                  ) : (
                    <>
                      <SearchCheck className="size-4" /> Verificar no PubMed pós-{cutoff}
                    </>
                  )}
                </Button>
              )}
            </div>
          </section>

          {result && (
            <>
              <section className="panel p-5">
                <h3 className="font-display text-lg font-semibold">{result.title}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">confiança {pct(result.confidence, 0)}</Badge>
                  <Badge variant="outline">novidade {result.novelty}</Badge>
                  <Badge variant="secondary">{result.model}</Badge>
                  <Badge variant="outline">
                    {result.evidence_seen.a.length + result.evidence_seen.c.length} artigos lidos
                  </Badge>
                </div>
                <Block title="Hipótese" body={result.hypothesis} />
                <Block title="Mecanismo proposto" body={result.mechanism} />
                <Block title="Raciocínio pela ponte B" body={result.bridge_reasoning} />
                <Block
                  title="Função transferida e impacto potencial"
                  body={result.innovation_value}
                />
                <Block title="Limitações da evidência" body={result.evidence_limitations} />
                <Block title="Como refutar a hipótese" body={result.falsification} />
                {result.evidence_seen.bridges.map((bridge) => (
                  <div key={bridge.term} className="mt-3 text-xs">
                    <strong>{bridge.term}</strong>
                    {[
                      ["A–B", bridge.ab],
                      ["B–C", bridge.bc],
                    ].map(([arm, ids]) => (
                      <p key={String(arm)}>
                        {String(arm)}:{" "}
                        {(ids as string[]).map((pmid) => (
                          <a
                            key={pmid}
                            className="mr-2 text-primary underline"
                            href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PMID {pmid}
                          </a>
                        ))}
                      </p>
                    ))}
                  </div>
                ))}
              </section>

              <section className="panel p-5">
                <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                  <FlaskConical className="size-4 text-primary" /> Previsão testável
                </h3>
                <p className="mt-2 text-sm leading-relaxed">{result.testable_prediction}</p>
              </section>

              <section className="panel p-5">
                <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                  <ShieldAlert className="size-4 text-destructive" /> Agente cético
                </h3>
                <p className="mt-2 text-sm leading-relaxed">{result.skeptic_critique}</p>
              </section>
            </>
          )}

          {check && (
            <section className="panel p-5">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                <SearchCheck className="size-4 text-primary" /> Veredito na literatura real
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className={VERDICTS[check.verdict]?.className}>
                  {VERDICTS[check.verdict]?.label ?? check.verdict}
                </Badge>
                <Badge variant="outline">
                  {check.n_articles} artigos pós-{cutoff}
                </Badge>
                {check.first_year && (
                  <Badge variant="outline">primeiro em {check.first_year}</Badge>
                )}
              </div>
              <p className="mt-3 text-sm leading-relaxed">{check.rationale}</p>
              {check.articles.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {check.articles.map((art) => (
                    <li key={art.pmid} className="text-xs leading-snug">
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                        className={
                          check.supporting_pmids.includes(art.pmid)
                            ? "text-accent underline-offset-2 hover:underline"
                            : check.contradicting_pmids.includes(art.pmid)
                              ? "text-destructive underline-offset-2 hover:underline"
                              : "text-muted-foreground underline-offset-2 hover:underline"
                        }
                      >
                        [{art.year ?? "s/d"}] {art.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
