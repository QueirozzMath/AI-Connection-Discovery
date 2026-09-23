# Arquitetura científica, período e ingestão

## Execução local

```sh
python -m venv .venv
# Windows: .venv/Scripts/python.exe; Linux: .venv/bin/python
.venv/Scripts/python.exe -m pip install -r pipeline/requirements.txt
.venv/Scripts/python.exe pipeline/map_api.py
npm ci
npm run dev
```

O banco local ativo é `pipeline/data/indexes/pubmed.sqlite`. Ele reúne a baseline parcial já incorporada, os artigos do banco anterior e suplementos oficiais obtidos por ano e área MeSH. A contagem e os anos disponíveis vêm de `/metadata` e aparecem na barra temporal. O arquivo anterior `pipeline/data/indexes/map.sqlite` permanece preservado. Os bancos são ignorados pelo Git e não são incluídos no deploy.

Em uma instalação sem banco, a primeira carga pode ser criada explicitamente com `pubmed_sync.py --db pipeline/data/indexes/pubmed.sqlite --max-files 1`. Esse comando é apenas para uma base nova ou ainda exclusivamente ordenada; não é necessário para iniciar a aplicação com o corpus ampliado existente.

A ampliação é aditiva: PMIDs existentes não são atualizados nem excluídos, e os agregados recebem somente artigos novos. O corpus continua sendo parcial; cobertura de um ano não significa cobertura completa da produção daquele ano. O piso anual melhora a distribuição temporal, mas não elimina os vieses de seleção e indexação MeSH.

Para ampliar ou retomar a execução local:

```sh
.venv/Scripts/python.exe pipeline/pubmed_expand.py --target-per-year 5000
```

A execução faz backup consistente do SQLite, incorpora o banco anterior e busca registros até atingir o piso em cada ano de 1974–2026. As buscas alternam 12 áreas MeSH; registros são aceitos somente se o ano de publicação extraído do XML corresponder ao ano solicitado e houver descritores MeSH. PMIDs são deduplicados globalmente. As requisições seguem os [limites oficiais das E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25497/); `NCBI_EMAIL` e `NCBI_API_KEY` são opcionais. Erros interrompem a execução com checkpoints, sem substituição por dados antigos ou vazios.

Backup, respostas oficiais comprimidas, entradas imutáveis, SHA-256 e manifesto ficam em `pipeline/data/expansions/diversified-1974-2026/`. Reexecutar o mesmo comando retoma os lotes sem duplicar artigos. Para outra meta ou uma nova coleta, use um novo diretório `--root`. O controle dos sete arquivos de baseline permanece intacto. `pubmed_sync.py` recusa executar sobre o corpus suplementado, evitando que arquivos antigos sobrescrevam registros preservados; uma sincronização integral ordenada exige outro banco explicitamente escolhido. Daily updates só se aplicam após a baseline completa.

A aplicação consulta a API local em `127.0.0.1:8090`; `MAP_API_URL` permite mudar esse endereço no servidor. `MAP_API_TOKEN` protege a API privada. Banco, tokens e conexões não vão ao navegador. Ampliar este SQLite local não popula automaticamente o PostgreSQL/Hyperdrive do ambiente publicado.

### Carga local de 22/09/2026

