import { articleNetwork } from "@/lib/article-network";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { mapArticles } from "@/lib/map-api.functions";
import type { MapArticle } from "@/lib/map-api-types";
import { catColor, num } from "@/lib/science-data";

/** Explore one actual descriptor at a time; all articles remain available in the list. */
function ArticleMeshNetwork({ articles }: { articles: MapArticle[] }) {
  const descriptors = useMemo(() => {
    const counts = new Map<string, { label: string; category: string; count: number }>();
    for (const article of articles)
      for (const m of article.mesh) {
        const previous = counts.get(m.id);
        counts.set(m.id, {
          label: m.label,
          category: m.category,
          count: (previous?.count ?? 0) + 1,
        });
      }
    return [...counts].sort(
      (a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label),
    );
  }, [articles]);
  const [chosen, setChosen] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [focusedMesh, setFocusedMesh] = useState<string | null>(null);
  const active = descriptors.find(([id]) => id === chosen);
  const linked = active ? articles.filter((a) => a.mesh.some((m) => m.id === active[0])) : articles;
  const batch = linked.slice(offset, offset + 10);
  const selected = batch.find((a) => a.pmid === selectedArticle);
  useEffect(() => {
    setOffset(0);
    setSelectedArticle(null);
    setFocusedMesh(null);
  }, [articles, chosen]);
  const network = useMemo(() => articleNetwork(batch), [articles, offset, chosen]);
  if (!articles.length) return <p>Nenhuma relação artigo–MeSH nesta página.</p>;
  const points = batch.map((article, i) => ({
    article,
    x: network.positions[i * 2]!,
    y: network.positions[i * 2 + 1]!,
    number: offset + i + 1,
  }));
  return (
    <div className="min-w-0 space-y-3">
      <label className="block font-medium" htmlFor="article-network-term">
        Explorar um descritor
      </label>
      <select
        id="article-network-term"
        className="w-full min-w-0 rounded-md border border-border bg-background p-2 text-xs"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
      >
        <option value="">Todos os descritores desta página</option>
        {descriptors.map(([id, m]) => (
          <option key={id} value={id}>
            {m.label} · {m.count} artigos nesta página
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground">
        Pontos numerados são artigos; pontos coloridos com nome são termos MeSH distintos. Selecione
        qualquer elemento para destacar suas ligações reais.
      </p>
      <svg
        viewBox="0 0 360 330"
        className="block w-full rounded-xl border border-border bg-background/60"
        role="group"
        aria-label="Rede de artigos e descritores MeSH distintos"
      >
        {network.links.map(([a, b]) => {
          const term = network.mesh[b - batch.length]!;
          const match = selectedArticle
            ? batch[a]!.pmid === selectedArticle
            : focusedMesh
              ? term.id === focusedMesh
              : true;
          return (
            <line
              key={`${a}:${b}`}
              x1={network.positions[a * 2]}
              y1={network.positions[a * 2 + 1]}
              x2={network.positions[b * 2]}
              y2={network.positions[b * 2 + 1]}
              stroke={catColor(term.category)}
              opacity={match ? 0.45 : 0.035}
              strokeWidth={match ? 1.2 : 0.6}
            />
          );
        })}
        {network.mesh.map((m, i) => {
          const index = batch.length + i,
            x = network.positions[index * 2]!,
            y = network.positions[index * 2 + 1]!;
          return (
            <g
              key={m.id}
              role="button"
              tabIndex={0}
              className="group cursor-pointer focus:outline-none"
              aria-label={`Termo MeSH: ${m.label}, ${m.count} artigos visíveis`}
              onClick={() => {
                setFocusedMesh(focusedMesh === m.id ? null : m.id);
                setSelectedArticle(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocusedMesh(m.id);
                  setSelectedArticle(null);
                }
              }}
            >
              <title>
                {m.label} · {m.id}
              </title>
              <circle
                cx={x}
                cy={y}
                r={focusedMesh === m.id ? 9 : 6}
                fill={catColor(m.category)}
                stroke="var(--background)"
                strokeWidth={2}
                className="group-focus-visible:stroke-white"
              />
              <text
                x={x > 240 ? x - 9 : x + 9}
                y={y + 3}
                textAnchor={x > 240 ? "end" : "start"}
                fontSize={8.5}
                fill="currentColor"
                paintOrder="stroke"
                stroke="var(--background)"
                strokeWidth={3}
              >
                {m.label.length > 17 ? m.label.slice(0, 16) + "…" : m.label}
              </text>
            </g>
          );
        })}
        {points.map(({ article, x, y, number }) => (
          <g
            key={article.pmid}
            role="button"
            tabIndex={0}
            aria-label={`Artigo ${number}: ${article.title ?? article.pmid}`}
            className="group cursor-pointer focus:outline-none"
            onClick={() => {
              setSelectedArticle(article.pmid);
              setFocusedMesh(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedArticle(article.pmid);
                setFocusedMesh(null);
              }
            }}
          >
            <title>{article.title ?? article.pmid}</title>
            <circle
              cx={x}
              cy={y}
              r={selectedArticle === article.pmid ? 14 : 11}
              fill={selectedArticle === article.pmid ? "var(--primary)" : "var(--foreground)"}
              stroke="var(--border)"
              strokeWidth={1.2}
              className="group-focus-visible:stroke-white group-focus-visible:stroke-[3px]"
            />
            <text x={x} y={y + 3.5} textAnchor="middle" fill="var(--background)" fontSize={10}>
              {number}
            </text>
          </g>
        ))}
      </svg>
      {focusedMesh && network.mesh.find((m) => m.id === focusedMesh) && (
        <div className="rounded border border-border p-2">
          <p className="font-semibold">{network.mesh.find((m) => m.id === focusedMesh)!.label}</p>
          <p className="text-muted-foreground">
            {focusedMesh} · {network.mesh.find((m) => m.id === focusedMesh)!.count} artigos nesta
            rede
          </p>
          <button
            className="mt-1 text-primary underline"
            onClick={() => {
              setChosen(focusedMesh);
              setFocusedMesh(null);
            }}
          >
            Explorar artigos deste termo
          </button>
          <button className="ml-3 underline" onClick={() => setFocusedMesh(null)}>
            Limpar destaque
          </button>
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <button
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
          disabled={offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - 10));
            setSelectedArticle(null);
          }}
        >
          ← Anteriores
        </button>
        <span>
          {offset + 1}–{offset + batch.length} de {linked.length}
        </span>
        <button
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
          disabled={offset + 10 >= linked.length}
          onClick={() => {
            setOffset(offset + 10);
            setSelectedArticle(null);
          }}
        >
          Mais →
        </button>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {(selected ? points.filter((p) => p.article.pmid === selected.pmid) : points).map(
          ({ article, number }) => (
            <div key={article.pmid} className="rounded-lg border border-border bg-background p-3">
              <div className="mb-1 flex gap-2 text-[10px] text-muted-foreground">
                <span className="font-semibold text-primary">
                  {number.toString().padStart(2, "0")}
                </span>
                <span>
                  {article.year} · PMID {article.pmid}
                </span>
              </div>
              <a
                className="block text-xs font-medium leading-relaxed text-primary hover:underline"
                href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {article.title ?? `Artigo ${article.pmid}`} ↗
              </a>
              {selected && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {article.mesh.map((m) => (
                    <button
                      key={m.id}
                      className="rounded-full border border-border px-2 py-1 text-[10px] hover:bg-secondary"
                      onClick={() => setChosen(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>
      {selected && (
        <button className="text-primary underline" onClick={() => setSelectedArticle(null)}>
          Mostrar todos os títulos desta rede
        </button>
      )}
      <p className="text-[10px] text-muted-foreground">
        Até 18 descritores distintos e 10 artigos visíveis por quadro, baseados nos{" "}
        {articles.length} artigos da página atual. Use “Próxima página” para explorar mais.
      </p>
    </div>
  );
}

export function MapArticles({
  start,
  end,
  meshIds,
  remote = false,
}: {
  start: number;
  end: number;
  meshIds: string[];
  remote?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "network">("list");
  useEffect(() => {
    setCursor(null);
  }, [start, end, meshIds]);
  const result = useQuery({
    queryKey: ["map-articles", start, end, meshIds, cursor, remote],
    queryFn: async () => {
      if (remote) return mapArticles({ data: { start, end, meshIds, cursor } });
      const { bundledArticles } = await import("@/lib/bundled-articles");
      return bundledArticles({ start, end, meshIds, cursor });
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return (
    <section className="panel space-y-3 p-3 text-xs" aria-label="Artigos do subconjunto">
      <h2 className="font-display text-sm font-semibold">Artigos do mapa</h2>
      <p className="text-muted-foreground">
        {start}–{end} · associados aos conceitos em foco ou ao subconjunto do mapa.
      </p>
      {!remote && (
        <p className="text-[10px] text-muted-foreground">
          Corpus publicado do PubMed · títulos e descritores disponíveis; autores, periódico e DOI
          não incluídos neste recorte.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(["list", "network"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={view === mode}
            className="rounded border border-border px-2 py-1 aria-pressed:bg-primary/20"
            onClick={() => setView(mode)}
          >
            {mode === "list" ? "Lista" : "Rede artigo–MeSH"}
          </button>
        ))}
      </div>
      {result.isPending && <p role="status">Consultando artigos…</p>}
      {result.isError && (
        <div role="alert">
          <p>Artigos temporariamente indisponíveis.</p>
          <button className="underline" onClick={() => void result.refetch()}>
            Tentar novamente
          </button>
        </div>
      )}
      {result.data && (
        <>
          <p aria-live="polite">{num(result.data.total)} artigos distintos no subconjunto</p>
          {result.data.years.length > 0 && (
            <details>
              <summary className="cursor-pointer">Distribuição temporal</summary>
              <div className="max-h-40 overflow-auto">
                {result.data.years.map((point) => (
                  <div key={point.year} className="flex items-center gap-2 py-0.5">
                    <span>{point.year}</span>
                    <span
                      className="h-1.5 bg-primary"
                      style={{
                        width: `${(100 * point.count) / Math.max(...result.data!.years.map((p) => p.count))}%`,
                      }}
                    />
                    <span>{num(point.count)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {result.data.total === 0 && <p>Nenhum artigo no subconjunto atual.</p>}
          {view === "network" ? (
            <ArticleMeshNetwork
              key={`${start}:${end}:${cursor}:${meshIds.join(",")}`}
              articles={result.data.items}
            />
          ) : (
            <ul className="space-y-4">
              {result.data.items.map((article) => (
                <li key={article.pmid} className="border-t border-border pt-3">
                  <a
                    className="font-medium text-primary hover:underline"
                    href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {article.title || `PMID ${article.pmid}`}
                  </a>
                  <p className="mt-1">
                    {article.year}
                    {article.journal ? ` · ${article.journal}` : ""} · PMID {article.pmid}
                  </p>
                  {article.authors.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {article.authors.slice(0, 6).join(", ")}
                      {article.authors.length > 6 ? " et al." : ""}
                    </p>
                  )}
                  {article.doi && (
                    <a
                      className="mt-1 block break-all text-primary hover:underline"
                      href={`https://doi.org/${encodeURIComponent(article.doi)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      DOI: {article.doi}
                    </a>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer">
                      MeSH associados ({article.mesh.length})
                    </summary>
                    <ul>
                      {article.mesh.map((m) => (
                        <li key={m.id}>
                          {m.label} · {m.id}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between">
            <button
              disabled={!cursor || result.isFetching}
              onClick={() => setCursor(null)}
              className="disabled:opacity-40"
            >
              Primeira página
            </button>
            <button
              disabled={!result.data.next || result.isFetching}
              onClick={() => setCursor(result.data!.next)}
              className="disabled:opacity-40"
            >
              Próxima página →
            </button>
          </div>
        </>
      )}
    </section>
  );
}
