# Mapa: exploração anual, artigos e ingestão

Referências de UX: [Map of Science](https://sciencemap.eto.tech/?mode=map), [lista de publicações CS Biology](https://www.csbiology.org/publication) e imagem multicamada fornecida. A implementação preserva o Canvas e a identidade visual do projeto.

## Execução local

Requer Node já usado pelo projeto e Python 3.11+; os scripts novos usam apenas a biblioteca padrão. Com o Python gerenciado pelo uv, substitua `python` por `uv run --no-project python`.

```sh
python pipeline/map_store.py --input pipeline/cache/pubmed_corpus.jsonl.gz
python pipeline/map_api.py --host 127.0.0.1 --port 8090
npm run dev
```

O corpus inicial é uma **amostra real**, não o PubMed completo: 67.560 registros de 1985 a 2025. O banco gerado fica em `pipeline/data/indexes/map.sqlite`, fora do Git. Reexecutar a importação do mesmo arquivo não duplica artigos nem pesos. Um arquivo já importado deve permanecer imutável; correções entram em novos arquivos de atualização.

Em desenvolvimento, o servidor TanStack consulta `http://127.0.0.1:8090`. No deploy, configure **somente no servidor** `MAP_API_URL=https://endereco-do-servico` e, se utilizado, `MAP_API_TOKEN` com o mesmo valor no serviço Python. O navegador chama as server functions do app e não recebe endereço privado nem token. O banco não é empacotado no Cloudflare. O serviço SQL deverá ser hospedado separadamente, conforme a decisão do projeto; `http.server` é o servidor de referência local, não um substituto por um gateway de produção. Sem o serviço, a aplicação mantém os recortes publicados e indica que artigos/consulta anual estão indisponíveis.

## Fluxo e contratos

```text
XML PubMed / corpus local
    -> parser streaming -> eventos upsert/delete
    -> importador transacional -> SQLite + agregados anuais
    -> API privada -> server functions TanStack -> React Query
    -> grafo limitado -> filtro de categorias -> AND/OR -> busca -> termos-chave
    -> Canvas 2D/3D + resumo + páginas de artigos
```

- `GET /metadata`: limites temporais reais, quantidade de artigos, origem, revisão do banco.
- `POST /graph {start,end}`: soma `node_year` e `pair_year`. Não lê textos dos artigos. Retorna até **4.500 conceitos por frequência** e **30.000 arestas por peso**. As métricas da visualização e as consultas de artigos usam esse universo explicitamente limitado; não afirmam representar todos os conceitos do PubMed. Os limites aparecem no painel direito.
- `POST /articles {start,end,meshIds,cursor}`: semijoin indexado artigo–MeSH, no máximo 20 artigos, cursor por ano/PMID, total distinto e distribuição anual. `meshIds=[]` retorna zero, nunca todos. O conjunto de IDs é derivado exatamente do filtro do mapa (ou do nó fixado por clique). Nenhuma consulta é disparada ao passar o mouse.
- Um artigo aparece quando contém ao menos um conceito do conjunto resultante. A rede opcional é bipartida artigo–MeSH, restrita à página e a 24 descritores. Não há alegação de citação.
- DOI, periódico e autores ausentes não são preenchidos artificialmente. O corpus inicial possui sobretudo título/PMID/ano/MeSH; a ingestão XML preserva os metadados adicionais quando existem.

As entradas são validadas no servidor e os parâmetros SQL são vinculados. O limite de concorrência local é de duas consultas pesadas. Grafos têm cache LRU de 12 entradas, páginas de 128, ambos associados à revisão do banco. React Query mantém cache de resultados no cliente. O layout em worker e suas posições permanecem separados dos filtros/câmera.

## AND/OR e buscas

Cada conceito tem uma categoria principal (`cat`). OR é a união das categorias. AND mantém conceitos **das categorias escolhidas** cuja vizinhança direta no grafo do período, incluindo a categoria do próprio conceito, alcance todas as categorias escolhidas. Isso é interseção de cobertura da vizinhança, **não** pertencimento múltiplo nem prova de que todas as categorias ocorreram no mesmo artigo. Com nenhuma categoria, ambos os operadores não restringem a rede.

A cobertura é memoizada antes da busca textual. A busca textual é aplicada dentro desse conjunto. No modo termos-chave, os conceitos escolhidos e seus vizinhos diretos são intersectados com o mesmo conjunto permitido. Os artigos usam os IDs resultantes, portanto o operador é aplicado uma única vez, com a mesma semântica, em mapa/resumo/artigos. As predições nos recortes validados recebem a adjacência induzida pelo filtro; candidatos, âncoras e pontes não escapam dele.

Categorias, operador, texto, período, tipo de recorte, modo 2D/3D/hierarquia e cor são serializados na URL. Câmera, hover e seleção temporária são locais. Limpar filtros remove texto, categorias e termos-chave; resetar câmera preserva os filtros.

## Tempo e métricas

Os campos inicial/final aceitam anos inteiros dentro do corpus importado. Anos iguais representam um ano individual. Não se oferece 1946 ou 2026 como se existissem dados locais nesses anos; uma nova ingestão amplia os limites reais. As consultas somam pré-agregados anuais, não reprocessam os artigos a cada mudança. Alterar o período pode recalcular o layout do novo grafo; trocar filtros, hover ou câmera não o recalcula.

O crescimento conserva a fórmula do pipeline existente: logaritmo da razão entre ocorrências dos cinco anos terminando no ano final e dos cinco anos anteriores, com suavização +1 e limite [-2,2]. Quando o corpus não cobre os dez anos necessários, `growthAvailable=false`: cor cinza e indicação de indisponibilidade. A escala de cor satura em [-1,1], igualmente em 2D e 3D. Não se transforma esse índice em porcentagem.

O modelo de predição e suas métricas permanecem nos **recortes validados**. Eles não são apresentados como validados para intervalos arbitrários. A exploração anual mantém busca global/termos-chave, mas não executa inferência com uma calibração temporal inexistente.

## 3D e navegação

O Canvas existente foi preservado, sem dependência de WebGL adicional. X/Y usam o layout relacional; Z é a categoria principal, ordenada por código. A altura é categórica, não ranking. Planos, nomes e cores vêm dos dados. Arestas dentro/entre camadas são as mesmas coocorrências reais.

São desenhadas no máximo 4.500 arestas de contexto, até 160 conexões mais fortes do nó selecionado e 30 labels de conceitos. Posições, cobertura, vizinhos de foco, máximo de grau e buffers são memoizados. O volume de artigos não vira objetos DOM no mapa. A rede de artigos possui um orçamento independente e pequeno.

A toolbar atua nas câmeras existentes: PNG do Canvas (sem os painéis HTML), aproximar/afastar, enquadrar seleção, restaurar câmera global; arrasto translada em 2D, rotaciona ou translada em 3D. Zoom por retângulo existe em 2D. A mudança de modo preserva os filtros. O painel direito mostra prévia de hover e fixa detalhes por clique.

## Distribuição oficial e ingestão em lote

A NLM oferece baseline anual XML e arquivos diários com inclusões, revisões e exclusões. A ordem oficial é baseline antes das atualizações diárias, estas em ordem numérica. Fontes: [Download Data — PubMed](https://pubmed.ncbi.nlm.nih.gov/download/) e [NLM Data Distribution](https://www.nlm.nih.gov/databases/download/data_distrib_main.html).

```sh
# Normalizar arquivos oficiais já baixados, sem texto completo:
python pipeline/pubmed_bulk.py --directory pipeline/data/raw
# Ou baixar/processar URLs oficiais explícitas de um manifesto (uma por linha):
python pipeline/pubmed_bulk.py --manifest baseline-urls.txt
# Opcional: conservar somente PMID/ano/MeSH/operação:
python pipeline/pubmed_bulk.py --directory pipeline/data/raw --mesh-only
# Aplicar cada arquivo normalizado, em ordem, ao banco:
python pipeline/map_store.py --input pipeline/data/processed/pubmed26n0001.xml.gz.metadata.jsonl.gz
```

O downloader só aceita os caminhos oficiais HTTPS de baseline/updatefiles, valida o MD5 publicado, reutiliza arquivos íntegros e retoma `.part` quando o servidor aceita Range. O parser XML processa uma citação por vez, grava saídas atomicamente e registra SHA-256/progresso em `pipeline/data/indexes`. Não baixa a baseline completa implicitamente. Registros de livros têm outra estrutura e são ignorados nesta versão; não são convertidos em artigos MeSH fictícios.

O importador aplica batches de 500 registros e grava o checkpoint na mesma transação dos artigos/associações/agregados. Um upsert subtrai as contribuições anteriores antes de adicionar as atuais. `DeleteCitation` remove artigo, associações e contribuições anuais. Arquivos oficiais fora de ordem são rejeitados. A retomada de um gzip relê até o checkpoint, mas não reaplica os registros já confirmados. Execute um único importador por banco. Uma nova baseline anual completa deve inicializar um novo banco, seguido dos updates daquele ciclo, antes da troca do serviço.

Não existe um atalho oficial aqui que forneça somente coocorrências MeSH prontas: o modo econômico **extrai** campos mínimos do XML e descarta o restante; ele reduz armazenamento/processamento posterior, não o tamanho do XML distribuído. E-utilities permanece apropriado para consultas selecionadas, não para esta carga grande. Caso usado pelo fluxo existente, `NCBI_API_KEY` fica em ambiente. [Política oficial E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25497/) documenta limites por IP/chave.

## Escala e migração SQL

Índices: `articles(year,pmid)`, `article_mesh(pmid,mesh_id)` e inverso, `mesh(category,id)`, `node_year(year,mesh_id)` e inverso, `pair_year(year,mesh_a,mesh_b)` e `(mesh_a,mesh_b,year)`. Títulos/metadados ficam separados dos agregados usados no mapa.

Para PostgreSQL, preservar os contratos HTTP e substituir `sqlite3`, `INSERT OR REPLACE`, PRAGMAs e tabelas temporárias pelo adaptador PostgreSQL/UPSERT. Particionar os agregados por ano, usar carga COPY/staging para grandes batches e avaliar estatísticas/materialização conforme os planos reais. O esquema não transforma SQLite automaticamente em PostgreSQL. A implementação local foi exercitada com 67.560 artigos; **não foi medida com milhões**. A explosão combinatória de pares por artigo é o principal custo que deve ser medido antes de uma baseline integral.

## Verificação

```sh
npx tsc --noEmit
npm run build
node --test tests/map.test.mjs tests/map-renderers.test.mjs
python -m unittest discover -s tests -p test_map_pipeline.py -v
```

Os testes usam o corpus real e fixtures de operações de atualização/exclusão em bancos temporários. A validação com Canvas instrumentado não substitui QA visual em navegador real. O ambiente desta sessão não disponibilizou um navegador controlável.

## Arquivos desta rodada

- `src/routes/index.tsx`: composição, estado/URL, controles, período e resumo contextual.
- `src/components/ScienceMap.tsx`, `ScienceMap3D.tsx`: câmeras, hover, navegação e camadas.
- `src/components/MapToolbar.tsx`, `MapArticles.tsx`: toolbar e exploração de artigos.
- `src/lib/map-selection.ts`, `discovery.ts`: AND/OR e inferência restrita ao subconjunto.
- `src/lib/map-navigation.ts`, `map-layers.ts`: exportação e posições semânticas das camadas.
- `src/lib/science-data.ts`: indicação opcional de disponibilidade do crescimento.
- `src/lib/map-api-types.ts`, `map-api.functions.ts`, `map-api.server.ts`: contrato e proxy privado.
- `pipeline/pubmed_bulk.py`, `map_store.py`, `map_api.py`: extração em lote, armazenamento e consulta.
- `pipeline/.gitignore`, `pipeline/data/.gitignore`, `tests/.gitignore`: dados gerados e caches fora do Git.
- `tests/map.test.mjs`, `map-renderers.test.mjs`, `test_map_pipeline.py`: regressões e integração.
- Este documento: decisões, operação local, deploy e limites de escala.
