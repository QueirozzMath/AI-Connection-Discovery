import { z } from "zod";
export const HypothesisSchema = z.object({
  decision: z.enum(["propose", "reject"]),
  documented_evidence: z.string(),
  extrapolations: z.string(),
  context_compatibility: z.string(),
  contradictions: z.string(),
  references: z.array(z.string().regex(/^\d{1,10}$/)).min(1),
  title: z.string(),
  hypothesis: z.string(),
  mechanism: z.string(),
  bridge_reasoning: z.string(),
  testable_prediction: z.string(),
  experiment: z.string().min(1),
  potential_applications: z.string().min(1),
  next_steps: z.string().min(1),
  skeptic_critique: z.string(),
  confidence: z.number().min(0).max(1),
  novelty: z.enum(["alta", "media", "baixa"]),
  innovation_value: z.string(),
  falsification: z.string(),
  evidence_limitations: z.string(),
  research_plan: z.string().min(1).optional(),
});

export function normalizeHypothesis(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = { ...value } as Record<string, unknown>;
  if (Array.isArray(out["references"]))
    out["references"] = out["references"].map((v) =>
      typeof v === "number" && Number.isSafeInteger(v)
        ? String(v)
        : typeof v === "string"
          ? v.replace(/^PMID\s*:?\s*/i, "").trim()
          : v,
    );
  if (typeof out["confidence"] === "string" && /^\d+(?:\.\d+)?%$/.test(out["confidence"]))
    out["confidence"] = Number(out["confidence"].slice(0, -1)) / 100;
  const novelty: Record<string, string> = {
    high: "alta",
    medium: "media",
    low: "baixa",
    média: "media",
  };
  if (typeof out["novelty"] === "string")
    out["novelty"] = novelty[out["novelty"].toLowerCase()] ?? out["novelty"];
  return out;
}
const properties = Object.fromEntries(
  Object.keys(HypothesisSchema.shape).map((key) => [
    key,
    key === "references"
      ? { type: "array", items: { type: "string", pattern: "^\\d{1,10}$" }, minItems: 1 }
      : key === "confidence"
        ? { type: "number", minimum: 0, maximum: 1 }
        : key === "decision"
          ? { type: "string", enum: ["propose", "reject"] }
          : key === "novelty"
            ? { type: "string", enum: ["alta", "media", "baixa"] }
            : { type: "string", minLength: 1 },
  ]),
);
export const hypothesisJsonSchema = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};
