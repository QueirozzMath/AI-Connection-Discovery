import { useTemporal } from "./TemporalContext";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { mapArticles } from "@/lib/map-api.functions";
import type { MapArticle } from "@/lib/map-api-types";
import { catColor, num } from "@/lib/science-data";

/** Bounded bipartite graph: current page only, at most 24 genuine MeSH headings. */
function ArticleMeshNetwork({ articles }: { articles: MapArticle[] }) {
  const network = useMemo(() => {
    const counts = new Map<string, { label: string; category: string; count: number }>();
    for (const a of articles)
      for (const m of a.mesh) {
        const current = counts.get(m.id);
        counts.set(m.id, {
          label: m.label,
          category: m.category,
          count: (current?.count ?? 0) + 1,
        });
      }
    const mesh = [...counts].sort((a, b) => b[1].count - a[1].count).slice(0, 24);
    return { mesh, positions: new Map(mesh.map(([id], i) => [id, 25 + i * 24])) };
  }, [articles]);
  const height = Math.max(160, network.mesh.length * 24 + 30, articles.length * 27 + 30);
  return (
    <div className="overflow-auto">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Artigo → MeSH nesta página. Convergência indica MeSH compartilhado, não citação. Até 24
        descritores.
      </p>
      <svg
        viewBox={`0 0 440 ${height}`}
        role="img"
        aria-label="Relações reais artigo–MeSH"
        className="min-w-[360px] w-full"
      >
        {articles.flatMap((a, i) =>
          a.mesh
            .filter((m) => network.positions.has(m.id))
            .map((m) => (
              <line
                key={a.pmid + m.id}
                x1={110}
                y1={25 + i * 27}
                x2={240}
                y2={network.positions.get(m.id)}
                stroke={catColor(m.category)}
                strokeOpacity={0.3}
              />
            )),
        )}
        {articles.map((a, i) => (
          <a
            key={a.pmid}
            href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <title>{a.title ?? a.pmid}</title>
            <rect x={103} y={20 + i * 27} width={10} height={10} fill="#d5e2f5" />
            <text x={4} y={29 + i * 27} fontSize={10} fill="currentColor">
              {a.pmid}
            </text>
          </a>
        ))}
        {network.mesh.map(([id, m]) => (
          <g key={id}>
            <title>{m.label}</title>
            <circle cx={240} cy={network.positions.get(id)} r={4} fill={catColor(m.category)} />
            <text x={250} y={network.positions.get(id)! + 4} fontSize={10} fill="currentColor">
              {m.label.length > 25 ? m.label.slice(0, 24) + "…" : m.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function MapArticles({
  start,
  end,
  meshIds,
}: {
  start: number;
  end: number;
  meshIds: string[];
}) {
  const { revision } = useTemporal();
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "network">("list");
  const result = useQuery({
    queryKey: ["map-articles", start, end, meshIds, cursor, revision],
    queryFn: () => mapArticles({ data: { startYear: start, endYear: end, meshIds, cursor } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return (
    <section className="panel space-y-3 p-3 text-xs" aria-label="Artigos do subconjunto">
      <h2 className="font-display text-sm font-semibold">Artigos</h2>
      <p className="text-muted-foreground">
        {start}–{end} · associados aos conceitos em foco ou ao subconjunto do mapa.
      </p>
      <div className="flex gap-2">
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
            <ArticleMeshNetwork articles={result.data.items} />
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
