import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { aboutSections } from "./guide-content";
import { GuidedTour } from "./GuidedTour";
import { BookOpenCheck, Bot, HelpCircle, Send } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const quick = [
  "O que é MeSH?",
  "Como gerar uma hipótese?",
  "Como verificar as evidências?",
  "Como usar E e OU?",
];

function answer(question: string) {
  const q = question.toLocaleLowerCase("pt-BR");
  if (q.includes("mesh") || q.includes("descritor") || q.includes("descriptor"))
    return "MeSH é uma taxonomia biomédica padronizada. Aqui, descritores viram nós do mapa e a posição na árvore organiza a exploração de artigos por área e subárea.";
  if (
    q.includes("hipótes") ||
    q.includes("hypothes") ||
    q.includes("gemini") ||
    q.includes("chave") ||
    q.includes("key")
  )
    return "Abra Agentes, escolha o ano e o par, insira sua chave Gemini na caixa segura da sessão e clique em Gerar hipótese. A chave não fica salva ao recarregar a página.";
  if (q.includes("auc") || q.includes("valid"))
    return "AUC próxima de 1 indica boa ordenação de conexões futuras; 0,5 equivale ao acaso. Uma associação posterior deve ser verificada nos estudos originais; ela não demonstra causalidade.";
  if (
    q.includes(" e ") ||
    q.includes(" ou ") ||
    q.includes("operador") ||
    q.includes(" and ") ||
    q.includes(" or ") ||
    q.includes("operator")
  )
    return "OU mostra artigos que contêm qualquer descritor selecionado. E exige que todos os descritores selecionados apareçam no mesmo artigo.";
  if (q.includes("ano") || q.includes("corte") || q.includes("year") || q.includes("cutoff"))
    return "O ano de corte simula o conhecimento disponível naquele momento. O grafo, o ranking, e os Agentes usam o mesmo corte para evitar informação do futuro.";
  if (
    q.includes("artigo") ||
    q.includes("article") ||
    q.includes("tree") ||
    q.includes("árvore") ||
    q.includes("arvore")
  )
    return "Abra a aba Artigos na navegação superior. Escolha uma categoria MeSH, avance pelas ramificações, marque descritores e abra os resultados diretamente no PubMed.";
  return "Posso explicar MeSH, descritores, anos de corte, mapa, inferência, Agentes, operadores E/OU e verificação das evidências. Tente perguntar sobre uma dessas funções.";
}

export function PlatformGuide() {
  const _uiLanguage = useLanguage().language;

  const [mode, setMode] = useState<"guide" | "chat" | "about">("guide");
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "Olá! Pergunte como funciona qualquer parte da plataforma." },
  ]);
  const ask = (value: string) => {
    const text = value.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { role: "user", text },
      { role: "assistant", text: answer(text) },
    ]);
    setDraft("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };

  return (
    <>
      <Localized value={" "} />
      <Localized value={tour && <GuidedTour onClose={() => setTour(false)} />} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <HelpCircle className="size-4" />
            <span className="hidden md:inline">
              <Localized value={"Guia"} />
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <Localized value={"Guia interativo"} />
            </DialogTitle>
            <DialogDescription>
              <Localized value={" Aprenda o fluxo completo ou tire uma dúvida específica. "} />
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 rounded-lg border border-border p-1">
            <button
              onClick={() => setMode("guide")}
              className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm ${mode === "guide" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              <BookOpenCheck className="size-4" />
              <Localized value={" Tour "} />
            </button>
            <button
              onClick={() => setMode("about")}
              className={`rounded-md py-2 text-sm ${mode === "about" ? "bg-secondary" : "text-muted-foreground"}`}
            >
              <Localized value={" Sobre "} />
            </button>
            <button
              onClick={() => setMode("chat")}
              className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm ${mode === "chat" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              <Bot className="size-4" />
              <Localized value={" Assistente "} />
            </button>
          </div>
          <Localized
            value={
              mode === "guide" ? (
                <section className="space-y-4 py-5">
                  <h3 className="font-display text-xl">
                    <Localized value={"Aprenda usando a plataforma"} />
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    <Localized
                      value={
                        " O tour destaca os controles reais e acompanha suas ações: escolher ano, filtrar, explorar artigos, inferir conexões e analisar resultados. "
                      }
                    />
                  </p>
                  <Button
                    onClick={() => {
                      setOpen(false);
                      setTour(true);
                    }}
                  >
                    <Localized value={" Iniciar tour interativo "} />
                  </Button>
                </section>
              ) : mode === "about" ? (
                <article
                  className="max-h-[60vh] overflow-y-auto space-y-7 pr-3"
                  aria-label={t("Sobre a plataforma")}
                >
                  <nav aria-label={t("Seções sobre o projeto")} className="flex flex-wrap gap-2">
                    <Localized
                      value={aboutSections.map((section, index) => (
                        <a
                          key={section.title}
                          className="text-xs underline text-primary"
                          href={`#about-${index}`}
                        >
                          <Localized value={section.title} />
                        </a>
                      ))}
                    />
                  </nav>
                  <Localized
                    value={aboutSections.map((section, index) => (
                      <section key={section.title} id={`about-${index}`} className="scroll-mt-3">
                        <h3 className="font-display text-lg font-semibold">
                          <Localized value={section.title} />
                        </h3>
                        <Localized
                          value={section.paragraphs.map((text) => (
                            <p key={text} className="mt-3 text-sm leading-7 text-muted-foreground">
                              <Localized value={text} />
                            </p>
                          ))}
                        />
                      </section>
                    ))}
                  />
                </article>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Localized
                      value={quick.map((item) => (
                        <button
                          key={item}
                          onClick={() => ask(item)}
                          className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:bg-secondary"
                        >
                          <Localized value={item} />
                        </button>
                      ))}
                    />
                  </div>
                  <div className="h-64 space-y-3 overflow-auto rounded-lg border border-border p-3">
                    <Localized
                      value={messages.map((message, index) => (
                        <div
                          key={index}
                          className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
                        >
                          <Localized value={message.text} />
                        </div>
                      ))}
                    />
                  </div>
                  <form onSubmit={submit} className="flex gap-2">
                    <Input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={t("Pergunte sobre a plataforma…")}
                      aria-label={t("Pergunta para o guia")}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!draft.trim()}
                      aria-label={t("Enviar pergunta")}
                    >
                      <Send className="size-4" />
                    </Button>
                  </form>
                  <p className="text-[11px] text-muted-foreground">
                    <Localized
                      value={
                        " Este assistente responde localmente com base no guia da plataforma; não usa sua chave Gemini. "
                      }
                    />
                  </p>
                </div>
              )
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
