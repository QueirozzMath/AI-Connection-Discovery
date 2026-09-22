import { computeMapLayout } from "./map-layout";
import type { ScienceGraph } from "./science-data";

self.onmessage = (event: MessageEvent<ScienceGraph>) => {
  const positions = computeMapLayout(event.data);
  self.postMessage(positions, { transfer: [positions.buffer] });
};
