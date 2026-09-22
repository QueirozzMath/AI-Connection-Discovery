import { Camera, Plus, Minus, Move, Scan, RotateCcw, BoxSelect, Rotate3d } from "lucide-react";
import type { MapAction, MapTool } from "@/lib/map-navigation";

export function MapToolbar({
  mode3d,
  tool,
  onTool,
  onAction,
}: {
  mode3d: boolean;
  tool: MapTool;
  onTool: (tool: MapTool) => void;
  onAction: (action: MapAction) => void;
}) {
  const actions = [
    { action: "export", label: "Exportar visualização PNG", Icon: Camera },
    { action: "zoom-in", label: "Aproximar", Icon: Plus },
    { action: "zoom-out", label: "Afastar", Icon: Minus },
    { action: "fit", label: "Enquadrar resultados", Icon: Scan },
    { action: "reset", label: "Restaurar câmera global", Icon: RotateCcw },
  ] as const;
  return (
    <div
      role="toolbar"
      aria-label="Navegação do mapa"
      className="absolute right-3 top-3 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover/95 p-1 shadow-panel"
    >
      {actions.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={label}
          className="rounded p-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => onAction(action)}
        >
          <Icon className="size-4" />
        </button>
      ))}
      <button
        type="button"
        title={mode3d ? "Rotacionar" : "Navegar"}
        aria-label={mode3d ? "Rotacionar" : "Navegar"}
        aria-pressed={tool === "navigate"}
        className="rounded p-2 aria-pressed:bg-primary/25"
        onClick={() => onTool("navigate")}
      >
        {mode3d ? <Rotate3d className="size-4" /> : <Move className="size-4" />}
      </button>
      {mode3d && (
        <button
          type="button"
          title="Deslocar câmera"
          aria-label="Deslocar câmera"
          aria-pressed={tool === "pan"}
          className="rounded p-2 aria-pressed:bg-primary/25"
          onClick={() => onTool("pan")}
        >
          <Move className="size-4" />
        </button>
      )}
      {!mode3d && (
        <button
          type="button"
          title="Zoom por região: arraste um retângulo"
          aria-label="Zoom por região"
          aria-pressed={tool === "region"}
          className="rounded p-2 aria-pressed:bg-primary/25"
          onClick={() => onTool("region")}
        >
          <BoxSelect className="size-4" />
        </button>
      )}
    </div>
  );
}
