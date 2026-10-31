import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext({
  theme: "dark" as Theme,
  toggle: () => {},
  accent: "",
  setAccent: (_color: string) => {},
});
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, updateAccent] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ia-discovery-accent-v1");
      if (saved && /^#[0-9a-f]{6}$/i.test(saved)) updateAccent(saved);
    } catch {}
  }, []);
  const setAccent = (color: string) => {
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return;
    updateAccent(color);
    try {
      if (color) localStorage.setItem("ia-discovery-accent-v1", color);
      else localStorage.removeItem("ia-discovery-accent-v1");
    } catch {}
  };
  useEffect(() => {
    const root = document.documentElement;
    const tokens = [
      "--primary",
      "--primary-foreground",
      "--ring",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-ring",
      "--chart-1",
    ];
    if (!accent) {
      tokens.forEach((token) => root.style.removeProperty(token));
      return;
    }
    const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    const luminance = rgb
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    tokens.forEach((token) =>
      root.style.setProperty(
        token,
        token.includes("foreground") ? (luminance > 0.179 ? "#101820" : "#ffffff") : accent,
      ),
    );
  }, [accent]);
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("ia-discovery-theme", next);
    } catch {
      // Theme switching also works when browser storage is unavailable.
    }
    setTheme(next);
  };
  return (
    <ThemeContext.Provider value={{ theme, toggle, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}
