import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { indexQuery, num, pct, timelineQuery } from "@/lib/science-data";

export const Route = createFileRoute("/timeline")({
  head: () => ({
    meta: [
      { title: "Eficácia por ano de corte — MeSHMap" },
      {
        name: "description",
        content:
          "Conexões confirmadas, tempo médio até a confirmação e eficácia do modelo para cada ano de corte testado.",
      },
      { property: "og:title", content: "Eficácia por ano de corte — MeSHMap" },
      {
        property: "og:description",
        content:
          "Comparativo por ano de corte: confirmações, lead time e AUC do modelo de literatura desconexa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  ssr: false,
  component: () => (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando séries…</div>}>
      <TimelinePage />
    </Suspense>
  ),
});

function TimelinePage() {
  const { data } = useSuspenseQuery(timelineQuery);
  const { data: idx } = useSuspenseQuery(indexQuery);
  const axis = { stroke: "oklch(0.7 0.024 246)", fontSize: 11 };
  const tooltip = {
    contentStyle: {
      background: "oklch(0.21 0.03 252)",
      border: "1px solid oklch(0.32 0.03 253)",
      borderRadius: 8,
      fontSize: 12,
    },
  } as const;

  const items = data.items;
  const totalConfirmed = items.reduce((s, i) => s + i.n_confirmed, 0);
  const totalPredicted = items.reduce((s, i) => s + i.n_predicted, 0);
  const leads = items.map((i) => i.mean_lead_time).filter((v): v is number => v != null);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Eficácia por ano de corte</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada corte treina e avalia o modelo só com a literatura disponível naquele ano.
          Corpus real: {num(idx.n_articles)} artigos do PubMed entre {idx.corpus_years[0]} e{" "}
          {idx.corpus_years[1]}.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Cortes avaliados" value={String(items.length)} sub={idx.cutoffs.join(" · ")} />
        <Card
          label="Conexões confirmadas"
          value={`${num(totalConfirmed)}/${num(totalPredicted)}`}
          sub={`${pct(totalConfirmed / Math.max(1, totalPredicted))} do topo do ranking`}
        />
        <Card
          label="Tempo médio até confirmar"
          value={leads.length ? `${(leads.reduce((a, b) => a + b, 0) / leads.length).toFixed(1)} anos` : "—"}
          sub="média entre os cortes"
        />
        <Card
          label="AUC médio"
          value={(items.reduce((s, i) => s + i.auc, 0) / Math.max(1, items.length)).toFixed(3)}
          sub="acerto na ordenação dos pares"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Conexões confirmadas por ano de corte"
          desc="Pares do topo do ranking que realmente passaram a co-ocorrer depois do corte."
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={items}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="cutoff_year" {...axis} />
              <YAxis yAxisId="l" {...axis} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 0.3]} {...axis} />
              <Tooltip {...tooltip} />
              <Bar yAxisId="l" dataKey="n_confirmed" fill="var(--color-accent)" radius={4} />
              <Line
                yAxisId="r"
                dataKey="rate"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title="Tempo até a conexão aparecer"
          desc="Mediana e média de anos entre a previsão e a primeira co-ocorrência real."
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={items}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="cutoff_year" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <Line dataKey="median_lead_time" stroke="var(--color-primary)" strokeWidth={2} dot />
              <Line dataKey="mean_lead_time" stroke="var(--color-accent)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title="Eficácia do modelo (AUC)"
          desc="Capacidade de ordenar corretamente pares que viraram conexão contra os que não viraram."
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={items}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="cutoff_year" {...axis} />
              <YAxis domain={[0.5, 1]} {...axis} />
              <Tooltip {...tooltip} />
              <Line dataKey="auc" stroke="var(--color-primary)" strokeWidth={2} dot />
              <Line
                dataKey="precision_at_50"
                stroke="var(--color-chart-3)"
                strokeWidth={2}
                dot
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title="Escala da rede em cada corte"
          desc="Conceitos MeSH ativos e taxa base de pares que viram conexão."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={items}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 253)" />
              <XAxis dataKey="cutoff_year" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <Bar dataKey="nodes" fill="var(--color-chart-3)" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <section className="panel overflow-x-auto p-5">
        <h2 className="font-display text-base font-semibold">Tabela por corte</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2">Corte</th>
              <th>AUC (IC95%)</th>
              <th>Confirmadas</th>
              <th>Taxa</th>
              <th>Lead time mediano</th>
              <th>Precision@50</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.cutoff_year} className="border-t border-border">
                <td className="py-2 font-medium">{i.cutoff_year}</td>
                <td className="stat-value">
                  {i.auc.toFixed(3)} ({i.auc_ci95[0].toFixed(2)}–{i.auc_ci95[1].toFixed(2)})
                </td>
                <td>
                  {i.n_confirmed}/{i.n_predicted}
                </td>
                <td>{pct(i.rate)}</td>
                <td>{i.median_lead_time ?? "—"} anos</td>
                <td>{i.precision_at_50 != null ? pct(i.precision_at_50) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
