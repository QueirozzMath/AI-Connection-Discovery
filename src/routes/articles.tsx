import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MeshHierarchyExplorer } from "@/components/MeshHierarchyExplorer";
import { indexQuery } from "@/lib/science-data";

export const Route = createFileRoute("/articles")({
  head: () => ({ meta: [{ title: "Artigos — AI Connection Discovery" }] }),
  component: ArticlesPage,
});
function ArticlesPage() {
  const index = useQuery(indexQuery);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [operator, setOperator] = useState<"and" | "or">("or");
  if (index.isError)
    return (
      <p role="alert" className="p-6">
        Não foi possível carregar o período.{" "}
        <button onClick={() => index.refetch()} className="text-primary underline">
          Tentar novamente
        </button>
      </p>
    );
  if (!index.data)
    return (
      <p role="status" className="p-6">
        Carregando artigos…
      </p>
    );
  const [min, max] = index.data.corpus_years;
  const start = Math.max(min, Math.min(max, from ?? min));
  const end = Math.max(start, Math.min(max, to ?? max));
  const years = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div
      className="mx-auto flex h-full max-w-[1600px] flex-col p-3 sm:p-5"
      data-tour="article-explorer"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Artigos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore a árvore MeSH e consulte as publicações do corpus no PubMed.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            De
            <select
              aria-label="Ano inicial dos artigos"
              value={start}
              onChange={(e) => setFrom(Number(e.target.value))}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Até
            <select
              aria-label="Ano final dos artigos"
              value={end}
              onChange={(e) => setTo(Number(e.target.value))}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              {years
                .filter((y) => y >= start)
                .map((y) => (
                  <option key={y}>{y}</option>
                ))}
            </select>
          </label>
          <label className="text-xs">
            Combinar descritores
            <select
              aria-label="Combinar descritores"
              value={operator}
              onChange={(e) => setOperator(e.target.value as "and" | "or")}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              <option value="or">OU · qualquer descritor</option>
              <option value="and">E · todos os descritores</option>
            </select>
          </label>
        </div>
      </div>
      <div className="min-h-[420px] flex-1 overflow-auto rounded-xl border border-border bg-surface">
        <MeshHierarchyExplorer start={start} end={end} matches={null} operator={operator} />
      </div>
    </div>
  );
}
