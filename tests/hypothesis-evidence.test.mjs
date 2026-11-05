import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/lib/hypothesis.functions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const paper = (id) => ({ pmid: id, year: 2010, title: "Study", abstract: "Evidence ".repeat(20) });
const assessment = {
  status: "ready",
  arms: [
    { from: "Alpha", to: "Beta", articles: [paper("123456"), paper("123457")] },
    { from: "Beta", to: "Omega", articles: [paper("123457"), paper("123458")] },
  ],
  checkedAt: "now",
  pathsChecked: 1,
  quality: 0.4,
  minimum: 2,
  reason: "ok",
};
const terms = ["Alpha", "Beta", "Omega"].map((label, i) => ({ id: `D${i}`, label, aliases: [] }));
const input = {
  a: "Alpha",
  c: "Omega",
  intermediaries: ["Beta"],
  prob: 0.5,
  cutoffYear: 2014,
  apiKey: "valid-key-for-test-session",
  expanded: false,
  plans: [
    {
      nodes: terms,
      arms: [
        ["123456", "123457"],
        ["123457", "123458"],
      ],
    },
  ],
};
const output = {
  decision: "propose",
  documented_evidence: "PMID 123456",
  extrapolations: "Assumption",
  context_compatibility: "Uncertain",
  contradictions: "Not assessed",
  references: ["123456", "123457", "123458"],
  title: "Test",
  hypothesis: "Hypothesis",
  mechanism: "Mechanism",
  bridge_reasoning: "Bridge",
  testable_prediction: "Experiment",
  experiment: "Controlled experiment",
  potential_applications: "Potential applications",
  next_steps: "Obtain evidence",
  skeptic_critique: "Critique",
  confidence: 0.3,
  novelty: "baixa",
  innovation_value: "Experimental",
  falsification: "Control",
  evidence_limitations: "Limited",
};
function load(status = "ready", response = output) {
  let calls = 0;
  let lastSystem = "";
  const module = { exports: {} };
  const context = {
    exports: module.exports,
    module,
    require: (id) => {
      if (id === "@tanstack/react-start")
        return {
          createServerFn: () => {
            let validator = (x) => x;
            const builder = {
              validator(fn) {
                validator = fn;
                return builder;
              },
              inputValidator(fn) {
                validator = fn;
                return builder;
              },
              handler(fn) {
                return async (raw) => fn({ data: validator(raw) });
              },
            };
            return builder;
          },
        };
      if (id === "./hypothesis-schema") return require("../src/lib/hypothesis-schema.ts");
      if (id === "./ai-settings") return require("../src/lib/ai-settings.ts");
      if (id === "./ai.server")
        return {
          resolveGeminiKey: () => "test-key",
          geminiConfiguration: () => ({ model: "test-model" }),
          askAiJson: async (system, prompt) => {
            calls++;
            lastSystem = system;
            assert.match(system, /INTERNAL/);
            assert.match(prompt, /123456/);
            return {
              data: response,
              provenance: { model: "test-model", provider: "test", mode: "free", attempts: [] },
            };
          },
        };
      if (id === "./discovery-manifesto.server")
        return { manifestoPrompt: () => "INTERNAL INSTRUCTIONS" };
      if (id === "./evidence.server")
        return {
          assessPlans: async () => ({ ...assessment, status }),
          validateCitations: () => {},
        };
      return require(id);
    },
  };
  vm.runInNewContext(js, context);
  return { fn: module.exports.generateHypothesis, calls: () => calls, system: () => lastSystem };
}
test("generation rechecks the evidence gate on the server before calling the LLM", async () => {
  const app = load("pending");
  await assert.rejects(app.fn(input));
  assert.equal(app.calls(), 0);
});
test("a generated proposal retains verified paths, modality and allowed references", async () => {
  const app = load();
  const r = await app.fn(input);
  assert.equal(r.evidence_assessment.status, "ready");
  assert.equal(r.model, "test-model");
  assert.equal(app.calls(), 1);
  assert.equal(r.evidence_seen.bridges[0].ab.length, 2);
});
test("unprovided references and missing edge citations are rejected", async () => {
  await assert.rejects(
    load("ready", { ...output, references: ["999999", "123456", "123457"] }).fn(input),
    /Referência/,
  );
  await assert.rejects(
    load("ready", { ...output, references: ["123456", "123456", "123456"] }).fn(input),
    /todas as ligações/,
  );
});
test("client cannot smuggle a longer chain into normal mode or change its endpoints", async () => {
  const bad = {
    ...input,
    plans: [
      { ...input.plans[0], nodes: [{ ...terms[0], label: "Different" }, terms[1], terms[2]] },
    ],
  };
  const app = load();
  await assert.rejects(app.fn(bad));
  assert.equal(app.calls(), 0);
});

test("experiment, applications and next steps must be generated as separate fields", async () => {
  const { experiment, ...incomplete } = output;
  await assert.rejects(load("ready", incomplete).fn(input), /inválida nos campos: experiment/);
  const result = await load().fn(input);
  assert.equal(result.experiment, "Controlled experiment");
  assert.equal(result.potential_applications, "Potential applications");
  assert.equal(result.next_steps, "Obtain evidence");
});

test("new reports follow the selected language without translating identifiers or enums", async () => {
  const app = load();
  const result = await app.fn({ ...input, language: "en" });
  assert.equal(result.language, "en");
  assert.equal(result.novelty, "baixa");
  assert.match(app.system(), /OUTPUT LANGUAGE: English/);
  assert.deepEqual(Array.from(result.references), output.references);
});

test("numeric PMIDs and explicit percentage confidence are normalized without adding facts", async () => {
  const r = await load("ready", {
    ...output,
    references: [123456, 123457, 123458],
    confidence: "30%",
    novelty: "low",
  }).fn(input);
  assert.equal(r.confidence, 0.3);
  assert.deepEqual(Array.from(r.references), output.references);
});
test("two distinct references can support both verified arms without an arbitrary third citation", async () => {
  const r = await load("ready", { ...output, references: ["123456", "123457"] }).fn(input);
  assert.equal(r.references.length, 2);
});
test("missing fields are identified instead of publishing an incomplete report", async () => {
  await assert.rejects(
    load("ready", { ...output, mechanism: undefined, confidence: 45 }).fn(input),
    /mechanism.*confidence/,
  );
});
