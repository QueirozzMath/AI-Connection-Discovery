import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Boxes, Network, Search, Sparkles, Target, Zap } from "lucide-react";

import { ScienceMap, type MapHighlight } from "@/components/ScienceMap";
import { ScienceMap3D } from "@/components/ScienceMap3D";
import {
  candidatesQuery,
  catColor,
  graphQuery,
  indexQuery,
  metricsQuery,
  num,
  pct,
} from "@/lib/science-data";
import { buildAdjacency, discover, type InferredPair } from "@/lib/discovery";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mapa da ciência MeSH — MeSHMap" },
      {
        name: "description",
        content:
          "Navegue a rede real de MeSH terms do PubMed em 2D, 3D e por hierarquia, e encontre as conexões inéditas com maior chance de virar descoberta.",
      },
      { property: "og:title", content: "Mapa da ciência MeSH — MeSHMap" },
      {
        property: "og:description",
        content:
          "Rede real de MeSH terms do PubMed com predição de descobertas por literatura desconexa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  ssr: false,
  component: () => (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando rede…</div>}>
      <MapPage />
    </Suspense>
  ),
});

function MapPage() {
  const { data: idx } = useSuspenseQuery(indexQuery);
  const [cutoff, setCutoff] = useState(idx.default_cutoff);
  return <MapForCutoff key={cutoff} cutoff={cutoff} cutoffs={idx.cutoffs} onCutoff={setCutoff} />;
}

