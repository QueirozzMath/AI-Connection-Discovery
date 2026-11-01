import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { ResizeHandle } from "@/components/ResizeHandle";
import { KeywordPicker } from "@/components/KeywordPicker";
import { usePanelSizes } from "@/hooks/use-panel-sizes";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { BookOpen, Boxes, Network, Search, Sparkles, Target, Zap } from "lucide-react";

import { ScienceMap, type MapHighlight } from "@/components/ScienceMap";
import { useMapLayout } from "@/hooks/use-map-layout";
import {
  categoryCoverage,
  mapSearchIndex,
  selectMapNodes,
  summarizeMap,
} from "@/lib/map-selection";
import { MapArticles } from "@/components/MapArticles";
import { mapCatalog, mapPeriodGraph } from "@/lib/map-api.functions";
import type { MapCatalog, TemporalGraph } from "@/lib/map-api-types";
import { MapToolbar } from "@/components/MapToolbar";
import type { MapCommand, MapAction, MapTool } from "@/lib/map-navigation";
import { ScienceMap3D } from "@/components/ScienceMap3D";
import { useTheme } from "@/components/ThemeProvider";
import { MeshHierarchyExplorer } from "@/components/MeshHierarchyExplorer";
import {
  candidatesQuery,
  catColor,
  graphQuery,
  indexQuery,
  metricsQuery,
  num,
  pct,
  type ScienceGraph,
  type Candidate,
  type Metrics,
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
      dataset?: unknown;
    },
  ) => ({
    from: Number.isInteger(Number(search.from)) ? Number(search.from) : undefined,
    to: Number.isInteger(Number(search.to)) ? Number(search.to) : undefined,
    dataset: search.dataset === "snapshot" ? ("snapshot" as const) : ("annual" as const),
    op: search.op === "and" ? ("and" as const) : ("or" as const),
    view:
      search.view === "articles"
        ? ("articles" as const)
        : search.view === "3d"
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
      { title: "Mapa da ciência — AI Connection Discovery" },
      {
        name: "description",
        content:
          "Navegue a rede real de MeSH terms do PubMed em 2D, 3D e por hierarquia, e encontre as conexões inéditas com maior chance de virar descoberta.",
      },
      { property: "og:title", content: "Mapa da ciência — AI Connection Discovery" },
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
    <Suspense
      fallback={
        <div className="p-8 text-muted-foreground">
          <Localized value={"Carregando rede…"} />
        </div>
      }
    >
      <MapPage />
    </Suspense>
  ),
});

function MapPage() {
  const _uiLanguage = useLanguage().language;

  const { data: idx } = useSuspenseQuery(indexQuery);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const catalogQuery = useQuery({
    queryKey: ["map-catalog"],
    queryFn: () => mapCatalog(),
    staleTime: 60_000,
  });
  const catalog = catalogQuery.data ?? null;
  const start = Math.max(
    catalog?.start ?? idx.corpus_years[0],
    Math.min(
      catalog?.end ?? idx.corpus_years[1],
      search.from ?? catalog?.start ?? idx.corpus_years[0],
    ),
  );
  const end = Math.max(
    start,
    Math.min(catalog?.end ?? idx.corpus_years[1], search.to ?? search.year ?? idx.default_cutoff),
  );
  const annual = !!catalog && search.dataset !== "snapshot";
  const periodQuery = useQuery({
    queryKey: ["map-period", catalog?.revision, start, end],
    queryFn: () => mapPeriodGraph({ data: { start, end } }),
    enabled: annual,
    staleTime: Infinity,
    retry: 1,
  });
  const cutoff =
    search.year != null && idx.cutoffs.includes(search.year) ? search.year : idx.default_cutoff;
  const setCutoff = (year: number) => {
    void navigate({ search: (previous) => ({ ...previous, year }), replace: true });
  };
  if (catalogQuery.isPending || (annual && periodQuery.isPending))
    return (
      <div role="status" className="p-8 text-muted-foreground">
        <Localized value={" Consultando o período e seus agregados… "} />
      </div>
    );
  if (annual && periodQuery.isError)
    return (
      <div role="alert" className="space-y-3 p-8">
        <p>
          <Localized value={"Não foi possível carregar o período."} />
        </p>
        <Button onClick={() => void periodQuery.refetch()}>
          <Localized value={"Tentar novamente"} />
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void navigate({
              search: (previous) => ({ ...previous, dataset: "snapshot" }),
              replace: true,
            })
          }
        >
          <Localized value={" Abrir recortes validados "} />
        </Button>
      </div>
    );
  const props = {
    cutoff,
    cutoffs: idx.cutoffs,
    onCutoff: setCutoff,
    catalog,
    temporal: annual ? periodQuery.data : undefined,
    start: annual ? start : idx.corpus_years[0],
    end: annual ? end : cutoff,
  };
  return annual ? (
    <MapForCutoff
      key={start + ":" + end}
      {...props}
      graph={periodQuery.data!}
      candidates={EMPTY_CANDIDATES}
      metrics={null}
    />
  ) : (
    <SnapshotMap key={cutoff} {...props} />
  );
}

