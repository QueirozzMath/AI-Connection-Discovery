# Evolução incremental para LBD temporal

## Fase 1 — auditoria (branch Agentes)

Base inspecionada: `9b8dab0`. O corpus ativo contém 449.996 artigos; não será recriado.

| Área | Implementação existente | Constatação |
|---|---|---|
| Tempo | TemporalContext, temporal.ts | Um seletor já existe; limites vêm de metadata. Parsing de URL precisa evitar `Number(null)=0`. |
| Mapa | ScienceMap, ScienceMap3D, worker de layout | Canvas, navegação, camadas e seleção serão preservados. |
| Busca | map-selection.ts, index.tsx | Busca e sementes só conhecem os 4.500 conceitos renderizados; não são busca de todo o corpus. |
| Candidatos | temporal_model.py, build_from_corpus.py | ABC quantitativo existe, mas depende de treinamento e usa um grafo limitado. A exclusão de pares conhecidos consulta todo pair_year. |
| Treino | temporal_model.train | Features no corte interno, rótulos até o corte externo; holdout posterior separado. A hierarquia MeSH usada não tem versão histórica. |
| Agentes | hypotheses.tsx, hypothesis.functions.ts | Geração e cético em uma chamada; confiança autorrelatada e instrução para mecanismo específico. |
| Evidências | map_api.evidence_query, postgres-map.server.ts | Artigos de A e C separados, pontes por rótulo; falta vincular PMIDs a cada A–B e B–C. |
| Hipótese | estado React | Não há registro persistente, versão de prompt nem congelamento. |
| Validação | verifyHypothesis | Lê T+1 em diante, mas usa texto enviado pelo cliente e pode classificar títulos como confirmação de mecanismo. |
| Artigos | articles, article_mesh | PMID é chave; ano, título, revista, DOI e autores; indexação MeSH com major topic. Predominam títulos, sem texto integral. |
| MeSH | mesh, cache/mesh_trees.json | Descriptor, rótulo e uma árvore principal; falta versão temporal, Concepts, Terms, Qualifiers e SCR estruturados. |
| Agregados | node_year, pair_year | Contagens anuais transacionais, usadas por SQLite e PostgreSQL. |
| Ingestão | pubmed_bulk, pubmed_sync, ingestion_jobs, pubmed_expand | Arquivos oficiais, checksum, sequência, upsert/delete, checkpoint, R2 opcional e worker externo já existem. Corpus suplementado é protegido contra sobregravação. |
| Runtime | agent-provider.server.ts | Workers AI; nenhum gateway de terceiros ou chave do usuário. Runtime local ainda ausente. |

## Política científica proposta, explícita e versionada

A política conservadora aprovada pelo usuário considera elegível apenas A–C não observado **em todo o corpus até T**, não apenas no intervalo de exploração ou nas arestas desenhadas. Uma coocorrência posterior é sinal bibliográfico, não confirmação de mecanismo. Suporte parcial/substancial e contradição exigem revisão humana identificada. Nenhuma porcentagem autorrelatada é usada.

Métricas propostas para a implementação mínima, sempre acompanhadas de definição:

- `novelty`: indicador de ausência de coindexação A–C até T; não estima novidade mundial.
- `bridgeStrength`: soma de `min(nAB,nBC)` nas pontes; não representa probabilidade.
- `surprise`: PMI observado/esperado das ligações, `log2(nXY*N/(nX*nY))`; expectativa sob independência, sem afirmar significância estatística.
- `temporalEmergence`: variação de contagens por janelas anteriores a T; não usa futuro.
- `persistence`: anos ativos / anos observados da ligação.
- `pathCount`: pontes B distintas; não implica estudos estatisticamente independentes.
- `semanticDistance`: distância de Jaccard entre vizinhanças pré-corte, identificada como proxy estrutural; distância MeSH só com versão válida no corte.
- `evidenceStrength`: contagem de artigos distintos dos caminhos.
- `contradictionSignal`: não avaliado automaticamente a partir de títulos; ausência de evidência não é contradição.

Ranking interno determinístico e lexicográfico, com componentes expostos e limites de geração informados. O scorecard não é uma nota de qualidade nem probabilidade de descoberta.