- Resultado da ampliação aditiva: **449.996 artigos únicos**, cobrindo todos os **53 anos de 1974 a 2026**, com pelo menos **5.000 artigos por ano**.
- Composição: 210.000 artigos da base ativa preservados, 67.560 reincorporados da base anterior e 172.436 novos artigos obtidos nas E-utilities oficiais.
- Os cinco anos de 1975–1979 mantêm seus 209.996 artigos. Os outros 48 anos passam a reunir 240.000, melhorando a distribuição sem remover registros antigos.
- Antes da ampliação aditiva: 210.000 artigos únicos, com anos de publicação de 1974 a 1980.
- Sete arquivos oficiais, `pubmed26n0001.xml.gz` até `pubmed26n0007.xml.gz`, incorporados em ordem com MD5 conferido.
- Banco anterior: 67.560 artigos, 1985–2025, incorporados por adição; o arquivo original permanece preservado.
- O relatório da primeira carga permanece em `pipeline/data/manifests/corpus-expansion-2026-09-22.json`. O manifesto da ampliação aditiva registra separadamente a distribuição anterior e posterior, as fontes e a integridade do banco.
- A auditoria detalhada fica em `pipeline/data/expansions/diversified-1974-2026/validation.json`; as consultas da API são verificadas em `api-validation.json`, no mesmo diretório. São artefatos locais, junto ao backup e aos dados, e não fazem parte do deploy.
- Validação concluída: nenhum artigo ou vínculo MeSH original perdido/alterado, arquivo anterior intacto, agregados anuais de conceitos recalculados e conferidos, pesos de pares amostrados nos 53 anos, integridade SQLite `ok` e nenhuma violação de chave estrangeira. A consulta de 1974–2026 sem cache de resultado levou 15,3 segundos nesta máquina; a consulta anual de 2026 e a listagem de artigos também passaram. Oito testes automatizados cobrem preservação, deduplicação, retomada e rejeição de erros.

Após trocar de banco, recarregue a página e ajuste eventuais parâmetros `from`/`to` antigos à cobertura disponível. Os artigos do mapa referem-se ao intervalo selecionado; a barra temporal mostra também o total do corpus.

## Inspeção e mudanças

A versão anterior usava uma consulta SQL anual no Mapa e arquivos JSON de quatro cortes para inferência, métricas e agentes. O bloqueio era `if (temporal) return` no Mapa e a ocultação do botão. Agentes carregavam candidatos estáticos e consultavam literatura por outra rota. Agora todas as abas usam o contexto temporal compartilhado, sem seletor de universos distintos. Os JSON históricos continuam como artefatos de referência/teste e sementes de layout, sem fornecer calibração às novas operações.

O Canvas 2D/3D, layout em worker, toolbar, filtros inferiores, resumo e artigos foram preservados. O estado temporal e os filtros transitam na URL e na navegação entre abas. A aba Agentes continua separada de Validação e Mapa. A aba Por ano de corte calcula cortes do intervalo selecionado, quatro por página, somente mediante ação do usuário.

## Um único período

Contrato canônico: `{startYear, endYear}`. A camada Python ainda aceita `{start,end}` como compatibilidade com clientes locais antigos. Não há substituição silenciosa por um corte antigo.

- Exploração, busca, termos-chave, artigos e contexto de geração usam exatamente o intervalo inclusivo selecionado.
- Validação usa `validationCutoff = endYear`. Treino disponível até esse ano; holdout começa em `endYear + 1` e termina no máximo real do corpus.
- Exemplo: exploração de 2018 mostra 2018; validação desse período usa dados até 2018 e teste em 2019–2025 no corpus inicial.
- Limites vêm de `MIN(year)` e `MAX(year)`. O catálogo é atualizado a cada minuto; a revisão do banco integra as chaves de cache do grafo, dos artigos e das análises.

O crescimento mantém `log((ocorrências nos últimos 5 anos + 1)/(ocorrências nos 5 anos anteriores + 1))`, limitado a [-2,2]. A janela termina em `endYear`; pode anteceder o início da janela de observação. Isso é intencional para conservar a fórmula existente. Sem dez anos de cobertura, `growthAvailable=false`, com motivo explícito. Não se apresenta esse índice como percentual.

## Filtros e consultas

OR reúne conceitos das categorias escolhidas. AND mantém conceitos dessas categorias cuja vizinhança direta, incluindo o próprio conceito, cubra todas as categorias selecionadas. Não significa pertencimento múltiplo de um nó ou interseção de categorias no mesmo artigo. Sem categorias, não há restrição. Busca textual é aplicada nesse universo; termos-chave selecionam sementes e vizinhos dentro dele. O mesmo conjunto alimenta mapa, resumo, artigos, candidatos e agentes.

