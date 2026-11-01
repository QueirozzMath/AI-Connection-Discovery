import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setUiLanguage, t, type Language } from "@/lib/ui-language";
const Context = createContext<{ language: Language; setLanguage: (value: Language) => void }>({
  language: "pt",
  setLanguage: () => {},
});
export const useLanguage = () => useContext(Context);
export function Localized({ value }: { value: ReactNode }) {
  useLanguage();
  return <>{t(value)}</>;
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>("pt");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("discovery-language-v1");
      if (saved === "en") {
        setUiLanguage("en");
        setState("en");
      }
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "pt-BR";
  }, [language]);
  const setLanguage = (value: Language) => {
    setUiLanguage(value);
    setState(value);
    try {
      localStorage.setItem("discovery-language-v1", value);
    } catch {}
  };
  return <Context.Provider value={{ language, setLanguage }}>{children}</Context.Provider>;
}
