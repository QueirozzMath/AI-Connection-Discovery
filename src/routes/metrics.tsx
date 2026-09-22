import { useTemporalAnalysis } from "@/hooks/use-temporal-analysis";
import type { Metrics } from "@/lib/science-data";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { num, pct } from "@/lib/science-data";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/metrics")({
  head: () => ({
    meta: [
      { title: "Validação estatística do modelo — MeSHMap" },
      {
        name: "description",
        content:
          "AUC com IC bootstrap, teste de permutação, precision@k, calibração, lead time e comparação com baselines estruturais.",
      },
      { property: "og:title", content: "Validação estatística do modelo — MeSHMap" },
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
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando métricas…</div>}>
      <MetricsGate />
    </Suspense>
  ),
});

function MetricsGate() {
  const [requested, setRequested] = useState(false);
  const query = useTemporalAnalysis("validate", requested);
  if (!requested)
    return (
      <div className="p-8">
        <button
          className="rounded bg-primary p-3 text-primary-foreground"
          onClick={() => setRequested(true)}
        >
          Validar com o corte do período selecionado
        </button>
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="p-8">
        Não foi possível executar a validação.
      </div>
    );
  if (!query.data || query.data.status === "pending" || query.data.status === "busy")
    return (
      <div role="status" className="p-8">
        Treinando e avaliando o modelo em segundo plano?
      </div>
    );
  if (!query.data.metrics)
    return (
      <div role="status" className="p-8">
        {query.data.reason ?? "Dados insuficientes para validação temporal neste corte."}
      </div>
    );
  return <MetricsPage m={query.data.metrics} />;
}
function MetricsPage({ m }: { m: Metrics }) {
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
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Validação do modelo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Treino em literatura até {m.cutoff_year}; avaliação contra conexões que realmente
          apareceram entre {m.cutoff_year + 1} e {m.window[1]}. {num(m.n_articles)} artigos,{" "}
          {num(m.graph.nodes)} conceitos MeSH.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="AUC (teste)"
          value={m.model.auc.toFixed(3)}
          sub={`IC95% ${m.model.auc_ci95[0].toFixed(3)}–${m.model.auc_ci95[1].toFixed(3)}`}
        />
        <Card
          label="Teste de permutação"
          value={`p = ${m.model.permutation_p < 0.001 ? "<0,001" : m.model.permutation_p.toFixed(3)}`}
          sub="melhor que o acaso"
        />
        <Card
          label="Conexões confirmadas"
          value={`${num(m.confirmations.n_confirmed)}/${num(m.confirmations.n_predicted)}`}
          sub={`${pct(m.confirmations.rate)} do top ranking`}
        />
        <Card
          label="Lead time mediano"
          value={`${m.confirmations.median_lead_time ?? "—"} anos`}
          sub="antecipação até a conexão surgir"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Comparação com outros modelos"
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
                {m.model_comparison.map((d, i) => (
                  <Cell
                    key={d.name}
                    fill={i === 0 ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {m.delong_vs_best_baseline && (
            <p className="mt-2 text-xs text-muted-foreground">
              Teste de DeLong contra o melhor baseline: z = {m.delong_vs_best_baseline.z.toFixed(2)}
              , p ={" "}
              {m.delong_vs_best_baseline.p < 0.001
                ? "<0,001"
                : m.delong_vs_best_baseline.p.toFixed(4)}
              .
            </p>
          )}
        </Panel>

        <Panel
          title="Precision@k / Recall@k"
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
          title="Calibração"
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
          title="Tempo até a nova conexão aparecer"
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
          title="Importância das features"
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
          title="Estrutura da rede"
          desc="Diagnósticos do grafo pré-corte usados para validar o regime livre de escala."
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item k="Conceitos (nós)" v={num(m.graph.nodes)} />
            <Item k="Arestas pré-corte" v={num(m.graph.edges_pre)} />
            <Item k="Pares de teste que surgiram após o corte" v={num(m.graph.edges_post_new)} />
            <Item k="Densidade" v={m.graph.density.toExponential(2)} />
            <Item k="Pares avaliados" v={num(m.labels.n)} />
            <Item k="Taxa base de positivos" v={pct(m.labels.rate)} />
            {m.powerlaw && (
              <>
                <Item k="Lei de potência α" v={m.powerlaw.alpha.toFixed(2)} />
                <Item
                  k="vs. lognormal"
                  v={`R = ${m.powerlaw.loglik_ratio_vs_lognormal.toFixed(2)} (p = ${m.powerlaw.p.toFixed(2)})`}
                />
              </>
            )}
          </dl>
          {m.demo && (
            <Badge variant="outline" className="mt-4">
              Dados de demonstração — rode pipeline/build_mesh_graph.py para substituir
            </Badge>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="stat-value mt-1 text-2xl text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
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
  return (
    <section className="panel p-5">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{desc}</p>
      {children}
    </section>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="stat-value text-sm">{v}</dd>
    </div>
  );
}
