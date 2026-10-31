import { Link } from "@tanstack/react-router";
import { BrainCircuit, Map, Sun, Moon } from "lucide-react";
import { PlatformGuide } from "@/components/PlatformGuide";
import { useTheme } from "@/components/ThemeProvider";

const links = [
  { to: "/", label: "Mapa", icon: Map },
  { to: "/hypotheses", label: "Agentes", icon: BrainCircuit },
] as const;

export function AppNav() {
  const { theme, toggle } = useTheme();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4">
      <Link to="/" className="flex min-w-0 items-center gap-2">
        <span className="inline-block size-2.5 shrink-0 rounded-full bg-primary shadow-glow" />
        <span className="font-display text-sm font-semibold tracking-tight">
          AI Connection Discovery
          <span className="hidden text-muted-foreground xl:inline">
            {" "}
            · descoberta por literatura desconexa
          </span>
        </span>
      </Link>
      <nav className="flex shrink-0 items-center gap-1" aria-label="Navegação principal">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            activeOptions={{ exact: to === "/" }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            activeProps={{ className: "bg-secondary text-foreground" }}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
        <PlatformGuide />
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
          title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-secondary"
        >
          {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span className="hidden md:inline">{theme === "light" ? "Escuro" : "Claro"}</span>
        </button>
      </nav>
    </header>
  );
}