const EMPTY_CANDIDATES: { items: Candidate[] } = { items: [] };
interface MapViewProps {
  cutoff: number;
  cutoffs: number[];
  onCutoff: (value: number) => void;
  catalog: MapCatalog | null;
  temporal: TemporalGraph | undefined;
  start: number;
  end: number;
}
function SnapshotMap(props: MapViewProps) {
  const _uiLanguage = useLanguage().language;

  const queryClient = useQueryClient();
  const { data: graph } = useSuspenseQuery(graphQuery(props.cutoff));
  const { data: candidates } = useSuspenseQuery(candidatesQuery(props.cutoff));
  const { data: metrics } = useSuspenseQuery(metricsQuery(props.cutoff));
  useEffect(() => {
    const position = props.cutoffs.indexOf(props.cutoff);
    for (const year of [props.cutoffs[position - 1], props.cutoffs[position + 1]]) {
      if (year == null) continue;
      void queryClient.prefetchQuery(graphQuery(year));
      void queryClient.prefetchQuery(candidatesQuery(year));
      void queryClient.prefetchQuery(metricsQuery(year));
    }
  }, [props.cutoff, props.cutoffs, queryClient]);
  return <MapForCutoff {...props} graph={graph} candidates={candidates} metrics={metrics} />;
}
function MapForCutoff({
  cutoff,
  cutoffs,
  onCutoff,
  catalog,
  temporal,
  start,
  end,
  graph,
  candidates,
  metrics,
}: MapViewProps & {
  graph: ScienceGraph;
  candidates: { items: Candidate[] };
  metrics: Metrics | null;
}) {
  const _uiLanguage = useLanguage().language;

  const { theme, accent } = useTheme();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { sizes, limits, setSize, reset: resetPanels } = usePanelSizes();
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
  const [last2dView, setLast2dView] = useState<"force" | "hierarchy">(
    search.view === "hierarchy" ? "hierarchy" : "force",
  );
  const setView = (view: "force" | "hierarchy" | "3d" | "articles") => {
    if (view === "force" || view === "hierarchy") setLast2dView(view);
    setTool("navigate");
    setHovered(null);
    void navigate({ search: (previous) => ({ ...previous, view }), replace: true });
  };
  const [hovered, setHovered] = useState<number | null>(null);
  const [command, setCommand] = useState<MapCommand>({ action: "fit", sequence: 0 });
  const [tool, setTool] = useState<MapTool>("navigate");
  const onAction = (action: MapAction) => {
    setCommand((previous) => ({ action, sequence: previous.sequence + 1 }));
  };
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  useEffect(() => {
    try {
      setAutoRotate(localStorage.getItem("discovery-3d-rotation-v1") !== "off");
    } catch {}
  }, []);
  const chooseAutoRotate = (enabled: boolean) => {
    setAutoRotate(enabled);
    try {
      localStorage.setItem("discovery-3d-rotation-v1", enabled ? "on" : "off");
    } catch {}
  };
  const colorMode = search.color;
  const setColorMode = (color: "category" | "degree" | "growth") => {
    void navigate({ search: (previous) => ({ ...previous, color }), replace: true });
  };
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<MapHighlight | null>(null);
  const [mode, setMode] = useState<"global" | "seeded">("global");
  const [randomSeed, setRandomSeed] = useState(42);
  const [seeds, setSeeds] = useState<number[]>([]);
  const [pairs, setPairs] = useState<InferredPair[] | null>(null);
  const [busy, setBusy] = useState(false);

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
  const keywordMatches = useMemo(
    () => selectMapNodes(graph, searchIndex, "", selectedCategories, search.op, coverage),
    [graph, searchIndex, selectedCategories, search.op, coverage],
  );
  const matches = useMemo(() => {
    if (mode !== "seeded" || !seeds.length) return baseMatches;
    const active = new Set(seeds.filter((i) => !baseMatches || baseMatches.has(i)));
    const neighbourhood = new Set(active);
    for (const [a, b] of graph.edges) {
      if (active.has(a)) neighbourhood.add(b);
      if (active.has(b)) neighbourhood.add(a);
    }
    return new Set([...neighbourhood].filter((i) => !baseMatches || baseMatches.has(i)));
  }, [mode, seeds, baseMatches, graph]);
  const adj = useMemo(
    () =>
      buildAdjacency(
        matches
          ? { ...graph, edges: graph.edges.filter(([a, b]) => matches.has(a) && matches.has(b)) }
          : graph,
      ),
    [graph, matches],
  );
  const activeSeeds = useMemo(
    () => seeds.filter((i) => !matches || matches.has(i)),
    [seeds, matches],
  );
  const summary = useMemo(() => summarizeMap(graph, matches), [graph, matches]);
  const suggestions = useMemo(
    () =>
      deferredQuery.trim() && baseMatches
        ? [...baseMatches].slice(0, 8).map((i) => ({ n: graph.nodes[i]!, i }))
        : [],
    [graph, baseMatches, deferredQuery],
  );
  useEffect(() => {
    setHighlight(null);
    setPairs(null);
    setHovered(null);
  }, [matches]);
  useEffect(() => {
    if (matches && selected != null && !matches.has(selected)) setSelected(null);
  }, [matches, selected]);

  // ranking padrão vindo do pipeline (com confirmação real pós-corte)
  const precomputed = useMemo(() => {
    return candidates.items.map((c) => ({
      ...c,
      ai: c.a_ui ? graph.nodes.findIndex((n) => n.id === c.a_ui) : -1,
      ci: c.c_ui ? graph.nodes.findIndex((n) => n.id === c.c_ui) : -1,
    }));
  }, [candidates.items, graph.nodes]);

  const eligiblePrecomputed = useMemo(
    () =>
      precomputed.filter(
        (c) =>
          !matches ||
          (matches.has(c.ai) &&
            matches.has(c.ci) &&
            c.intermediaries.every((label) => matches.has(byLabel.get(label.toLowerCase()) ?? -1))),
      ),
    [precomputed, matches, byLabel],
  );

  const runDiscovery = () => {
    if (temporal) return;
    setBusy(true);
    setTimeout(() => {
      const res = discover(graph, adj, {
        mode,
        allowed: matches,
        ...(mode === "seeded" ? { seeds: activeSeeds } : {}),
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
    <div
      className="flex h-full min-h-0 flex-col lg:flex-row"
      style={
        {
          "--left-panel-width": `${sizes.left}px`,
          "--right-panel-width": `${sizes.right}px`,
        } as CSSProperties
      }
    >
      <div className="relative w-full shrink-0 lg:h-full lg:w-[var(--left-panel-width)]">
        <aside
          aria-label={t("Filtros e descoberta")}
          className="flex max-h-[45vh] w-full flex-col gap-3 overflow-y-auto border-b border-border bg-sidebar p-4 lg:max-h-none lg:h-full lg:border-b-0 lg:border-r"
        >
          <div>
            <h1 className="font-display text-lg font-semibold">
              <Localized value={"Mapa da ciência"} />
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              <Localized value={num(graph.meta.n_nodes)} />
              <Localized value={" conceitos · "} />
              <Localized value={num(graph.meta.n_edges)} />
              <Localized value={" co-ocorrências ·"} />
              <Localized value={" "} />
              <Localized value={num(graph.meta.n_articles)} />
              <Localized value={" artigos do PubMed "} />
            </p>
          </div>
          <p className="hidden text-[10px] text-muted-foreground lg:block">
            <Localized value={" Arraste as divisórias para ajustar os painéis. "} />
          </p>
          <button className="text-left text-[11px] text-primary underline" onClick={resetPanels}>
            <Localized value={" Restaurar tamanho dos painéis "} />
          </button>

          <Localized
            value={
              catalog && (
                <div className="space-y-2 text-xs">
                  <div className="flex gap-2">
                    <button
                      aria-pressed={!!temporal}
                      className="rounded border border-border px-2 py-1 aria-pressed:bg-primary/20"
                      onClick={() =>
                        void navigate({
                          search: (previous) => ({ ...previous, dataset: "annual" }),
                          replace: true,
                        })
                      }
                    >
                      <Localized value={" Período anual "} />
                    </button>
                    <button
                      aria-pressed={!temporal}
                      className="rounded border border-border px-2 py-1 aria-pressed:bg-primary/20"
                      onClick={() =>
                        void navigate({
                          search: (previous) => ({ ...previous, dataset: "snapshot" }),
                          replace: true,
                        })
                      }
                    >
                      <Localized value={" Recortes validados "} />
                    </button>
                  </div>
                  <Localized
                    value={
                      temporal && (
                        <>
                          <label className="block">
                            <Localized value={" Ano inicial "} />
                            <input
                              type="number"
                              key={start + "start"}
                              defaultValue={start}
                              min={catalog.start}
                              max={end}
                              className="mt-1 w-full rounded border border-border bg-background p-2"
                              onBlur={(event) => {
                                const from = Number(event.currentTarget.value);
                                if (Number.isInteger(from) && from >= catalog.start && from <= end)
                                  void navigate({
                                    search: (previous) => ({ ...previous, from, to: end }),
                                    replace: true,
                                  });
                                else event.currentTarget.value = String(start);
                              }}
                            />
                          </label>
                          <label className="block">
                            <Localized value={" Ano final "} />
                            <input
                              type="number"
                              key={end + "end"}
                              defaultValue={end}
                              min={start}
                              max={catalog.end}
                              className="mt-1 w-full rounded border border-border bg-background p-2"
                              onBlur={(event) => {
                                const to = Number(event.currentTarget.value);
                                if (Number.isInteger(to) && to >= start && to <= catalog.end)
                                  void navigate({
                                    search: (previous) => ({ ...previous, from: start, to }),
                                    replace: true,
                                  });
                                else event.currentTarget.value = String(end);
                              }}
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              className="underline"
                              onClick={() =>
                                void navigate({
                                  search: (previous) => ({ ...previous, from: end, to: end }),
                                  replace: true,
                                })
                              }
                            >
                              <Localized value={" Somente "} />
                              <Localized value={end} />
                            </button>
                            <button
                              className="underline"
                              onClick={() =>
                                void navigate({
                                  search: (previous) => ({
                                    ...previous,
                                    from: catalog.start,
                                    to: catalog.end,
                                  }),
                                  replace: true,
                                })
                              }
                            >
                              <Localized value={" Todos os anos "} />
                            </button>
                          </div>
                          <p className="text-muted-foreground">
                            <Localized value={" Corpus importado: "} />
                            <Localized value={catalog.start} />
                            <Localized value={"–"} />
                            <Localized value={catalog.end} />
                            <Localized value={". Ajustes aplicados ao sair do campo. "} />
                          </p>
                        </>
                      )
                    }
                  />
                </div>
              )
            }
          />
          <Localized
            value={
              !temporal && (
                <>
                  <Localized value={" "} />
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-xs text-muted-foreground">
                      <Localized value={"Ano de corte"} />
                    </Label>
                    <Select value={String(cutoff)} onValueChange={(v) => onCutoff(Number(v))}>
                      <SelectTrigger data-tour="cutoff" className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <Localized
                          value={cutoffs.map((y) => (
                            <SelectItem key={y} value={String(y)} className="text-xs">
                              <Localized value={y} />
                            </SelectItem>
                          ))}
                        />
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )
            }
          />
          <Tabs data-tour="views" value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList className="grid h-auto w-full grid-cols-[1fr_1.5fr_0.75fr] gap-1">
              <TabsTrigger value="force" className="min-w-0 gap-1 px-1 text-[11px]">
                <Network className="size-3 shrink-0" />
                <Localized value={" Rede "} />
              </TabsTrigger>
              <TabsTrigger value="hierarchy" className="min-w-0 gap-1 px-1 text-[11px]">
                <Target className="size-3 shrink-0" />
                <Localized value={" Hierarquia "} />
              </TabsTrigger>
              <TabsTrigger value="3d" className="min-w-0 gap-1 px-1 text-[11px]">
                <Boxes className="size-3 shrink-0" />
                <Localized value={" 3D "} />
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
              data-tour="search"
              aria-label={t("Buscar conceito MeSH, categoria ou área")}
              placeholder={t("Buscar conceito MeSH, categoria ou área…")}
              className="pl-8"
            />
            <Localized
              value={
                searchOpen &&
                suggestions.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-panel">
                    <Localized
                      value={suggestions.map(({ n, i }) => (
                        <li key={n.id}>
                          <button
                            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary"
                            onClick={() => {
                              setSelected(i);
                              setSearchOpen(false);
                              setQuery(mode === "seeded" ? "" : n.label);
                              if (mode === "seeded" && !seeds.includes(i))
                                setSeeds((s) => [...s, i]);
                            }}
                          >
                            <span className="truncate">
                              <Localized value={n.label} />
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              <Localized value={n.tree || n.cat} />
                              <Localized value={" · "} />
                              <Localized value={n.deg} />
                            </span>
                          </button>
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </div>

          <section
            className="panel space-y-3 p-3"
            data-tour="filters"
            aria-label={t("Filtros por área")}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                <Localized value={"Filtros"} />
              </h2>
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                <Localized value={" Limpar filtros "} />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">
                <Localized value={"Categorias"} />
              </span>
              <Localized
                value={(["or", "and"] as const).map((op) => (
                  <button
                    key={op}
                    aria-pressed={search.op === op}
                    className="rounded border border-border px-2 py-1 text-xs aria-pressed:bg-primary/25"
                    onClick={() =>
                      void navigate({ search: (previous) => ({ ...previous, op }), replace: true })
                    }
                  >
                    <Localized value={op.toUpperCase()} />
                  </button>
                ))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Localized
                value={
                  selectedCategories.length
                    ? selectedCategories.length + " categorias ativas"
                    : "Todas as categorias"
                }
              />
              <Localized value={" "} />
              <Localized value={" · "} />
              <Localized value={search.op.toUpperCase()} />
            </p>
            <Localized
              value={
                search.op === "and" &&
                selectedCategories.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    <Localized
                      value={
                        " AND: conceitos das áreas escolhidas ligados diretamente a todas elas. Não implica um mesmo artigo. "
                      }
                    />
                  </p>
                )
              }
            />
            <div className="flex items-center gap-2">
              <Switch
                id="unselected"
                checked={showUnselected}
                onCheckedChange={(context) =>
                  void navigate({ search: (previous) => ({ ...previous, context }), replace: true })
                }
              />
              <Label htmlFor="unselected" className="text-xs">
                <Localized value={" Mostrar nós não selecionados "} />
              </Label>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={summary.count === 0}
              onClick={() => setFocusRequest((v) => v + 1)}
            >
              <Localized value={" Centralizar resultados "} />
            </Button>
          </section>
          <div data-tour="display" className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Switch id="edges" checked={showEdges} onCheckedChange={setShowEdges} />
              <Label htmlFor="edges" className="text-xs">
                <Localized value={" Arestas "} />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="deg"
                checked={colorMode === "degree"}
                onCheckedChange={(v) => setColorMode(v ? "degree" : "category")}
              />
              <Label htmlFor="deg" className="text-xs">
                <Localized value={" Cor por grau "} />
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="growth"
                checked={colorMode === "growth"}
                onCheckedChange={(v) => setColorMode(v ? "growth" : "category")}
              />
              <Label htmlFor="growth" className="text-xs">
                <Localized value={" Cor por crescimento "} />
              </Label>
            </div>
            <Localized
              value={
                view === "3d" && (
                  <div className="flex items-center gap-2">
                    <Switch id="rot" checked={autoRotate} onCheckedChange={chooseAutoRotate} />
                    <Label htmlFor="rot" className="text-xs">
                      <Localized value={" Girar "} />
                    </Label>
                  </div>
                )
              }
            />
          </div>

          <div data-tour="discovery" className="panel space-y-2 p-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="global" className="text-xs">
                  <Localized value={" Busca global "} />
                </TabsTrigger>
                <TabsTrigger value="seeded" className="text-xs">
                  <Localized value={" Termos-chave "} />
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Localized
              value={
                mode === "global" ? (
                  <div className={temporal ? "hidden" : "flex items-center gap-2"}>
                    <Label className="shrink-0 text-xs text-muted-foreground">
                      <Localized value={"Semente"} />
                    </Label>
                    <Input
                      type="number"
                      value={randomSeed}
                      onChange={(e) => setRandomSeed(Number(e.target.value) || 0)}
                      className="h-8 text-xs"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <KeywordPicker
                      nodes={graph.nodes}
                      selected={seeds}
                      allowed={keywordMatches}
                      onPick={(i) => {
                        setQuery("");
                        setDeferredQuery("");
                        void navigate({
                          search: (previous) => ({ ...previous, q: "" }),
                          replace: true,
                        });
                        setSeeds((previous) =>
                          previous.includes(i) ? previous : [...previous, i],
                        );
                        setSelected(i);
                      }}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Localized
                        value={
                          seeds.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              <Localized value={" Pesquise e escolha um ou mais termos. "} />
                            </p>
                          )
                        }
                      />
                      <Localized
                        value={seeds.map((i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="cursor-pointer text-[10px]"
                            onClick={() => setSeeds((s) => s.filter((x) => x !== i))}
                          >
                            <Localized value={graph.nodes[i]!.label} />
                            <Localized value={" × "} />
                          </Badge>
                        ))}
                      />
                    </div>
                  </div>
                )
              }
            />

            <Localized
              value={
                !temporal && (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!!temporal || busy || (mode === "seeded" && activeSeeds.length === 0)}
                    data-tour="infer"
                    onClick={runDiscovery}
                  >
                    <Sparkles className="size-4" />
                    <Localized value={busy ? "Inferindo…" : "Inferir conexões"} />
                  </Button>
                )
              }
            />
          </div>

          <Localized
            value={
              temporal && (
                <p className="text-xs text-muted-foreground">
                  <Localized
                    value={
                      " A busca usa o período atual. Predições e métricas de validação ficam nos recortes validados, pois o modelo não foi treinado para intervalos arbitrários. "
                    }
                  />
                </p>
              )
            }
          />
          <Localized
            value={
              !temporal &&
              metrics && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label={t("AUC")} value={metrics.model.auc.toFixed(3)} />
                    <Stat label={t("Confirmadas")} value={pct(metrics.confirmations.rate, 0)} />
                    <Stat
                      label={t("Lead time")}
                      value={`${metrics.confirmations.median_lead_time ?? "—"} a`}
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <h2 className="font-display text-sm font-semibold">
                      <Localized
                        value={pairs ? "Conexões inferidas agora" : "Ranking validado do corte"}
                      />
                    </h2>
                    <Badge variant="secondary" className="text-[10px]">
                      <Localized value={pairs ? pairs.length : eligiblePrecomputed.length} />
                      <Localized value={" pares "} />
                    </Badge>
                  </div>

                  <ScrollArea className="h-[34rem] min-h-[34rem] rounded-lg border border-border">
                    <ul className="divide-y divide-border">
                      <Localized
                        value={
                          pairs
                            ? pairs.map((p) => (
                                <li key={`${p.a}-${p.c}`}>
                                  <button
                                    onClick={() =>
                                      setHighlight({
                                        a: p.a,
                                        c: p.c,
                                        bridges: p.bridges,
                                        confirmed: false,
                                      })
                                    }
                                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        <Localized value={graph.nodes[p.a]!.cat} />
                                        <Localized value={" ⇢ "} />
                                        <Localized value={graph.nodes[p.c]!.cat} />
                                      </span>
                                      <span className="font-mono text-[11px] text-primary">
                                        <Localized value={" prioridade "} />
                                        <Localized value={(p.priority * 100).toFixed(1)} />
                                        <Localized value={"/100 "} />
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs leading-snug">
                                      <span className="font-medium">
                                        <Localized value={graph.nodes[p.a]!.label} />
                                      </span>
                                      <span className="text-muted-foreground">
                                        <Localized value={" ⇢ "} />
                                      </span>
                                      <span className="font-medium">
                                        <Localized value={graph.nodes[p.c]!.label} />
                                      </span>
                                    </p>
                                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                      <Localized value={" via"} />
                                      <Localized value={" "} />
                                      <Localized
                                        value={p.bridges
                                          .map((b) => graph.nodes[b]!.label)
                                          .slice(0, 3)
                                          .join(", ")}
                                      />
                                    </p>
                                    <Link
                                      to="/hypotheses"
                                      search={{
                                        a: graph.nodes[p.a]!.label,
                                        c: graph.nodes[p.c]!.label,
                                        cutoff,
                                        b: p.bridges.map((i) => graph.nodes[i]!.label).join("|"),
                                      }}
                                      className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                                    >
                                      <Localized value={" gerar hipótese → "} />
                                    </Link>
                                  </button>
                                </li>
                              ))
                            : eligiblePrecomputed.slice(0, 120).map((c) => (
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
                                        <Localized value={" #"} />
                                        <Localized value={c.rank} />
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <Localized
                                          value={
                                            c.confirmed ? (
                                              <Badge className="bg-accent text-accent-foreground text-[10px]">
                                                <Localized value={" confirmada +"} />
                                                <Localized value={c.lead_time_years} />
                                                <Localized value={"a "} />
                                              </Badge>
                                            ) : (
                                              <Badge variant="outline" className="text-[10px]">
                                                <Localized value={" em aberto "} />
                                              </Badge>
                                            )
                                          }
                                        />
                                        <span className="font-mono text-[11px] text-primary">
                                          <Localized value={" prioridade "} />
                                          <Localized value={((c.priority ?? 0) * 100).toFixed(1)} />
                                          <Localized value={"/100 "} />
                                        </span>
                                      </div>
                                    </div>
                                    <p className="mt-1 text-xs leading-snug">
                                      <span className="font-medium">
                                        <Localized value={c.a} />
                                      </span>
                                      <span className="text-muted-foreground">
                                        <Localized value={" ⇢ "} />
                                      </span>
                                      <span className="font-medium">
                                        <Localized value={c.c} />
                                      </span>
                                    </p>
                                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                      <Localized value={" via "} />
                                      <Localized value={c.intermediaries.slice(0, 3).join(", ")} />
                                    </p>
                                    <Link
                                      to="/hypotheses"
                                      search={{ a: c.a, c: c.c, cutoff }}
                                      className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                                    >
                                      <Localized value={" gerar hipótese → "} />
                                    </Link>
                                  </button>
                                </li>
                              ))
                        }
                      />
                    </ul>
                  </ScrollArea>
                </>
              )
            }
          />
        </aside>
        <ResizeHandle
          axis="x"
          value={sizes.left}
          min={210}
          max={limits.left}
          onChange={(v) => setSize("left", v)}
          label={t("Ajustar largura do painel esquerdo")}
        />
      </div>

      <div className="relative min-h-[60vh] min-w-0 flex-1">
        <div
          className={view === "articles" ? "absolute inset-x-0 top-0" : "absolute inset-x-0 top-14"}
          style={{ bottom: `${sizes.bottom + 20}px` }}
        >
          <Localized
            value={
              view === "articles" ? (
                <MeshHierarchyExplorer
                  start={start}
                  end={end}
                  graph={graph}
                  matches={matches}
                  operator={search.op}
                  onSelect={(id) => setSelected(graph.nodes.findIndex((n) => n.id === id))}
                />
              ) : view === "3d" ? (
                <ScienceMap3D
                  theme={theme}
                  accent={accent}
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
                  theme={theme}
                  accent={accent}
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
              )
            }
          />
        </div>
        <Localized
          value={
            view !== "articles" &&
            (layoutPending || layoutFailed) && (
              <div
                role="status"
                className="pointer-events-none absolute left-4 top-4 rounded bg-popover/90 p-2 text-xs"
              >
                <Localized
                  value={
                    layoutPending
                      ? "Organizando comunidades…"
                      : "Layout original preservado: não foi possível preparar comunidades."
                  }
                />
              </div>
            )
          }
        />
        <Localized
          value={
            view !== "articles" &&
            matches?.size === 0 && (
              <div
                role="status"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <p className="rounded bg-popover/95 p-4 text-sm">
                  <Localized value={" Nenhum conceito corresponde aos filtros. "} />
                </p>
              </div>
            )
          }
        />
        <Localized
          value={
            view !== "articles" && (
              <MapToolbar
                mode3d={view === "3d"}
                onToggleDimension={() => setView(view === "3d" ? last2dView : "3d")}
                tool={tool}
                onTool={(next) => {
                  setTool(next);
                }}
                onAction={onAction}
              />
            )
          }
        />
        <Localized
          value={
            <div
              className="absolute bottom-3 left-3 right-3 z-20 rounded-lg border border-border bg-popover/95"
              style={{ height: sizes.bottom }}
              role="group"
              data-tour="categories"
              aria-label={t("Selecionar categorias")}
            >
              <ResizeHandle
                axis="y"
                reverse
                value={sizes.bottom}
                min={80}
                max={limits.bottom}
                onChange={(v) => setSize("bottom", v)}
                label={t("Ajustar altura do painel inferior")}
              />
              <div className="h-full overflow-auto px-2 pb-2 pt-4">
                <div className="flex flex-wrap gap-1.5">
                  <Localized
                    value={categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={selectedCategories.includes(c.id)}
                        title={t(c.label + " · " + num(c.count) + " conceitos")}
                        className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary/20"
                        onClick={() => toggleCategory(c.id)}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: catColor(c.id) }}
                        />
                        <Localized value={c.label} />
                        <Localized value={selectedCategories.includes(c.id) ? " ✓" : ""} />
                      </button>
                    ))}
                  />
                </div>
                <Localized
                  value={
                    colorMode !== "category" && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        <Localized
                          value={
                            colorMode === "degree"
                              ? "Nós: azul → amarelo = menor → maior grau"
                              : "Nós: laranja → verde = crescimento −1 → +1; cinza = indisponível"
                          }
                        />
                        <Localized value={" . As cores dos botões identificam categorias. "} />
                      </p>
                    )
                  }
                />
                <Localized
                  value={
                    view === "3d" && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        <Localized
                          value={
                            " Z = categoria principal · altura não representa ranking · arestas = coocorrências "
                          }
                        />
                      </p>
                    )
                  }
                />
              </div>
            </div>
          }
        />
      </div>
      <div className="relative w-full shrink-0 lg:w-[var(--right-panel-width)] lg:h-full">
        <div className="absolute inset-y-0 left-0 z-30 w-2">
          <ResizeHandle
            axis="x"
            reverse
            value={sizes.right}
            min={240}
            max={limits.right}
            onChange={(v) => setSize("right", v)}
            label={t("Ajustar largura do painel direito")}
          />
        </div>
        <aside
          className="h-full w-full space-y-3 overflow-y-auto border-l border-border bg-sidebar p-3"
          aria-label={t("Resumo contextual")}
        >
          <Localized
            value={
              node ? (
                <>
                  <Localized value={" "} />
                  <Localized
                    value={
                      node && (
                        <div className="panel p-3">
                          <div className="mb-2 flex justify-between text-xs">
                            <span>
                              <Localized
                                value={selected != null ? "Conceito selecionado" : "Em foco"}
                              />
                            </span>
                            <Localized
                              value={
                                selected != null && (
                                  <button onClick={() => setSelected(null)}>
                                    <Localized value={"Fechar detalhe"} />
                                  </button>
                                )
                              }
                            />
                          </div>
                          <p className="font-display text-sm font-semibold">
                            <Localized value={node.label} />
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <Localized value={node.id} />
                            <Localized value={" · "} />
                            <Localized
                              value={categories.find((c) => c.id === node.cat)?.label ?? node.cat}
                            />
                            <Localized value={" "} />
                            <Localized value={node.tree ? `· ${node.tree}` : ""} />
                            <Localized value={" · "} />
                            <Localized value={num(node.deg)} />
                            <Localized value={" conexões ·"} />
                            <Localized value={" "} />
                            <Localized value={num(node.pubs)} />
                            <Localized value={" artigos "} />
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <Localized value={" Crescimento:"} />
                            <Localized value={" "} />
                            <Localized
                              value={
                                node.growthAvailable === false
                                  ? "indisponível para este período"
                                  : node.growth.toFixed(3)
                              }
                            />
                          </p>
                          <Localized
                            value={
                              selected != null && (
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
                                  <Localized value={" Usar como termo-chave "} />
                                </Button>
                              )
                            }
                          />
                          <Localized
                            value={
                              selected != null && (
                                <details className="mt-3 text-xs" open>
                                  <summary className="cursor-pointer font-medium">
                                    <Localized value={" Conceitos conectados ("} />
                                    <Localized value={adj.map[selected]?.size ?? 0} />
                                    <Localized value={") "} />
                                  </summary>
                                  <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                                    <Localized
                                      value={[...(adj.map[selected] ?? new Map<number, number>())]
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([i, weight]) => (
                                          <li key={graph.nodes[i]!.id}>
                                            <button
                                              className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-secondary"
                                              onClick={() => setSelected(i)}
                                            >
                                              <span>
                                                <Localized value={graph.nodes[i]!.label} />
                                              </span>
                                              <span
                                                className="shrink-0 text-[10px] text-muted-foreground"
                                                title={t("Coocorrências no recorte")}
                                              >
                                                <Localized value={num(weight)} />
                                              </span>
                                            </button>
                                          </li>
                                        ))}
                                    />
                                  </ul>
                                </details>
                              )
                            }
                          />
                          <Localized
                            value={
                              selected == null && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  <Localized
                                    value={
                                      " Clique no nó para fixar o detalhe e consultar seus artigos. "
                                    }
                                  />
                                </p>
                              )
                            }
                          />
                        </div>
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <Localized value={" "} />
                  <section
                    className="panel space-y-2 p-3 text-xs"
                    aria-label={t("Resumo da seleção")}
                    aria-live="polite"
                  >
                    <h2 className="text-sm font-semibold">
                      <Localized value={matches ? "Resumo da seleção" : "Resumo do mapa"} />
                    </h2>
                    <p>
                      <Localized value={num(summary.count)} />
                      <Localized value={" conceitos · "} />
                      <Localized value={num(summary.edges)} />
                      <Localized value={" conexões internas "} />
                    </p>
                    <p>
                      <Localized value={num(summary.occurrences)} />
                      <Localized value={" ocorrências conceito–artigo"} />
                    </p>
                    <p className="text-muted-foreground">
                      <Localized
                        value={
                          " A soma pode contar um artigo em vários conceitos. Conexões referem-se às arestas exportadas. "
                        }
                      />
                    </p>
                    <Localized
                      value={
                        summary.count === 0 && (
                          <p>
                            <Localized
                              value={"Nenhum resultado. Ajuste a busca ou limpe os filtros."}
                            />
                          </p>
                        )
                      }
                    />
                    <p>
                      <Localized
                        value={summary.categories
                          .map(
                            ([id, count]) =>
                              t(categories.find((c) => c.id === id)?.label ?? id) +
                              ": " +
                              num(count),
                          )
                          .join(" · ")}
                      />
                    </p>
                    <Localized
                      value={
                        summary.top.length > 0 && (
                          <p className="text-muted-foreground">
                            <Localized value={"Principais conceitos por artigos:"} />
                          </p>
                        )
                      }
                    />
                    <div className="flex flex-wrap gap-1">
                      <Localized
                        value={summary.top.map((i) => (
                          <button
                            key={i}
                            className="rounded bg-secondary px-2 py-1 text-left"
                            onClick={() => setSelected(i)}
                          >
                            <Localized value={graph.nodes[i]!.label} />
                          </button>
                        ))}
                      />
                    </div>
                  </section>
                </>
              )
            }
          />
          <Localized
            value={
              temporal && (
                <p className="text-[11px] text-muted-foreground">
                  <Localized value={" Mapa limitado aos "} />
                  <Localized value={num(temporal.meta.node_limit)} />
                  <Localized value={" conceitos mais frequentes e"} />
                  <Localized value={" "} />
                  <Localized value={num(temporal.meta.edge_limit)} />
                  <Localized value={" conexões mais fortes do período ( "} />
                  <Localized value={num(temporal.meta.total_concepts)} />
                  <Localized
                    value={
                      " conceitos disponíveis). Filtros e artigos usam esse universo visível. "
                    }
                  />
                </p>
              )
            }
          />
          <Localized
            value={
              <MapArticles
                key={start + ":" + end + ":" + articleMeshIds.join(",")}
                start={start}
                end={end}
                meshIds={articleMeshIds}
                remote={!!catalog}
              />
            }
          />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const _uiLanguage = useLanguage().language;

  return (
    <div className="panel px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <Localized value={label} />
      </p>
      <p className="stat-value text-base text-primary">
        <Localized value={value} />
      </p>
    </div>
  );
}
