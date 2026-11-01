import { t, getLocale } from "@/lib/ui-language";
import { Localized, useLanguage } from "@/components/LanguageProvider";
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { Button } from "./ui/button";

const steps = [
  {
    target: "cutoff",
    title: "Ano de corte: definir o contexto",
    text: "O seletor de ano estabelece o recorte temporal disponível para explorar a rede e comparar conexões. Ele existe para que você saiba qual literatura está sendo considerada, em vez de interpretar todos os resultados como atuais. Abra o seletor, escolha um corte e confira o ano indicado antes de prosseguir. Comparar cortes pode revelar mudanças de associação, mas a cobertura dos dados também influencia essa leitura.",
    route: "/",
  },
  {
    target: "views",
    title: "Rede, Hierarquia e 3D",
    text: "Rede facilita a observação de grupos e pontes bibliográficas. Hierarquia organiza os conceitos segundo a estrutura temática. 3D oferece uma perspectiva espacial alternativa. A aba Artigos, na navegação superior, permite consultar os registros e a árvore de assuntos. Esses botões existem porque nenhuma representação resolve sozinha todas as perguntas: escolha Rede para explorar relações, Hierarquia para se orientar por assunto e Artigos para examinar as fontes.",
    route: "/",
  },
  {
    target: "search",
    title: "Busca: localizar nomes e identificadores",
    text: "Digite um assunto, parte do nome de um descritor ou seu identificador MeSH. A busca ajuda a encontrar conceitos sem percorrer o mapa inteiro e permite conferir se o termo usado corresponde ao conceito esperado. Observe os resultados e seus nomes antes de selecionar. Se não encontrar um tema, experimente outra forma do nome ou o código; ausência na busca não demonstra ausência de estudos sobre o assunto.",
    route: "/",
  },
  {
    target: "filters",
    title: "E, OU e limpar filtros",
    text: "Os filtros delimitam a pergunta que você está investigando. OU amplia a seleção para critérios alternativos; E exige a combinação dos critérios aplicáveis. Limpar filtros desfaz as restrições para recuperar uma visão ampla. Use OU para conhecer o entorno de áreas distintas e E para concentrar a exploração em sua interseção. Um conjunto vazio pode ser resultado de uma combinação muito restritiva, portanto revise os filtros antes de interpretar a ausência.",
    route: "/",
  },
  {
    target: "categories",
    title: "Categorias: selecionar áreas do conhecimento",
    text: "Os botões de categoria na base do mapa permitem incluir ou retirar ramos MeSH do recorte. A cor associa visualmente cada área a seus conceitos e as contagens ajudam a dimensionar o conjunto. Esse controle serve para reduzir ruído quando a rede está muito densa ou comparar assuntos de áreas diferentes. Combine categorias com a busca, mantendo em mente que uma classificação temática não comprova uma relação causal.",
    route: "/",
  },
  {
    target: "filters",
    title: "Seleção e centralização dos resultados",
    text: "Mostrar nós não selecionados mantém visível o contexto que ficou fora do filtro, quando ativado. Centralizar resultados reposiciona a visualização sobre o conjunto selecionado, ajudando a reencontrá-lo após navegar. Esses controles existem para alternar entre foco e contexto sem confundir o recorte da pesquisa com a posição da câmera. Se Centralizar estiver desabilitado, confira se há resultados selecionados.",
    route: "/",
  },
  {
    target: "display",
    title: "Arestas e cores: ler a rede com cuidado",
    text: "Arestas exibe ou oculta as linhas de conexão para facilitar a leitura em regiões densas. Cor por grau destaca a quantidade de conexões de um nó; Cor por crescimento apresenta a medida de crescimento quando disponível. A cor por categoria ajuda a distinguir áreas. Use essas opções para comparar aspectos diferentes do mesmo conjunto; conectividade elevada e crescimento não representam, por si só, relevância clínica ou qualidade metodológica.",
    route: "/",
  },
  {
    target: "views",
    title: "Navegar em 3D",
    text: "Selecione 3D para examinar a rede em outra perspectiva. A opção Girar, disponível nesse modo, controla a rotação automática e ajuda a perceber estruturas que podem se sobrepor numa projeção. Pause a rotação quando quiser inspecionar um conceito. O espaço é uma organização visual do grafo, não um sistema de coordenadas físicas ou uma medida direta de semelhança experimental.",
    route: "/",
  },
  {
    target: "articles",
    title: "Abrir Artigos e voltar às fontes",
    text: "Abra Artigos na navegação superior para acessar a página de exploração bibliográfica. Essa visualização existe para que uma conexão observada possa ser confrontada com registros de publicações. A árvore permite partir de uma área ampla e avançar até descritores mais específicos. A mudança de modo não equivale a uma nova descoberta: ela oferece outra maneira de examinar os assuntos e os filtros escolhidos.",
    route: "/",
  },
  {
    target: "article-explorer",
    title: "Expandir ramos e combinar descritores",
    text: "Abra os ramos da árvore para explorar seus descendentes e selecione os descritores que representam sua pergunta. Um mesmo descritor pode pertencer a mais de um ramo MeSH. Utilize E para exigir descritores conjuntamente ou OU para reunir alternativas. Observe como a seleção modifica os artigos apresentados; esse processo ajuda a tornar a pergunta mais precisa antes de solicitar uma hipótese.",
    route: "/articles",
  },
  {
    target: "explorer",
    title: "Títulos, PMID e links dos artigos",
    text: "Quando disponível, a busca por título ou PMID ajuda a localizar um registro conhecido. PMID é o identificador de uma publicação no PubMed. Os chips de descritores mostram os assuntos associados ao registro e permitem continuar explorando a partir dele. Abra o link do artigo no PubMed para conferir a referência e buscar o texto completo: título e indexação não substituem a leitura dos métodos e resultados.",
    route: "/",
  },
  {
    target: "discovery",
    title: "Busca global e Termos-chave",
    text: "Busca global permite solicitar uma exploração mais ampla das conexões consideradas pelo mecanismo. Termos-chave direciona a análise para conceitos escolhidos no seletor. Ao selecionar termos, confira os chips e retire os que não representam mais sua pergunta. Esses modos existem para alternar entre exploração aberta e investigação orientada; a escolha deve refletir se você está procurando um tema novo ou desenvolvendo uma questão já definida.",
    route: "/",
  },
  {
    target: "infer",
    title: "Inferir conexões e interpretar o ranking",
    text: "Inferir conexões executa a análise com as opções atuais e atualiza os resultados quando disponíveis. Primeiro ajuste os filtros e os termos; depois solicite o cálculo. Examine o par proposto, os intermediários e os escores em conjunto. A posição no ranking ajuda a priorizar revisão de literatura, mas não garante que a conexão seja inédita fora do corpus, verdadeira ou experimentalmente viável. Se não houver resultados, revise o recorte e a disponibilidade dos dados.",
    route: "/",
  },
  {
    target: "agents",
    title: "Agentes: escolher o par e o corte",
    text: "A aba Agentes reúne a passagem de uma conexão bibliográfica para uma proposta escrita. Confira o ano e selecione o par que deseja analisar, usando os controles de seleção apresentados. O objetivo é formular uma pergunta sobre uma relação concreta entre conceitos, e não pedir uma narrativa genérica. Compare os termos e suas pontes com os artigos antes de interpretar o resultado gerado.",
    route: "/hypotheses",
  },
  {
    target: "agents",
    title: "Chave Gemini: usar e remover na sessão",
    text: "Se a interface solicitar uma chave, cole sua credencial no campo de senha e pressione Usar nesta sessão. Esse botão disponibiliza a chave para a geração, sem colocá-la na busca ou no guia. Remover chave retira a credencial da sessão. A chamada depende de acesso e cota do provedor; ter uma chave não garante uso ilimitado. O Guia responde localmente e não precisa dessa credencial. Evite enviar conteúdo confidencial ao serviço de IA.",
    route: "/hypotheses",
  },
  {
    target: "agents",
    title: "Gerar, Regerar e examinar a hipótese",
    text: "Gerar hipótese inicia a solicitação de análise; aguarde enquanto o botão indica processamento. Depois, leia a hipótese, o mecanismo proposto, o raciocínio pela ponte, o impacto potencial, as limitações e como refutar a proposta. Cada campo ajuda a distinguir a ideia central de suas suposições e de um possível teste. Regerar produz uma nova resposta e pode mudar a interpretação; não acrescenta automaticamente novos fatos ou evidências.",
    route: "/hypotheses",
  },
  {
    target: "agents",
    title: "Verificar no PubMed depois do corte",
    text: "Após gerar, o botão Verificar no PubMed pós-corte busca literatura posterior para examinar a conexão. Use-o para reunir estudos que merecem leitura, não como confirmação automática. Verifique se os artigos tratam da mesma relação, em que organismo ou contexto e com qual desenho experimental. Uma menção conjunta pode ser indireta, enquanto a ausência de resultados pode refletir limites da consulta ou do corpus.",
    route: "/hypotheses",
  },
  {
    target: "agents",
    title: "Concluir: transformar exploração em investigação",
    text: "Registre os conceitos, o corte e as referências consultadas antes de levar a ideia para um projeto. Revise o texto gerado, procure explicações alternativas e formule um teste que possa contradizer a hipótese. Você pode voltar ao Mapa pela navegação, reabrir o Guia para consultar o Sobre ou alternar a aparência pelo botão Claro/Escuro. O tour pode ser encerrado a qualquer momento e não exige gerar uma hipótese nem utilizar sua chave Gemini.",
    route: "/hypotheses",
  },
] as const;
export function GuidedTour({ onClose }: { onClose: () => void }) {
  const _uiLanguage = useLanguage().language;

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [found, setFound] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const item = steps[step]!;
  useEffect(() => {
    if (location.pathname !== item.route) void navigate({ to: item.route });
    setDone(false);
    setFound(false);
  }, [step, navigate, item.route]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    const action = (event: Event) => {
      if (target?.contains(event.target as Node)) setDone(true);
    };
    const locate = () => {
      const next = document.querySelector<HTMLElement>(`[data-tour="${item.target}"]`);
      if (next === target) return;
      target?.classList.remove("tour-focus");
      target = next;
      setFound(!!target);
      if (target) {
        target.classList.add("tour-focus");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { subtree: true, childList: true });
    locate();
    const event = "click";
    document.addEventListener(event, action, true);
    return () => {
      observer.disconnect();
      target?.classList.remove("tour-focus");
      document.removeEventListener(event, action, true);
    };
  }, [item]);
  return (
    <aside
      aria-label={t("Tour interativo")}
      className="fixed z-[60] bottom-5 right-5 w-[min(480px,calc(100vw-40px))] max-h-[75vh] overflow-y-auto rounded-xl border border-primary bg-background p-5 shadow-2xl"
    >
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          <Localized value={" APRENDA EXPLORANDO · "} />
          <Localized value={step + 1} />
          <Localized value={"/"} />
          <Localized value={steps.length} />
        </span>
        <button aria-label={t("Encerrar tour")} onClick={onClose}>
          <Localized value={" ✕ "} />
        </button>
      </div>
      <h2 className="font-display font-semibold mt-2">
        <Localized value={item.title} />
      </h2>
      <p className="text-sm text-muted-foreground mt-2">
        <Localized value={item.text} />
      </p>
      <p role="status" className="text-xs text-primary mt-3">
        <Localized
          value={
            done
              ? "✓ Você interagiu com esta etapa."
              : found
                ? "Experimente o controle destacado."
                : "Abra a seção indicada ou use Continuar para ler a próxima explicação."
          }
        />
      </p>
      <div className="flex justify-between mt-4">
        <Button size="sm" variant="ghost" disabled={!step} onClick={() => setStep((s) => s - 1)}>
          <Localized value={" Voltar "} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (step === steps.length - 1 ? onClose() : setStep((s) => s + 1))}
        >
          <Localized value={" Pular "} />
        </Button>
        <Button
          size="sm"
          onClick={() => (step === steps.length - 1 ? onClose() : setStep((s) => s + 1))}
        >
          <Localized value={step === steps.length - 1 ? "Concluir" : "Continuar"} />
        </Button>
      </div>
    </aside>
  );
}