Endpoints privados:

- `GET /metadata`: cobertura, revisão, contagem e origem.
- `POST /graph`: período; até 4.500 conceitos por frequência e 30.000 arestas por peso.
- `POST /articles`: período, `meshIds`, cursor; 20 artigos, total distinto e distribuição anual. Lista vazia de conceitos retorna zero artigos.
- `POST /analysis`: período, operação `explore` ou `validate`, conceitos/sementes opcionais. Retorna `pending`, `busy`, `complete` ou `error`; o cliente consulta novamente enquanto está na fila.
- `POST /evidence`: período, dois conceitos, universo permitido opcional. Resolve descritores no banco e devolve artigos reais e pontes; não aceita evidência inventada pelo cliente.
- `POST /ingestion-jobs`: endpoint administrativo separado, autenticado e desabilitado por padrão.

Não há endpoints separados para busca global/termos-chave: o filtro reutilizável atua no grafo limitado; a inferência recebe os IDs resultantes em uma consulta. A ausência de aresta no grafo exportado não comprova novidade: candidatos são conferidos contra `pair_year` completo até o corte.

## Treino e validação sem dados futuros

`temporal_model.py` reutiliza as 14 features, regressão logística e HistGradientBoostingClassifier do pipeline existente. Para corte C, extrai features em C−6, rotula aparições em C−5…C e treina. As features de teste são extraídas até C; somente depois da predição são lidos rótulos do holdout C+1…maxYear. Crescimento e seleção de conceitos de treino também ficam limitados à data das features. A rotina offline antiga recebeu a mesma correção de crescimento e seleção temporal.

Condições mínimas: dez anos de histórico antes da janela interna de calibração de seis anos, 12 publicações por conceito nos snapshots de treino, três pontes ABC e pelo menos 20 exemplos de cada classe para treino/avaliação. Sem isso, a resposta informa insuficiência. Sem holdout posterior não há validação, mas exploração continua possível.

O trabalho pesado roda em um executor Python com um worker e até quatro jobs pendentes. Cache de análises: 12 resultados; cache de modelos: seis cortes/revisões. Reiniciar o serviço pode exigir recalcular análises, mas não perde artigos ou checkpoints de ingestão. O orçamento atual é de 6.000 pares candidatos e 200 resultados, com grafo limitado; as métricas descrevem essa amostra de candidatos, não todos os pares possíveis do PubMed. Boosting e regressão logística são comparados com seis baselines. Não se inventam ajustes de lei de potência ou testes DeLong quando não calculados.

## Agentes e Workers AI

Provider padrão: Cloudflare Workers AI, binding `AI`. Modelo padrão centralizado em `src/lib/agent-config.ts`: `@cf/meta/llama-3.1-8b-instruct`; `AI_MODEL` pode sobrescrevê-lo no servidor. `generateAgentResponse` encapsula o provider. O build produz configuração Wrangler com binding AI e `nodejs_compat`.

Não há gateway externo nem chave de provedor solicitada ao usuário final. Foram removidos o gateway anterior, telemetria/editor, pacote de configuração Vite e SDKs de IA que não são mais usados. O lockfile npm é a fonte de dependências; o lockfile Bun antigo foi retirado para não conservar dependências obsoletas.

Geração consulta primeiro a API/banco, com datas e IDs controlados pelo servidor. Prompts científicos foram preservados e receberam instruções de grounding e de tratamento dos títulos como dados. Probabilidades e pontes enviadas pelo cliente não servem como evidência. JSON é validado; listas de PMIDs fora do contexto são rejeitadas. A verificação usa apenas artigos posteriores ao corte, sem confundir coocorrência com confirmação mecanística.

