import test from "node:test";
import assert from "node:assert/strict";
import { neuricoIdea } from "../src/lib/neurico.ts";
const report = {
  title: "Testable scientific hypothesis",
  hypothesis: "A measurable relation requiring new evidence.",
  pair: ["A", "C"],
  cutoff_year: 2018,
  mechanism: "Hypothetical mechanism",
  research_plan: "Compare baseline and candidate; retain artifacts.",
  experiment: "Controlled comparison",
  next_steps: "Collect evidence.",
  testable_prediction: "Measurable outcome.",
  falsification: "Null result.",
  evidence_assessment: {
    arms: [
      {
        from: "A",
        to: "B",
        articles: [{ pmid: "123456", year: 2010, title: "Study", abstract: "Abstract" }],
      },
    ],
  },
};
test("NeuriCo export retains evidence, temporal boundaries, evaluation criteria and zero budget", () => {
  const idea = JSON.parse(neuricoIdea(report)).idea;
  assert.equal(idea.domain, "data_science");
  assert.equal(idea.constraints.budget, 0);
  assert.equal(idea.background.papers[0].url, "https://pubmed.ncbi.nlm.nih.gov/123456/");
  assert.match(idea.background.description, /2018/);
  assert.match(idea.background.description, /Compare baseline/);
  assert.equal(idea.expected_outputs[0].type, "report");
  assert.equal(idea.hypothesis, report.hypothesis);
});
test("invalid short hypothesis cannot produce an unsupported NeuriCo submission", () =>
  assert.throws(() => neuricoIdea({ ...report, hypothesis: "Short" }), /20 caracteres/));
