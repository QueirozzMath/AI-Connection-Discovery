# AI Connection Discovery

**Exploração de literatura biomédica, análise de redes de conhecimento e geração de hipóteses científicas fundamentadas em evidências.**

O AI Connection Discovery organiza artigos do PubMed e descritores MeSH em redes de coocorrência para investigar relações entre conceitos que ainda não aparecem conectados no recorte analisado. A plataforma combina exploração visual, inferência de ligações e agentes de IA para transformar conexões candidatas em propostas de pesquisa que possam ser examinadas e testadas.

O projeto se inspira na descoberta baseada em literatura desconexa e no modelo A–B–C de Swanson: duas linhas de pesquisa podem compartilhar um conceito intermediário sem que a relação entre seus extremos tenha sido investigada diretamente. Essa estrutura orienta a busca; não demonstra, por si só, uma relação causal.

[**Acessar a plataforma**](https://ia-connection-discovery-main.telus-digita-3218.chatgpt.site) · [Política de evidências](pipeline/EVIDENCE_POLICY.md) · [Provedores de IA](AI_PROVIDERS.md)

> Plataforma experimental de apoio à pesquisa. As hipóteses geradas exigem revisão das fontes e validação independente; não constituem recomendações clínicas nem descobertas comprovadas. O acesso ao Site depende das permissões configuradas pelo proprietário.

## O que a plataforma oferece

| Recurso                    | Aplicação                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Mapa interativo**        | Exploração de descritores e conexões em rede 2D, hierarquia MeSH e visualização 3D.                                         |
| **Filtros e busca**        | Seleção por período, categorias, termos-chave e identificadores MeSH, com operadores AND/OR.                                |
| **Exploração de artigos**  | Lista paginada, navegação pela árvore MeSH, rede artigo–descritor e links para as fontes no PubMed.                         |
| **Inferência de conexões** | Priorização de pares com conceitos intermediários e suporte bibliográfico disponível.                                       |
| **Agentes científicos**    | Formulação de hipóteses, fundamentação, avaliação crítica, validação experimental proposta e possíveis aplicações.          |
| **Verificação posterior**  | Busca separada na literatura publicada após o corte para examinar uma hipótese e suas previsões.                            |
| **Avaliação temporal**     | Consulta a métricas exportadas pelo pipeline, incluindo AUC, conexões observadas posteriormente e tempo até sua observação. |
| **Experiência de uso**     | Interface em português e inglês, temas claro/escuro, guia interativo e painéis redimensionáveis.                            |

Os resultados da aba Agentes permanecem disponíveis ao navegar entre abas, até que o usuário gere um novo resultado ou selecione outra conexão. As chaves de API ficam somente na memória da sessão e são removidas ao recarregar a página.

## Como funciona

1. **Selecionar o recorte.** O ano de corte delimita os dados usados para explorar a rede e recuperar evidências históricas.
2. **Identificar uma conexão candidata.** O sistema busca caminhos A–B–C e prioriza a especificidade das pontes, o suporte nos braços e características da rede.
3. **Conferir as evidências.** O servidor recupera os artigos, verifica datas, descritores e disponibilidade de resumos antes de permitir a geração.
4. **Formular e criticar a hipótese.** O agente recebe o dossiê bibliográfico e distingue observações documentadas, extrapolações, mecanismos propostos e explicações alternativas.
5. **Propor um teste.** O relatório apresenta uma previsão testável, um desenho experimental proposto e condições que poderiam refutar a hipótese.
6. **Examinar a literatura posterior.** Em uma etapa independente, o usuário pode buscar estudos posteriores ao corte para avaliar a proposta.

O modo ampliado permite explorar caminhos com três ou quatro ligações. Esses caminhos recebem uma penalização na priorização e são identificados como mais especulativos: a existência das ligações intermediárias não implica a relação entre os extremos.

### Critérios científicos e rastreabilidade

- O critério bibliográfico inicial exige, experimentalmente, **dois PMIDs distintos com resumo utilizável por ligação**, além de diversidade mínima de artigos no caminho.
- As evidências são verificadas novamente no servidor no momento da geração.
- As referências produzidas pelo agente precisam pertencer ao conjunto de artigos recuperados; uma proposta deve citar suporte para cada ligação do caminho.
- Respostas incompletas, fora do formato esperado ou com referências não fornecidas são rejeitadas.
- O relatório identifica o modelo utilizado e preserva o ano de corte e a avaliação das evidências.
- Falhas de recuperação são diferenciadas de ausência de evidências.

O limiar de dois artigos é uma regra operacional experimental. Ele não comprova independência entre estudos, qualidade metodológica, replicação nem compatibilidade entre espécies, tecidos, doses ou intervenções. Esses aspectos precisam ser examinados na avaliação científica.

Consulte a [política de evidências](pipeline/EVIDENCE_POLICY.md) para os critérios completos e os limites da exploração.

## Dados e cobertura

O projeto utiliza artigos do **PubMed/MEDLINE** e o vocabulário **Medical Subject Headings (MeSH)** da National Library of Medicine.

Os metadados dos artefatos publicados nesta versão informam:

| Componente                        | Cobertura       |
| --------------------------------- | --------------- |
| Artigos no corpus                 | **105.051**     |
| Período do corpus                 | **1985–2025**   |
| Vocabulário MeSH                  | Edição **2026** |
| Descritores no vocabulário        | **31.110**      |
| Termos registrados no vocabulário | **267.012**     |

A base é uma **amostra estratificada por ano e ramo MeSH**, não uma cópia integral do PubMed. O número de nós, arestas e artigos exibidos varia com o corte, os filtros e os limites de exportação. A presença de um descritor no vocabulário não significa que ele apareça no grafo de todos os períodos.

O corpus publicado disponibiliza PMIDs, títulos, anos e descritores. Autores, periódico e DOI não fazem parte de todos os recortes. Resumos e informações adicionais para os agentes são recuperados pelo serviço de literatura quando disponíveis.

As contagens podem ser conferidas em [index.json](public/data/index.json) e [corpus-stats.json](public/data/corpus-stats.json).

## Modelos de IA

A escolha do provedor é aplicada à geração de hipóteses, à verificação na literatura e à tradução dos relatórios.

| Modo                         | Configuração                                             | Observações                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gratuito**                 | Não exige chave pessoal.                                 | Usa o acesso anônimo da OVHcloud; uma credencial da plataforma pode habilitar o roteador gratuito do OpenRouter. Sujeito a cotas e disponibilidade. |
| **Chave pessoal**            | Provedor, identificador do modelo e chave de API.        | Suporta Google Gemini, OpenAI, Anthropic/Claude e OpenRouter. O provedor pode cobrar pelo uso.                                                      |
| **Modelo próprio / LiteLLM** | Endereço base HTTPS autorizado, modelo e chave opcional. | Conecta a um gateway existente compatível com Chat Completions e saída JSON.                                                                        |

O modo gratuito **não migra automaticamente para modelos pagos**. Chaves pessoais são enviadas somente ao provedor escolhido e não entram no conjunto de alternativas gratuitas. As mesmas validações de evidência e referências se aplicam a todos os modos.

Um modelo instalado apenas no computador do usuário ou em uma rede interna precisa de um gateway acessível pelo servidor hospedado. Endereços próprios devem ser autorizados pelo administrador; a aplicação não aceita destinos arbitrários nem acompanha redirecionamentos de requisições com credenciais.

Consulte [AI_PROVIDERS.md](AI_PROVIDERS.md) para os contratos de integração, prazos, tratamento de erros e configuração do LiteLLM.

## Arquitetura

- **Interface:** React, TypeScript, TanStack Router/Start, TanStack Query, Tailwind CSS e componentes Radix UI.
- **Visualização:** renderização Canvas para os mapas e componentes de gráficos para distribuições e métricas.
- **Servidor web:** server functions para recuperação bibliográfica, validação de evidências e comunicação com as APIs de IA.
- **Pipeline de dados:** scripts Python para ingestão, construção dos grafos, exportação de recortes e avaliação temporal.
- **Serviço de dados opcional:** API Python com SQLite e agregações anuais, hospedada separadamente quando utilizada em produção.
- **Hospedagem do Site:** Cloudflare Workers, com identidade de projeto e configuração em `.openai/hosting.json`.

```text
src/components/     Componentes de interface, mapas e relatórios
src/routes/         Páginas e fluxos da aplicação
src/lib/            Inferência, evidências, APIs, provedores e estado de sessão
public/data/        Corpus, vocabulário e recortes publicados
pipeline/           Ingestão, processamento, serviço de dados e avaliação
tests/              Testes de dados, interação, evidências e provedores
```

## Executar localmente

### Pré-requisitos

- Node.js **22.18 ou superior**, com npm.
- Git.
- Python **3.11 ou superior** para executar o serviço de dados e os pipelines opcionais.

### Aplicação web

```bash
git clone https://github.com/QueirozzMath/AI-Connection-Discovery.git
cd AI-Connection-Discovery
npm ci
npm run dev
```

Abra o endereço informado pelo Vite no terminal. Execute os comandos a partir da pasta do projeto.

No Windows PowerShell, se a política de execução bloquear `npm.ps1`, utilize `npm.cmd ci` e `npm.cmd run dev`.

### Variáveis de ambiente

Crie um arquivo `.env.local` apenas quando precisar configurar os recursos opcionais. Não publique esse arquivo.

| Variável              | Finalidade                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`  | Credencial da plataforma para habilitar o roteador de modelos gratuitos.                 |
| `AI_CUSTOM_ENDPOINTS` | Lista de endereços base HTTPS autorizados para modelos próprios, separados por vírgulas. |
| `MAP_API_URL`         | Endereço do serviço Python de dados, quando hospedado separadamente.                     |
| `MAP_API_TOKEN`       | Token compartilhado com esse serviço, quando configurado.                                |
| `NCBI_API_KEY`        | Credencial opcional para scripts de ingestão que a utilizam.                             |

As chaves pessoais de IA são informadas na própria interface. Não coloque segredos em variáveis `VITE_*`, arquivos versionados ou no manifesto de hospedagem. Na hospedagem, configure as variáveis no ambiente do servidor.

### Serviço de dados opcional

O importador e a API local de referência podem ser executados em um segundo terminal:

```bash
python pipeline/map_store.py --input pipeline/cache/pubmed_corpus.jsonl.gz
python pipeline/map_api.py --host 127.0.0.1 --port 8090
```

A aplicação possui artefatos publicados para exploração sem esse serviço. As consultas disponíveis e o caminho de recuperação dependem do recurso utilizado. Em desenvolvimento, a integração procura o serviço em `http://127.0.0.1:8090`.

A API Python de referência não substitui uma configuração de servidor adequada para produção. Veja [a documentação do mapa e da ingestão](pipeline/MAP_ARCHITECTURE.md); contagens históricas desse documento podem se referir a recortes anteriores.

### Verificações e build

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

O projeto também disponibiliza `npm run lint` e `npm run format`. Os pipelines de treinamento podem exigir dependências adicionais, como NumPy e scikit-learn; consulte os imports e as instruções do script escolhido antes de executar uma reconstrução dos dados.

## Limitações e interpretação dos resultados

- **Coocorrência não é causalidade.** Uma ligação indica associação de descritores em artigos, não uma relação experimental demonstrada entre eles.
- **Ausência no grafo não prova ineditismo.** Uma relação pode estar descrita fora da amostra ou não ser capturada pela indexação utilizada.
- **Métricas de ligação não validam hipóteses científicas.** AUC, confirmação posterior de uma aresta e lead time avaliam aspectos da rede; não demonstram que o mecanismo proposto esteja correto.
- **O corte temporal controla as evidências fornecidas, não o conhecimento prévio do LLM.** Modelos podem ter sido treinados com literatura posterior; avaliações históricas precisam considerar essa fonte de viés.
- **A cobertura é parcial.** Indexação MeSH, acesso a resumos, amostragem e limites de exportação afetam os resultados.
- **Serviços externos têm cotas e políticas próprias.** Latência, indisponibilidade e condições de tratamento dos dados variam entre NCBI e provedores de IA.

O objetivo da plataforma é tornar a exploração e a formulação de hipóteses mais rastreáveis, oferecendo evidências e critérios explícitos para a revisão do pesquisador.

## Contribuir

Contribuições podem incluir correções, melhorias de visualização, ampliação documentada da base, novos adaptadores de IA e avaliações reproduzíveis. Descreva o problema, a mudança proposta e como ela foi verificada ao abrir uma issue ou pull request.

Mudanças na inferência ou nos agentes devem preservar a separação temporal, a rastreabilidade dos PMIDs, a distinção entre evidência e especulação e o isolamento das credenciais.
