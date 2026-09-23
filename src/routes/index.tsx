import { useTemporalAnalysis } from "@/hooks/use-temporal-analysis";
import { useTemporal } from "@/components/TemporalContext";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Boxes, Network, Search, Sparkles, Target, Zap } from "lucide-react";

import { ScienceMap, type MapHighlight } from "@/components/ScienceMap";
import { useMapLayout } from "@/hooks/use-map-layout";
import {
  selectKeywordNodes,
  categoryCoverage,
  mapSearchIndex,
  selectMapNodes,
  summarizeMap,
} from "@/lib/map-selection";
import { MapArticles } from "@/components/MapArticles";
import { mapPeriodGraph, searchConcepts } from "@/lib/map-api.functions";
import type { MapCatalog, TemporalGraph } from "@/lib/map-api-types";
import { MapToolbar } from "@/components/MapToolbar";
import type { MapCommand, MapAction, MapTool } from "@/lib/map-navigation";
import { ScienceMap3D } from "@/components/ScienceMap3D";
import { catColor, num, pct, type ScienceGraph } from "@/lib/science-data";
import { type InferredPair } from "@/lib/discovery";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: SearchSchemaInput & {
      q?: unknown;
      cats?: unknown;
      context?: unknown;
      year?: unknown;
      op?: unknown;
      view?: unknown;
      color?: unknown;
      from?: unknown;
      to?: unknown;
    },
  ) => ({
    from: Number.isInteger(Number(search.from)) ? Number(search.from) : undefined,
    to: Number.isInteger(Number(search.to)) ? Number(search.to) : undefined,
    op: search.op === "and" ? ("and" as const) : ("or" as const),
    view:
      search.view === "3d"
        ? ("3d" as const)
        : search.view === "hierarchy"
          ? ("hierarchy" as const)
          : ("force" as const),
    color:
      search.color === "degree"
        ? ("degree" as const)
        : search.color === "growth"
          ? ("growth" as const)
          : ("category" as const),
    q: typeof search.q === "string" ? search.q : "",
    cats: typeof search.cats === "string" ? search.cats : "",
    context: search.context === true || search.context === "true",
    year: Number.isInteger(Number(search.year)) ? Number(search.year) : undefined,
  }),
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
  const { period, catalog } = useTemporal();
  const search = Route.useSearch();
  const periodQuery = useQuery({
    queryKey: ["period-graph", period, catalog?.revision, search.focus, search.seedIds],
    queryFn: () =>
      mapPeriodGraph({
        data: {
          ...period!,
          focusIds: [
            ...new Set([search.focus, ...search.seedIds.split(",")].filter(Boolean)),
          ].slice(0, 20),
        },
      }),
    enabled: !!period && !!catalog,
  });
  if (!period || !catalog)
    return <div className="p-8">Aguardando o serviço de dados científicos.</div>;
  if (periodQuery.isPending) return <div className="p-8">Carregando rede…</div>;
  if (periodQuery.isError)
    return (
      <div role="alert" className="p-8">
        Não foi possível carregar o período.{" "}
        <Button onClick={() => void periodQuery.refetch()}>Tentar novamente</Button>
      </div>
    );
  return (
    <MapForCutoff
      key={`${period.startYear}:${period.endYear}:${catalog.revision}:${search.focus}:${search.seedIds}`}
      cutoff={period.endYear}
      catalog={catalog}
      temporal={periodQuery.data}
      start={period.startYear}
      end={period.endYear}
      graph={periodQuery.data}
    />
  );
}
interface MapViewProps {
  cutoff: number;
  catalog: MapCatalog;
  temporal: TemporalGraph;
  start: number;
  end: number;
}
function MapForCutoff({
  cutoff,
  catalog,
  temporal,
  start,
  end,
  graph,
}: MapViewProps & {
  graph: ScienceGraph;
}) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const [deferredQuery, setDeferredQuery] = useState(search.q);
  const categories = useMemo(() => {
    const labels = new Map(graph.categories.map((c) => [c.id, c.label]));
    const counts = new Map<string, number>();
    for (const n of graph.nodes) counts.set(n.cat, (counts.get(n.cat) ?? 0) + 1);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => ({ id, label: labels.get(id) ?? id, count }));
  }, [graph]);
  const selectedCategories = useMemo(
    () => search.cats.split(",").filter((id) => categories.some((c) => c.id === id)),
    [search.cats, categories],
  );
  const showUnselected = search.context;
  const [focusRequest, setFocusRequest] = useState(0);
  const { positions, layoutPending, layoutFailed } = useMapLayout(graph);
  const displayGraph = useMemo(
    () =>
      positions
        ? {
            ...graph,
            nodes: graph.nodes.map((n, i) => ({
              ...n,
              x: positions[i * 2]!,
              y: positions[i * 2 + 1]!,
            })),
          }
        : graph,
    [graph, positions],
  );
  useEffect(() => {
    setQuery(search.q);
    setDeferredQuery(search.q);
  }, [search.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeferredQuery(query);
      if (query !== search.q)
        void navigate({ search: (previous) => ({ ...previous, q: query }), replace: true });
    }, 220);
    return () => clearTimeout(timer);
  }, [query, search.q, navigate]);
  const toggleCategory = (id: string) => {
    const next = selectedCategories.includes(id)
      ? selectedCategories.filter((c) => c !== id)
      : [...selectedCategories, id];
    void navigate({ search: (previous) => ({ ...previous, cats: next.join(",") }), replace: true });
  };
  const clearFilters = () => {
    setQuery("");
    setDeferredQuery("");
    setSelected(null);
    setSeeds([]);
    setHighlight(null);
    void navigate({
      search: (previous) => ({ ...previous, q: "", cats: "", context: false }),
      replace: true,
    });
    setFocusRequest((v) => v + 1);
  };
  const view = search.view;
  const setView = (view: "force" | "hierarchy" | "3d") => {
    setTool("navigate");
    setHovered(null);
    void navigate({ search: (previous) => ({ ...previous, view }), replace: true });
  };
  const [hovered, setHovered] = useState<number | null>(null);
  const [command, setCommand] = useState<MapCommand>({ action: "fit", sequence: 0 });
  const [tool, setTool] = useState<MapTool>("navigate");
  const onAction = (action: MapAction) => {
    setAutoRotate(false);
    setCommand((previous) => ({ action, sequence: previous.sequence + 1 }));
  };
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const colorMode = search.color;
  const setColorMode = (color: "category" | "degree" | "growth") => {
    void navigate({ search: (previous) => ({ ...previous, color }), replace: true });
  };
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<MapHighlight | null>(null);
  const [mode, setMode] = useState<"global" | "seeded">(search.seedIds ? "seeded" : "global");
  const [seeds, setSeeds] = useState<number[]>(() =>
    search.seedIds
      .split(",")
      .map((id) => graph.nodes.findIndex((n) => n.id === id))
      .filter((i) => i >= 0),
  );
  useEffect(() => {
    const seedIds = mode === "seeded" ? seeds.map((i) => graph.nodes[i]!.id).join(",") : "";
    if (search.seedIds !== seedIds)
      void navigate({ search: (previous) => ({ ...previous, seedIds }), replace: true });
  }, [seeds, mode, graph, search.seedIds, navigate]);
  const [pairs, setPairs] = useState<InferredPair[] | null>(null);

  const byLabel = useMemo(
    () => new Map(graph.nodes.map((n, i) => [n.label.toLowerCase(), i])),
    [graph],
  );

  const searchIndex = useMemo(() => mapSearchIndex(graph), [graph]);
  const coverage = useMemo(() => categoryCoverage(graph), [graph]);
  const baseMatches = useMemo(
    () =>
      selectMapNodes(graph, searchIndex, deferredQuery, selectedCategories, search.op, coverage),
    [graph, searchIndex, deferredQuery, selectedCategories, search.op, coverage],
  );
  const matches = useMemo(() => {
    if (mode !== "seeded" || !seeds.length) return baseMatches;
    return selectKeywordNodes(graph, baseMatches, seeds);
  }, [mode, seeds, baseMatches, graph]);
  const activeSeeds = useMemo(
    () => seeds.filter((i) => !matches || matches.has(i)),
    [seeds, matches],
  );
  const summary = useMemo(() => summarizeMap(graph, matches), [graph, matches]);
  const conceptQuery = useQuery({
    queryKey: [
      "concept-search",
      start,
      end,
      catalog.revision,
      deferredQuery,
      selectedCategories,
      search.op,
    ],
    queryFn: () =>
      searchConcepts({
        data: {
          startYear: start,
          endYear: end,
          q: deferredQuery,
          categories: selectedCategories,
          operator: search.op,
        },
      }),
    enabled: !!deferredQuery.trim(),
  });
  const suggestions = (conceptQuery.data?.items ?? [])
    .slice(0, 12)
    .map((n) => ({ n, i: graph.nodes.findIndex((node) => node.id === n.id) }));
  useEffect(() => {
    setHighlight(null);
    setPairs(null);
    setHovered(null);
  }, [matches]);
  useEffect(() => {
    if (matches && selected != null && !matches.has(selected)) setSelected(null);
  }, [matches, selected]);

  const [requested, setRequested] = useState(false);
  const allowedIds = useMemo(
    () => (matches ? [...matches].map((i) => graph.nodes[i]!.id) : undefined),
    [matches, graph],
  );
  const seedIds = useMemo(
    () => (mode === "seeded" ? activeSeeds.map((i) => graph.nodes[i]!.id) : undefined),
    [mode, activeSeeds, graph],
  );
  const analysis = useTemporalAnalysis("explore", requested, allowedIds, seedIds);
  const runDiscovery = () => {
    if (requested) void analysis.refetch();
    else setRequested(true);
  };
  const busy = requested && (!analysis.data || ["pending", "busy"].includes(analysis.data.status));

  useEffect(() => {
    setPairs(null);
    setHighlight(null);
  }, [mode, cutoff]);

  useEffect(() => {
    if (requested && analysis.data?.items) {
      const byId = new Map(graph.nodes.map((n, i) => [n.id, i]));
      setPairs(
        analysis.data.items.flatMap((item) => {
          const a = byId.get(item.a_ui ?? ""),
            c = byId.get(item.c_ui ?? "");
          return a == null || c == null
            ? []
            : [
                {
                  a,
                  c,
                  prob: item.prob,
                  bridges: item.intermediaries
                    .map((label) => byLabel.get(label.toLowerCase()) ?? -1)
                    .filter((i) => i >= 0),
                  features: Object.values(item.features),
                },
              ];
        }),
      );
    } else setPairs(null);
  }, [analysis.data, requested, graph, byLabel]);

  const focused = selected ?? hovered;
  const node = focused == null ? null : graph.nodes[focused];
  const articleMeshIds = useMemo(
    () =>
      selected != null
        ? [graph.nodes[selected]!.id]
        : (matches ? [...matches] : graph.nodes.map((_, i) => i)).map((i) => graph.nodes[i]!.id),
    [graph, selected, matches],
  );
  const seedSet = useMemo(() => new Set(seeds), [seeds]);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex max-h-[45vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-sidebar p-4 lg:max-h-none lg:h-full lg:w-64 lg:border-b-0 lg:border-r">
        <div>
          <h1 className="font-display text-lg font-semibold">Mapa da ciência MeSH</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {num(graph.meta.n_nodes)} conceitos · {num(graph.meta.n_edges)} co-ocorrências ·{" "}
            {num(graph.meta.n_articles)} artigos reais do PubMed
          </p>
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

        <div
          className="relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
          }}
        >
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchOpen(false);
            }}
            aria-label="Buscar conceito MeSH, categoria ou área"
            placeholder="Buscar conceito MeSH, categoria ou área…"
            className="pl-8"
          />
          {searchOpen && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-panel">
              {suggestions.map(({ n, i }) => (
                <li key={n.id}>
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary"
                    onClick={() => {
                      if (i < 0) {
                        void navigate({
                          search: (previous) => ({
                            ...previous,
                            focus: n.id,
                            q: mode === "seeded" ? "" : n.label,
                            seedIds:
                              mode === "seeded"
                                ? [
                                    ...new Set([
                                      ...search.seedIds.split(",").filter(Boolean),
                                      n.id,
                                    ]),
                                  ].join(",")
                                : previous.seedIds,
                          }),
                          replace: true,
                        });
                        return;
                      }
                      setSelected(i);
                      setSearchOpen(false);
                      setQuery(mode === "seeded" ? "" : n.label);
                      if (mode === "seeded" && !seeds.includes(i)) setSeeds((s) => [...s, i]);
                    }}
                  >
                    <span className="truncate">{n.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {n.tree || n.category} · {n.pubs} artigos
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {conceptQuery.isError && (
            <p role="alert" className="text-xs text-destructive">
              Falha ao pesquisar o corpus.{" "}
              <button onClick={() => void conceptQuery.refetch()}>Tentar novamente</button>
            </p>
          )}
          {deferredQuery && conceptQuery.data && (
            <p className="text-xs text-muted-foreground">
              {conceptQuery.data.total} conceitos no corpus deste período; o mapa tem limite visual.
            </p>
          )}
        </div>

        <section className="panel space-y-3 p-3" aria-label="Filtros por área">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Filtros</h2>
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs">Categorias</span>
            {(["or", "and"] as const).map((op) => (
              <button
                key={op}
                aria-pressed={search.op === op}
                className="rounded border border-border px-2 py-1 text-xs aria-pressed:bg-primary/25"
                onClick={() =>
                  void navigate({ search: (previous) => ({ ...previous, op }), replace: true })
                }
              >
                {op.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {selectedCategories.length
              ? selectedCategories.length + " categorias ativas"
              : "Todas as categorias"}{" "}
            · {search.op.toUpperCase()}
          </p>
          {search.op === "and" && selectedCategories.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              AND: conceitos das áreas escolhidas ligados diretamente a todas elas. Não implica um
              mesmo artigo.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="unselected"
              checked={showUnselected}
              onCheckedChange={(context) =>
                void navigate({ search: (previous) => ({ ...previous, context }), replace: true })
              }
            />
            <Label htmlFor="unselected" className="text-xs">
              Mostrar nós não selecionados
            </Label>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={summary.count === 0}
            onClick={() => setFocusRequest((v) => v + 1)}
          >
            Centralizar resultados
          </Button>
        </section>
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

          {mode === "seeded" && (
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

          {
            <Button
              size="sm"
              className="w-full"
              disabled={
                busy ||
                (requested && (!analysis.data || analysis.data.status === "pending")) ||
                (mode === "seeded" && activeSeeds.length === 0)
              }
              onClick={runDiscovery}
            >
              <Sparkles className="size-4" />
              {busy ? "Inferindo…" : "Inferir conexões"}
            </Button>
          }
        </div>

        {analysis.data?.reason && (
          <p role="status" className="text-xs text-muted-foreground">
            {analysis.data.reason}
          </p>
        )}
        {
          <>
            <div className="flex items-center justify-between pt-1">
              <h2 className="font-display text-sm font-semibold">
                {pairs ? "Conexões inferidas agora" : "Conexões do período"}
              </h2>
              <Badge variant="secondary" className="text-[10px]">
                {pairs?.length ?? 0} pares
              </Badge>
            </div>

            <ScrollArea className="min-h-40 flex-1 rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {pairs?.map((p) => (
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
                        <span className="font-mono text-[11px] text-primary">{pct(p.prob, 0)}</span>
                      </div>
                      <p className="mt-1 text-xs leading-snug">
                        <span className="font-medium">{graph.nodes[p.a]!.label}</span>
                        <span className="text-muted-foreground"> ⇢ </span>
                        <span className="font-medium">{graph.nodes[p.c]!.label}</span>
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        via{" "}
                        {p.bridges
                          .map((b) => graph.nodes[b]!.label)
                          .slice(0, 3)
                          .join(", ")}
                      </p>
                    </button>
                    <Link
                      to="/hypotheses"
                      search={{
                        a: graph.nodes[p.a]!.label,
                        c: graph.nodes[p.c]!.label,
                        cutoff,
                        from: start,
                        to: end,
                        cats: search.cats,
                        q: search.q,
                        op: search.op,
                        seedIds: search.seedIds,
                      }}
                      className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                    >
                      gerar hipótese →
                    </Link>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </>
        }
      </aside>

      <div className="relative min-h-[60vh] min-w-0 flex-1">
        <div className="absolute inset-x-0 top-14 bottom-32">
          {view === "3d" ? (
            <ScienceMap3D
              graph={displayGraph}
              highlight={highlight}
              matches={matches}
              showUnselected={showUnselected}
              focusRequest={focusRequest}
              command={command}
              tool={tool}
              onHover={setHovered}
              seeds={seedSet}
              showEdges={showEdges}
              autoRotate={autoRotate}
              colorMode={colorMode}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <ScienceMap
              graph={displayGraph}
              layout={view}
              highlight={highlight}
              matches={matches}
              showUnselected={showUnselected}
              focusRequest={focusRequest}
              command={command}
              tool={tool}
              onHover={setHovered}
              seeds={seedSet}
              colorMode={colorMode}
              showEdges={showEdges}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>
        {(layoutPending || layoutFailed) && (
          <div
            role="status"
            className="pointer-events-none absolute left-4 top-4 rounded bg-popover/90 p-2 text-xs"
          >
            {layoutPending
              ? "Organizando comunidades…"
              : "Layout original preservado: não foi possível preparar comunidades."}
          </div>
        )}
        {matches?.size === 0 && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <p className="rounded bg-popover/95 p-4 text-sm">
              Nenhum conceito corresponde aos filtros.
            </p>
          </div>
        )}
        <MapToolbar
          mode3d={view === "3d"}
          tool={tool}
          onTool={(next) => {
            setTool(next);
            setAutoRotate(false);
          }}
          onAction={onAction}
        />
        <div
          className="absolute bottom-3 left-3 right-3 z-20 max-h-28 overflow-auto rounded-lg border border-border bg-popover/95 p-2"
          role="group"
          aria-label="Selecionar categorias"
        >
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={selectedCategories.includes(c.id)}
                title={c.label + " · " + num(c.count) + " conceitos"}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary/20"
                onClick={() => toggleCategory(c.id)}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: catColor(c.id) }} />
                {c.label}
                {selectedCategories.includes(c.id) ? " ✓" : ""}
              </button>
            ))}
          </div>
          {colorMode !== "category" && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {colorMode === "degree"
                ? "Nós: azul → amarelo = menor → maior grau"
                : "Nós: laranja → verde = crescimento −1 → +1; cinza = indisponível"}
              . As cores dos botões identificam categorias.
            </p>
          )}
          {view === "3d" && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Z = categoria principal · altura não representa ranking · arestas = coocorrências
            </p>
          )}
        </div>
      </div>
      <aside
        className="w-full shrink-0 space-y-3 overflow-y-auto border-l border-border bg-sidebar p-3 lg:w-72 lg:h-full"
        aria-label="Resumo contextual"
      >
        {node ? (
          <>
            {" "}
            {node && (
              <div className="panel p-3">
                <div className="mb-2 flex justify-between text-xs">
                  <span>{selected != null ? "Conceito selecionado" : "Em foco"}</span>
                  {selected != null && (
                    <button onClick={() => setSelected(null)}>Fechar detalhe</button>
                  )}
                </div>
                <p className="font-display text-sm font-semibold">{node.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {node.id} · {categories.find((c) => c.id === node.cat)?.label ?? node.cat}{" "}
                  {node.tree ? `· ${node.tree}` : ""} · {num(node.deg)} conexões · {num(node.pubs)}{" "}
                  artigos
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Crescimento:{" "}
                  {node.growthAvailable === false
                    ? (node.growthReason ?? "indisponível para este período")
                    : node.growth.toFixed(3)}
                </p>
                {selected != null && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 h-7 text-xs"
                    onClick={() => {
                      setMode("seeded");
                      setQuery("");
                      setSeeds((s) => (s.includes(focused!) ? s : [...s, focused!]));
                    }}
                  >
                    Usar como termo-chave
                  </Button>
                )}
                {selected == null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Clique no nó para fixar o detalhe e consultar seus artigos.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {" "}
            <section
              className="panel space-y-2 p-3 text-xs"
              aria-label="Resumo da seleção"
              aria-live="polite"
            >
              <h2 className="text-sm font-semibold">
                {matches ? "Resumo da seleção" : "Resumo do mapa"}
              </h2>
              <p>
                {num(summary.count)} conceitos · {num(summary.edges)} conexões internas
              </p>
              <p>{num(summary.occurrences)} ocorrências conceito–artigo</p>
              <p className="text-muted-foreground">
                A soma pode contar um artigo em vários conceitos. Conexões referem-se às arestas
                exportadas.
              </p>
              {summary.count === 0 && <p>Nenhum resultado. Ajuste a busca ou limpe os filtros.</p>}
              <p>
                {summary.categories
                  .map(
                    ([id, count]) =>
                      (categories.find((c) => c.id === id)?.label ?? id) + ": " + num(count),
                  )
                  .join(" · ")}
              </p>
              {summary.top.length > 0 && (
                <p className="text-muted-foreground">Principais conceitos por artigos:</p>
              )}
              <div className="flex flex-wrap gap-1">
                {summary.top.map((i) => (
                  <button
                    key={i}
                    className="rounded bg-secondary px-2 py-1 text-left"
                    onClick={() => setSelected(i)}
                  >
                    {graph.nodes[i]!.label}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
        {temporal && (
          <p className="text-[11px] text-muted-foreground">
            Mapa limitado aos {num(temporal.meta.node_limit)} conceitos mais frequentes e{" "}
            {num(temporal.meta.edge_limit)} conexões mais fortes do período (
            {num(temporal.meta.total_concepts)} conceitos disponíveis). Filtros e artigos usam esse
            universo visível.
          </p>
        )}
        {catalog && (
          <MapArticles
            key={start + ":" + end + ":" + articleMeshIds.join(",")}
            start={start}
            end={end}
            meshIds={articleMeshIds}
          />
        )}
      </aside>
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