function MapForCutoff({
  cutoff,
  cutoffs,
  onCutoff,
}: {
  cutoff: number;
  cutoffs: number[];
  onCutoff: (v: number) => void;
}) {
  const { data: graph } = useSuspenseQuery(graphQuery(cutoff));
  const { data: candidates } = useSuspenseQuery(candidatesQuery(cutoff));
  const { data: metrics } = useSuspenseQuery(metricsQuery(cutoff));

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<"force" | "hierarchy" | "3d">("force");
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [colorMode, setColorMode] = useState<"category" | "degree" | "growth">("category");
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<MapHighlight | null>(null);
  const [mode, setMode] = useState<"global" | "seeded">("global");
  const [randomSeed, setRandomSeed] = useState(42);
  const [seeds, setSeeds] = useState<number[]>([]);
  const [pairs, setPairs] = useState<InferredPair[] | null>(null);
  const [busy, setBusy] = useState(false);

  const adj = useMemo(() => buildAdjacency(graph), [graph]);
  const byLabel = useMemo(
    () => new Map(graph.nodes.map((n, i) => [n.label.toLowerCase(), i])),
    [graph],
  );

  const matches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<number>();
    graph.nodes.forEach((n, i) => {
      if (n.label.toLowerCase().includes(q) || n.tree.toLowerCase().startsWith(q)) set.add(i);
    });
    return set;
  }, [graph, deferredQuery]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return graph.nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.label.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = a.n.label.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.n.label.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || b.n.deg - a.n.deg;
      })
      .slice(0, 8);
  }, [graph, query]);

  // ranking padrão vindo do pipeline (com confirmação real pós-corte)
  const precomputed = useMemo(() => {
    return candidates.items.map((c) => ({
      ...c,
      ai: c.a_ui ? graph.nodes.findIndex((n) => n.id === c.a_ui) : -1,
      ci: c.c_ui ? graph.nodes.findIndex((n) => n.id === c.c_ui) : -1,
    }));
  }, [candidates.items, graph.nodes]);

  const runDiscovery = () => {
    setBusy(true);
    setTimeout(() => {
      const res = discover(graph, adj, {
        mode,
        seeds: mode === "seeded" ? seeds : undefined,
        randomSeed,
        limit: 200,
      });
      setPairs(res);
      setBusy(false);
    }, 20);
  };

  useEffect(() => {
    setPairs(null);
    setHighlight(null);
  }, [mode, cutoff]);

  const node = selected == null ? null : graph.nodes[selected];
  const seedSet = useMemo(() => new Set(seeds), [seeds]);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-sidebar p-4 lg:h-full lg:w-[26rem] lg:border-b-0 lg:border-r">
        <div>
          <h1 className="font-display text-lg font-semibold">Mapa da ciência MeSH</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {num(graph.meta.n_nodes)} conceitos · {num(graph.meta.n_edges)} co-ocorrências ·{" "}
            {num(graph.meta.n_articles)} artigos reais do PubMed
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs text-muted-foreground">Ano de corte</Label>
          <Select value={String(cutoff)} onValueChange={(v) => onCutoff(Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cutoffs.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="force" className="text-xs">
              <Network className="mr-1 size-3.5" /> Rede
            </TabsTrigger>
            <TabsTrigger value="hierarchy" className="text-xs">
              <Target className="mr-1 size-3.5" /> Hierarquia
            </TabsTrigger>
            <TabsTrigger value="3d" className="text-xs">
              <Boxes className="mr-1 size-3.5" /> 3D
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conceito MeSH ou código da árvore…"
            className="pl-8"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-panel">
              {suggestions.map(({ n, i }) => (
                <li key={n.id}>
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary"
                    onClick={() => {
                      setSelected(i);
                      setQuery(n.label);
                      if (mode === "seeded" && !seeds.includes(i)) setSeeds((s) => [...s, i]);
                    }}
                  >
                    <span className="truncate">{n.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {n.tree || n.cat} · {n.deg}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
              Cor por grau
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="growth"
              checked={colorMode === "growth"}
              onCheckedChange={(v) => setColorMode(v ? "growth" : "category")}
            />
            <Label htmlFor="growth" className="text-xs">
              Cor por crescimento
            </Label>
          </div>
          {view === "3d" && (
            <div className="flex items-center gap-2">
              <Switch id="rot" checked={autoRotate} onCheckedChange={setAutoRotate} />
              <Label htmlFor="rot" className="text-xs">
                Girar
              </Label>
            </div>
          )}
        </div>

        {node && (
          <div className="panel p-3">
            <p className="font-display text-sm font-semibold">{node.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ramo {node.cat} {node.tree ? `· ${node.tree}` : ""} · {num(node.deg)} conexões ·{" "}
              {num(node.pubs)} artigos
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2 h-7 text-xs"
              onClick={() => {
                setMode("seeded");
                setSeeds((s) => (s.includes(selected!) ? s : [...s, selected!]));
              }}
            >
              Usar como termo-chave
            </Button>
          </div>
        )}

        <div className="panel space-y-2 p-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="global" className="text-xs">
                Busca global
              </TabsTrigger>
              <TabsTrigger value="seeded" className="text-xs">
                Termos-chave
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "global" ? (
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-xs text-muted-foreground">Semente</Label>
              <Input
                type="number"
                value={randomSeed}
                onChange={(e) => setRandomSeed(Number(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {seeds.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Busque e escolha um ou mais termos (ex.: Zika Virus, Glioblastoma).
                </p>
              )}
              {seeds.map((i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="cursor-pointer text-[10px]"
                  onClick={() => setSeeds((s) => s.filter((x) => x !== i))}
                >
                  {graph.nodes[i]!.label} ×
                </Badge>
              ))}
            </div>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={busy || (mode === "seeded" && seeds.length === 0)}
            onClick={runDiscovery}
          >
            <Sparkles className="size-4" />
            {busy ? "Inferindo…" : "Inferir conexões"}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="AUC" value={metrics.model.auc.toFixed(3)} />
          <Stat label="Confirmadas" value={pct(metrics.confirmations.rate, 0)} />
          <Stat
            label="Lead time"
            value={`${metrics.confirmations.median_lead_time ?? "—"} a`}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <h2 className="font-display text-sm font-semibold">
            {pairs ? "Conexões inferidas agora" : "Ranking validado do corte"}
          </h2>
          <Badge variant="secondary" className="text-[10px]">
            {pairs ? pairs.length : precomputed.length} pares
          </Badge>
        </div>

        <ScrollArea className="min-h-40 flex-1 rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {pairs
              ? pairs.map((p) => (
                  <li key={`${p.a}-${p.c}`}>
                    <button
                      onClick={() =>
                        setHighlight({ a: p.a, c: p.c, bridges: p.bridges, confirmed: false })
                      }
                      className="w-full px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {graph.nodes[p.a]!.cat} ⇢ {graph.nodes[p.c]!.cat}
                        </span>
                        <span className="font-mono text-[11px] text-primary">
                          {pct(p.prob, 0)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-snug">
                        <span className="font-medium">{graph.nodes[p.a]!.label}</span>
                        <span className="text-muted-foreground"> ⇢ </span>
                        <span className="font-medium">{graph.nodes[p.c]!.label}</span>
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        via {p.bridges.map((b) => graph.nodes[b]!.label).slice(0, 3).join(", ")}
                      </p>
                      <Link
                        to="/hypotheses"
                        search={{
                          a: graph.nodes[p.a]!.label,
                          c: graph.nodes[p.c]!.label,
                          cutoff,
                        }}
                        className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                      >
                        gerar hipótese →
                      </Link>
                    </button>
                  </li>
                ))
              : precomputed.slice(0, 120).map((c) => (
                  <li key={`${c.a}-${c.c}`}>
                    <button
                      onClick={() => {
                        if (c.ai >= 0 && c.ci >= 0)
                          setHighlight({ a: c.ai, c: c.ci, confirmed: c.confirmed });
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
                      <Link
                        to="/hypotheses"
                        search={{ a: c.a, c: c.c, cutoff }}
                        className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                      >
                        gerar hipótese →
                      </Link>
                    </button>
                  </li>
                ))}
          </ul>
        </ScrollArea>
      </aside>

      <div className="relative min-h-[60vh] flex-1">
        {view === "3d" ? (
          <ScienceMap3D
            graph={graph}
            highlight={highlight}
            matches={matches}
            seeds={seedSet}
            showEdges={showEdges}
            autoRotate={autoRotate}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <ScienceMap
            graph={graph}
            layout={view}
            highlight={highlight}
            matches={matches}
            seeds={seedSet}
            colorMode={colorMode}
            showEdges={showEdges}
            selected={selected}
            onSelect={setSelected}
          />
        )}
        <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[70%] flex-wrap gap-2">
          {graph.categories.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-1.5 rounded-full border border-border bg-popover/80 px-2 py-1 text-[10px] backdrop-blur"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: catColor(c.id) }} />
              {c.label}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-border bg-popover/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
          <Zap className="size-3.5 text-primary" />
          {view === "3d" ? "arraste para girar · scroll para aproximar" : "arraste para navegar · scroll para zoom"}
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
