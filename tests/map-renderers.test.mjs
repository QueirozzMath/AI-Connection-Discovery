import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const graph = JSON.parse(readFileSync(new URL("../public/data/graph-2014.json", import.meta.url)));

// Exercise the real renderer functions and event handlers with a recording canvas.
// This detects runtime and filter regressions; it does not replace browser visual QA.
function mount(name, props) {
  const effects = [],
    state = [],
    refs = [],
    memos = [];
  let stateIndex = 0,
    refIndex = 0,
    memoIndex = 0,
    effectIndex = 0,
    pending = [];
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef: (current) => {
      const i = refIndex++;
      return (refs[i] ??= { current });
    },
    useMemo: (fn, deps) => {
      const i = memoIndex++;
      if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: fn() };
      return memos[i].value;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useState: (initial) => {
      const i = stateIndex++;
      if (!(i in state)) state[i] = initial;
      return [
        state[i],
        (value) => {
          state[i] = typeof value === "function" ? value(state[i]) : value;
        },
      ];
    },
    useEffect: (fn, deps) => {
      const i = effectIndex++;
      if (!effects[i] || !same(effects[i].deps, deps)) {
        effects[i] = { deps };
        pending.push(fn);
      }
    },
  };
  const arcs = [],
    labels = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "arc") return (...args) => arcs.push(args);
        if (key === "fillText") return (text) => labels.push(text);
        if (key === "clearRect")
          return () => {
            arcs.length = 0;
            labels.length = 0;
          };
        return () => {};
      },
      set: () => true,
    },
  );
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const wrap = {
    clientWidth: 1000,
    clientHeight: 700,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
  };
  const source = readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {
    exports,
    require: (id) =>
      id === "react"
        ? react
        : id === "@/lib/science-data"
          ? { catColor: () => "#ffffff" }
          : id === "@/lib/map-navigation"
            ? require("../src/lib/map-navigation.ts")
            : id === "@/lib/map-layers"
              ? require("../src/lib/map-layers.ts")
              : require(id),
    window: { devicePixelRatio: 1 },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  let selected = null;
  let currentProps = {
    graph,
    layout: "force",
    colorMode: "category",
    showEdges: true,
    selected: null,
    autoRotate: false,
    command: { action: "fit", sequence: 0 },
    onSelect: (i) => {
      selected = i;
    },
    ...props,
  };
  let element;
  const render = () => {
    stateIndex = refIndex = memoIndex = effectIndex = 0;
    pending = [];
    element = exports[name](currentProps);
    element.props.ref.current = wrap;
    element.props.children[0].props.ref.current = canvas;
    pending.forEach((fn) => fn());
  };
  render();
  return {
    get element() {
      return element;
    },
    arcs,
    labels,
    state,
    selected: () => selected,
    update: (props) => {
      currentProps = { ...currentProps, ...props };
      render();
    },
    command: (action) => {
      currentProps = {
        ...currentProps,
        command: { action, sequence: currentProps.command.sequence + 1 },
      };
      render();
    },
  };
}

for (const name of ["ScienceMap", "ScienceMap3D"]) {
  test(`${name}: toolbar controls the existing camera and preserves filtering`, () => {
    const selection = new Set(
      graph.nodes.map((n, i) => (n.cat === "C" ? i : -1)).filter((i) => i >= 0),
    );
    const map = mount(name, { matches: selection, showUnselected: false });
    const initial = map.arcs.map((arc) => [...arc]);
    map.command("zoom-in");
    assert.notDeepEqual(map.arcs, initial);
    map.command("fit");
    assert.deepEqual(map.arcs, initial);
    map.command("zoom-out");
    assert.notDeepEqual(map.arcs, initial);
    map.command("reset");
    assert.ok(map.arcs.length <= selection.size);
    map.update({ matches: new Set(), showUnselected: false });
    assert.equal(map.arcs.length, 0);
    map.command("zoom-in");
    assert.equal(map.arcs.length, 0);
  });
  test(`${name}: empty selection hides nodes, labels and stale highlights`, () => {
    const map = mount(name, {
      matches: new Set(),
      showUnselected: false,
      selected: 0,
      highlight: { a: 0, c: 1 },
    });
    assert.equal(map.arcs.length, 0);
    assert.equal(map.labels.length, 0);
  });
  test(`${name}: category selection, context, hover, click, pan and zoom`, () => {
    const selection = new Set(
      graph.nodes.map((n, i) => (n.cat === "C" ? i : -1)).filter((i) => i >= 0),
    );
    const map = mount(name, { matches: selection, showUnselected: false });
    assert.ok(map.arcs.length > 0 && map.arcs.length <= selection.size);
    assert.ok(
      map.labels.every(
        (label) =>
          [...selection].some((i) => graph.nodes[i].label === label) ||
          graph.categories.some((c) => c.label === label),
      ),
    );
    const [x, y] = map.arcs.find(([x, y]) => x > 0 && y > 0 && x < 1000 && y < 700);
    const event = { clientX: x, clientY: y, pointerId: 1, target: { setPointerCapture() {} } };
    map.element.props.onPointerMove(event);
    assert.ok(selection.has(map.state[0].i));
    map.element.props.onPointerDown(event);
    map.element.props.onPointerUp(event);
    assert.ok(selection.has(map.selected()));
    map.element.props.onWheel({ ...event, deltaY: -100 });
    map.element.props.onPointerDown(event);
    map.element.props.onPointerMove({ ...event, clientX: x + 40, clientY: y + 20 });
    map.element.props.onPointerUp({ ...event, clientX: x + 40, clientY: y + 20 });
    map.element.props.onPointerLeave();
    assert.equal(map.state[0], null);
    const context = mount(name, { matches: selection, showUnselected: true });
    assert.ok(context.arcs.length > map.arcs.length);
    const reset = mount(name, { matches: null });
    assert.ok(reset.arcs.length > 0);
  });
}

test("2D rectangle zoom reuses the camera and clears on cancellation", () => {
  const map = mount("ScienceMap", { tool: "region" });
  const initial = map.arcs.map((arc) => [...arc]);
  const event = { clientX: 250, clientY: 180, pointerId: 1, target: { setPointerCapture() {} } };
  map.element.props.onPointerDown(event);
  map.element.props.onPointerMove({ ...event, clientX: 750, clientY: 520 });
  map.update({});
  map.element.props.onPointerUp({ ...event, clientX: 750, clientY: 520 });
  assert.notDeepEqual(map.arcs, initial);
  assert.equal(map.state[1], null);
  map.element.props.onPointerDown(event);
  map.element.props.onPointerMove({ ...event, clientX: 750, clientY: 520 });
  map.element.props.onPointerCancel();
  assert.equal(map.state[1], null);
});

test("3D pan translates projected nodes without changing semantic layers", () => {
  const map = mount("ScienceMap3D", { tool: "pan" });
  const [x, y] = map.arcs[0];
  const event = { clientX: 300, clientY: 200, pointerId: 1, target: { setPointerCapture() {} } };
  map.element.props.onPointerDown(event);
  map.element.props.onPointerMove({ ...event, clientX: 340, clientY: 230 });
  assert.ok(Math.abs(map.arcs[0][0] - x - 40) < 0.001);
  assert.ok(Math.abs(map.arcs[0][1] - y - 30) < 0.001);
});
