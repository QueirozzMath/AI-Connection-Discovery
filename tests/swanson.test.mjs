import test from "node:test";
import assert from "node:assert/strict";
import { buildAdjacency, scorePair, discover } from "../src/lib/discovery.ts";

function fixture() {
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    id: "D" + i,
    label: "Specific molecule " + i,
    cat: i === 1 ? "C" : "D",
    tree: i === 1 ? "C01.100" : "D01.100",
    deg: 2,
    pubs: 200,
    growth: 0,
  }));
  nodes[3].label = "Humans";
  return {
    meta: { n_articles: 10000 },
    nodes,
    features: [],
    model: {
      mean: Array(14).fill(0),
      std: Array(14).fill(1),
      coef: Array(14).fill(0),
      intercept: 0,
    },
    edges: [
      [0, 2, 4],
      [1, 2, 4],
      [4, 3, 30],
      [5, 3, 30],
      [0, 6, 100],
      [1, 7, 100],
    ],
  };
}
test("a single specific A–B–C bridge qualifies; a generic hub cannot qualify", () => {
  const graph = fixture(),
    adj = buildAdjacency(graph);
  const pair = scorePair(graph, adj, 0, 1);
  assert.ok(pair && pair.priority > 0);
  assert.deepEqual(pair.bridges, [2]);
  assert.equal(scorePair(graph, adj, 4, 5), null);
});
test("directly observed A–C is excluded and missing growth does not erase a valid bridge", () => {
  const graph = fixture();
  graph.nodes[0].growthAvailable = false;
  assert.ok(scorePair(graph, buildAdjacency(graph), 0, 1));
  graph.edges.push([0, 1, 1]);
  assert.equal(scorePair(graph, buildAdjacency(graph), 0, 1), null);
});
test("filtering does not disguise global hubs as rare intermediaries", () => {
  const graph = fixture();
  graph.nodes[2].deg = 35;
  assert.equal(scorePair(graph, buildAdjacency(graph), 0, 1), null);
});
test("Swanson priority rewards evidence in both arms and is deterministic", () => {
  const graph = fixture(),
    adj = buildAdjacency(graph);
  const weak = scorePair(graph, adj, 0, 1);
  graph.edges[0][2] = graph.edges[1][2] = 8;
  const strong = scorePair(graph, buildAdjacency(graph), 0, 1);
  assert.ok(strong.priority > weak.priority);
  const opts = { mode: "seeded", seeds: [0], limit: 10 };
  assert.deepEqual(
    discover(graph, buildAdjacency(graph), opts),
    discover(graph, buildAdjacency(graph), opts),
  );
});
