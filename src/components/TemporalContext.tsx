import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { mapCatalog } from "@/lib/map-api.functions";
import type { MapCatalog } from "@/lib/map-api-types";
import type { ExplorationPeriod } from "@/lib/temporal";

type TemporalState = {
  period: ExplorationPeriod | null;
  catalog: MapCatalog | null;
  setPeriod: (period: ExplorationPeriod) => void;
  revision: string | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
};
const Context = createContext<TemporalState | null>(null);
export function TemporalProvider({ children }: { children: ReactNode }) {
  const { searchStr, pathname } = useLocation();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<ExplorationPeriod | null>(null);
  const query = useQuery({
    queryKey: ["map-catalog"],
    queryFn: () => mapCatalog(),
    refetchInterval: 60000,
    staleTime: 10000,
  });
  const catalog = query.data ?? null;
  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const legacy = params.get("year") ?? params.get("cutoff");
    const explicit = params.has("from") || params.has("to") || !!legacy;
    const start = Number(params.get("from") ?? legacy),
      end = Number(params.get("to") ?? legacy);
    if (explicit && Number.isInteger(start) && Number.isInteger(end))
      setPeriod({ startYear: start, endYear: end });
    else if (explicit) setPeriod(null);
    else if (catalog) setPeriod((p) => p ?? { startYear: catalog.end, endYear: catalog.end });
  }, [searchStr, catalog]);
  return (
    <Context.Provider
      value={{
        period,
        catalog,
        setPeriod: (next) => {
          setPeriod(next);
          void navigate({
            to: pathname as "/" | "/metrics" | "/timeline" | "/hypotheses",
            search: (previous) => ({ ...previous, from: next.startYear, to: next.endYear }),
            replace: true,
          });
        },
        revision: catalog?.revision,
        loading: query.isPending,
        error: query.isError,
        retry: () => {
          void query.refetch();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
// The provider and its typed hook intentionally share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTemporal() {
  const value = useContext(Context);
  if (!value) throw new Error("TemporalProvider ausente");
  return value;
}
export function PeriodSelector() {
  const { period, catalog, setPeriod, loading, error, retry } = useTemporal();
  if (!period || !catalog)
    return (
      <div className="px-4 text-xs" role="status">
        {loading ? (
          "Carregando período…"
        ) : error ? (
          <>
            Não foi possível carregar o período.{" "}
            <button className="underline" onClick={retry}>
              Tentar novamente
            </button>
          </>
        ) : catalog ? (
          "Período inválido na URL. Informe anos inteiros em from e to."
        ) : (
          "Serviço científico indisponível. Inicie a API de dados."
        )}
      </div>
    );
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
      {(period.startYear < catalog.start ||
        period.endYear > catalog.end ||
        period.startYear > period.endYear) && (
        <span role="alert" className="text-destructive">
          Período fora da cobertura disponível. Ajuste os anos; nenhum outro período foi
          selecionado.
        </span>
      )}
      <span>Período</span>
      {(["startYear", "endYear"] as const).map((field, i) => (
        <label key={field} className="flex items-center gap-2">
          {i === 1 && "até"}
          <input
            aria-label={i ? "Ano final" : "Ano inicial"}
            key={period[field]}
            className="w-24 rounded border border-border bg-background p-1"
            type="number"
            min={catalog.start}
            max={catalog.end}
            defaultValue={period[field]}
            onBlur={(e) => {
              const value = Number(e.target.value);
              const next = { ...period, [field]: value };
              if (
                Number.isInteger(value) &&
                value >= catalog.start &&
                value <= catalog.end &&
                next.startYear <= next.endYear
              )
                setPeriod(next);
              else e.target.value = String(period[field]);
            }}
          />
        </label>
      ))}
      <button
        className="underline"
        onClick={() => setPeriod({ startYear: period.endYear, endYear: period.endYear })}
      >
        Somente {period.endYear}
      </button>
      <span className="text-muted-foreground">
        Dados: {catalog.start}–{catalog.end} · corte de validação: {period.endYear}; treino:{" "}
        {catalog.start}–{period.endYear};{" "}
        {period.endYear < catalog.end
          ? `teste: ${period.endYear + 1}–${catalog.end}`
          : "sem dados posteriores para teste"}
      </span>
    </div>
  );
}
