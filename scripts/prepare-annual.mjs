import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(`src/lib/${name}.ts`, "utf8").replace(
    /import\.meta\.url/g,
    '"file:///unused"',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  modules.set(name, exports);
  vm.runInNewContext(output, {
    exports,
    require: (id) => load(id.replace("./", "")),
    fetch: async (path) => new Response(readFileSync(`public${path}`)),
    Response,
    Uint8Array,
    DecompressionStream,
    setTimeout,
    console,
  });
  return exports;
}
mkdirSync("public/data/annual", { recursive: true });
const { buildDynamicBundle } = load("dynamic-cutoff");
const requested = process.argv.slice(2).map(Number);
const years = requested.length
  ? requested
  : JSON.parse(readFileSync("public/data/index.json")).cutoffs;
for (const year of years) {
  if ([2006, 2010, 2014, 2018].includes(year)) continue;
  const started = Date.now();
  const bundle = await buildDynamicBundle(year);
  writeFileSync(`public/data/annual/${year}.json.gz`, gzipSync(JSON.stringify(bundle)));
  console.log(
    JSON.stringify({
      year,
      ms: Date.now() - started,
      nodes: bundle.graph.nodes.length,
      pairs: bundle.candidates.items.length,
    }),
  );
}
