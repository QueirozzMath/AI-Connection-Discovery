import { selectionKey } from "@/lib/agent-session";
import { reportTextFields } from "@/lib/translation-validation";
import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { useAgentSession } from "@/components/AgentSessionProvider";
import { HypothesisReport } from "@/components/HypothesisReport";
import { CitationText } from "@/components/CitationText";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { BrainCircuit, Loader2, SearchCheck } from "lucide-react";
import { toast } from "sonner";

import { candidatesQuery, graphQuery, indexQuery, pct, type Candidate } from "@/lib/science-data";
import {
  checkEvidence,
  generateHypothesis,
  translateAgentOutput,
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
import { corpus, meshVocabulary } from "@/lib/bundled-articles";
import { evidenceIndex, planEvidence, type EvidenceAssessment } from "@/lib/evidence";
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
    <Suspense
      fallback={
        <div className="p-8 text-muted-foreground">
          <Localized value={"Carregando pares…"} />
        </div>
      }
    >
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
  const _uiLanguage = useLanguage().language;

  const { data: idx } = useSuspenseQuery(indexQuery);
  const search = Route.useSearch();
  const session = useAgentSession();
  const navigate = Route.useNavigate();
  const cutoff = idx.cutoffs.includes(search.cutoff)
    ? search.cutoff
    : session.state.active && idx.cutoffs.includes(session.state.active.cutoff)
      ? session.state.active.cutoff
      : idx.default_cutoff;
  const { data } = useSuspenseQuery(candidatesQuery(cutoff));
  const queryClient = useQueryClient();
  const runEvidence = useServerFn(checkEvidence);

  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [assessments, setAssessments] = useState<Record<string, EvidenceAssessment>>({});
  const [batchChecking, setBatchChecking] = useState(false);
  const corpusQuery = useQuery({
    queryKey: ["pubmed-corpus"],
    queryFn: corpus,
    staleTime: Infinity,
  });
  const vocabularyQuery = useQuery({
    queryKey: ["mesh-vocabulary-2026"],
    queryFn: meshVocabulary,
    staleTime: Infinity,
  });
  const graph = useQuery(graphQuery(cutoff));
  const index = useMemo(
    () => (corpusQuery.data ? evidenceIndex(corpusQuery.data, cutoff) : null),
    [corpusQuery.data, cutoff],
  );
  const recommendations = useMemo(
    () =>
      data.items
        .slice(0, 120)
        .map((candidate) => {
          const plans =
            graph.data && index
              ? planEvidence(candidate, graph.data, index, vocabularyQuery.data)
              : [];
          return {
            candidate,
            plans,
            score: 0.6 * (candidate.priority ?? candidate.prob) + 0.4 * (plans[0]?.score ?? 0),
          };
        })
        .sort(
          (a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0) || b.score - a.score,
        ),
    [data.items, graph.data, index, vocabularyQuery.data],
  );
  const runGenerate = useServerFn(generateHypothesis);
  const runVerify = useServerFn(verifyHypothesis);
  const runTranslate = useServerFn(translateAgentOutput);
  const readConfiguration = useServerFn(getAiConfiguration);
  const { data: aiConfiguration, isPending: configurationPending } = useQuery({
    queryKey: ["ai-configuration"],
    queryFn: () => readConfiguration(),
    staleTime: 60000,
  });
  const { apiKey, setApiKey } = session;
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
      (session.state.active?.cutoff === cutoff ? session.state.active.pair : undefined) ??
      recommendations[0]?.candidate ?? {
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
  }, [data.items, recommendations, search.a, search.c, search.b, session.state.active, cutoff]);

  const pair = initial;
  const expanded =
    session.state.active?.cutoff === cutoff &&
    session.state.active.pair.a === pair.a &&
    session.state.active.pair.c === pair.c
      ? session.state.active.expanded
      : false;
  const setExpanded = (update: boolean | ((v: boolean) => boolean)) =>
    session.select({
      pair,
      cutoff,
      expanded: typeof update === "function" ? update(expanded) : update,
    });
  const setPair = (next: Candidate) => {
    session.select({ pair: next, cutoff, expanded: false });
    void navigate({
      search: (previous) => ({
        ...previous,
        a: next.a,
        c: next.c,
        cutoff,
        b: next.intermediaries.join("|"),
      }),
    });
  };
  useEffect(() => {
    if (session.hydrated && pair.a) session.select({ pair, cutoff, expanded });
  }, [pair, cutoff, expanded, session.hydrated, session.select]);
  const { results, checks } = session.state;
  const { setResults, setChecks } = session;
  const key = `${cutoff}::${pair.a}::${pair.c}::${expanded}`;
  const outputKey = selectionKey({ pair, cutoff, expanded });
  const plans = useMemo(() => {
    if (!graph.data || !index) return [];
    return planEvidence(pair, graph.data, index, vocabularyQuery.data, expanded ? 4 : 2)
      .filter((p) => (expanded ? p.nodes.length > 3 : p.nodes.length === 3))
      .slice(0, 3);
  }, [pair, graph.data, index, vocabularyQuery.data, expanded]);
  const assessmentKey = (a: string, c: string, mode = false) => `${cutoff}::${a}::${c}::${mode}`;
  const statusFor = (a: string, c: string) =>
    assessments[assessmentKey(a, c)]?.status === "ready"
      ? "ready"
      : assessments[assessmentKey(a, c, true)]?.status === "expanded"
        ? "expanded"
        : "pending";
  const evidenceInput = {
    a: pair.a,
    c: pair.c,
    cutoffYear: cutoff,
    expanded,
    plans: plans.map((p) => ({ nodes: p.nodes, arms: p.arms })),
  };
  const evidenceQuery = useQuery({
    queryKey: ["agent-evidence", key, plans],
    queryFn: () => runEvidence({ data: evidenceInput }),
    enabled: plans.length > 0,
    staleTime: 240000,
    retry: false,
  });
  const assessment = evidenceQuery.data;
  useEffect(() => {
    if (assessment) setAssessments((prev) => ({ ...prev, [key]: assessment }));
  }, [assessment, key]);

  const verifyRecommendations = async () => {
    setBatchChecking(true);
    try {
      for (const row of recommendations.filter((r) => r.plans.length).slice(0, 5)) {
        const p = row.candidate;
        const k = assessmentKey(p.a, p.c);
        const input = {
          a: p.a,
          c: p.c,
          cutoffYear: cutoff,
          expanded: false,
          plans: row.plans.slice(0, 3).map((plan) => ({ nodes: plan.nodes, arms: plan.arms })),
        };
        const value = await runEvidence({ data: input });
        setAssessments((prev) => ({ ...prev, [k]: value }));
        queryClient.setQueryData(["agent-evidence", k, row.plans.slice(0, 3)], value);
      }
    } catch (err) {
      toast.error(t(err instanceof Error ? err.message : "Falha na checagem das recomendações."));
    } finally {
      setBatchChecking(false);
    }
  };
  const canGenerate =
    assessment &&
    assessment.status !== "pending" &&
    !evidenceQuery.isFetching &&
    !evidenceQuery.isError;

  const loading = session.pending[`generate:${outputKey}`] ?? false;
  const verifying = session.pending[`verify:${outputKey}`] ?? false;
  const originalResult = results[outputKey];
  const originalCheck = checks[outputKey];
  const language = _uiLanguage;
  const translationKey = `${outputKey}:${language}`;
  const translated = session.state.translations[translationKey];
  const result = translated?.result ?? originalResult;
  const check = translated?.check ?? originalCheck;
  const needsTranslation = Boolean(
    (originalResult && (originalResult.language ?? "pt") !== language && !translated?.result) ||
    (originalCheck && (originalCheck.language ?? "pt") !== language && !translated?.check),
  );
  const translating = session.pending[`translate:${translationKey}`] ?? false;
  const [translationError, setTranslationError] = useState("");
  const translateReport = async () => {
    if (!needsTranslation || translating || !aiReady) return;
    session.setPending(`translate:${translationKey}`, true);
    setTranslationError("");
    try {
      const fields: Record<string, string> = {};
      if (originalResult && (originalResult.language ?? "pt") !== language)
        for (const field of reportTextFields)
          if (originalResult[field]) fields[field] = originalResult[field];
      if (originalCheck && (originalCheck.language ?? "pt") !== language)
        fields["rationale"] = originalCheck.rationale;
      const text = await runTranslate({ data: { fields, language, apiKey: apiKey || undefined } });
      session.saveTranslation(
        translationKey,
        {
          ...(originalResult
            ? {
                result: {
                  ...originalResult,
                  ...Object.fromEntries(
                    reportTextFields.filter((f) => text[f]).map((f) => [f, text[f]]),
                  ),
                  language,
                },
              }
            : {}),
          ...(originalCheck
            ? {
                check: {
                  ...originalCheck,
                  rationale: text["rationale"] ?? originalCheck.rationale,
                  language,
                },
              }
            : {}),
        },
        { key: outputKey, result: originalResult, check: originalCheck },
      );
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Falha na tradução.");
    } finally {
      session.setPending(`translate:${translationKey}`, false);
    }
  };
  useEffect(() => {
    setTranslationError("");
  }, [translationKey, originalResult, originalCheck]);
  useEffect(() => {
    if (needsTranslation && aiReady && !translating && !translationError) void translateReport();
  }, [
    needsTranslation,
    aiReady,
    translationKey,
    originalResult,
    originalCheck,
    translating,
    translationError,
  ]);

  const generate = async () => {
    if (!canGenerate) return;
    session.setPending(`generate:${outputKey}`, true);
    try {
      const res = await runGenerate({
        data: {
          plans: evidenceInput.plans,
          expanded,
          apiKey: apiKey || undefined,
          language,
          a: pair.a,
          c: pair.c,
          intermediaries: pair.intermediaries,
          prob: pair.prob,
          cutoffYear: cutoff,
        },
      });
      setResults((r) => ({ ...r, [outputKey]: res }));
      setChecks((c) => {
        const next = { ...c };
        delete next[outputKey];
        return next;
      });
    } catch (err) {
      toast.error(t(err instanceof Error ? err.message : "Falha ao gerar hipótese"));
    } finally {
      session.setPending(`generate:${outputKey}`, false);
    }
  };

  const verify = async () => {
    if (!result) return;
    session.setPending(`verify:${outputKey}`, true);
    try {
      const res = await runVerify({
        data: {
          apiKey: apiKey || undefined,
          language,
          a: pair.a,
          c: pair.c,
          cutoffYear: cutoff,
          hypothesis: result.hypothesis,
          mechanism: result.mechanism,
          prediction: result.testable_prediction,
        },
      });
      setChecks((c) => ({ ...c, [outputKey]: res }));
    } catch (err) {
      toast.error(t(err instanceof Error ? err.message : "Falha ao verificar no PubMed"));
    } finally {
      session.setPending(`verify:${outputKey}`, false);
    }
  };

  return (
    <div data-tour="agents" className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-sidebar p-4 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        <h1 className="font-display text-lg font-semibold">
          <Localized value={"Agentes de hipótese"} />
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <Localized value={" Corte "} />
          <Localized value={cutoff} />
          <Localized
            value={": cada agente vê apenas artigos reais do PubMed publicados até esse ano. "}
          />
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
            <SelectValue aria-label={t("Ano de corte")} />
          </SelectTrigger>
          <SelectContent>
            <Localized
              value={idx.cutoffs.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  <Localized value={year} />
                </SelectItem>
              ))}
            />
          </SelectContent>
        </Select>
        <p className="mt-3 text-xs text-muted-foreground">
          <Localized
            value={
              " Ordenação combina escore estrutural e suporte bibliográfico local, sem usar artigos posteriores ao corte. "
            }
          />
        </p>
        <label className="mt-3 block text-xs">
          <Localized value={" Estado das evidências "} />
          <select
            aria-label={t("Filtrar por estado das evidências")}
            value={evidenceFilter}
            onChange={(e) => setEvidenceFilter(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background p-2"
          >
            <option value="all">
              <Localized value={"Todos · pendentes identificados"} />
            </option>
            <option value="ready">
              <Localized value={"Pronta para gerar"} />
            </option>
            <option value="expanded">
              <Localized value={"Exploração ampliada"} />
            </option>
            <option value="pending">
              <Localized value={"Evidência pendente"} />
            </option>
          </select>
        </label>
        <Button
          className="mt-2 w-full"
          size="sm"
          variant="outline"
          disabled={batchChecking || !index || !graph.data}
          onClick={verifyRecommendations}
        >
          <Localized
            value={batchChecking ? "Verificando recomendações…" : "Verificar 5 recomendações"}
          />
        </Button>
        <ScrollArea className="mt-3 h-[55vh] lg:h-[calc(100%-17rem)] rounded-lg border border-border">
          <ul className="divide-y divide-border">
            <Localized
              value={recommendations
                .filter(
                  ({ candidate: c }) =>
                    evidenceFilter === "all" || statusFor(c.a, c.c) === evidenceFilter,
                )
                .map(({ candidate: c, plans: localPlans }) => (
                  <li key={`${c.a}-${c.c}`}>
                    <button
                      onClick={() => {
                        setPair(c);
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-secondary"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          <Localized value={"#"} />
                          <Localized value={c.rank} />
                        </span>
                        <span className="font-mono text-[11px] text-primary">
                          <Localized value={" prioridade "} />
                          <Localized value={((c.priority ?? 0) * 100).toFixed(1)} />
                          <Localized value={"/100 "} />
                        </span>
                      </div>
                      <p className="mt-1 leading-snug">
                        <Localized value={c.a} />{" "}
                        <span className="text-muted-foreground">
                          <Localized value={"⇢"} />
                        </span>{" "}
                        <Localized value={c.c} />
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        <Localized
                          value={
                            (
                              {
                                ready: "Pronta para gerar",
                                expanded: "Exploração ampliada",
                                pending: "Evidência pendente",
                              } as const
                            )[statusFor(c.a, c.c)]
                          }
                        />
                        <Localized
                          value={
                            localPlans.length
                              ? " · suporte local encontrado"
                              : " · sem ponte local elegível"
                          }
                        />
                      </p>
                    </button>
                  </li>
                ))}
            />
          </ul>
          <Localized
            value={
              (!data.items.length ||
                !recommendations.some(
                  ({ candidate: c }) =>
                    evidenceFilter === "all" || statusFor(c.a, c.c) === evidenceFilter,
                )) && (
                <p className="p-4 text-xs text-muted-foreground">
                  <Localized
                    value={
                      " Nenhum par neste filtro. Verifique as recomendações, altere o filtro ou escolha outro corte. "
                    }
                  />
                </p>
              )
            }
          />
        </ScrollArea>
      </aside>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <details className="panel p-4">
            <summary className="cursor-pointer text-sm font-medium">
              <Localized value={" Como as hipóteses são avaliadas "} />
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <Localized
                value={
                  " Verificamos as ligações da ponte na literatura anterior ao corte. O mínimo experimental é de dois artigos distintos com resumo utilizável por ligação e diversidade de referências entre ligações. Isso mede disponibilidade bibliográfica, não causalidade, independência dos estudos nem validade do mecanismo. O agente distingue fatos, extrapolações e contradições e pode rejeitar a proposta. "
                }
              />
            </p>
          </details>
          <section className="panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Localized
                value={
                  pair.rank > 0 && (
                    <Badge variant="secondary">
                      <Localized value={"#"} />
                      <Localized value={pair.rank} />
                    </Badge>
                  )
                }
              />
              <Localized
                value={
                  pair.confirmed ? (
                    <Badge className="bg-accent text-accent-foreground">
                      <Localized value={" conexão surgiu em "} />
                      <Localized value={pair.first_year} />
                      <Localized value={" (+"} />
                      <Localized value={pair.lead_time_years} />
                      <Localized value={" anos) "} />
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Localized value={"conexão ainda não observada"} />
                    </Badge>
                  )
                }
              />
              <Localized
                value={
                  pair.priority != null && (
                    <Badge variant="outline">
                      <Localized value={" prioridade Swanson "} />
                      <Localized value={(pair.priority * 100).toFixed(1)} />
                      <Localized value={"/100 "} />
                    </Badge>
                  )
                }
              />
              <Badge variant="outline">
                <Localized value={"modelo estrutural "} />
                <Localized value={pct(pair.prob)} />
              </Badge>
              <Badge variant="outline">
                <Localized value={"corte "} />
                <Localized value={cutoff} />
              </Badge>
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold">
              <Localized value={pair.a} />{" "}
              <span className="text-muted-foreground">
                <Localized value={"⇢"} />
              </span>{" "}
              <Localized value={pair.c} />
            </h2>
            <Localized
              value={
                pair.intermediaries.length > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Localized value={" Conceitos-ponte: "} />
                    <Localized value={pair.intermediaries.join(", ")} />
                  </p>
                )
              }
            />
            <Progress value={(pair.priority ?? 0) * 100} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">
              <Localized
                value={
                  " Ranking por especificidade das pontes, suporte dos dois braços e distância temática. O escore não mede sucesso terapêutico; ausência de A–C na amostra não comprova ineditismo. "
                }
              />
            </p>
            <section
              className="mt-4 space-y-3 rounded-lg border border-border p-4"
              aria-label={t("Checagem de evidências")}
            >
              <h3 className="font-semibold text-sm" role="status">
                <Localized
                  value={
                    evidenceQuery.isFetching
                      ? "Verificando evidências…"
                      : canGenerate
                        ? assessment.status === "ready"
                          ? "Pronta para gerar"
                          : "Exploração ampliada"
                        : "Evidência pendente"
                  }
                />
              </h3>
              <p className="text-xs text-muted-foreground">
                <Localized
                  value={
                    !index || !graph.data
                      ? "Carregando o corpus e o grafo do corte…"
                      : !plans.length
                        ? expanded
                          ? "Nenhum caminho elegível com 3 ou 4 ligações encontrado na busca limitada. Isso não prova ausência de uma relação."
                          : "Nenhuma ponte A–B–C com dois artigos por ligação encontrada no corpus para este par. Tente a exploração ampliada ou outro par."
                        : evidenceQuery.isError
                          ? "A checagem não pôde ser concluída. Tente novamente; falha de recuperação não significa ausência de literatura."
                          : (assessment?.reason ??
                            "A geração será liberada somente após a recuperação das referências.")
                  }
                />
              </p>
              <p className="text-[11px] text-muted-foreground">
                <Localized
                  value={
                    " Limiar experimental: 2 PMIDs distintos com resumo por ligação. Não é garantia de sustentação mecanística. Caminhos ampliados recebem penalidade no escore e exigem revisão adicional. "
                  }
                />
              </p>
              <Localized
                value={
                  assessment && (
                    <p className="text-[11px] text-muted-foreground">
                      <Localized value={assessment.pathsChecked} />
                      <Localized value={" caminhos examinados · suporte bibliográfico"} />
                      <Localized value={" "} />
                      <Localized value={(assessment.quality * 100).toFixed(0)} />
                      <Localized value={"/100 · checagem"} />
                      <Localized value={" "} />
                      <Localized
                        value={new Date(assessment.checkedAt).toLocaleTimeString(getLocale())}
                      />
                    </p>
                  )
                }
              />
              <Localized
                value={assessment?.arms.map((arm, i) => (
                  <div key={i} className="border-t border-border pt-2 text-xs">
                    <p className="font-medium">
                      <Localized value={arm.from} />
                      <Localized value={" → "} />
                      <Localized value={arm.to} />
                    </p>
                    <p className="text-muted-foreground">
                      <Localized value={arm.articles.length} />
                      <Localized value={" registros ·"} />
                      <Localized value={" "} />
                      <Localized
                        value={arm.articles.filter((a) => a.abstract.length >= 80).length}
                      />
                      <Localized value={" com resumo ·"} />
                      <Localized value={" "} />
                      <Localized value={arm.method} />
                    </p>
                    <Localized
                      value={
                        arm.error && (
                          <p role="alert">
                            <Localized value={arm.error} />
                          </p>
                        )
                      }
                    />
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Localized
                        value={arm.articles.map((a) => (
                          <a
                            key={a.pmid}
                            href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                            title={t(a.title)}
                          >
                            <Localized value={" PMID "} />
                            <Localized value={a.pmid} />
                            <Localized value={" ("} />
                            <Localized value={a.year} />
                            <Localized value={") "} />
                          </a>
                        ))}
                      />
                    </div>
                  </div>
                ))}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!plans.length || evidenceQuery.isFetching}
                  onClick={() => void evidenceQuery.refetch()}
                >
                  <Localized value={" Verificar novamente "} />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
                  <Localized
                    value={expanded ? "Voltar a A–B–C" : "Explorar caminhos com 3 ou 4 ligações"}
                  />
                </Button>
              </div>
              <Localized
                value={
                  expanded && (
                    <p className="text-xs text-warning">
                      <Localized
                        value={
                          " Modalidade exploratória: cada intermediário acrescenta suposições. A relação entre os extremos não decorre automaticamente das ligações. "
                        }
                      />
                    </p>
                  )
                }
              />
            </section>
            <Localized
              value={
                !aiConfiguration?.configured && (
                  <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 text-sm">
                    <p className="font-medium">
                      <Localized value={"IA com Gemini"} />
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      <Localized
                        value={
                          " Use sua chave do Google AI Studio. A API oferece uma faixa gratuita, sujeita a cotas."
                        }
                      />
                      <Localized value={" "} />
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        <Localized value={" Criar chave "} />
                      </a>
                      <Localized
                        value={
                          " . A chave fica apenas na memória desta aba e é enviada ao servidor para acessar o Gemini; não é salva no navegador. Recarregar a página remove a chave. "
                        }
                      />
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Localized
                        value={
                          " Na faixa gratuita, o Google pode usar os dados enviados para melhorar seus produtos. "
                        }
                      />
                    </p>
                    <Localized
                      value={
                        apiKey ? (
                          <div className="mt-3 flex items-center gap-3">
                            <span className="text-xs">
                              <Localized value={"Chave disponível nesta sessão"} />
                            </span>
                            <Button variant="outline" size="sm" onClick={() => setApiKey("")}>
                              <Localized value={" Remover chave "} />
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
                              <Localized value={" Chave da API Gemini "} />
                            </label>
                            <Input
                              id="gemini-api-key"
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={t("Chave da API Gemini")}
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
                              <Localized value={" Usar nesta sessão "} />
                            </Button>
                          </form>
                        )
                      }
                    />
                  </div>
                )
              }
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={generate}
                disabled={
                  loading || !aiReady || configurationPending || !pair.a || !pair.c || !canGenerate
                }
              >
                <Localized
                  value={
                    loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <Localized value={" Agentes trabalhando… "} />
                      </>
                    ) : (
                      <>
                        <BrainCircuit className="size-4" />{" "}
                        <Localized value={result ? "Regerar" : "Gerar"} />
                        <Localized value={" hipótese "} />
                      </>
                    )
                  }
                />
              </Button>
              <Localized
                value={
                  result &&
                  result.decision !== "reject" && (
                    <Button variant="secondary" onClick={verify} disabled={verifying || !aiReady}>
                      <Localized
                        value={
                          verifying ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              <Localized value={" Buscando no PubMed… "} />
                            </>
                          ) : (
                            <>
                              <SearchCheck className="size-4" />
                              <Localized value={" Verificar no PubMed pós-"} />
                              <Localized value={cutoff} />
                            </>
                          )
                        }
                      />
                    </Button>
                  )
                }
              />
            </div>
          </section>

          {needsTranslation && (
            <div
              role="status"
              className="rounded-lg border border-border p-3 text-sm text-muted-foreground"
            >
              {translating
                ? t("Traduzindo relatório…")
                : translationError
                  ? t(translationError)
                  : t(
                      "Informe uma chave válida para traduzir o relatório existente. O resultado original foi preservado.",
                    )}
              {translationError && (
                <Button variant="outline" className="ml-2" onClick={translateReport}>
                  {t("Tentar novamente")}
                </Button>
              )}
            </div>
          )}
          <Localized value={result && <HypothesisReport result={result} />} />

          <Localized
            value={
              check && (
                <section className="panel p-5">
                  <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                    <SearchCheck className="size-4 text-primary" />
                    <Localized value={" Veredito na literatura real "} />
                  </h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className={VERDICTS[check.verdict]?.className}>
                      <Localized value={VERDICTS[check.verdict]?.label ?? check.verdict} />
                    </Badge>
                    <Badge variant="outline">
                      <Localized value={check.n_articles} />
                      <Localized value={" artigos pós-"} />
                      <Localized value={cutoff} />
                    </Badge>
                    <Localized
                      value={
                        check.first_year && (
                          <Badge variant="outline">
                            <Localized value={"primeiro em "} />
                            <Localized value={check.first_year} />
                          </Badge>
                        )
                      }
                    />
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                    <CitationText
                      text={check.rationale}
                      pmids={check.articles.map((a) => a.pmid)}
                    />
                  </p>
                  <Localized
                    value={
                      check.articles.length > 0 && (
                        <ul className="mt-4 space-y-1.5">
                          <Localized
                            value={check.articles.map((art) => (
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
                                  <Localized value={" ["} />
                                  <Localized value={art.year ?? "s/d"} />
                                  <Localized value={"] "} />
                                  <Localized value={art.title} />
                                </a>
                              </li>
                            ))}
                          />
                        </ul>
                      )
                    }
                  />
                </section>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
