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
        Adicionar termo-chave
      </label>
      <Input
        id="keyword-search"
        placeholder="Digite um conceito ou MeSH ID"
        aria-label="Pesquisar termo-chave"
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
      {text.trim() && (
        <div
          className="max-h-56 overflow-y-auto rounded border border-border bg-background"
          aria-live="polite"
        >
          {!items.length && (
            <p className="p-2 text-xs">Nenhum termo disponível para adicionar neste recorte.</p>
          )}
          {items.map(({ node, i }, index) => (
            <button
              key={node.id}
              type="button"
              className={`block w-full border-b border-border p-2 text-left text-xs hover:bg-secondary focus-visible:bg-secondary ${index === active ? "bg-secondary" : ""}`}
              onClick={() => choose(i)}
            >
              <span className="block font-medium">{node.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {node.id} · {node.pubs.toLocaleString("pt-BR")} artigos
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Pesquise e selecione conceitos do recorte atual para explorar suas conexões.
      </p>
    </div>
  );
}
