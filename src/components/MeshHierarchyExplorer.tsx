import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, ExternalLink, Network, Search } from "lucide-react";
import { corpus, meshVocabulary, type MeshDescriptor } from "@/lib/bundled-articles";
import { catColor, type ScienceGraph } from "@/lib/science-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FALLBACK_BRANCH = "X";
const paths = (descriptor: MeshDescriptor) =>
  descriptor[2].length ? descriptor[2] : [`${FALLBACK_BRANCH}.${descriptor[0]}`];
const belongs = (tree: string, branch: string) =>
  !branch ||
  (branch.length === 1
    ? tree.startsWith(branch)
    : tree === branch || tree.startsWith(`${branch}.`));

export function MeshHierarchyExplorer({
  start,
  end,
  graph,
  matches,
  operator,
  onSelect,
}: {
  start: number;
  end: number;
  graph?: ScienceGraph;
  matches: Set<number> | null;
  operator: "and" | "or";
  onSelect?: (id: string) => void;
}) {
  const _uiLanguage = useLanguage().language;

  const corpusQuery = useQuery({
    queryKey: ["mesh-hierarchy-corpus"],
    queryFn: corpus,
    staleTime: Infinity,
  });
  const vocabularyQuery = useQuery({
    queryKey: ["mesh-vocabulary-2026"],
    queryFn: meshVocabulary,
    staleTime: Infinity,
  });
  const [path, setPath] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const branch = path.at(-1) ?? "";
  const data = corpusQuery.data;
  const vocabulary = vocabularyQuery.data;

  const corpusIndex = useMemo(
    () => new Map(data?.concepts.map((concept, index) => [concept[0], index]) ?? []),
    [data],
  );
  const allowed = useMemo(
    () =>
      matches && graph
        ? new Set(graph.nodes.filter((_, index) => matches.has(index)).map((node) => node.id))
        : null,
    [graph, matches],
  );
  const eligible = useMemo(
    () =>
      vocabulary?.descriptors.flatMap((descriptor, index) =>
        !allowed || allowed.has(descriptor[0]) ? [index] : [],
      ) ?? [],
    [vocabulary, allowed],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searched = useMemo(() => {
    if (!vocabulary || !normalizedQuery) return null;
    return eligible
      .filter((index) => {
        const descriptor = vocabulary.descriptors[index]!;
        return (
          descriptor[0].toLocaleLowerCase().includes(normalizedQuery) ||
          descriptor[1].toLocaleLowerCase().includes(normalizedQuery) ||
          descriptor[3].some((term) => term.toLocaleLowerCase().includes(normalizedQuery))
        );
      })
      .slice(0, 300);
  }, [eligible, normalizedQuery, vocabulary]);
  const scope = useMemo(
    () =>
      searched ??
      eligible.filter((index) =>
        paths(vocabulary!.descriptors[index]!).some((tree) => belongs(tree, branch)),
      ),
    [eligible, branch, searched, vocabulary],
  );
  const treeLabels = useMemo(() => {
    const result = new Map<string, string>();
    for (const descriptor of vocabulary?.descriptors ?? [])
      for (const tree of paths(descriptor)) result.set(tree, descriptor[1]);
    return result;
  }, [vocabulary]);
  const groups = useMemo(() => {
    if (!vocabulary || searched) return [];
    const result = new Map<string, Set<number>>();
    const depth = branch.length === 1 ? 1 : branch ? branch.split(".").length : 0;
    for (const index of scope) {
      for (const tree of paths(vocabulary.descriptors[index]!)) {
        if (!belongs(tree, branch)) continue;
        const parts = tree.split(".");
        const id = !branch ? tree.charAt(0) : parts.slice(0, depth + 1).join(".");
        if (!id || id === branch) continue;
        const members = result.get(id) ?? new Set<number>();
        members.add(index);
        result.set(id, members);
      }
    }
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  }, [scope, branch, searched, vocabulary]);
  const leaves = useMemo(() => {
    if (!vocabulary) return [];
    if (searched) return searched;
    const groupIds = new Set(groups.map(([id]) => id));
    return scope
      .filter((index) =>
        paths(vocabulary.descriptors[index]!).some(
          (tree) => tree === branch || (!groupIds.size && belongs(tree, branch)),
        ),
      )
      .slice(0, 240);
  }, [branch, groups, scope, searched, vocabulary]);
  const activeCorpusIndices = useMemo(
    () => selected.flatMap((id) => (corpusIndex.has(id) ? [corpusIndex.get(id)!] : [])),
    [selected, corpusIndex],
  );
  const scopeCorpusIndices = useMemo(
    () =>
      new Set(
        scope.flatMap((index) => {
          const corpusId = corpusIndex.get(vocabulary!.descriptors[index]![0]);
          return corpusId == null ? [] : [corpusId];
        }),
      ),
    [scope, corpusIndex, vocabulary],
  );
  const articles = useMemo(() => {
    if (!data) return [];
    const chosen = activeCorpusIndices;
    return data.articles
      .filter(
        (article) =>
          article[1] >= start &&
          article[1] <= end &&
          (chosen.length && operator === "and"
            ? chosen.every((index) => article[3].includes(index))
            : article[3].some((index) =>
                chosen.length ? chosen.includes(index) : scopeCorpusIndices.has(index),
              )) &&
          (!normalizedQuery ||
            `${article[0]} ${article[2] ?? ""}`.toLocaleLowerCase().includes(normalizedQuery) ||
            article[3].some((index) => {
              const concept = data.concepts[index];
              return concept
                ? `${concept[0]} ${concept[1]}`.toLocaleLowerCase().includes(normalizedQuery)
                : false;
            }) ||
            searched?.some((index) =>
              article[3].includes(corpusIndex.get(vocabulary!.descriptors[index]![0]) ?? -1),
            )),
      )
      .sort((a, b) => b[1] - a[1]);
  }, [
    activeCorpusIndices,
    corpusIndex,
    data,
    end,
    normalizedQuery,
    operator,
    scopeCorpusIndices,
    searched,
    start,
    vocabulary,
  ]);
  useEffect(() => setPage(0), [branch, query, matches, operator, selected, start, end]);

  const name = (id: string) =>
    data?.categories.find((category) => category.id === id)?.label ??
    treeLabels.get(id) ??
    (id === FALLBACK_BRANCH ? "Sem posição na árvore" : `Ramo ${id}`);
  const error = corpusQuery.error || vocabularyQuery.error;
  if (error)
    return (
      <p className="p-6">
        <Localized
          value={
            " Não foi possível carregar o catálogo MeSH e os artigos. Reabra esta visualização para tentar novamente. "
          }
        />
      </p>
    );
  if (!data || !vocabulary)
    return (
      <p role="status" className="p-6">
        <Localized value={" Carregando o vocabulário MeSH completo e o índice de artigos… "} />
      </p>
    );

  return (
    <div className="h-full overflow-auto p-4 space-y-4" data-tour="explorer">
      <header>
        <h2 className="font-display text-lg flex gap-2 items-center">
          <Network className="size-5 text-primary" />
          <Localized value={" Conexões entre assuntos e artigos "} />
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          <Localized value={" MeSH "} />
          <Localized value={vocabulary.version} />
          <Localized value={" completo · "} />
          <Localized value={vocabulary.descriptor_count.toLocaleString(getLocale())} />
          <Localized value={" "} />
          <Localized value={" descritores · "} />
          <Localized value={vocabulary.term_count.toLocaleString(getLocale())} />
          <Localized value={" termos ·"} />
          <Localized value={" "} />
          <Localized
            value={graph ? "filtros do mapa ativos" : "exploração bibliográfica independente"}
          />
        </p>
      </header>
      <div className="relative">
        <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input
          aria-label={t("Encontrar artigo, descritor ou termo MeSH")}
          placeholder={t("Título, PMID, descritor ou sinônimo MeSH…")}
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav aria-label={t("Caminho MeSH")} className="flex flex-wrap gap-1 items-center text-xs">
        <button
          className="rounded bg-secondary px-2 py-2"
          onClick={() => {
            setPath([]);
            setSelected([]);
            setQuery("");
          }}
        >
          <Localized value={" Todas as categorias "} />
        </button>
        <Localized
          value={path.map((id, index) => (
            <span key={id} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button
                className="rounded border border-primary/40 px-2 py-2 text-primary"
                onClick={() => {
                  setPath(path.slice(0, index + 1));
                  setSelected([]);
                  setQuery("");
                }}
              >
                <Localized value={name(id)} />
              </button>
            </span>
          ))}
        />
      </nav>
      <section className="rounded-xl border border-border bg-sidebar/60 p-4">
        <div className="flex items-center gap-3">
          <span
            className="size-4 rounded-full ring-4 ring-primary/10"
            style={{ background: catColor(branch.charAt(0)) }}
          />
          <div>
            <h3 className="font-display font-semibold">
              <Localized
                value={
                  searched
                    ? "Resultados no vocabulário MeSH"
                    : branch
                      ? name(branch)
                      : "Árvore MeSH"
                }
              />
            </h3>
            <p className="text-xs text-muted-foreground">
              <Localized value={scope.length.toLocaleString(getLocale())} />
              <Localized value={" descritores neste contexto "} />
            </p>
          </div>
        </div>
        <div className="ml-2 mt-3 border-l-2 border-primary/30 pl-5 space-y-2">
          <Localized
            value={groups.map(([id, members]) => (
              <button
                key={id}
                data-tour="mesh-branch"
                onClick={() => {
                  setPath([...path, id]);
                  setSelected([]);
                }}
                className="relative w-full flex items-center gap-3 text-left rounded-lg border border-border bg-background p-3 hover:border-primary before:absolute before:-left-5 before:w-5 before:border-t before:border-primary/30"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: catColor(id[0]!) }}
                />
                <span className="flex-1 text-sm">
                  <Localized value={name(id)} />
                  <span className="block text-[10px] text-muted-foreground font-mono">
                    <Localized value={id} />
                    <Localized value={" · "} />
                    <Localized value={members.size.toLocaleString(getLocale())} />
                    <Localized value={" descritores "} />
                  </span>
                </span>
                <ChevronRight className="size-4" />
              </button>
            ))}
          />
          <Localized
            value={leaves.map((index) => {
              const descriptor = vocabulary.descriptors[index]!;
              return (
                <button
                  key={descriptor[0]}
                  aria-pressed={selected.includes(descriptor[0])}
                  onClick={() => {
                    setSelected((current) =>
                      current.includes(descriptor[0])
                        ? current.filter((id) => id !== descriptor[0])
                        : [...current, descriptor[0]],
                    );
                    onSelect?.(descriptor[0]);
                  }}
                  className="relative w-full rounded-lg border border-border p-3 text-left text-sm aria-pressed:border-primary aria-pressed:bg-primary/15 hover:bg-secondary before:absolute before:-left-5 before:top-1/2 before:w-5 before:border-t before:border-primary/30"
                >
                  <span className="text-primary">
                    <Localized value={"● "} />
                  </span>
                  <Localized value={descriptor[1]} />
                  <span className="block text-[10px] text-muted-foreground">
                    <Localized value={descriptor[0]} />
                    <Localized value={" · "} />
                    <Localized value={paths(descriptor).join(" · ")} />
                    <Localized
                      value={
                        descriptor[3].length ? ` · ${descriptor[3].length} termos relacionados` : ""
                      }
                    />
                  </span>
                </button>
              );
            })}
          />
        </div>
        <Localized
          value={
            leaves.length === 240 && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Localized
                  value={
                    " Mostrando 240 descritores. Refine o ramo ou use a busca para chegar ao termo desejado. "
                  }
                />
              </p>
            )
          }
        />
      </section>
      <div className="flex justify-center text-xs text-primary">
        <Localized value={" ↓ assuntos conectados aos artigos ↓ "} />
      </div>
      <section className="rounded-xl border border-primary/30 bg-sidebar/60 p-4">
        <div className="flex justify-between gap-2">
          <h3 className="font-display flex items-center gap-2">
            <BookOpen className="size-4" />{" "}
            <Localized value={articles.length.toLocaleString(getLocale())} />
            <Localized value={" artigos "} />
          </h3>
          <Localized
            value={
              selected.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  <Localized value={" Limpar descritores ("} />
                  <Localized value={selected.length} />
                  <Localized value={") "} />
                </Button>
              )
            }
          />
        </div>
        <Localized
          value={articles.slice(page * 20, page * 20 + 20).map((article) => (
            <article key={article[0]} className="py-4 border-b border-border last:border-0">
              <a
                className="text-sm hover:text-primary"
                href={`https://pubmed.ncbi.nlm.nih.gov/${article[0]}/`}
                target="_blank"
                rel="noreferrer"
              >
                <Localized value={article[2] || `Artigo ${article[0]}`} />{" "}
                <ExternalLink className="inline size-3" />
              </a>
              <p className="text-[10px] text-muted-foreground mt-1">
                <Localized value={article[1]} />
                <Localized value={" · PMID "} />
                <Localized value={article[0]} />
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                <Localized
                  value={article[3].slice(0, 12).map((index) => (
                    <button
                      key={index}
                      className="rounded-full border border-primary/30 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
                      onClick={() => {
                        const concept = data.concepts[index]!;
                        setSelected([concept[0]]);
                        onSelect?.(concept[0]);
                      }}
                    >
                      <Localized value={data.concepts[index]![1]} />
                    </button>
                  ))}
                />
              </div>
            </article>
          ))}
        />
        <Localized
          value={
            !articles.length && (
              <p className="py-8 text-sm text-muted-foreground">
                <Localized
                  value={
                    " Nenhum artigo da amostra contém esta combinação. O descritor continua disponível no vocabulário MeSH completo; tente OU, amplie o período ou selecione um termo ancestral. "
                  }
                />
              </p>
            )
          }
        />
        <Localized
          value={
            articles.length > 20 && (
              <div className="flex justify-between items-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!page}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <Localized value={" Anterior "} />
                </Button>
                <span className="text-xs">
                  <Localized value={page + 1} />
                  <Localized value={" / "} />
                  <Localized value={Math.ceil(articles.length / 20)} />
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(page + 1) * 20 >= articles.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <Localized value={" Próxima "} />
                </Button>
              </div>
            )
          }
        />
      </section>
    </div>
  );
}
