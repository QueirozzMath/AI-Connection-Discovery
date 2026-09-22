import { useQuery } from "@tanstack/react-query";
import { useTemporal } from "@/components/TemporalContext";
import { mapAnalysis } from "@/lib/map-api.functions";

export function useTemporalAnalysis(
  operation: "explore" | "validate",
  enabled = true,
  meshIds?: string[],
  seedIds?: string[],
) {
  const { period, catalog } = useTemporal();
  return useQuery({
    queryKey: ["temporal-analysis", operation, period, catalog?.revision, meshIds, seedIds],
    queryFn: () =>
      mapAnalysis({
        data: {
          ...period!,
          operation,
          ...(meshIds ? { meshIds } : {}),
          ...(seedIds ? { seedIds } : {}),
        },
      }),
    enabled: enabled && !!period && !!catalog,
    refetchInterval: (query) =>
      ["pending", "busy"].includes(query.state.data?.status ?? "") ? 2000 : false,
  });
}
