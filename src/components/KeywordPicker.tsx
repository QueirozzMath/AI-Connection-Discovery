import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { useMemo, useState } from "react";
import { keywordSuggestions } from "@/lib/keyword-search";
import type { GraphNode } from "@/lib/science-data";
import { Input } from "./ui/input";

export function KeywordPicker({
  nodes,
  selected,
  allowed,
  onPick,
}: {
  nodes: GraphNode[];
  selected: number[];
  allowed: Set<number> | null;
  onPick: (index: number) => void;
}) {
  const _uiLanguage = useLanguage().language;

  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const items = useMemo(
    () => keywordSuggestions(nodes, text, selected, allowed),
    [nodes, text, selected, allowed],
  );
  const choose = (index: number) => {
    onPick(index);
    setText("");
    setActive(0);
  };
  return (
    <div className="space-y-2">
      <label htmlFor="keyword-search" className="block text-xs font-medium">
        <Localized value={" Adicionar termo-chave "} />
      </label>
      <Input
        id="keyword-search"
        placeholder={t("Digite um conceito ou MeSH ID")}
        aria-label={t("Pesquisar termo-chave")}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) =>
              Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))),
            );
          }
          if (event.key === "Enter" && items[active]) {
            event.preventDefault();
            choose(items[active]!.i);
          }
          if (event.key === "Escape") {
            setText("");
            setActive(0);
          }
        }}
      />
      <Localized
        value={
          text.trim() && (
            <div
              className="max-h-56 overflow-y-auto rounded border border-border bg-background"
              aria-live="polite"
            >
              <Localized
                value={
                  !items.length && (
                    <p className="p-2 text-xs">
                      <Localized value={"Nenhum termo disponível para adicionar neste recorte."} />
                    </p>
                  )
                }
              />
              <Localized
                value={items.map(({ node, i }, index) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`block w-full border-b border-border p-2 text-left text-xs hover:bg-secondary focus-visible:bg-secondary ${index === active ? "bg-secondary" : ""}`}
                    onClick={() => choose(i)}
                  >
                    <span className="block font-medium">
                      <Localized value={node.label} />
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      <Localized value={node.id} />
                      <Localized value={" · "} />
                      <Localized value={node.pubs.toLocaleString(getLocale())} />
                      <Localized value={" artigos "} />
                    </span>
                  </button>
                ))}
              />
            </div>
          )
        }
      />
      <p className="text-[11px] text-muted-foreground">
        <Localized
          value={" Pesquise e selecione conceitos do recorte atual para explorar suas conexões. "}
        />
      </p>
    </div>
  );
}
