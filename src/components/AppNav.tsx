import { Link } from "@tanstack/react-router";
import { Activity, BrainCircuit, Map } from "lucide-react";

const links = [
  { to: "/", label: "Mapa", icon: Map },
  { to: "/metrics", label: "Validação", icon: Activity },
  { to: "/hypotheses", label: "Agentes", icon: BrainCircuit },
] as const;

export function AppNav() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4">
      <Link to="/" className="flex items-center gap-2">
        <span className="inline-block size-2.5 rounded-full bg-primary shadow-glow" />
        <span className="font-display text-sm font-semibold tracking-tight">
          MeSHMap<span className="text-muted-foreground"> · descoberta por literatura desconexa</span>
        </span>
      </Link>
      <nav className="flex items-center gap-1">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            activeProps={{ className: "bg-secondary text-foreground" }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
