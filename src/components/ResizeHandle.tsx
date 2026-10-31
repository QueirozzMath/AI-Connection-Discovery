import { useRef } from "react";
export function ResizeHandle({
  axis,
  value,
  min,
  max,
  onChange,
  label,
  reverse = false,
}: {
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  reverse?: boolean;
}) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  return (
    <button
      type="button"
      role="separator"
      aria-label={label}
      title={label + " · arraste ou use as setas"}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={
        axis === "x"
          ? "absolute inset-y-0 right-0 z-30 hidden w-2 touch-none cursor-ew-resize bg-border/30 hover:bg-primary/60 focus-visible:bg-primary lg:block"
          : "absolute inset-x-0 top-0 z-30 h-2 touch-none cursor-ns-resize bg-border/30 hover:bg-primary/60 focus-visible:bg-primary"
      }
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: axis === "x" ? e.clientX : e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          const delta =
            ((axis === "x" ? e.clientX : e.clientY) - drag.current.start) * (reverse ? -1 : 1);
          onChange(Math.max(min, Math.min(max, drag.current.value + delta)));
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const delta =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 10
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? -10
              : 0;
        if (delta) {
          e.preventDefault();
          onChange(Math.max(min, Math.min(max, value + delta * (reverse ? -1 : 1))));
        }
      }}
    />
  );
}
