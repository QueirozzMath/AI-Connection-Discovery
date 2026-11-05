import { useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { neuricoIdea } from "@/lib/neurico";
import type { HypothesisResult } from "@/lib/hypothesis.functions";
import { CitationText } from "./CitationText";
export function NeuricoPanel({
  result,
  onUpdate,
}: {
  result: HypothesisResult;
  onUpdate?: ((result: HypothesisResult) => void) | undefined;
}) {
  const en = useLanguage().language === "en";
  const [error, setError] = useState("");
  const download = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([neuricoIdea(result)], { type: "application/yaml" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "neurico-idea.yaml";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const pmids = result.evidence_assessment.arms.flatMap((a) => a.articles.map((p) => p.pmid));
  return (
    <section
      className="panel p-5 sm:p-6"
      aria-label={en ? "NeuriCo investigation" : "Investigação com NeuriCo"}
    >
      <h3 className="font-display text-lg font-semibold">
        {en ? "NeuriCo · research plan" : "NeuriCo · plano de investigação"}
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        {en
          ? "Planning adapted from the NeuriCo workflow. Experiments have not been executed by this site. Export the idea for an external NeuriCo installation, then import its report."
          : "Planejamento adaptado do fluxo NeuriCo. Os experimentos não foram executados por este site. Exporte a ideia para uma instalação externa do NeuriCo e depois importe o relatório."}{" "}
        <a
          className="text-primary underline"
          href="https://github.com/ChicagoHAI/NeuriCo"
          target="_blank"
          rel="noopener noreferrer"
        >
          NeuriCo ↗
        </a>
      </p>
      <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
        <CitationText
          text={
            result.research_plan ??
            (en
              ? "Generate a new hypothesis to include the research plan."
              : "Gere uma nova hipótese para incluir o plano de investigação.")
          }
          pmids={pmids}
        />
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-sm"
          onClick={download}
        >
          {en ? "Export NeuriCo idea (.yaml)" : "Exportar ideia NeuriCo (.yaml)"}
        </button>
        {onUpdate && (
          <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm">
            {en ? "Import REPORT.md" : "Importar REPORT.md"}
            <input
              className="sr-only"
              aria-label={en ? "Import NeuriCo report" : "Importar relatório NeuriCo"}
              type="file"
              accept=".md,.txt,text/plain,text/markdown"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError("");
                if (file.size > 500000) {
                  setError(en ? "Maximum size: 500 KB." : "Tamanho máximo: 500 KB.");
                  return;
                }
                const text = await file.text();
                if (!text.trim()) {
                  setError(en ? "The report is empty." : "O relatório está vazio.");
                  return;
                }
                onUpdate({ ...result, neurico_report: { name: file.name, text } });
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {en
          ? "The export uses the data_science domain for bibliographic/computational analysis and budget 0. Review the domain and protocol before executing it; biomedical interventions require appropriate infrastructure and review."
          : "A exportação usa o domínio data_science para análise bibliográfica/computacional e orçamento 0. Revise o domínio e o protocolo antes de executar; intervenções biomédicas exigem infraestrutura e avaliação apropriadas."}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {result.neurico_report && (
        <div className="mt-5 border-t border-border pt-4">
          <h4 className="font-semibold">
            {en ? "Imported external report" : "Relatório externo importado"} ·{" "}
            {result.neurico_report.name}
          </h4>
          <p className="mt-2 text-xs text-muted-foreground">
            {en
              ? "User-provided content; does not change the literature verdict."
              : "Conteúdo fornecido pelo usuário; não altera o veredito na literatura."}
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
            <CitationText text={result.neurico_report.text} pmids={pmids} />
          </p>
        </div>
      )}
    </section>
  );
}