Limites: o corpus inicial contém principalmente títulos, não abstracts completos; a avaliação científica requer revisão humana. O conhecimento prévio de um LLM pré-treinado não pode ser apagado por um prompt: a separação garantida é a dos dados recuperados e dos modelos de ligação. Isso não constitui uma prova de ausência de conhecimento futuro no pré-treinamento do LLM.

Workers AI oferece uma franquia gratuita sujeita aos limites da conta; não é inferência ilimitada gratuita. Ver [bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/) e [preços/franquia](https://developers.cloudflare.com/workers-ai/platform/pricing/). Sem binding, o app informa indisponibilidade; não muda para uma API paga. O dev Vite puro não emula AI; uma chamada real requer ambiente Cloudflare configurado. Os testes unitários usam um binding simulado, sem cobrança.

## Ingestão automática

```sh
# Banco novo para a baseline; não sobrescreve a amostra local.
.venv/Scripts/python.exe pipeline/pubmed_sync.py --db pipeline/data/indexes/pubmed.sqlite --max-files 1
# Sincronização completa inicial e, depois, somente arquivos novos:
.venv/Scripts/python.exe pipeline/pubmed_sync.py --db pipeline/data/indexes/pubmed.sqlite
# Alternativa de agendamento local/externo:
.venv/Scripts/python.exe pipeline/pubmed_sync.py --db pipeline/data/indexes/pubmed.sqlite --interval 86400
```

Descobre listagens oficiais HTTPS; registra baseline e updates; processa baseline primeiro e updates numericamente. Downloads retomam `.part`; valida MD5 oficial e grava SHA-256 nos marcadores. Arquivos incorporados não são baixados novamente. Falha interrompe a sequência; retry retoma checkpoints transacionais, sem duplicar artigos. Um lock de sistema operacional (SQLite) ou advisory lock (PostgreSQL) garante um escritor.

`ingestion_files` registra nome, tipo, ciclo, URL, checksum, tamanho, datas de download/processamento/incorporação, status, registros, inserts, updates, deletes, checkpoint e erro. Contadores de efeitos e checkpoint são confirmados na mesma transação dos artigos. Revisões subtraem as contribuições antigas antes de adicionar as novas; deletes retiram relações e agregados. `node_year` e `pair_year` são atualizados incrementalmente. Quantidade de artigos é consultada diretamente em `articles`, sem contador redundante.

Uma baseline anual nova requer banco novo e troca planejada após validação; o sincronizador recusa misturá-la silenciosamente com o ciclo anterior ou com a amostra inicial. Livros (`PubmedBookArticle`) continuam fora do parser de artigos MeSH. Fonte: [distribuição PubMed](https://pubmed.ncbi.nlm.nih.gov/download/). Não se usa E-utilities para carga massiva.

## Armazenamento bruto e R2

Local: `pipeline/data/raw/baseline`, `raw/update`, `processed`, `indexes`, `checksums`, `manifests`. Dados gerados ficam fora do Git.

Com `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, o processo externo arquiva os XML validados via API S3 compatível, com upload multipart e deduplicação por SHA-256 nos metadados. Chaves: `pubmed/baseline/`, `pubmed/updates/`, `pubmed/checksums/`, `pubmed/processed/` (manifestos de incorporação). JSONL intermediário fica local: não há segunda cópia bruta desnecessária no R2. A cópia local é staging para parse/retomada e não é apagada automaticamente. O ledger SQL é a autoridade de incorporação; presença de um XML no R2 não significa que o banco já o recebeu.

## Cron, Queue e serviço externo

`cloudflare/ingestion-worker.ts` apenas agenda e entrega jobs. `wrangler.ingestion.jsonc` define Cron diário e filas `pubmed-sync` e `pubmed-sync-failed`. Configure `INGESTION_API_URL` e o secret `INGESTION_API_TOKEN` no Worker. O consumidor envia um ID diário idempotente e só confirma a mensagem quando o serviço aceita o job persistido.

No serviço Python: `ENABLE_INGESTION=1`, `INGESTION_API_TOKEN`, `PUBMED_ROOT` opcional e `DATABASE_URL` ou `--db` do banco de ingestão. `ingestion_jobs` persiste a fila; o processo retoma jobs interrompidos e tenta novamente os que falham. XML e treino não rodam dentro de requisições do frontend ou do scheduler Worker. Hospede esse processo no serviço externo já previsto pelo projeto, com disco persistente, supervisão e gateway TLS; `http.server` é a referência local, não um gateway público de produção.

## PostgreSQL e Hyperdrive

SQLite continua disponível. `DATABASE_URL=postgresql://...` ativa psycopg no importador, sincronizador e API, com o mesmo schema e UPSERTs. Índices cobrem ano/PMID, artigo–MeSH nos dois sentidos, categorias e pares anuais. `sql_backend.py` adapta placeholders e detalhes do SQLite sem duplicar a lógica de contribuição.

No build da aplicação, `HYPERDRIVE_ID` adiciona o binding `HYPERDRIVE`. Com ele, `postgres-map.server.ts` executa catálogo, grafo, artigos e evidências diretamente por `pg`, dentro de transações de leitura. Análise científica continua no serviço Python via `MAP_API_URL`/`MAP_API_TOKEN`. **Ambos devem apontar para o mesmo PostgreSQL**, evitando divergência de dados/revisões. Sem Hyperdrive, a API SQL externa atende todas as consultas. Ver [conexão oficial PostgreSQL/Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/).

Nenhum banco, bucket, fila ou deployment foi provisionado automaticamente. Não foi executada uma baseline completa. Capacidade para milhões exige dimensionamento, medição real de memória/SQL e possível particionamento dos agregados; a implementação não alega benchmark nessa escala.

## Testes

```sh
npx tsc --noEmit
npm run build
node --test tests/map.test.mjs tests/map-renderers.test.mjs tests/temporal-search.test.mjs tests/agent-provider.test.mjs
.venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py" -v
# Opt-in, com aplicação e API em execução:
# MAP_TEST_URL=http://127.0.0.1:8083
node --test tests/local-http.test.mjs
# Integração opcional do LLM (não executada automaticamente):
# definir AI_TEST_ACCOUNT_ID e AI_TEST_TOKEN de operador Cloudflare
node --test tests/workers-ai.integration.mjs
```

As fixtures de datas controladas são restritas aos testes. A suíte cobre período individual/intervalo, buscas, AND/OR, artigos/evidências, fronteiras de treino, insuficiência, novo ano, revisão/delete, sequência de ingestão, checkpoint, fila idempotente e binding do agente. Canvas instrumentado não substitui QA visual de navegador. R2, PostgreSQL/Hyperdrive e inferência real Workers AI precisam de integração com recursos configurados para validação operacional.

## Arquivos principais desta etapa

- `src/components/TemporalContext.tsx`, `AppNav.tsx`, rotas e `use-temporal-analysis.ts`: período compartilhado e operações nas respectivas abas.
- `src/lib/temporal.ts`, `map-api.functions.ts`, `map-api.server.ts`, `postgres-map.server.ts`: contrato temporal e consultas SQLite/API ou PostgreSQL/Hyperdrive.
- `src/lib/agent-config.ts`, `agent-provider.server.ts`, `hypothesis.functions.ts`, `vite.config.ts`: IA server-side e build independente.
- `pipeline/temporal_model.py`, `build_from_corpus.py`: treino, features temporais e holdout.
- `pipeline/pubmed_sync.py`, `ingestion_jobs.py`, `sql_backend.py`, `map_store.py`, `map_api.py`: sincronização, ledger, persistência e consulta.
- `cloudflare/ingestion-worker.ts`, `wrangler.ingestion.jsonc`: Cron e Queue.
- Novos testes `temporal-search`, `agent-provider`, `local-http`, `test_temporal_ingestion`, `test_temporal_leakage`.
