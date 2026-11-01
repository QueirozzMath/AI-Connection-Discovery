import english from "./ui-en.json" with { type: "json" };
export type Language = "pt" | "en";
let current: Language = "pt";
export const getLanguage = () => current;
export const getLocale = () => (current === "en" ? "en-US" : "pt-BR");
export function setUiLanguage(language: Language) {
  current = language;
}
const table: Record<string, string> = english;
const templates = Object.entries(table)
  .filter(([k]) => k.includes("{0}"))
  .map(([source, target]) => ({
    regex: new RegExp(
      "^" +
        source
          .split(/(\{\d+\})/)
          .map((p) => (/^\{\d+\}$/.test(p) ? "(.+?)" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("") +
        "$",
    ),
    target,
  }));
export function translate<T>(value: T): T {
  if (current === "pt" || typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  let text = table[normalized];
  if (!text)
    for (const entry of templates) {
      const match = normalized.match(entry.regex);
      if (match) {
        text = entry.target.replace(/\{(\d+)\}/g, (_, i) => translate(match[Number(i) + 1] ?? ""));
        break;
      }
    }
  if (!text) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return (leading + text + trailing) as T;
}
export const t = translate;
