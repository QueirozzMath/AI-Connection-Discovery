export const reportTextFields = [
  "research_plan",
  "title",
  "hypothesis",
  "mechanism",
  "bridge_reasoning",
  "testable_prediction",
  "experiment",
  "potential_applications",
  "next_steps",
  "skeptic_critique",
  "innovation_value",
  "falsification",
  "evidence_limitations",
  "documented_evidence",
  "extrapolations",
  "context_compatibility",
  "contradictions",
] as const;
export function validateTranslation(
  source: Record<string, string>,
  translated: Record<string, string>,
) {
  if (Object.keys(source).sort().join("|") !== Object.keys(translated).sort().join("|"))
    throw new Error("Tradução incompleta. Tente novamente.");
  for (const key of Object.keys(source)) {
    const ids = (text: string) =>
      [...text.matchAll(/\bPMID\s*:?\s*(\d+)/gi)]
        .map((m) => m[1])
        .sort()
        .join("|");
    if (!translated[key]?.trim() || ids(source[key]!) !== ids(translated[key]!))
      throw new Error("A tradução alterou as referências. Tente novamente.");
  }
  return translated;
}