## Limitações históricas e fontes

A indexação atual de um artigo antigo pode ter sido revisada posteriormente. Sem versões históricas de artigos e MeSH, garante-se separação por **ano de publicação**, não uma reconstrução perfeita do que estava indexado em T. A hierarquia atual não deve entrar disfarçada como feature histórica. Distâncias históricas indisponíveis permanecem nulas; modo estrito deve recusar dados não versionados.

As versões MeSH são anuais ([NLM](https://www.nlm.nih.gov/databases/download/mesh.html)); DateCreated não substitui por si só um arquivo histórico ([elementos XML](https://www.nlm.nih.gov/mesh/xml_data_elements.html)). O adaptador local utilizará mensagens e JSON estruturado de um serviço separado ([Ollama](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx)). Conhecimento futuro do pré-treinamento do LLM não pode ser apagado por prompt: saídas são interpretações assistidas, não prova de ausência de leakage do modelo.

## Contrato e execução

`POST /lbd` aceita `operation`: `discover`, `candidate`, `generate`, `validate`, `review`, `backtest`, `status`, `list`, `get`. Operações pesadas exigem `requestId` UUID e retornam `{id,status}`. Consultar `{operation:"status",id}` até `complete` ou `error`. A fila persiste no banco, admite oito trabalhos pendentes/em execução e usa um worker científico. Execute somente uma instância desse worker por banco. Reinício marca trabalhos interrompidos como erro explícito; não altera hipóteses já gravadas.

Descoberta recebe `{startYear,endYear,mode,a?,c?,q?,categories?,operator?,seedIds?}`. `open` procura C a partir de A; `closed` procura pontes entre A e C; `global` percorre âncoras. Conceitos candidatos respeitam o período de seleção. Conhecimento das ligações, novidade e métricas usam todo o histórico disponível até `endYear`. Em closed discovery, o detalhe explica também uma relação já observada, mas sua geração de hipótese é recusada.

O ranking de geração usa força das pontes, número de pontes e IDs como desempate; o detalhe recalcula todas as pontes reais. Por isso os valores do detalhe podem superar os da geração limitada. Não há pontuação científica consolidada. Orçamento atual: 30 âncoras globais, 80 vizinhos por expansão, 40 resultados; 8 caminhos detalhados, 12 artigos por lado. Os agentes recebem os 3 primeiros caminhos, com até 3 artigos por ligação; o conjunto exato é salvo. Esses limites tornam a busca parcial, especialmente em torno de descritores muito frequentes.

```powershell
# Em um terminal: serviço local já instalado; não iniciar outro se a porta estiver ocupada.
ollama serve
ollama pull qwen2.5:1.5b
# Em outro terminal, na raiz do projeto:
$env:AGENT_RUNTIME='ollama'
$env:AGENT_MODEL='qwen2.5:1.5b'
$env:AGENT_URL='http://127.0.0.1:11434'
.\.venv\Scripts\python.exe pipeline/map_api.py --db pipeline/data/indexes/pubmed.sqlite
```

Para trocar o modelo, baixe-o no runtime e altere `AGENT_MODEL`; para um servidor Hugging Face/vLLM compatível, use `AGENT_RUNTIME=compatible` e `AGENT_URL` apontando para a raiz que oferece `/v1/chat/completions`. `AGENT_TOKEN` é opcional, apenas do operador do servidor, nunca solicitado na interface. A API da aplicação permanece em `MAP_API_URL`, protegida por `MAP_API_TOKEN`. No deploy, API, ingestão e Hyperdrive devem usar o mesmo PostgreSQL. Não foram provisionados recursos externos.

## Registros e ingestão incremental

`hypothesis_ledger` armazena JSON canônico, SHA-256, data de criação, corte, revisão do corpus, conceitos, todas as métricas, evidências, textos dos agentes, versões dos prompts, prompts completos, modelo/digest e parâmetros de amostragem. UPDATE e DELETE são recusados por triggers. Uma nova execução cria outro registro. Reprodutibilidade aqui significa reconstruir entradas e auditar a saída; não promete identidade bit a bit entre hardwares/runtimes.

`validation_ledger` só acrescenta registros posteriores, usando o ID da hipótese original. Coindexação posterior produz `WEAK_SIGNAL`; ausência na janela produz `NO_FUTURE_EVIDENCE`; ausência de janela futura produz `INCONCLUSIVE`. Estados interpretativos exigem revisor, justificativa e PMIDs posteriores identificados. O backtest separa contagens automáticas da última revisão humana de cada hipótese; não apaga nem substitui revisões humanas. Revisões são declarações identificadas do operador, sem autenticação individual de revisores nesta versão.

`mesh_versions` prepara entidades `Descriptor`, `Concept`, `Term`, `TreeNumber`, `Qualifier`, `SCR`: chave `(id,version,kind)`, `valid_from`, `valid_to`, rótulo e payload. Para Descriptor, o payload pode conter `treeNumbers`, `category`, `conceptIds`, `qualifierIds`; Concepts/Terms/SCR podem guardar sinônimos, relações e mappings. Não foram inventadas versões nem carregada uma ontologia histórica. Distância só é calculada com descritores da mesma versão válida em T. `strictHistorical` recusa ausência desses dados; não certifica reconstrução histórica da indexação dos artigos.

O parser PubMed agora preserva Qualifiers, substâncias e DateRevised em `article_annotations`. Revisões/deletes futuros registram o snapshot anterior e evento recebido em `article_revisions`, na mesma transação do checkpoint e dos agregados. Não há retropreenchimento fictício de revisões. Datas de ingestão/revisão não substituem ano de publicação. O sincronizador oficial, checksum, ordem, lock, retries e R2 permanecem existentes. A proteção do corpus suplementado continua: uma baseline oficial completa deve usar banco explicitamente separado e passar por conciliação antes de qualquer troca.

## Entrega por requisito (20 itens)

1. **Arquitetura anterior:** grafo limitado e modelo supervisionado produziam candidatos; uma chamada LLM interpretava/ceticava; hipóteses viviam no React. A auditoria acima identifica cada módulo.
2. **Arquitetura resultante:** corpus SQL → ABC quantitativo → métricas explicáveis → cinco papéis → hipótese imutável → validação posterior. Treino estatístico anterior continua disponível, separado do novo engine.
3. **Criados:** `lbd_engine.py`, `lbd_jobs.py`, `agent_runtime.py`, `hypothesis_ledger.py`, tipos LBD, hook de jobs, parser temporal e testes correspondentes.
4. **Alterados:** TemporalContext, rotas Mapa/Agentes, server functions, API, seleção focada PostgreSQL, armazenamento/importação PubMed e features temporais. Canvas 2D/3D e layout não foram reescritos.
5. **Motor LBD:** open, closed e global; novidade conferida no agregado completo, evidências vinculadas a A–B e B–C.
6. **Métricas:** dez componentes separados, incluindo distância MeSH quando disponível; fórmulas acima e na UI. Contradição permanece não determinada sem revisão.
7. **Tempo:** contrato canônico startYear/endYear; parser corrige ausência de parâmetros confundida com ano zero. Holdout inicia em T+1.
8. **Leakage:** consultas quantitativas limitadas a T; evidência futura só entra na validação. Features MeSH do modelo estatístico também usam apenas versões históricas; campos desconhecidos ficam neutros, sem hierarquia atual disfarçada. Limitações de reindexação/pré-treinamento permanecem explícitas.
9. **Busca:** `/concepts` consulta todo o corpus do período com AND/OR e sementes; seleção fora do Canvas pode ser carregada por `focusIds`. Estatísticas locais do desenho continuam descrevendo apenas o recorte visual.
10. **Agentes:** EvidenceAgent e TemporalAgent são ferramentas determinísticas; Interpreter, Contradiction e Synthesis usam o runtime. Referências/trechos inexistentes, métricas inventadas e respostas sem estrutura são rejeitadas.
11. **Hipótese:** mantém mecanismo, ponte, previsão testável e crítica, mas separa inferência/hipótese/especulação e não oferece confiança autorrelatada.
12. **Hypothesis Ledger:** persistente, congelado, evidências e configuração completas; SHA-256 verificado na leitura individual.
13. **Validation Ledger:** append-only, avaliação automática fraca, revisão humana para suporte/contradição.
14. **Backtest:** conta registros, sinais posteriores, tempo até sinal, conhecidos no corte e revisões humanas; não mede confirmação causal.
15. **Ingestão:** preservada; acrescidos anotações e histórico de revisões futuras. Corpus atual não reimportado nem substituído.
16. **Modelo:** Ollama 0.34.3 instalado; Qwen 2.5 1.5B selecionado pela RAM disponível, CPU, sem GPU dedicada. Modelo local pequeno exige revisão; não é avaliador científico validado.
17. **Troca de modelo:** configuração de servidor e adaptador HTTP, sem mudar lógica científica; instruções acima.
18. **Independência de fornecedor anterior:** busca automatizada em fontes versionadas e novos arquivos confirma ausência do antigo gateway, nome e credenciais; nenhum segredo de usuário exigido pelo novo fluxo.
19. **Testes:** ver resultados abaixo. Fixtures são exclusivas dos testes, nunca fallback de produção.
20. **Limitações:** corpus parcial, títulos, reindexação retrospectiva, falta de MeSH histórico, viés das âncoras frequentes, limites da busca e do contexto LLM, suporte qualitativo humano. PostgreSQL/Hyperdrive/R2 e deploy precisam validação no ambiente configurado. Não há benchmark em milhões nem garantia automática de verdade científica.

## Verificação realizada

- TypeScript e build de produção; lint dos novos módulos de UI/agentes.
- 22 testes Node: período, filtros, AND/OR, termos-chave, Canvas 2D/3D, layout e ausência do fornecedor anterior.
- 15 testes Python existentes: ingestão/checksum/checkpoint/update/delete, API temporal e fronteiras reais do treinamento.
- 47 execuções da suíte Python em `pipeline`: ABC, PMIDs por ligação, injeção de futuro, MeSH histórico, open/closed, filas, cinco agentes, resposta inválida, ausência de chave de usuário, offline, ledgers, revisão humana e expansão aditiva. O total inclui testes-base herdados entre fixtures.
- API real: metadata mantém **449.996 artigos, 1974–2026**; busca de Migraine Disorders, open discovery em 2014 e detalhe com evidências <=2014. Geração ~50 s, detalhe ~24 s neste computador; fila e polling mantêm consultas HTTP curtas.
- Navegador automatizado indisponível nesta sessão; não foi possível fazer inspeção visual interativa. Isso permanece uma limitação de QA, apesar do build e testes de renderizadores.
- Integração HTTP real do frontend: catálogo, três períodos, grafo, artigos, busca global e resposta da análise supervisionada passaram. No corpus atual, treino em 2018 informa menos de 20 exemplos em uma classe; preservou-se esse requisito, sem fabricar um modelo disponível. O novo engine ABC funciona independentemente dessa insuficiência.
- Ollama instalado e modelo `qwen2.5:1.5b` baixado (986 MB, Q4_K_M), digest `65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b`. Primeiro ciclo local: 61 s intérprete, 70 s crítico, 79 s síntese. As cinco saídas passaram nas verificações de estrutura, citações e limite temporal; isso não valida a inferência científica. Uma confusão A/C versus B observada no texto motivou instrução explícita e repetição do ensaio. Os artefatos locais estão em `pipeline/data/ollama-agent-smoke.json` e `.jsonl`, fora do Git. Não foram adicionadas hipóteses de teste ao ledger do usuário.
- Segundo ciclo com instrução corrigida: 78 s intérprete, 74 s crítico, 95 s síntese; verificações concluídas sem erro. A interpretação reconheceu A/C como extremos de uma ponte genérica, sem mecanismo identificado. Isso continua sendo um teste de integração, sem validação independente da qualidade científica.
- API final reiniciada na porta 8090. Busca e foco do descritor raro `D020325` retornaram nó com 3 ligações reais em 1,7 s no período 2010–2014. Ollama está ativo na porta local 11434. Nenhum commit, merge, push ou deploy foi executado nesta etapa.
