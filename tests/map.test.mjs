import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeMapLayout } from "../src/lib/map-layout.ts";
import { mapSearchIndex, selectMapNodes, summarizeMap } from "../src/lib/map-selection.ts";

const load = (year) =>
  JSON.parse(readFileSync(new URL(`../public/data/graph-${year}.json`, import.meta.url), "utf8"));
const graph = load(2018);
const index = mapSearchIndex(graph);

test("real data: category union, search intersection, identifier, tree, reset and empty results", () => {
  assert.equal(selectMapNodes(graph, index, "", []), null);
  const categories = graph.categories.slice(0, 2).map((c) => c.id);
  const selected = selectMapNodes(graph, index, "", categories);
  assert.equal(selected.size, graph.nodes.filter((n) => categories.includes(n.cat)).length);
  for (const c of graph.categories) {
    const byCategory = selectMapNodes(graph, index, c.label, [c.id]);
    assert.equal(byCategory.size, graph.nodes.filter((n) => n.cat === c.id).length);
  }
  const first = graph.nodes[0];
  assert.ok(selectMapNodes(graph, index, first.id, []).has(0));
  assert.ok(selectMapNodes(graph, index, first.tree, [first.cat]).has(0));
  assert.equal(selectMapNodes(graph, index, first.id, ["nonexistent"]).size, 0);
  assert.equal(selectMapNodes(graph, index, "no-such-mesh-concept-xyz", []).size, 0);
});

test("summary excludes context nodes and counts only internal exported edges", () => {
  const selection = selectMapNodes(graph, index, "", ["C", "D"]);
  const summary = summarizeMap(graph, selection);
  assert.equal(summary.count, selection.size);
  assert.equal(
    summary.edges,
    graph.edges.filter(([a, b]) => selection.has(a) && selection.has(b)).length,
  );
  assert.equal(
    summary.occurrences,
    [...selection].reduce((sum, i) => sum + graph.nodes[i].pubs, 0),
  );
  assert.ok(summary.top.every((i) => selection.has(i)));
  assert.equal(summarizeMap(graph, new Set()).edges, 0);
  assert.equal(summarizeMap(graph, null).count, graph.nodes.length);
});

test("layout is deterministic, finite, does not mutate input and improves connected proximity", () => {
  const original = JSON.stringify(graph);
  const start = performance.now();
  const positions = computeMapLayout(graph);
  const elapsed = performance.now() - start;
  assert.deepEqual(computeMapLayout(graph), positions);
  assert.equal(JSON.stringify(graph), original);
  assert.equal(positions.length, graph.nodes.length * 2);
  assert.ok(positions.every(Number.isFinite));
  const strongest = [...graph.edges]
    .sort((a, b) => {
      const strength = ([i, j, w]) =>
        w / Math.sqrt(Math.max(1, graph.nodes[i].pubs * graph.nodes[j].pubs));
      return strength(b) - strength(a);
    })
    .slice(0, 5000);
  const ratio = (distance) => {
    const linked = strongest.reduce((sum, [a, b]) => sum + distance(a, b), 0) / strongest.length;
    let background = 0;
    for (let i = 0; i < graph.nodes.length; i++)
      background += distance(i, (i * 7919 + 127) % graph.nodes.length);
    return linked / (background / graph.nodes.length);
  };
  const before = ratio((a, b) =>
    Math.hypot(graph.nodes[a].x - graph.nodes[b].x, graph.nodes[a].y - graph.nodes[b].y),
  );
  const after = ratio((a, b) =>
    Math.hypot(positions[a * 2] - positions[b * 2], positions[a * 2 + 1] - positions[b * 2 + 1]),
  );
  console.log(
    JSON.stringify({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      layoutMs: Math.round(elapsed),
      connectedDistanceRatioBefore: before,
      connectedDistanceRatioAfter: after,
    }),
  );
  assert.ok(after < before, "strongly related concepts should be closer relative to the map scale");
  assert.ok(after < 0.6);
});

test("all available cutoffs produce valid coordinates", () => {
  for (const year of [2006, 2010, 2014]) {
    const data = load(year);
    const positions = computeMapLayout(data);
    assert.equal(positions.length, data.nodes.length * 2);
    assert.ok(positions.every(Number.isFinite));
  }
  assert.equal(computeMapLayout({ ...graph, nodes: [], edges: [] }).length, 0);
});
