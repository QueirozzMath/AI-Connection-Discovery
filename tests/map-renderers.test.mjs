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
    state = [];
  let stateIndex = 0;
  const react = {
    useRef: (current) => ({ current }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useState: (initial) => {
      const i = stateIndex++;
      state[i] = initial;
      return [
        initial,
        (value) => {
          state[i] = typeof value === "function" ? value(state[i]) : value;
        },
      ];
    },
    useEffect: (fn) => effects.push(fn),
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
          : require(id),
    window: { devicePixelRatio: 1 },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  let selected = null;
  const element = exports[name]({
    graph,
    layout: "force",
    colorMode: "category",
    showEdges: true,
    selected: null,
    autoRotate: false,
    onSelect: (i) => {
      selected = i;
    },
    ...props,
  });
  element.props.ref.current = wrap;
  element.props.children[0].props.ref.current = canvas;
  effects.forEach((fn) => fn());
  return { element, arcs, labels, state, selected: () => selected };
}

for (const name of ["ScienceMap", "ScienceMap3D"]) {
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
      map.labels.every((label) => [...selection].some((i) => graph.nodes[i].label === label)),
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
