import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MapArticles, MapCatalog, TemporalGraph } from "./map-api-types";
import type { Candidate, LinkModel, Metrics } from "./science-data";

import { Period, PeriodFields } from "./temporal";
export const mapCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<MapCatalog> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService<MapCatalog>("metadata");
  },
);
export const mapPeriodGraph = createServerFn({ method: "POST" })
  .validator((input: unknown) => Period.parse(input))
  .handler(async ({ data }): Promise<TemporalGraph> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService<TemporalGraph>("graph", data);
  });
export const mapArticles = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    PeriodFields.extend({
      meshIds: z.array(z.string().min(1).max(24)).max(4500),
      cursor: z.string().max(40).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<MapArticles> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService<MapArticles>("articles", data);
  });

export type TemporalAnalysis = {
  status: "pending" | "busy" | "error" | "complete";
  available?: boolean;
  reason?: string;
  model?: LinkModel;
  items?: Candidate[];
  metrics?: Metrics;
};
export const mapAnalysis = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    PeriodFields.extend({
      operation: z.enum(["explore", "validate"]),
      meshIds: z.array(z.string().max(24)).max(4500).optional(),
      seedIds: z.array(z.string().max(24)).max(4500).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<TemporalAnalysis> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService<TemporalAnalysis>("analysis", data);
  });
