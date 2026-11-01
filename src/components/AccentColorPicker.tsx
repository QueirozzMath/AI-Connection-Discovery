import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const families = [
  ["Cinza", "#e2e8f0", "#94a3b8", "#64748b", "#334155"],
  ["Azul", "#93c5fd", "#60a5fa", "#2563eb", "#1e40af"],
  ["Ciano", "#a5f3fc", "#5ad1e6", "#0891b2", "#086879"],
  ["Verde", "#bbf7d0", "#4ade80", "#16a34a", "#166534"],
  ["Amarelo", "#fef08a", "#facc15", "#ca8a04", "#854d0e"],
  ["Laranja", "#fed7aa", "#fb923c", "#ea580c", "#9a3412"],
  ["Vermelho", "#fecaca", "#f87171", "#dc2626", "#991b1b"],
  ["Rosa", "#fbcfe8", "#f472b6", "#db2777", "#9d174d"],
  ["Violeta", "#ddd6fe", "#a78bfa", "#7c3aed", "#5b21b6"],
];
export function AccentColorPicker() {
  const _uiLanguage = useLanguage().language;

  const { accent, setAccent } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("Escolher cor da plataforma")}
          title={t("Escolher cor da plataforma")}
          className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="size-3 rounded-full bg-primary shadow-glow" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(25rem,calc(100vw-2rem))] space-y-4"
        aria-label={t("Cores da plataforma")}
      >
        <div>
          <h2 className="text-sm font-semibold">
            <Localized value={"Cores da plataforma"} />
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <Localized
              value={
                " Escolha a cor dos textos, botões e destaques. A preferência fica salva neste navegador. "
              }
            />
          </p>
        </div>
        <div className="grid grid-cols-9 gap-1" role="group" aria-label={t("Tabela de cores")}>
          <Localized
            value={families.map(([name, ...colors]) => (
              <div key={name} className="space-y-1">
                <Localized
                  value={colors.map((color, i) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={t(`${name}, tom ${i + 1} (${color})`)}
                      aria-pressed={accent === color}
                      title={t(`${name} · ${color}`)}
                      onClick={() => setAccent(color)}
                      className="relative flex h-9 w-full items-center justify-center rounded-sm border border-foreground/20 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      style={{ backgroundColor: color }}
                    >
                      <Localized
                        value={
                          accent === color && (
                            <Check className="size-4 rounded bg-background text-foreground" />
                          )
                        }
                      />
                    </button>
                  ))}
                />
              </div>
            ))}
          />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <Localized value={" Cor personalizada "} />
          <input
            aria-label={t("Cor personalizada")}
            type="color"
            value={accent || "#5ad1e6"}
            onChange={(e) => setAccent(e.target.value)}
            className="h-11 w-16 cursor-pointer rounded border border-border"
          />
        </label>
        <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="font-mono text-muted-foreground">
            <Localized value={accent || "Cor original"} />
          </span>
          <button
            type="button"
            onClick={() => setAccent("")}
            className="min-h-9 rounded px-2 text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Localized value={" Restaurar padrão "} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
