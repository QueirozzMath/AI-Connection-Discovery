import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import vm from "node:vm";

const output = ts.transpileModule(readFileSync("src/lib/discovery.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports });
const { discover, buildAdjacency } = exports;
const corpus = JSON.parse(gunzipSync(readFileSync("public/data/corpus.json.gz")));
const firstYears = new Map();
for (const article of corpus.articles) {
  const ids = [...new Set(article[3].map((index) => corpus.concepts[index][0]))].sort();
  for (let a = 0; a < ids.length; a++)
    for (let c = a + 1; c < ids.length; c++) {
      const key = ids[a] + "|" + ids[c];
      firstYears.set(key, Math.min(firstYears.get(key) ?? Infinity, article[1]));
    }
}
const index = JSON.parse(readFileSync("public/data/index.json"));
const requestedYears = process.argv.slice(2).map(Number);
for (const year of requestedYears.length ? requestedYears : index.cutoffs) {
  const published = [2006, 2010, 2014, 2018].includes(year);
  const path = published
    ? `public/data/candidates-${year}.json`
    : `public/data/annual/${year}.json.gz`;
  const bundle = published ? null : JSON.parse(gunzipSync(readFileSync(path)));
  const graph = published
    ? JSON.parse(readFileSync(`public/data/graph-${year}.json`))
    : bundle.graph;
  const pairs = discover(graph, buildAdjacency(graph), {
    mode: "global",
    sampleNodes: 200,
    randomSeed: year,
    limit: 300,
  });
  const items = pairs
    .map((pair, rank) => {
      const a = graph.nodes[pair.a],
        c = graph.nodes[pair.c];
      const first = firstYears.get([a.id, c.id].sort().join("|")) ?? null;
      return {
        rank: rank + 1,
        a: a.label,
        c: c.label,
        a_ui: a.id,
        c_ui: c.id,
        prob: pair.prob,
        priority: pair.priority,
        bridgeSpecificity: pair.bridgeSpecificity,
        selection_method: "swanson-rare-bridges-v1",
        confirmed: first != null && first > year,
        first_year: first,
        lead_time_years: first != null && first > year ? first - year : null,
        intermediaries: pair.bridges.map((b) => graph.nodes[b].label),
        features: Object.fromEntries(graph.features.map((name, i) => [name, pair.features[i]])),
      };
    })
    .filter((pair) => pair.first_year == null || pair.first_year > year)
    .map((pair, rank) => ({ ...pair, rank: rank + 1 }));
  const candidates = { cutoff_year: year, selection_method: "swanson-rare-bridges-v1", items };
  if (published) writeFileSync(path, JSON.stringify(candidates));
  else {
    bundle.candidates = candidates;
    writeFileSync(path, gzipSync(JSON.stringify(bundle)));
  }
  console.log(JSON.stringify({ year, pairs: items.length, top: items[0]?.intermediaries }));
}
