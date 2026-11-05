import type { HypothesisResult } from "./hypothesis.functions";
/** JSON is valid YAML 1.2; compatible with NeuriCo ideas/schema.yaml v1.2. */
export function neuricoIdea(result: HypothesisResult) {
  if (result.hypothesis.length < 20)
    throw new Error("A hipótese precisa ter pelo menos 20 caracteres para exportar ao NeuriCo.");
  const papers = [
    ...new Map(
      result.evidence_assessment.arms.flatMap((arm) => arm.articles).map((a) => [a.pmid, a]),
    ).values(),
  ];
  return (
    JSON.stringify(
      {
        idea: {
          title: (result.title.length < 10
            ? "Scientific hypothesis: " + result.title
            : result.title
          ).slice(0, 200),
          domain: "data_science",
          hypothesis: result.hypothesis,
          background: {
            description: JSON.stringify({
              concepts: result.pair,
              cutoff_year: result.cutoff_year,
              mechanism: result.mechanism,
              research_plan: result.research_plan ?? result.next_steps,
              evidence: result.evidence_assessment.arms,
            }),
            papers: papers.map((a) => ({
              url: `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`,
              description: a.title,
            })),
          },
          methodology: { approach: result.experiment, steps: [result.next_steps] },
          constraints: { budget: 0 },
          expected_outputs: [
            {
              type: "report",
              format: "markdown",
              description: "Methods, actual results, artifacts, limitations and reproducibility.",
            },
          ],
          evaluation_criteria: [
            `Evaluate literature only up to ${result.cutoff_year}; keep later verification separate.`,
            "Do not claim experiments were executed without artifacts and measured results.",
            "Distinguish mechanism, co-occurrence, assumptions and alternative explanations.",
            result.testable_prediction,
            result.falsification,
          ],
        },
      },
      null,
      2,
    ) + "\n"
  );
}
