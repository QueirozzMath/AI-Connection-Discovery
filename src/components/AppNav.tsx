import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/ui-language";
import { Localized, useLanguage } from "./LanguageProvider";
import { Link } from "@tanstack/react-router";
import {
  BrainCircuit,
  Map,
  Sun,
  Moon,
  BookOpen,
  MoreVertical,
  HelpCircle,
  Languages,
} from "lucide-react";
import { PlatformGuide } from "@/components/PlatformGuide";
import { useTheme } from "@/components/ThemeProvider";

import { AccentColorPicker } from "./AccentColorPicker";

const links = [
  { to: "/", label: "Mapa", icon: Map },
  { to: "/articles", label: "Artigos", icon: BookOpen },
  { to: "/hypotheses", label: "Agentes", icon: BrainCircuit },
] as const;

export function AppNav() {
  const [guideOpen, setGuideOpen] = useState(false);

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("Mais opções")}
              title={t("Mais opções")}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            >
              <MoreVertical className="size-5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-60 max-w-[calc(100vw-1rem)]">
            <DropdownMenuItem
              onSelect={() => setGuideOpen(true)}
              className="min-h-11 cursor-pointer gap-3 px-3"
            >
              <HelpCircle aria-hidden="true" />
              <span>{t("Guia")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={toggle}
              className="min-h-11 cursor-pointer gap-3 px-3"
              aria-label={t(theme === "light" ? "Ativar tema escuro" : "Ativar tema claro")}
            >
              {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
              <span>{t("Tema")}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {t(theme === "light" ? "Escuro" : "Claro")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setLanguage(language === "pt" ? "en" : "pt")}
              className="min-h-11 cursor-pointer gap-3 px-3"
              aria-label={language === "pt" ? "Switch to English" : "Mudar para português"}
            >
              <Languages aria-hidden="true" />
              <span>{t("Idioma")}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {language === "pt" ? "English" : "Português"}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PlatformGuide open={guideOpen} onOpenChange={setGuideOpen} hideTrigger />
      </nav>
    </header>
  );
}
