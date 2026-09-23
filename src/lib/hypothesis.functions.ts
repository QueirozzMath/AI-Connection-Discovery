import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Request = z.object({
  operation: z.enum([
    "discover",
    "candidate",
    "generate",
    "validate",
    "review",
    "backtest",
    "status",
    "list",
    "get",
  ]),
  requestId: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
  hypothesisId: z.string().uuid().optional(),
  startYear: z.number().int().min(1800).max(3000).optional(),
  endYear: z.number().int().min(1800).max(3000).optional(),
  cutoffYear: z.number().int().min(1800).max(3000).optional(),
  validationEndYear: z.number().int().min(1800).max(3000).optional(),
  a: z.string().max(300).optional(),
  c: z.string().max(300).optional(),
  mode: z.enum(["global", "open", "closed"]).optional(),
  q: z.string().max(300).optional(),
  categories: z.array(z.string().max(8)).max(26).optional(),
  operator: z.enum(["and", "or"]).optional(),
  seedIds: z.array(z.string().max(24)).max(20).optional(),
  strictHistorical: z.boolean().optional(),
  review: z
    .object({
      status: z.enum([
        "NO_FUTURE_EVIDENCE",
        "WEAK_SIGNAL",
        "PARTIAL_SUPPORT",
        "SUBSTANTIAL_SUPPORT",
        "CONTRADICTED",
        "INCONCLUSIVE",
      ]),
      reviewer: z.string().min(1).max(200),
      rationale: z.string().min(1).max(5000),
      pmids: z.array(z.string().regex(/^\d+$/)).max(100),
    })
    .optional(),
});
export type LbdRequest = z.infer<typeof Request>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type LbdResponse = {
  id?: string;
  status?: "pending" | "running" | "complete" | "error" | "busy";
  result?: JsonValue;
  error?: string;
  items?: JsonValue[];
  hypothesis?: JsonValue;
  validations?: JsonValue[];
};
export const lbdRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => Request.parse(input))
  .handler(async ({ data }): Promise<LbdResponse> => {
    const { queryMapService } = await import("./map-api.server");
    return queryMapService("lbd", data);
  });
