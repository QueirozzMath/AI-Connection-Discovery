import { NeuricoPanel } from "./NeuricoPanel";
import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { Lightbulb, Link2, ShieldAlert, FlaskConical, Globe2, type LucideIcon } from "lucide-react";
import type { HypothesisResult } from "@/lib/hypothesis.functions";
import { CitationText } from "./CitationText";
import { Badge } from "./ui/badge";

export function HypothesisReport({
  result,
  onUpdate,
}: {
  result: HypothesisResult;
  onUpdate?: ((result: HypothesisResult) => void) | undefined;
}) {
  const _uiLanguage = useLanguage().language;

  const articles = new Map(
    result.evidence_assessment.arms.flatMap((a) => a.articles).map((a) => [a.pmid, a]),
  );
  const ids = [...articles.keys()];
  const abstracts = [...articles.values()].filter((a) => a.abstract.trim().length >= 80).length;
  const path = result.evidence_assessment.arms
    .map((a) => a.from)
    .concat(result.evidence_assessment.arms.at(-1)?.to ?? result.pair[1]);
  const field = (title: string, body: string | undefined) => (
    <div className="mt-5">
      <h4 className="text-sm font-semibold">
        <Localized value={title} />
      </h4>
      <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted-foreground">
        <CitationText
          text={body || "Campo não disponível nesta resposta. Gere novamente para preenchê-lo."}
          pmids={ids}
        />
      </p>
    </div>
  );
  return (
    <article className="space-y-4" aria-label={t("Hipótese científica")}>
      <header className="panel p-5 sm:p-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <Localized value={" Hipótese científica "} />
        </p>
        <h2 className="font-display text-xl font-semibold leading-snug sm:text-2xl">
          <Localized value={result.title} />
        </h2>
        <p
          className="mt-3 text-sm leading-relaxed text-muted-foreground"
          aria-label={t("Caminho da conexão")}
        >
          <Localized value={path.join(" → ")} />
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">
            <Localized
              value={
                result.decision === "reject"
                  ? "Proposta rejeitada pelo agente"
                  : result.evidence_assessment.status === "expanded"
                    ? "Exploração ampliada"
                    : "Exploratória · A–B–C"
              }
            />
          </Badge>
          <Badge variant="outline">
            <Localized value={" Confiança estimada pelo agente: "} />
            <Localized value={(result.confidence * 100).toFixed(0)} />
            <Localized value={"% "} />
          </Badge>
          <Badge variant="outline">
            <Localized value={"Novidade estimada: "} />
            <Localized value={result.novelty} />
          </Badge>
          <Badge variant="secondary">
            <Localized
              value={result.ai ? `${result.ai.provider} · ${result.model}` : result.model}
            />
          </Badge>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <Localized value={articles.size} />{" "}
          <Localized
            value={articles.size === 1 ? "referência fornecida" : "referências fornecidas"}
          />
          <Localized value={" "} />
          <Localized value={"ao agente · "} />
          <Localized value={abstracts} />
          <Localized value={" com resumo utilizável · corte "} />
          <Localized value={result.cutoff_year} />
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          <Localized
            value={
              " A confiança não é uma probabilidade calibrada de acerto. A novidade estimada não comprova ineditismo na literatura. "
            }
          />
        </p>
      </header>
      <ReportSection title={t("Descoberta")} icon={Lightbulb}>
        <Localized value={field("Hipótese central", result.hypothesis)} />
        <Localized value={field("Mecanismo proposto", result.mechanism)} />
        <Localized value={field("Contribuição científica", result.innovation_value)} />
      </ReportSection>
      <ReportSection title={t("Fundamentação científica")} icon={Link2}>
        <Localized value={field("Evidências documentadas", result.documented_evidence)} />
        <Localized value={field("Construção da conexão científica", result.bridge_reasoning)} />
        <Localized value={field("Extrapolações e pressupostos", result.extrapolations)} />
        <details className="mt-5 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            <Localized value={" Referências por ligação ("} />
            <Localized value={articles.size} />
            <Localized value={") "} />
          </summary>
          <div className="mt-3 space-y-4">
            <Localized
              value={result.evidence_assessment.arms.map((arm, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold">
                    <Localized value={arm.from} />
                    <Localized value={" → "} />
                    <Localized value={arm.to} />
                  </p>
                  <ul className="mt-2 space-y-2">
                    <Localized
                      value={arm.articles.map((a) => (
                        <li key={a.pmid} className="text-xs leading-relaxed">
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            <Localized value={a.title || `PMID ${a.pmid}`} />
                          </a>
                          <span className="text-muted-foreground">
                            <Localized value={" "} />
                            <Localized value={" · PMID "} />
                            <Localized value={a.pmid} />
                            <Localized value={" · "} />
                            <Localized value={a.year ?? "ano não informado"} />
                          </span>
                        </li>
                      ))}
                    />
                  </ul>
                </div>
              ))}
            />
          </div>
        </details>
      </ReportSection>
      <ReportSection title={t("Avaliação crítica")} icon={ShieldAlert} critical>
        <Localized value={field("Consistência das evidências", result.context_compatibility)} />
        <Localized
          value={field("Contradições e explicações alternativas", result.contradictions)}
        />
        <Localized value={field("Limitações", result.evidence_limitations)} />
        <Localized value={field("Parecer do agente cético", result.skeptic_critique)} />
      </ReportSection>
      <ReportSection title={t("Validação experimental")} icon={FlaskConical}>
        <Localized value={field("Previsões testáveis", result.testable_prediction)} />
        <Localized value={field("Experimento proposto", result.experiment)} />
        <Localized value={field("Critérios de refutação", result.falsification)} />
      </ReportSection>
      <ReportSection title={t("Impacto e perspectivas")} icon={Globe2}>
        <Localized value={field("Aplicações potenciais", result.potential_applications)} />
        <Localized value={field("Próximos passos de investigação", result.next_steps)} />
      </ReportSection>
      <NeuricoPanel result={result} onUpdate={onUpdate} />
    </article>
  );
}
function ReportSection({
  title,
  icon: Icon,
  critical = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  critical?: boolean;
  children: React.ReactNode;
}) {
  const _uiLanguage = useLanguage().language;

  return (
    <section className="panel p-5 sm:p-6" aria-label={t(title)}>
      <h3 className="flex items-center gap-2.5 font-display text-lg font-semibold">
        <Icon
          aria-hidden="true"
          strokeWidth={1.6}
          className={`size-5 shrink-0 ${critical ? "text-destructive" : "text-primary"}`}
        />
        <Localized value={title} />
      </h3>
      <Localized value={children} />
    </section>
  );
}
