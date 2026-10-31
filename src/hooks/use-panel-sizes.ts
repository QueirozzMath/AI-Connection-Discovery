import { useEffect, useState } from "react";
const defaults = { left: 256, right: 288, bottom: 124 };
export function usePanelSizes() {
  const [sizes, setSizes] = useState(defaults);
  const [viewport, setViewport] = useState({ width: 1305, height: 925 });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener("resize", resize);
    try {
      const p = JSON.parse(localStorage.getItem("discovery-panel-sizes") ?? "null");
      if (p)
        setSizes({
          left: Math.max(210, Math.min(430, Number(p.left) || 256)),
          right: Math.max(240, Math.min(480, Number(p.right) || 288)),
          bottom: Math.max(80, Math.min(260, Number(p.bottom) || 124)),
        });
    } catch {}
    return () => window.removeEventListener("resize", resize);
  }, []);
  const update = (next: typeof defaults) => {
    setSizes(next);
    try {
      localStorage.setItem("discovery-panel-sizes", JSON.stringify(next));
    } catch {}
  };
  // Keep a useful canvas when restoring sizes on a narrower desktop.
  const available = Math.max(450, viewport.width - 360);
  const left = Math.max(210, Math.min(sizes.left, available - 240));
  const right = Math.max(240, Math.min(sizes.right, available - left));
  const bottomLimit = Math.max(80, Math.min(260, viewport.height - 250));
  return {
    sizes: { left, right, bottom: Math.min(sizes.bottom, bottomLimit) },
    limits: {
      left: Math.min(430, available - right),
      right: Math.min(480, available - left),
      bottom: bottomLimit,
    },
    setSize: (key: keyof typeof defaults, value: number) => update({ ...sizes, [key]: value }),
    reset: () => update(defaults),
  };
}
