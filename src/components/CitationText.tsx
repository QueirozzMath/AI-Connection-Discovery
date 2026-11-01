import { useLanguage } from "./LanguageProvider";
import { citationParts } from "@/lib/citation-parts";
export function CitationText({ text, pmids }: { text: string; pmids: string[] }) {
  const { language } = useLanguage();
  return (
    <>
      {citationParts(text, new Set(pmids)).map((part, i) =>
        part.pmid ? (
          <a
            key={i}
            href={`https://pubmed.ncbi.nlm.nih.gov/${part.pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`${part.text} — ${language === "en" ? "open article in PubMed in a new tab" : "abrir artigo no PubMed em nova aba"}`}
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
