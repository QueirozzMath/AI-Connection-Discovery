# Exploração fundamentada: módulo experimental

Implementação de pesquisa em `pipeline/recombination.py`, compatível com o corpus JSONL/JSONL.gz usado por `build_from_corpus.py`. Não altera o site nem a política de produção. Base: main `25b6653692593581dafb6bce915455e719647b07`.

## Executar

```bash
python pipeline/recombination.py --corpus pipeline/cache/pubmed_corpus.jsonl.gz --cutoff 2018 --seed D012130 --max-states 2000 --null-samples 64 --output recombination-2018.json
python -m unittest discover -s tests -p test_recombination.py -v
```

O identificador da semente precisa existir no corpus filtrado. A ausência resulta em lista vazia, não em conceitos inventados. Sem `--strict-availability`, o corte considera publicação e qualquer `available_year` informado, mas não garante reconstrução da indexação histórica. No modo estrito, registros sem `available_year` são excluídos. Não inventar esse campo a partir do ano de publicação.

Formato: `{"pmid":"...","year":2018,"mesh":[["D...","nome",true]],"abstract":"...","available_year":2018}`. Os campos PMID, ano e descritores já correspondem ao pipeline; resumos e disponibilidade podem faltar e precisam ser obtidos legitimamente. Sem resumos suficientes, candidatos são exportados, mas os dossiês não autorizam geração. Identificadores conflitantes são excluídos integralmente.

## Generalização implementada

- Caminhos simples até quatro arestas, com limite de estados.
- Todos os segmentos contíguos de pelo menos duas arestas são avaliados; isso permite alvos intermediários, como B–D no caminho A–B–C–D.
- A ausência de relação é verificada no grafo analítico completo, antes do mínimo de suporte para busca.
- `--proposals pares.json` recebe uma lista explícita de pares de descritores. Esses pares precisam estar ausentes do grafo e ter extremos existentes. Não são adicionados às evidências observadas.
- Por padrão, no máximo uma ligação interna hipotética, no máximo 1/3 das arestas e pelo menos duas ligações observadas. O alvo final é a hipótese principal; essas lacunas são hipóteses adicionais.
- Modelos semânticos, preditores e agentes podem fornecer propostas por essa interface. Sua geração automática e integração à UI ainda não estão implementadas.

## Política de seleção

Fundamentação `G = 1-exp(-min_support/2)`. Modelo nulo por trocas de incidência artigo–descritor dentro de cada ano, preservando tamanho de artigo e frequência anual do descritor. São 64 amostras, 10 tentativas de troca por incidência e semente 0 por padrão. Mistura/convergência não foi estabelecida; ausência de variância produz z indefinido. O nulo percorre o corpus inteiro a cada amostra: validar memória e tempo em subconjuntos antes da base completa.

Convencionalidade C = mediana superior dos z definidos entre todos os pares de nós do caminho. Cauda T = posição floor(0.1*(m-1)). Escores indefinidos têm cobertura explícita; sem estatística, bônus zero.

`R = G + 0.25*clip(C/3)*clip(-T/3) - 0.1*(L-2) - 0.5*numero_lacunas`.

Seleção gulosa por R menos 0.3 vezes a maior similaridade Jaccard de nós com candidatos já selecionados; um caminho representativo por alvo, até dez alvos. Não é probabilidade nem política treinada. Contagem de artigos não mede verdade, independência ou causalidade. Limites e desempate determinístico podem enviesar a busca; não prometemos enumeração exaustiva ou ótimo global.

A motivação é Uzzi et al. (2013), DOI 10.1126/science.1240474. O estudo usa cocitações de periódicos e impacto por citações; esta é uma adaptação experimental à coindexação MeSH. Não inferimos do artigo a proporção 1/3 nem uma receita universal para disrupção.

## Chamadas multiagentes

`run_agents(dossier, invoke, max_calls=5)` executa chamadas separadas: mecanismo, alternativa (sem ver a primeira proposta), cético, experimento e síntese. O callback `invoke(role, payload)` deve retornar `{"text":"...","citations":["PMID",...]}`. A saída conserva divergências e ligações não verificadas. Citações são validadas por pertencimento ao dossiê, não por implicação semântica.

O módulo não importa SDK, não contém chave e não chama provedores por padrão. Para integração real, fornecer um callback que utilize o roteamento autorizado do projeto, aplique orçamento de tokens, registre versão/modelo/custos e valide o conteúdo. O limite implementado é de chamadas, não de tokens. Não há recuperação automática de contraevidência ou execução de experimentos. Testes usam callbacks simulados: nenhuma qualidade de LLM real foi medida.

## Experimentos necessários

Comparar A–B–C; múltiplos saltos observados; múltiplos saltos com lacunas; selecionar por suporte, atipicidade, combinação dos dois, previsão de ligação e amostragem uniforme. Variar penalidade de redundância e limites. Comparar chamada única com chamadas separadas sob custo agregado igual. Usar a mesma evidência e ocultar scores dos agentes. Desfechos: hipóteses aceitáveis e não redundantes por orçamento, novidade avaliada com busca datada, cobertura, suporte às afirmações, testabilidade, falhas e abstenções. Não usar sucesso em testes unitários como resultado científico.
