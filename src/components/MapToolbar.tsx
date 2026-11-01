import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import {
  Camera,
  Plus,
  Minus,
  Move,
  Scan,
  RotateCcw,
  BoxSelect,
  Rotate3d,
  Box,
  Layers2,
} from "lucide-react";
import type { MapAction, MapTool } from "@/lib/map-navigation";

export function MapToolbar({
  mode3d,
  onToggleDimension,
  tool,
  onTool,
  onAction,
}: {
  mode3d: boolean;
  onToggleDimension: () => void;
  tool: MapTool;
  onTool: (tool: MapTool) => void;
  onAction: (action: MapAction) => void;
}) {
  const _uiLanguage = useLanguage().language;

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
      aria-label={t("Navegação do mapa")}
      className="absolute right-3 top-3 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover/95 p-1 shadow-panel"
    >
      <button
        type="button"
        aria-label={t(mode3d ? "Alternar para grafo 2D" : "Alternar para grafo 3D")}
        title={t(
          mode3d
            ? "Voltar à representação bidimensional"
            : "Explorar representação tridimensional: arraste para girar",
        )}
        aria-pressed={mode3d}
        onClick={onToggleDimension}
        className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Localized value={mode3d ? <Layers2 className="size-4" /> : <Box className="size-4" />} />
        <Localized value={mode3d ? "Ver em 2D" : "Ver em 3D"} />
      </button>
      <Localized
        value={actions.map(({ action, label, Icon }) => (
          <button
            key={action}
            type="button"
            title={t(label)}
            aria-label={t(label)}
            className="rounded p-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => onAction(action)}
          >
            <Icon className="size-4" />
          </button>
        ))}
      />
      <button
        type="button"
        title={t(mode3d ? "Rotacionar" : "Navegar")}
        aria-label={t(mode3d ? "Rotacionar" : "Navegar")}
        aria-pressed={tool === "navigate"}
        className="rounded p-2 aria-pressed:bg-primary/25"
        onClick={() => onTool("navigate")}
      >
        <Localized value={mode3d ? <Rotate3d className="size-4" /> : <Move className="size-4" />} />
      </button>
      <Localized
        value={
          mode3d && (
            <button
              type="button"
              title={t("Deslocar câmera")}
              aria-label={t("Deslocar câmera")}
              aria-pressed={tool === "pan"}
              className="rounded p-2 aria-pressed:bg-primary/25"
              onClick={() => onTool("pan")}
            >
              <Move className="size-4" />
            </button>
          )
        }
      />
      <Localized
        value={
          !mode3d && (
            <button
              type="button"
              title={t("Zoom por região: arraste um retângulo")}
              aria-label={t("Zoom por região")}
              aria-pressed={tool === "region"}
              className="rounded p-2 aria-pressed:bg-primary/25"
              onClick={() => onTool("region")}
            >
              <BoxSelect className="size-4" />
            </button>
          )
        }
      />
    </div>
  );
}
