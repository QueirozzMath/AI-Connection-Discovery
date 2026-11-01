import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
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
  const _uiLanguage = useLanguage().language;

  const index = useQuery(indexQuery);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [operator, setOperator] = useState<"and" | "or">("or");
  if (index.isError)
    return (
      <p role="alert" className="p-6">
        <Localized value={" Não foi possível carregar o período."} />
        <Localized value={" "} />
        <button onClick={() => index.refetch()} className="text-primary underline">
          <Localized value={" Tentar novamente "} />
        </button>
      </p>
    );
  if (!index.data)
    return (
      <p role="status" className="p-6">
        <Localized value={" Carregando artigos… "} />
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
          <h1 className="text-xl font-semibold">
            <Localized value={"Artigos"} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Localized
              value={" Explore a árvore MeSH e consulte as publicações do corpus no PubMed. "}
            />
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <Localized value={" De "} />
            <select
              aria-label={t("Ano inicial dos artigos")}
              value={start}
              onChange={(e) => setFrom(Number(e.target.value))}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              <Localized
                value={years.map((y) => (
                  <option key={y}>
                    <Localized value={y} />
                  </option>
                ))}
              />
            </select>
          </label>
          <label className="text-xs">
            <Localized value={" Até "} />
            <select
              aria-label={t("Ano final dos artigos")}
              value={end}
              onChange={(e) => setTo(Number(e.target.value))}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              <Localized
                value={years
                  .filter((y) => y >= start)
                  .map((y) => (
                    <option key={y}>
                      <Localized value={y} />
                    </option>
                  ))}
              />
            </select>
          </label>
          <label className="text-xs">
            <Localized value={" Combinar descritores "} />
            <select
              aria-label={t("Combinar descritores")}
              value={operator}
              onChange={(e) => setOperator(e.target.value as "and" | "or")}
              className="mt-1 block rounded border border-border bg-background p-2"
            >
              <option value="or">
                <Localized value={"OU · qualquer descritor"} />
              </option>
              <option value="and">
                <Localized value={"E · todos os descritores"} />
              </option>
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
