import test from "node:test";
import assert from "node:assert/strict";
import { evidenceIndex, planEvidence, assessArms } from "../src/lib/evidence.ts";
import { retrieveArm, validateCitations } from "../src/lib/evidence.server.ts";
const article = (id, year = 2010, terms = [0, 1]) => [id, year, "Study", terms];
const nodes = ["Alpha", "Beta", "Delta", "Omega"].map((label, i) => ({
  id: `D${i}`,
  label,
  cat: "D",
  tree: "D.1",
  deg: 0,
  pubs: 2,
}));
const graph = {
  nodes,
  edges: [
    [0, 1, 10],
    [1, 2, 9],
    [2, 3, 8],
  ],
  categories: [],
  meta: { n_articles: 1000 },
};
const corpus = {
  concepts: nodes.map((n) => [n.id, n.label, "D"]),
  articles: [
    article("101"),
    article("102"),
    article("103", 2010, [1, 2]),
    article("104", 2010, [1, 2]),
    article("105", 2010, [2, 3]),
    article("106", 2010, [2, 3]),
    article("999", 2025),
  ],
  categories: [],
};
const pair = { a: "Alpha", c: "Omega", intermediaries: [] };
test("local eligibility respects cutoff and distinct PMIDs", () => {
  const index = evidenceIndex(corpus, 2014);
  assert.deepEqual(index.arm("D0", "D1"), ["101", "102"]);
  assert.equal(planEvidence(pair, graph, index).length, 0);
  const plans = planEvidence(pair, graph, index, undefined, 4);
  assert.equal(plans[0].nodes.length, 4);
  assert.equal(plans[0].arms.length, 3);
  assert.ok(!plans[0].arms.flat().includes("999"));
});
test("rejects generic bridges and insufficient per-arm support", () => {
  const generic = {
    ...graph,
    nodes: nodes.map((n, i) => (i === 1 ? { ...n, label: "Humans" } : n)),
  };
  assert.equal(planEvidence(pair, generic, evidenceIndex(corpus, 2014), undefined, 4).length, 0);
  const sparse = { ...corpus, articles: corpus.articles.filter((a) => a[0] !== "104") };
  assert.equal(planEvidence(pair, graph, evidenceIndex(sparse, 2014), undefined, 4).length, 0);
});
const paper = (pmid, year = 2010) => ({ pmid, year, title: "Title", abstract: "A".repeat(100) });
const arm = (ids) => ({
  from: "A",
  to: "B",
  articles: ids.map((id) => paper(id)),
  method: "MeSH",
  failed: false,
  error: null,
});
test("bibliographic gate needs abstracts and diversity, not raw co-occurrence counts", () => {
  assert.equal(assessArms([arm(["1", "2"]), arm(["3", "4"])], "now").status, "ready");
  assert.equal(assessArms([arm(["1", "2"]), arm(["1", "2"])], "now").status, "pending");
  assert.equal(assessArms([arm(["1", "1"]), arm(["3", "4"])], "now").status, "pending");
  assert.equal(
    assessArms([arm(["1", "2"]), arm(["3", "4"]), arm(["5", "6"])], "now").status,
    "expanded",
  );
  const titles = arm(["1", "2"]);
  titles.articles.forEach((a) => (a.abstract = ""));
  assert.equal(assessArms([titles, arm(["3", "4"])], "now").status, "pending");
  const outage = { ...titles, failed: true };
  assert.match(assessArms([outage, arm(["3", "4"])], "now").reason, /indisponível/);
});
test("local PMID hints are independently validated; future or unrelated records are excluded", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("esearch")) return Response.json({ esearchresult: { idlist: [] } });
    return new Response(
      `<PubmedArticleSet>${["123456", "123457", "999999"].map((id, i) => `<PubmedArticle><PMID>${id}</PMID><PubDate><Year>${i === 2 ? 2025 : 2010}</Year></PubDate><ArticleTitle>Study</ArticleTitle><Abstract>${"Evidence ".repeat(20)}</Abstract><DescriptorName UI="D100">Alpha</DescriptorName><DescriptorName UI="${i === 1 ? "D999" : "D200"}">${i === 1 ? "Other" : "Beta"}</DescriptorName></PubmedArticle>`).join("")}</PubmedArticleSet>`,
    );
  });
  const result = await retrieveArm(
    { id: "D100", label: "Alpha", aliases: [] },
    { id: "D200", label: "Beta", aliases: [] },
    2014,
    ["123456", "123457", "999999"],
  );
  assert.deepEqual(
    result.articles.map((a) => a.pmid),
    ["123456"],
  );
  assert.equal(result.failed, false);
});
test("network outage remains distinct from an empty PubMed search", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("offline");
  });
  const r = await retrieveArm(
    { id: "DA", label: "A failure", aliases: [] },
    { id: "DB", label: "B failure", aliases: [] },
    2011,
    [],
  );
  assert.equal(r.failed, true);
  assert.ok(r.error);
  assert.deepEqual(r.articles, []);
});
test("citations cannot introduce unprovided PMIDs; numerical measurements are allowed", () => {
  assert.throws(
    () => validateCitations({ text: "PMID 123456" }, new Set(["654321"])),
    /identificador/,
  );
  assert.doesNotThrow(() =>
    validateCitations({ text: "1000000 cells; PMID 123456" }, new Set(["123456"])),
  );
});

test("four-link exploration supports every edge and retains each reference group", () => {
  const fifth = { id: "D4", label: "Endpoint", deg: 0, pubs: 2, cat: "D", tree: "D.1" };
  const extendedGraph = { ...graph, nodes: [...nodes, fifth], edges: [...graph.edges, [3, 4, 7]] };
  const extendedCorpus = {
    ...corpus,
    concepts: [...corpus.concepts, ["D4", "Endpoint", "D"]],
    articles: [...corpus.articles, article("107", 2010, [3, 4]), article("108", 2010, [3, 4])],
  };
  const paths = planEvidence(
    { ...pair, c: "Endpoint" },
    extendedGraph,
    evidenceIndex(extendedCorpus, 2014),
    undefined,
    4,
  );
  assert.equal(paths[0].nodes.length, 5);
  assert.equal(paths[0].arms.length, 4);
  assert.equal(
    planEvidence(
      { ...pair, c: "Endpoint" },
      extendedGraph,
      evidenceIndex(extendedCorpus, 2014),
      undefined,
      2,
    ).length,
    0,
  );
});

test("fallback expands MeSH queries with aliases without removing the temporal cut", async (t) => {
  const queries = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("esearch")) {
      queries.push(new URL(url).searchParams.get("term"));
      return Response.json({ esearchresult: { idlist: [] } });
    }
    throw Error("unexpected fetch");
  });
  const r = await retrieveArm(
    { id: "D88", label: "Photo A", aliases: ["Alias A"] },
    { id: "D89", label: "Photo B", aliases: ["Alias B"] },
    2017,
    [],
  );
  assert.equal(r.failed, false);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /MeSH Terms/);
  assert.match(queries[1], /Alias A/);
  assert.ok(queries.every((q) => q.includes("2017") && q.includes("[dp]")));
});
