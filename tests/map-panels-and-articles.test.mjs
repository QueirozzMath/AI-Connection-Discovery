import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { keywordSuggestions } from "../src/lib/keyword-search.ts";
import { bundledArticles } from "../src/lib/bundled-articles.ts";
import { articleNetwork } from "../src/lib/article-network.ts";

const require = createRequire(import.meta.url);
const graph = JSON.parse(readFileSync(new URL("../public/data/graph-2014.json", import.meta.url)));
const compressed = readFileSync(new URL("../public/data/corpus.json.gz", import.meta.url));
const corpus = JSON.parse(gunzipSync(compressed));

test("term search supports MeSH ID, neutral free text, and excludes selected terms", () => {
  const node = graph.nodes[0];
  const exact = keywordSuggestions(graph.nodes, node.id, []);
  assert.equal(exact[0].node.id, node.id);
  assert.equal(keywordSuggestions(graph.nodes, node.id, [0]).length, 0);
  assert.equal(keywordSuggestions(graph.nodes, node.id, [], new Set([1])).length, 0);
  assert.equal(keywordSuggestions(graph.nodes, "", []).length, 0);
  assert.equal(keywordSuggestions(graph.nodes, "impossible-not-a-concept", []).length, 0);
  const terms = keywordSuggestions(graph.nodes, "human", []);
  assert.ok(terms.length && terms.every((x) => x.node.label.toLowerCase().includes("human")));
});

test("published corpus articles respect period, MeSH scope, pagination and empty selections", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/data/corpus.json.gz");
    return new Response(compressed);
  });
  const id = graph.nodes[0].id;
  const input = { start: 1985, end: 2014, meshIds: [id] };
  const expected = corpus.articles.filter((a) => a[1] >= input.start && a[1] <= input.end && a[3].some((i) => corpus.concepts[i][0] === id));
  const result = await bundledArticles(input);
  assert.equal(result.total, expected.length);
  assert.ok(result.total > 50);
  assert.ok(result.items.every((a) => a.year <= 2014 && a.year >= 1985 && a.mesh.some((m) => m.id === id)));
  assert.equal(result.years.reduce((total, p) => total + p.count, 0), result.total);
  const second = await bundledArticles({ ...input, cursor: result.next });
  assert.ok(second.items.every((a) => !result.items.some((b) => b.pmid === a.pmid)));
  assert.equal((await bundledArticles({ ...input, meshIds: [] })).total, 0);
  await assert.rejects(bundledArticles({ ...input, cursor: "invalid" }), /Página inválida/);
  await assert.rejects(bundledArticles({ ...input, start: 2015 }), /Período inválido/);
  const network = articleNetwork(result.items.slice(0, 10));
  assert.ok(network.links.length > 0);
  assert.equal(new Set(network.mesh.map((m) => m.id)).size, network.mesh.length);
  for (const [a, b] of network.links) {
    assert.ok(result.items[a].mesh.some((m) => m.id === network.mesh[b - 10].id));
  }
  assert.ok([...network.positions].every(Number.isFinite));
});

function handle(props) {
  const source = readFileSync(new URL("../src/components/ResizeHandle.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (id) => id === "react" ? { useRef: () => ({ current: null }) } : require(id) });
  return exports.ResizeHandle(props).props;
}

for (const [axis, reverse] of [["x", false], ["x", true], ["y", true]]) {
  test(`panel separator ${axis}, reverse=${reverse}: pointer, clamping, keyboard and cancellation`, () => {
    let value = 200;
    const props = handle({ axis, reverse, value, min: 100, max: 300, onChange: (v) => { value = v; }, label: "Resize" });
    const event = { clientX: 100, clientY: 100, pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
    props.onPointerDown(event);
    props.onPointerMove({ ...event, clientX: 150, clientY: 150 });
    assert.equal(value, reverse ? 150 : 250);
    props.onPointerMove({ ...event, clientX: 1100, clientY: 1100 });
    assert.equal(value, reverse ? 100 : 300);
    props.onPointerCancel();
    props.onPointerMove(event);
    assert.equal(value, reverse ? 100 : 300);
    props.onKeyDown({ key: axis === "x" ? "ArrowRight" : "ArrowDown", preventDefault() {} });
    assert.equal(value, reverse ? 190 : 210);
  });
}

test("article–MeSH UI uses distinct selectable points and highlights the selected article", () => {
  const source = readFileSync(new URL("../src/components/MapArticles.tsx", import.meta.url), "utf8") + "\nexport { ArticleMeshNetwork };";
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, state = [], effects = [];
  let index = 0, effectIndex = 0;
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in state)) state[i] = initial;
      return [state[i], (value) => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
    },
    useMemo(fn) { return fn(); },
    useEffect(fn, dependencies) {
      const i = effectIndex++;
      if (!effects[i] || dependencies.some((d, j) => d !== effects[i][j])) { fn(); effects[i] = dependencies; }
    },
  };
  vm.runInNewContext(js, { exports, require: (id) => id === "react" ? react : id === "@/lib/article-network" ? { articleNetwork } : id === "@tanstack/react-query" ? {} : id === "@/lib/map-api.functions" ? {} : id === "@/lib/science-data" ? { catColor: () => "#abc", num: String } : require(id) });
  const articles = [{ pmid: "1", year: 2014, title: "First", mesh: [{ id: "A", label: "Alpha", category: "C", major: 0 }] }, { pmid: "2", year: 2013, title: "Second", mesh: [{ id: "A", label: "Alpha", category: "C", major: 0 }, { id: "B", label: "Beta", category: "D", major: 0 }] }];
  function render() { index = effectIndex = 0; return exports.ArticleMeshNetwork({ articles }); }
  function flatten(element) {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(flatten);
    return [element, ...flatten(element.props?.children)];
  }
  render();
  let elements = flatten(render());
  const terms = elements.filter((e) => e.props?.role === "button" && e.props["aria-label"]?.startsWith("Termo MeSH"));
  assert.equal(terms.length, 2);
  assert.ok(terms.every((e) => typeof e.props.onClick === "function" && e.props.tabIndex === 0));
  const points = elements.filter((e) => e.props?.role === "button" && e.props["aria-label"]?.startsWith("Artigo"));
  points[0].props.onClick();
  elements = flatten(render());
  assert.equal(elements.find((e) => e.type === "line" && e.key === "1:2").props.opacity, 0.035);
  assert.ok(elements.some((e) => e.props?.children === "Mostrar todos os títulos desta rede"));
  const beta = elements.find((e) => e.props?.["aria-label"] === "Termo MeSH: Beta, 1 artigos visíveis");
  beta.props.onKeyDown({ key: "Enter", preventDefault() {} });
  elements = flatten(render());
  assert.ok(elements.some((e) => e.props?.children === "Explorar artigos deste termo"));
});
