import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MapArticles, MapCatalog, TemporalGraph } from "./map-api-types";

const Period = z.object({
  start: z.number().int().min(1946).max(3000),
  end: z.number().int().min(1946).max(3000),
});
export const mapCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<MapCatalog | null> => {
    try {
      const { queryMapService } = await import("./map-api.server");
      return await queryMapService<MapCatalog>("metadata");
    } catch {
      return null;
    }
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
    Period.extend({
      meshIds: z.array(z.string().min(1).max(24)).max(4500),
      cursor: z.string().max(40).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<MapArticles> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService<MapArticles>("articles", data);
  });
