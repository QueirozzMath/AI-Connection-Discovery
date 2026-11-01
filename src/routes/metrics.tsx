import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  indexQuery,
  metricsQuery,
  num,
  pct,
  timelineQuery,
  type TimelinePoint,
} from "@/lib/science-data";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/metrics")({
  head: () => ({
    meta: [
      { title: "Validação estatística do modelo — AI Connection Discovery" },
      {
        name: "description",
        content:
          "AUC com IC bootstrap, teste de permutação, precision@k, calibração, lead time e comparação com baselines estruturais.",
      },
      {
        property: "og:title",
        content: "Validação estatística do modelo — AI Connection Discovery",
      },
      {
        property: "og:description",
        content:
          "Prova estatística de que o modelo de literatura desconexa supera acaso e baselines.",
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
          <Localized value={"Carregando métricas…"} />
        </div>
      }
    >
      <MetricsGate />
    </Suspense>
  ),
});

function MetricsGate() {
  const _uiLanguage = useLanguage().language;

  const { data: idx } = useSuspenseQuery(indexQuery);
  const { data: timeline } = useSuspenseQuery(timelineQuery);
  const [cutoff, setCutoff] = useState(idx.default_cutoff);
  return (
    <Suspense
      fallback={
        <div className="p-8 text-muted-foreground">
          <Localized value={"Carregando métricas…"} />
        </div>
      }
    >
      <MetricsPage
        cutoff={cutoff}
        cutoffs={idx.cutoffs}
        onCutoff={setCutoff}
        timeline={timeline.items}
      />
    </Suspense>
  );
}

