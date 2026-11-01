import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "./LanguageProvider";
import { Link } from "@tanstack/react-router";
import { BrainCircuit, Map, Sun, Moon, BookOpen } from "lucide-react";
import { PlatformGuide } from "@/components/PlatformGuide";
import { useTheme } from "@/components/ThemeProvider";

import { AccentColorPicker } from "./AccentColorPicker";

const links = [
  { to: "/", label: "Mapa", icon: Map },
  { to: "/articles", label: "Artigos", icon: BookOpen },
  { to: "/hypotheses", label: "Agentes", icon: BrainCircuit },
] as const;

export function AppNav() {
  const _uiLanguage = useLanguage().language;

  const { theme, toggle } = useTheme();
  const { language, setLanguage } = useLanguage();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-2 sm:px-4">
      <div className="flex min-w-0 items-center">
        <AccentColorPicker />
        <Link to="/" className="min-w-0 truncate">
          <span className="font-display text-xs sm:text-sm font-semibold tracking-tight">
            <Localized value={" AI Connection Discovery "} />
            <span className="hidden text-muted-foreground xl:inline">
              <Localized value={" "} />
              <Localized value={" · descoberta por literatura desconexa "} />
            </span>
          </span>
        </Link>
      </div>
      <nav className="flex shrink-0 items-center gap-1" aria-label={t("Navegação principal")}>
        <Localized
          value={links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-label={t(label)}
              data-tour={to === "/articles" ? "articles" : undefined}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary text-foreground" }}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">
                <Localized value={label} />
              </span>
            </Link>
          ))}
        />
        <button
          type="button"
          aria-label={t(language === "pt" ? "Switch to English" : "Mudar para português")}
          title={t(language === "pt" ? "Switch to English" : "Mudar para português")}
          onClick={() => setLanguage(language === "pt" ? "en" : "pt")}
          className="min-h-9 rounded-md border border-border px-2 text-xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Localized value={language === "pt" ? "EN" : "PT"} />
        </button>
        <PlatformGuide />
        <button
          type="button"
          onClick={toggle}
          aria-label={t(theme === "light" ? "Ativar tema escuro" : "Ativar tema claro")}
          title={t(theme === "light" ? "Ativar tema escuro" : "Ativar tema claro")}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-secondary"
        >
          <Localized
            value={theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          />
          <span className="hidden md:inline">
            <Localized value={theme === "light" ? "Escuro" : "Claro"} />
          </span>
        </button>
      </nav>
    </header>
  );
}
