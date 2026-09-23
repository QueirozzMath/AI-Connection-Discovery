import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { BrainCircuit, FlaskConical, Loader2, SearchCheck, ShieldAlert } from "lucide-react";
import { useTemporal } from "@/components/TemporalContext";
import { useLbdJob } from "@/hooks/use-lbd-job";
import { lbdRequest } from "@/lib/hypothesis.functions";
import type {
  AgentClaim,
  EvidenceArticle,
  HypothesisRecord,
  LbdCandidate,
  LbdSummary,
  ValidationRecord,
} from "@/lib/lbd-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/hypotheses")({
  validateSearch: zodValidator(
    z.object({
      a: z.string().catch("").default(""),
      c: z.string().catch("").default(""),
      from: z.number().optional(),
      to: z.number().optional(),
      cutoff: z.number().optional(),
    }),
  ),
  head: () => ({
    meta: [
      { title: "Agentes e descoberta LBD temporal — MeSHMap" },
      {
        name: "description",
        content:
          "Candidatos ABC auditáveis, evidências por ligação, hipóteses congeladas e validação temporal posterior.",
      },
    ],
  }),
  ssr: false,
  component: HypothesesPage,
});

const LABELS: Record<string, string> = {
  NO_FUTURE_EVIDENCE: "Sem evidência futura no corpus",
  WEAK_SIGNAL: "Sinal bibliográfico fraco",
  PARTIAL_SUPPORT: "Suporte parcial — revisão humana",
  SUBSTANTIAL_SUPPORT: "Suporte substancial — revisão humana",
  CONTRADICTED: "Contradita — revisão humana",
  INCONCLUSIVE: "Inconclusivo",
};
const METRICS: Record<string, string> = {
  novelty: "Novidade no corpus",
  bridgeStrength: "Força das pontes",
  surprise: "Surpresa (PMI)",
  temporalEmergence: "Emergência temporal",
  semanticDistance: "Distância estrutural (proxy)",
  meshTreeDistance: "Distância MeSH histórica",
  evidenceStrength: "Artigos dos caminhos",
  pathCount: "Pontes B distintas",
  persistence: "Persistência",
  contradictionSignal: "Sinal de contradição",
};

function HypothesesPage() {
  const { period, catalog } = useTemporal();
  const search = Route.useSearch();
  if (!period || !catalog) return <div className="p-8">Aguardando o serviço científico.</div>;
  return (
    <DiscoveryWorkspace
      key={`${period.startYear}:${period.endYear}:${search.q}:${search.cats}:${search.op}:${search.seedIds}`}
      startYear={period.startYear}
      cutoff={period.endYear}
      maxYear={catalog.end}
    />
  );
}

