import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { citationParts } from "../src/lib/citation-parts.ts";
const require = createRequire(import.meta.url);
function component(path, dependencies = {}) {
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    exports: m.exports,
    module: m,
    require: (id) =>
      id === "@/components/LanguageProvider" || id === "./LanguageProvider"
        ? {
            useLanguage: () => ({ language: "pt" }),
            Localized: ({ value }) => React.createElement(React.Fragment, null, value),
          }
        : id === "@/lib/ui-language"
          ? { t: (v) => v, getLocale: () => "pt-BR" }
          : (dependencies[id] ?? require(id)),
  });
  return m.exports;
}
const { CitationText } = component("../src/components/CitationText.tsx", {
  "@/lib/citation-parts": { citationParts },
});
const { HypothesisReport } = component("../src/components/HypothesisReport.tsx", {
  "./CitationText": { CitationText },
  "./ui/badge": { Badge: ({ children }) => React.createElement("span", null, children) },
});
const paper = {
  pmid: "16116447",
  year: 2005,
  title: "Referência para teste de apresentação",
  abstract: "Resumo fornecido. ".repeat(10),
};
const fixture = {
  title: "Exemplo para verificação visual do relatório",
  pair: ["Conceito A", "Conceito C"],
  decision: "propose",
  confidence: 0.45,
  novelty: "alta",
  model: "Modelo de teste",
  cutoff_year: 2018,
  evidence_assessment: {
    status: "ready",
    arms: [
      { from: "Conceito A", to: "Conceito B", articles: [paper] },
      { from: "Conceito B", to: "Conceito C", articles: [paper] },
    ],
  },
  hypothesis: "Texto de demonstração da hipótese central, sem alegação científica.",
  mechanism: "O mecanismo deve explicitar as relações propostas e suas condições.",
  innovation_value: "A contribuição apresenta a lacuna científica.",
  documented_evidence: "Referência utilizada na demonstração: PMID 16116447.",
  bridge_reasoning: "A conexão reúne as ligações documentadas, sem presumir transitividade.",
  extrapolations: "Etapas ainda não demonstradas são identificadas como pressupostos.",
  context_compatibility: "Espécies, condições e escalas temporais devem ser comparadas.",
  contradictions: "Resultados divergentes e explicações alternativas são avaliados.",
  evidence_limitations: "O suporte bibliográfico não garante um mecanismo válido.",
  skeptic_critique: "A proposta pode ser rejeitada caso dependa de etapas sem suporte.",
  testable_prediction: "Uma previsão descreve o resultado que seria observado.",
  experiment: "Modelo, intervenção, controles e variáveis mensuráveis são descritos separadamente.",
  falsification: "Resultados que enfraqueceriam a hipótese são definidos antes do experimento.",
  potential_applications: "Aplicações potenciais são condicionadas à sustentação experimental.",
  next_steps: "Priorizar as evidências que resolvem as principais lacunas.",
};
const html = renderToStaticMarkup(React.createElement(HypothesisReport, { result: fixture }));
test("report has five sections in scientific reading order and preserves requested icons", () => {
  const names = [
    "Descoberta",
    "Fundamentação científica",
    "Avaliação crítica",
    "Validação experimental",
    "Impacto e perspectivas",
  ];
  let last = -1;
  for (const name of names) {
    const at = html.indexOf(`aria-label="${name}"`);
    assert.ok(at > last);
    last = at;
  }
  for (const icon of ["lightbulb", "link2", "shield-alert", "flask-conical", "earth"])
    assert.ok(html.includes(`lucide-${icon}`));
  assert.match(html, /Consistência das evidências/);
  assert.match(html, /Contradições e explicações alternativas/);
  assert.match(html, /Confiança estimada pelo agente: 45%/);
  assert.match(html, /Novidade estimada: alta/);
  assert.match(html, /1 referência fornecida ao agente/);
});
test("inline references and article titles are safe links to the source", () => {
  assert.ok(
    (html.match(/href="https:\/\/pubmed.ncbi.nlm.nih.gov\/16116447\/"/g) ?? []).length >= 3,
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  const unsafe = renderToStaticMarkup(
    React.createElement(CitationText, {
      text: "<script>bad()</script> PMID 99999999",
      pmids: ["16116447"],
    }),
  );
  assert.ok(!unsafe.includes("<script>"));
  assert.ok(!unsafe.includes("href="));
});
if (process.argv.includes("--preview"))
  writeFileSync(
    new URL("../public/__report_qa.html", import.meta.url),
    `<!doctype html><html lang="pt-BR" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module">import '/src/styles.css';</script><body><main style="max-width:850px;margin:32px auto;padding:16px">${html}</main></body></html>`,
  );