function MetricsPage({
  cutoff,
  cutoffs,
  onCutoff,
  timeline,
}: {
  cutoff: number;
  cutoffs: number[];
  onCutoff: (v: number) => void;
  timeline: TimelinePoint[];
}) {
  const _uiLanguage = useLanguage().language;

  const { data: m } = useSuspenseQuery(metricsQuery(cutoff));
  const axis = { stroke: "oklch(0.7 0.024 246)", fontSize: 11 };
  const tooltip = {
    contentStyle: {
      background: "oklch(0.21 0.03 252)",
      border: "1px solid oklch(0.32 0.03 253)",
      borderRadius: 8,
      fontSize: 12,
    },
  } as const;

  return (
    <div data-tour="validation" className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-4xl">
          <h1 className="font-display text-2xl font-semibold">
            <Localized value={"Validação do modelo"} />
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            <Localized
              value={
                " Estas métricas avaliam o modelo estrutural e seu ranking histórico. O novo ranking por pontes raras de Swanson é exploratório e ainda não possui validação independente; seus escores não herdam a AUC nem a calibração exibidas aqui. "
              }
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <Localized value={m.dynamic ? "Reconstrução preparada" : "Treino"} />
            <Localized value={" em literatura até "} />
            <Localized value={m.cutoff_year} />
            <Localized value={";"} />
            <Localized value={" "} />
            <Localized
              value={
                m.cutoff_year < m.window[1]
                  ? `avaliação contra conexões que realmente apareceram entre ${m.window[0]} e ${m.window[1]}`
                  : "este é o último ano do corpus, sem período posterior para confirmação"
              }
            />
            <Localized value={" . "} />
            <Localized value={num(m.n_articles)} />
            <Localized value={" artigos, "} />
            <Localized value={num(m.graph.nodes)} />
            <Localized value={" conceitos MeSH. "} />
          </p>
        </div>
        <div className="min-w-40">
          <Label className="mb-1 block text-xs text-muted-foreground">
            <Localized value={"Ano de corte"} />
          </Label>
          <Select value={String(cutoff)} onValueChange={(value) => onCutoff(Number(value))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <Localized
                value={cutoffs.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    <Localized value={year} />
                  </SelectItem>
                ))}
              />
            </SelectContent>
          </Select>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label={t("AUC (teste)")}
          value={m.model.auc.toFixed(3)}
          sub={`${m.dynamic ? "faixa indicativa" : "IC95%"} ${m.model.auc_ci95[0].toFixed(3)}–${m.model.auc_ci95[1].toFixed(3)}`}
        />
        <Localized
          value={
            m.dynamic ? (
              <Card
                label={t("Corte recalculado")}
                value="sob demanda"
                sub="grafo e ranking derivados do corpus"
              />
            ) : (
              <Card
                label={t("Teste de permutação")}
                value={`p = ${m.model.permutation_p < 0.001 ? "<0,001" : m.model.permutation_p.toFixed(3)}`}
                sub="melhor que o acaso"
              />
            )
          }
        />
        <Card
          label={t("Conexões confirmadas")}
          value={`${num(m.confirmations.n_confirmed)}/${num(m.confirmations.n_predicted)}`}
          sub={`${pct(m.confirmations.rate)} do top ranking`}
        />
        <Card
          label={t("Lead time mediano")}
          value={`${m.confirmations.median_lead_time ?? "—"} anos`}
          sub="antecipação até a conexão surgir"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title={t("Comparação com outros modelos")}
          desc="AUC do modelo multiplex vs. baselines estruturais clássicos de link prediction."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.model_comparison} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis type="number" domain={[0.4, 1]} {...axis} />
              <YAxis type="category" dataKey="name" width={190} {...axis} />
              <Tooltip {...tooltip} />
              <ReferenceLine x={0.5} stroke="oklch(0.63 0.21 22)" strokeDasharray="4 4" />
              <Bar dataKey="auc" radius={4}>
                <Localized
                  value={m.model_comparison.map((d, i) => (
                    <Cell
                      key={d.name}
                      fill={i === 0 ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                    />
                  ))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Localized
            value={
              m.delong_vs_best_baseline && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <Localized value={" Teste de DeLong contra o melhor baseline: z = "} />
                  <Localized value={m.delong_vs_best_baseline.z.toFixed(2)} />
                  <Localized value={" , p ="} />
                  <Localized value={" "} />
                  <Localized
                    value={
                      m.delong_vs_best_baseline.p < 0.001
                        ? "<0,001"
                        : m.delong_vs_best_baseline.p.toFixed(4)
                    }
                  />
                  <Localized value={" . "} />
                </p>
              )
            }
          />
        </Panel>

        <Panel
          title={t("Precision@k / Recall@k")}
          desc="O que importa na prática é o topo do ranking: quantos dos k primeiros pares viraram conexão real."
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={m.precision_at_k}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="k" {...axis} />
              <YAxis domain={[0, 1]} {...axis} />
              <Tooltip {...tooltip} />
              <Line dataKey="precision" stroke="var(--color-primary)" strokeWidth={2} dot />
              <Line dataKey="recall" stroke="var(--color-accent)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title={t("Calibração")}
          desc={`Curva de confiabilidade. Brier score = ${m.calibration.brier.toFixed(3)} (menor é melhor).`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={m.calibration.bins}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="p_pred" tickFormatter={(v: number) => v.toFixed(1)} {...axis} />
              <YAxis domain={[0, 1]} {...axis} />
              <Tooltip {...tooltip} />
              <Line dataKey="p_obs" stroke="var(--color-primary)" strokeWidth={2} dot />
              <Line
                dataKey="p_pred"
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title={t("Tempo até a nova conexão aparecer")}
          desc="Distribuição do lead time entre a previsão (ano de corte) e a primeira co-ocorrência real."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.confirmations.lead_time_histogram}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="years" unit=" a" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <Bar dataKey="n" fill="var(--color-accent)" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title={t("Importância das features")}
          desc="Contribuição de cada sinal do multiplex para a predição."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.model.feature_importance} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis type="number" {...axis} />
              <YAxis type="category" dataKey="feature" width={150} {...axis} />
              <Tooltip {...tooltip} />
              <Bar dataKey="importance" fill="var(--color-chart-3)" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title={t("Estrutura da rede")}
          desc="Diagnósticos do grafo pré-corte usados para validar o regime livre de escala."
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item k="Conceitos (nós)" v={num(m.graph.nodes)} />
            <Item k="Arestas pré-corte" v={num(m.graph.edges_pre)} />
            <Item k="Novas arestas pós-corte" v={num(m.graph.edges_post_new)} />
            <Item k="Densidade" v={m.graph.density.toExponential(2)} />
            <Item k="Pares avaliados" v={num(m.labels.n)} />
            <Item k="Taxa base de positivos" v={pct(m.labels.rate)} />
            <Localized
              value={
                m.powerlaw && (
                  <>
                    <Item k="Lei de potência α" v={m.powerlaw.alpha.toFixed(2)} />
                    <Item
                      k="vs. lognormal"
                      v={`R = ${m.powerlaw.loglik_ratio_vs_lognormal.toFixed(2)} (p = ${m.powerlaw.p.toFixed(2)})`}
                    />
                  </>
                )
              }
            />
          </dl>
          <Localized
            value={
              m.demo && (
                <Badge variant="outline" className="mt-4">
                  <Localized
                    value={
                      " Dados de demonstração — rode pipeline/build_mesh_graph.py para substituir "
                    }
                  />
                </Badge>
              )
            }
          />
        </Panel>
      </div>

      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="font-display text-xl font-semibold">
            <Localized value={"Comparativo por ano de corte"} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Localized
              value={
                " Os recortes estatísticos publicados foram reunidos aqui para comparar desempenho, confirmações e antecipação sem sair da Validação. "
              }
            />
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title={t("Desempenho ao longo do tempo")}
            desc="AUC e precision@50 nos recortes validados."
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
                <XAxis dataKey="cutoff_year" {...axis} />
                <YAxis domain={[0, 1]} {...axis} />
                <Tooltip {...tooltip} />
                <Line dataKey="auc" name="AUC" stroke="var(--color-primary)" strokeWidth={2} dot />
                <Line
                  dataKey="precision_at_50"
                  name="Precision@50"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel
            title={t("Confirmações após cada corte")}
            desc="Quantidade prevista e confirmada na literatura posterior."
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
                <XAxis dataKey="cutoff_year" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltip} />
                <Bar
                  dataKey="n_predicted"
                  name="Previstas"
                  fill="var(--color-muted-foreground)"
                  radius={4}
                />
                <Bar
                  dataKey="n_confirmed"
                  name="Confirmadas"
                  fill="var(--color-primary)"
                  radius={4}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-secondary/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">
                  <Localized value={"Corte"} />
                </th>
                <th className="p-3">
                  <Localized value={"AUC"} />
                </th>
                <th className="p-3">
                  <Localized value={"Precision@50"} />
                </th>
                <th className="p-3">
                  <Localized value={"Confirmadas"} />
                </th>
                <th className="p-3">
                  <Localized value={"Taxa"} />
                </th>
                <th className="p-3">
                  <Localized value={"Lead time mediano"} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Localized
                value={timeline.map((item) => (
                  <tr key={item.cutoff_year}>
                    <td className="p-3 font-mono text-primary">
                      <Localized value={item.cutoff_year} />
                    </td>
                    <td className="p-3">
                      <Localized value={item.auc.toFixed(3)} />
                    </td>
                    <td className="p-3">
                      <Localized
                        value={item.precision_at_50 == null ? "—" : pct(item.precision_at_50)}
                      />
                    </td>
                    <td className="p-3">
                      <Localized value={num(item.n_confirmed)} />
                      <Localized value={"/"} />
                      <Localized value={num(item.n_predicted)} />
                    </td>
                    <td className="p-3">
                      <Localized value={pct(item.rate)} />
                    </td>
                    <td className="p-3">
                      <Localized
                        value={
                          item.median_lead_time == null ? "—" : `${item.median_lead_time} anos`
                        }
                      />
                    </td>
                  </tr>
                ))}
              />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  const _uiLanguage = useLanguage().language;

  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        <Localized value={label} />
      </p>
      <p className="stat-value mt-1 text-2xl text-primary">
        <Localized value={value} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        <Localized value={sub} />
      </p>
    </div>
  );
}

function Panel({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  const _uiLanguage = useLanguage().language;

  return (
    <section className="panel p-5">
      <h2 className="font-display text-base font-semibold">
        <Localized value={title} />
      </h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        <Localized value={desc} />
      </p>
      <Localized value={children} />
    </section>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  const _uiLanguage = useLanguage().language;

  return (
    <div>
      <dt className="text-xs text-muted-foreground">
        <Localized value={k} />
      </dt>
      <dd className="stat-value text-sm">
        <Localized value={v} />
      </dd>
    </div>
  );
}
