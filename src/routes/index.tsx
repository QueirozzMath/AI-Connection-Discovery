import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { Search, Sparkles, Zap } from "lucide-react";

import { ScienceMap } from "@/components/ScienceMap";
import {
  candidatesQuery,
  catColor,
  graphQuery,
  metricsQuery,
  num,
  pct,
  type Candidate,
} from "@/lib/science-data";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mapa da ciência MeSH — MeSHMap" },
      {
        name: "description",
        content:
          "Navegue a rede multiplex de MeSH terms do PubMed e veja as conexões inéditas com maior probabilidade de virar descoberta.",
      },
      { property: "og:title", content: "Mapa da ciência MeSH — MeSHMap" },
      {
        property: "og:description",
        content:
          "Rede multiplex de MeSH terms do PubMed com predição de descobertas por literatura desconexa.",
      },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(graphQuery),
      context.queryClient.ensureQueryData(candidatesQuery),
      context.queryClient.ensureQueryData(metricsQuery),
    ]),
  component: () => (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando rede…</div>}>
      <MapPage />
    </Suspense>
  ),
});

function MapPage() {
  const { data: graph } = useSuspenseQuery(graphQuery);
  const { data: candidates } = useSuspenseQuery(candidatesQuery);
  const { data: metrics } = useSuspenseQuery(metricsQuery);

  const [query, setQuery] = useState("");
  const [showEdges, setShowEdges] = useState(true);
  const [colorMode, setColorMode] = useState<"category" | "degree" | "candidates">("category");
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Candidate | null>(null);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);

  const list = useMemo(
    () => candidates.items.filter((c) => (onlyConfirmed ? c.confirmed : true)).slice(0, 120),
    [candidates.items, onlyConfirmed],
  );

  const node = selected == null ? null : graph.nodes[selected];

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-border bg-sidebar p-4 lg:h-full lg:w-96 lg:border-b-0 lg:border-r">
        <div>
          <h1 className="font-display text-lg font-semibold">Mapa da ciência MeSH</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {num(graph.meta.n_nodes)} conceitos · {num(graph.meta.n_edges)} co-ocorrências ·
            corte {graph.meta.cutoff_year}
            {graph.meta.demo ? " · dados de demonstração" : ""}
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conceito MeSH…"
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Switch id="edges" checked={showEdges} onCheckedChange={setShowEdges} />
            <Label htmlFor="edges" className="text-xs">
              Arestas
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="deg"
              checked={colorMode === "degree"}
              onCheckedChange={(v) => setColorMode(v ? "degree" : "category")}
            />
            <Label htmlFor="deg" className="text-xs">
              Colorir por grau
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="conf" checked={onlyConfirmed} onCheckedChange={setOnlyConfirmed} />
            <Label htmlFor="conf" className="text-xs">
              Só confirmadas
            </Label>
          </div>
        </div>

        {node && (
          <div className="panel p-3">
            <p className="font-display text-sm font-semibold">{node.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ramo {node.cat} · {num(node.deg)} conexões · {num(node.pubs)} artigos
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="AUC" value={metrics.model.auc.toFixed(3)} />
          <Stat label="Confirmadas" value={pct(metrics.confirmations.rate, 0)} />
          <Stat
            label="Lead time"
            value={`${metrics.confirmations.median_lead_time ?? "—"} a`}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <h2 className="font-display text-sm font-semibold">Conexões inferidas</h2>
          <Badge variant="secondary" className="text-[10px]">
            {list.length} pares
          </Badge>
        </div>

        <ScrollArea className="min-h-40 flex-1 rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {list.map((c) => (
              <li key={`${c.a}-${c.c}`}>
                <button
                  onClick={() => {
                    setHighlight(c);
                    setColorMode("candidates");
                  }}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{c.rank}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {c.confirmed ? (
                        <Badge className="bg-accent text-accent-foreground text-[10px]">
                          confirmada +{c.lead_time_years}a
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          em aberto
                        </Badge>
                      )}
                      <span className="font-mono text-[11px] text-primary">
                        {pct(c.prob, 0)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs leading-snug">
                    <span className="font-medium">{c.a}</span>
                    <span className="text-muted-foreground"> ⇢ </span>
                    <span className="font-medium">{c.c}</span>
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    via {c.intermediaries.slice(0, 3).join(", ")}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>

        {highlight && (
          <Button asChild size="sm" className="w-full">
            <Link to="/hypotheses" search={{ a: highlight.a, c: highlight.c }}>
              <Sparkles className="size-4" /> Gerar hipótese com agentes
            </Link>
          </Button>
        )}
      </aside>

      <div className="relative min-h-[60vh] flex-1">
        <ScienceMap
          graph={graph}
          highlight={highlight}
          query={query}
          colorMode={colorMode}
          showEdges={showEdges}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[70%] flex-wrap gap-2">
          {graph.categories.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-1.5 rounded-full border border-border bg-popover/80 px-2 py-1 text-[10px] backdrop-blur"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: catColor(c.id) }}
              />
              {c.label}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-border bg-popover/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
          <Zap className="size-3.5 text-primary" /> arraste para navegar · scroll para zoom
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="stat-value text-base text-primary">{value}</p>
    </div>
  );
}
