import { useEffect, useState } from "react";
import type { ScienceGraph } from "@/lib/science-data";

const cache = new WeakMap<ScienceGraph, Float32Array>();

export function useMapLayout(graph: ScienceGraph) {
  const [positions, setPositions] = useState<Float32Array | undefined>(() => cache.get(graph));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const cached = cache.get(graph);
    setPositions(cached);
    setFailed(false);
    if (cached) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/map-layout.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<Float32Array>) => {
        cache.set(graph, event.data);
        setPositions(event.data);
        worker.terminate();
      };
      worker.onerror = () => {
        setFailed(true);
        worker.terminate();
      };
      worker.postMessage(graph);
    } catch {
      setFailed(true);
    }
    return () => worker?.terminate();
  }, [graph]);
  return { positions, layoutPending: !positions && !failed, layoutFailed: failed };
}
