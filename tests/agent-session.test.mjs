import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySession,
  selectSession,
  serializeSession,
  restoreSession,
  selectionKey,
} from "../src/lib/agent-session.ts";
import { validateTranslation } from "../src/lib/translation-validation.ts";
import { setUiLanguage, t } from "../src/lib/ui-language.ts";
const active = {
  pair: {
    a: "Alpha",
    c: "Omega",
    intermediaries: ["Beta"],
    rank: 1,
    prob: 0.5,
    confirmed: false,
    features: {},
  },
  cutoff: 2018,
  expanded: false,
};
const fields = [
  "title",
  "hypothesis",
  "mechanism",
  "bridge_reasoning",
  "testable_prediction",
  "skeptic_critique",
  "innovation_value",
  "falsification",
  "evidence_limitations",
  "documented_evidence",
  "extrapolations",
  "context_compatibility",
  "contradictions",
];
const result = {
  ...Object.fromEntries(fields.map((k) => [k, "PMID 123456"])),
  pair: ["Alpha", "Omega"],
  evidence_assessment: { arms: [{ articles: [{ pmid: "123456" }] }] },
};
const check = {
  rationale: "Evidence PMID 123456",
  articles: [{ pmid: "123456" }],
  supporting_pmids: ["123456"],
  contradicting_pmids: [],
};
test("active report and literature verification survive a session round trip without credentials", () => {
  const key = selectionKey(active);
  const state = {
    ...emptySession(),
    active,
    results: { [key]: result },
    checks: { [key]: check },
    apiKey: "secret-test-key",
  };
  const raw = serializeSession(state);
  assert.ok(!raw.includes("secret-test-key"));
  const restored = restoreSession(raw);
  assert.equal(restored.results[key].hypothesis, result.hypothesis);
  assert.deepEqual(restored.checks[key], check);
  assert.equal(selectSession(restored, { ...active }), restored);
  const changed = selectSession(restored, { ...active, pair: { ...active.pair, c: "Other" } });
  assert.deepEqual(changed.results, {});
  assert.deepEqual(changed.checks, {});
});
test("malformed or stale session data is ignored", () => {
  for (const raw of ["bad", "{}", "null", JSON.stringify({ version: 0, active })])
    assert.deepEqual(restoreSession(raw), emptySession());
  const key = selectionKey(active);
  assert.deepEqual(
    restoreSession(
      JSON.stringify({ version: 1, active, results: { [key]: { hypothesis: "incomplete" } } }),
    ),
    emptySession(),
  );
});
test("translation preserves report shape and citation identifiers", () => {
  assert.deepEqual(
    validateTranslation({ hypothesis: "Texto PMID 123456" }, { hypothesis: "Text PMID 123456" }),
    { hypothesis: "Text PMID 123456" },
  );
  assert.throws(() =>
    validateTranslation({ hypothesis: "PMID 123456" }, { hypothesis: "PMID 789" }),
  );
  assert.throws(() => validateTranslation({ hypothesis: "Text" }, { other: "Text" }));
});
test("language switching handles exact labels, templates and reversibility", () => {
  setUiLanguage("en");
  assert.equal(t("Ano de corte"), "Cutoff year");
  assert.equal(t("Confiança estimada pelo agente: 45%"), "Agent-estimated confidence: 45%");
  assert.equal(t("PMID 123456"), "PMID 123456");
  setUiLanguage("pt");
  assert.equal(t("Ano de corte"), "Ano de corte");
});

test("changing evidence exploration mode preserves the open outputs", () => {
  const state = selectSession(emptySession(), active);
  state.results[selectionKey(active)] = result;
  const next = selectSession(state, { ...active, expanded: true });
  assert.equal(next.results[selectionKey(active)], result);
  assert.equal(next.active.expanded, true);
});