function DiscoveryWorkspace({
  startYear,
  cutoff,
  maxYear,
}: {
  startYear: number;
  cutoff: number;
  maxYear: number;
}) {
  const search = Route.useSearch();
  const [a, setA] = useState(search.a || search.seedIds.split(",")[0] || "");
  const [c, setC] = useState(search.c);
  const [selected, setSelected] = useState<{
    a: string;
    c: string;
    mode?: "open" | "closed" | "global";
    saved?: HypothesisRecord;
  }>();
  const discover = useLbdJob<{
    items: (LbdSummary | LbdCandidate)[];
    reason?: string;
    ranking?: string;
    budget?: Record<string, number>;
  }>();
  const backtest = useLbdJob<{
    nHypotheses: number;
    withFutureEvidence: number;
    alreadyKnownAtCutoff: number;
    statusCounts: Record<string, number>;
    humanReviewCounts: Record<string, number>;
    leadTimeYears: number[];
  }>();
  const ledger = useQuery({
    queryKey: ["hypothesis-ledger", cutoff],
    queryFn: () => lbdRequest({ data: { operation: "list", cutoffYear: cutoff } }),
    refetchInterval: 15000,
  });
  const records = (ledger.data?.items ?? []) as HypothesisRecord[];
  const run = (mode: "global" | "open" | "closed") => {
    setSelected(undefined);
    discover.run({
      operation: "discover",
      mode,
      a,
      c,
      startYear,
      endYear: cutoff,
      q: search.q,
      categories: search.cats.split(",").filter(Boolean),
      operator: search.op,
      seedIds: search.seedIds.split(",").filter(Boolean).slice(0, 20),
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="w-full shrink-0 space-y-3 border-b border-border bg-sidebar p-4 lg:w-80 lg:overflow-auto lg:border-r">
        <h1 className="font-display text-lg font-semibold">Agentes de hipótese</h1>
        <p className="text-xs text-muted-foreground">
          Seleção de conceitos: {startYear}–{cutoff}. Conhecimento e novidade: todo o corpus até{" "}
          {cutoff}. Validação: somente {cutoff + 1}+.
        </p>
        <label className="block text-xs">
          Conceito A (MeSH ID ou nome)
          <Input aria-label="Conceito A" value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="block text-xs">
          Conceito C (opcional)
          <Input aria-label="Conceito C" value={c} onChange={(e) => setC(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={discover.pending} onClick={() => run("global")}>
            Busca global ABC
          </Button>
          <Button size="sm" disabled={!a || discover.pending} onClick={() => run("open")}>
            A → possíveis C
          </Button>
          <Button size="sm" disabled={!a || !c || discover.pending} onClick={() => run("closed")}>
            A → B → C
          </Button>
        </div>
        {discover.pending && (
          <p role="status" className="text-xs">
            Gerando candidatos quantitativos…
          </p>
        )}
        <ErrorMessage error={discover.error} />
        {discover.result?.reason && <p className="text-xs">{discover.result.reason}</p>}
        <ScrollArea className="h-64 rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {discover.result?.items.map((item, i) => (
              <li key={`${item.A.id}:${item.C.id}`}>
                <button
                  className="w-full px-3 py-2.5 text-left text-xs hover:bg-secondary"
                  onClick={() =>
                    setSelected({
                      a: item.A.id,
                      c: item.C.id,
                      mode: item.candidateType as "open" | "closed" | "global",
                    })
                  }
                >
                  <span className="font-mono text-muted-foreground">#{i + 1}</span>
                  <p>
                    {item.A.label} ⇢ {item.C.label}
                  </p>
                  {"generationPathCount" in item && (
                    <p>
                      {item.generationPathCount} pontes na geração · força{" "}
                      {item.generationBridgeStrength}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
        {discover.result?.ranking && (
          <p className="text-[11px] text-muted-foreground">
            {discover.result.ranking}. Orçamento: {JSON.stringify(discover.result.budget)}.
          </p>
        )}
        <h2 className="text-sm font-semibold">Hipóteses registradas neste corte</h2>
        <ErrorMessage error={ledger.error?.message} />
        {records.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma hipótese registrada neste corte.</p>
        )}
        {records.map((record) => (
          <button
            key={record.id}
            className="block w-full rounded border border-border p-2 text-left text-xs"
            onClick={() =>
              setSelected({ a: record.candidate.A.id, c: record.candidate.C.id, saved: record })
            }
          >
            {record.agents.synthesis.title}
            <span className="block font-mono text-[10px]">{record.createdAt}</span>
          </button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={!records.length || backtest.pending}
          onClick={() => backtest.run({ operation: "backtest", cutoffYear: cutoff })}
        >
          Backtest das hipóteses registradas
        </Button>
        {backtest.pending && <p className="text-xs">Validando registros congelados…</p>}
        <ErrorMessage error={backtest.error} />
        {backtest.result && (
          <div className="text-xs">
            <p>
              {backtest.result.nHypotheses} hipóteses · {backtest.result.withFutureEvidence} com
              coindexação futura · {backtest.result.alreadyKnownAtCutoff} já conhecidas no corte.
            </p>
            <p>
              Tempos até o primeiro sinal: {backtest.result.leadTimeYears.join(", ") || "nenhum"}{" "}
              anos.
            </p>
            {Object.entries(backtest.result.statusCounts).map(([status, count]) => (
              <p key={status}>
                {LABELS[status]}: {count}
              </p>
            ))}
            <p>Revisões humanas (última revisão de cada hipótese):</p>
            {Object.entries(backtest.result.humanReviewCounts)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <p key={status}>
                  {LABELS[status]}: {count}
                </p>
              ))}
            <p>Isso não é taxa de descobertas confirmadas.</p>
          </div>
        )}
      </aside>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        {selected ? (
          <CandidateWorkspace
            key={`${selected.a}:${selected.c}:${selected.saved?.id ?? "new"}`}
            {...selected}
            startYear={startYear}
            cutoff={cutoff}
            maxYear={maxYear}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Gere candidatos ABC ou selecione uma hipótese registrada. O LLM só será chamado ao
            solicitar a análise de um candidato.
          </p>
        )}
      </main>
    </div>
  );
}

function CandidateWorkspace({
  a,
  c,
  saved,
  mode = "closed",
  startYear,
  cutoff,
  maxYear,
}: {
  a: string;
  c: string;
  saved?: HypothesisRecord;
  mode?: "open" | "closed" | "global";
  startYear: number;
  cutoff: number;
  maxYear: number;
}) {
  const client = useQueryClient();
  const detailJob = useLbdJob<LbdCandidate>();
  const generation = useLbdJob<HypothesisRecord>();
  const runDetail = detailJob.run;
  useEffect(() => {
    if (!saved) runDetail({ operation: "candidate", a, c, mode, startYear, endYear: cutoff });
  }, [a, c, mode, startYear, cutoff, saved, runDetail]);
  const record = generation.result ?? saved;
  const detail = record?.candidate ?? detailJob.result;
  useEffect(() => {
    if (generation.result) void client.invalidateQueries({ queryKey: ["hypothesis-ledger"] });
  }, [generation.result, client]);
  if (!detail)
    return (
      <div>
        <p>
          {detailJob.pending ? "Recuperando caminhos e evidências…" : "Selecione um candidato."}
        </p>
        <ErrorMessage error={detailJob.error} />
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Candidato LBD · corte {detail.knowledgeCutoff}</Badge>
          <Badge variant="outline">
            A–C antes do corte: {detail.knownBeforeCutoff ? "SIM" : "NÃO observado no corpus"}
          </Badge>
        </div>
        <h2 className="mt-3 font-display text-xl font-semibold">
          {detail.A.label} ⇢ {detail.C.label}
        </h2>
        <p className="mt-2 text-sm">Conceitos-ponte: {detail.B.map((b) => b.label).join(", ")}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Categorias históricas A / C: {detail.A.category ?? "indisponível"} /{" "}
          {detail.C.category ?? "indisponível"}. Coindexação não comprova mecanismo.
        </p>
        <Button
          className="mt-4"
          disabled={!detail.eligible || generation.pending}
          onClick={() =>
            generation.run({ operation: "generate", a, c, mode, startYear, endYear: cutoff })
          }
        >
          {generation.pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Agentes trabalhando…
            </>
          ) : (
            <>
              <BrainCircuit className="size-4" />
              {record
                ? "Gerar nova hipótese (preservar registro)"
                : "Analisar e registrar hipótese"}
            </>
          )}
        </Button>
        <ErrorMessage error={generation.error} />
      </section>
      <section className="panel p-5">
        <h3 className="font-semibold">Discovery scorecard</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(detail.metrics).map(([key, value]) => (
            <div key={key} className="rounded border border-border p-3">
              <p className="text-xs">{METRICS[key] ?? key}</p>
              <strong>
                {value === null
                  ? "Não determinado"
                  : typeof value === "number"
                    ? Number.isInteger(value)
                      ? value.toLocaleString("pt-BR")
                      : value.toFixed(3)
                    : `${value.value} (MeSH ${value.meshVersion})`}
              </strong>
              <p className="mt-1 text-[11px] text-muted-foreground">{detail.definitions[key]}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="panel p-5">
        <h3 className="font-semibold">Evidências observadas dos caminhos A–B–C</h3>
        <p className="text-xs text-muted-foreground">
          Mostrando {detail.paths.length} caminhos; as contagens são do banco, e as listas de
          artigos são limitadas.
        </p>
        {detail.paths.map((path) => (
          <details key={path.B.id} className="mt-3 rounded border border-border p-3">
            <summary className="cursor-pointer text-sm">
              {detail.A.label} → {path.B.label} → {detail.C.label} · categoria de B:{" "}
              {path.B.category ?? "histórico indisponível"}
            </summary>
            {(["AB", "BC"] as const).map((side) => (
              <div key={side} className="mt-3">
                <h4 className="text-sm font-semibold">
                  {side === "AB" ? "A–B" : "B–C"}: {path[side].count} artigos · primeira ocorrência{" "}
                  {path[side].firstYear}
                </h4>
                <p className="text-xs">
                  Esperado sob independência: {path[side].expected.toFixed(3)} · PMI{" "}
                  {path[side].pmi.toFixed(3)}
                </p>
                <Articles articles={path[side].articles} />
              </div>
            ))}
          </details>
        ))}
      </section>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {detail.limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {record && <HypothesisView record={record} maxYear={maxYear} />}
    </div>
  );
}

function HypothesisView({ record, maxYear }: { record: HypothesisRecord; maxYear: number }) {
  const validation = useLbdJob<ValidationRecord>();
  const history = useQuery({
    queryKey: ["hypothesis-history", record.id, validation.result?.id],
    queryFn: () => lbdRequest({ data: { operation: "get", id: record.id } }),
  });
  const checks = (history.data?.validations ?? []) as ValidationRecord[];
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [pmids, setPmids] = useState("");
  const [reviewStatus, setReviewStatus] = useState<
    "PARTIAL_SUPPORT" | "SUBSTANTIAL_SUPPORT" | "CONTRADICTED" | "INCONCLUSIVE"
  >("INCONCLUSIVE");
  const synthesis = record.agents.synthesis;
  return (
    <>
      <section className="panel p-5">
        <h3 className="font-display text-lg font-semibold">{synthesis.title}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">Registro congelado</Badge>
          <Badge variant="outline">Revisão científica pendente</Badge>
          <Badge variant="secondary">{record.agentModel}</Badge>
          <Badge variant="outline">
            {record.agents.evidenceAgent.articles.length} artigos fornecidos
          </Badge>
        </div>
        <p className="mt-2 break-all font-mono text-[10px]">
          {record.id} · {record.createdAt} · {record.agentVersion} · {record.promptVersion}
        </p>
        <Block
          title="Interpretação (inferência, não fato demonstrado)"
          body={record.agents.interpreter.interpretation}
        />
        <Claims claims={record.agents.interpreter.claims} />
        <Block title="Hipótese científica" body={record.hypothesisText} />
        <Block
          title={
            synthesis.mechanismStatus === "speculative"
              ? "Mecanismo proposto — ESPECULATIVO"
              : "Mecanismo proposto — NÃO DETERMINADO"
          }
          body={record.mechanismText}
        />
        <Block title="Raciocínio pela ponte B" body={synthesis.bridge_reasoning} />
        <Claims claims={synthesis.claims} />
        <Block
          title="Nível de suporte"
          body="Caminhos bibliográficos observados; mecanismo e hipótese ainda não demonstrados."
        />
        <Block title="Limitações" body={record.limitations.join(" ")} />
        <p className="mt-3 text-xs">
          Agente temporal: evidências até {record.knowledgeCutoff}; MeSH histórico{" "}
          {record.agents.temporalAgent.meshHistoricalAvailable
            ? "disponível para distância"
            : "indisponível — não usado como distância histórica"}
          .
        </p>
        <details className="mt-3 text-xs">
          <summary>Artigos efetivamente fornecidos aos agentes</summary>
          <Articles articles={record.agents.evidenceAgent.articles} />
        </details>
      </section>
      <section className="panel p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-4" />
          Previsão testável
        </h3>
        <p className="mt-2 text-sm">{record.testablePrediction}</p>
      </section>
      <section className="panel p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-4" />
          Agente cético / contradições
        </h3>
        <p className="mt-2 text-sm">{record.agents.contradictionAgent.critique}</p>
        <Claims claims={record.agents.contradictionAgent.claims} />
        <p className="mt-2 text-xs">
          Ausência de evidência não é refutação. Alternativas:{" "}
          {record.agents.contradictionAgent.alternatives.join(" ")}
        </p>
      </section>
      <section className="panel space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <SearchCheck className="size-4" />
          Veredito na literatura real — validação futura
        </h3>
        <Button
          disabled={validation.pending}
          onClick={() =>
            validation.run({
              operation: "validate",
              hypothesisId: record.id,
              validationEndYear: maxYear,
            })
          }
        >
          {validation.pending
            ? "Consultando evidências…"
            : `Verificar literatura posterior a ${record.knowledgeCutoff}`}
        </Button>
        <ErrorMessage error={validation.error ?? history.error?.message} />
        {checks.map((check) => (
          <details
            key={check.id}
            open={check.id === checks[0]?.id}
            className="rounded border border-border p-3"
          >
            <summary className="cursor-pointer text-sm">
              {LABELS[check.validationStatus]} · {check.futureArticleCount} artigos ·{" "}
              {check.createdAt}
            </summary>
            <p className="mt-2 text-sm">{check.rationale}</p>
            <p className="text-xs">
              Janela {check.validationStartYear}–{check.validationEndYear}. Primeiro sinal:{" "}
              {check.firstFutureEvidenceYear ?? "nenhum"}.{" "}
              {check.review
                ? `Revisão humana: ${check.review.reviewer}`
                : "Avaliação bibliográfica automática."}
            </p>
            <Articles articles={check.futureEvidence} />
            {check.evidenceTruncated && (
              <p className="text-xs">
                Lista limitada aos primeiros 100 artigos; total calculado no banco.
              </p>
            )}
          </details>
        ))}
        {!!checks.length && (
          <details className="rounded border border-border p-3">
            <summary className="cursor-pointer text-sm">
              Registrar revisão humana da hipótese e das evidências
            </summary>
            <p className="my-2 text-xs">
              Classificação qualitativa identificada; não é julgamento absoluto de verdade.
            </p>
            <Input
              placeholder="Identificação do revisor"
              aria-label="Revisor"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <select
              aria-label="Status da revisão"
              className="my-2 w-full rounded border border-border bg-background p-2 text-sm"
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)}
            >
              {(
                ["INCONCLUSIVE", "PARTIAL_SUPPORT", "SUBSTANTIAL_SUPPORT", "CONTRADICTED"] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {LABELS[status]}
                </option>
              ))}
            </select>
            <Input
              aria-label="PMIDs da revisão"
              placeholder="PMIDs posteriores listados, separados por vírgula"
              value={pmids}
              onChange={(e) => setPmids(e.target.value)}
            />
            <textarea
              aria-label="Justificativa da revisão"
              className="my-2 w-full rounded border border-border bg-background p-2 text-sm"
              placeholder="Explique a correspondência ou contradição com o mecanismo/previsão, e suas limitações."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <Button
              disabled={!reviewer.trim() || !rationale.trim() || validation.pending}
              onClick={() =>
                validation.run({
                  operation: "review",
                  hypothesisId: record.id,
                  validationEndYear: maxYear,
                  review: {
                    status: reviewStatus,
                    reviewer,
                    rationale,
                    pmids: pmids
                      .split(",")
                      .map((p) => p.trim())
                      .filter(Boolean),
                  },
                })
              }
            >
              Acrescentar revisão ao registro
            </Button>
          </details>
        )}
      </section>
    </>
  );
}

function ErrorMessage({ error }: { error?: string | undefined }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-destructive">
      {error}
    </p>
  ) : null;
}
function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
function Articles({ articles }: { articles: EvidenceArticle[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {articles.map((article) => (
        <li key={article.pmid} className="text-xs">
          <a
            className="text-primary underline"
            target="_blank"
            rel="noreferrer"
            href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`}
          >
            PMID {article.pmid} · [{article.year}] {article.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
function Claims({ claims }: { claims: AgentClaim[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {claims.map((claim, i) => (
        <li key={i} className="rounded border border-border p-2 text-xs">
          <strong>
            {
              { inference: "Inferência", hypothesis: "Hipótese", speculation: "Especulação" }[
                claim.kind
              ]
            }
            :
          </strong>{" "}
          {claim.statement}
          {claim.evidence.map((e, j) => (
            <p key={j} className="mt-1 text-muted-foreground">
              PMID {e.pmid}: “{e.quote}”
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
