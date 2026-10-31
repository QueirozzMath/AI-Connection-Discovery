export const aboutSections = [
  {
    title: "Uma plataforma para conectar conhecimentos dispersos",
    paragraphs: [
      "AI Connection Discovery é um ambiente de exploração da literatura biomédica que combina um mapa de conceitos, consulta de artigos, organização hierárquica por assunto e geração assistida de hipóteses. Seu propósito é ajudar o usuário a perceber relações que podem ficar escondidas quando a leitura se concentra em uma única especialidade ou em buscas isoladas. O ponto de partida é a literatura incluída na plataforma: o mapa representa esse recorte bibliográfico, e não a totalidade do conhecimento científico.",
      "A plataforma serve como instrumento de investigação e formulação de perguntas. Um estudante pode utilizá-la para conhecer a vizinhança de um tema; um pesquisador pode examinar pontes entre áreas; uma equipe pode selecionar conexões para revisão de literatura. Cada caminho encontrado precisa ser interpretado à luz dos artigos e do contexto experimental.",
    ],
  },
  {
    title: "Inspiração e motivação: descoberta por literatura desconexa",
    paragraphs: [
      "A lógica central é a descoberta baseada em literatura, frequentemente descrita por um caminho A–B–C. Se um conjunto de trabalhos relaciona A a B e outro relaciona B a C, B pode oferecer uma ponte para investigar uma relação entre A e C. A inspiração conceitual é aproximar fragmentos de conhecimento que existem em comunidades ou conjuntos de publicações separados. Isso não significa que toda ponte produza uma descoberta: uma conexão pode ser trivial, indireta, incompatível ou já conhecida fora do corpus.",
      "A motivação é tornar a exploração interdisciplinar mais explícita e verificável. Em vez de apenas apresentar um texto gerado, a interface permite partir de conceitos, observar conexões e consultar artigos antes de formular uma explicação. A descrição explica o princípio do projeto; ela não atribui uma história pessoal ou uma descoberta experimental aos seus autores.",
    ],
  },
  {
    title: "Dados de origem, cobertura e atualização",
    paragraphs: [
      "Os dados bibliográficos têm origem no PubMed, e os conceitos são organizados com descritores MeSH. A quantidade de artigos, os anos e os cortes disponíveis devem ser lidos nos indicadores da própria interface. São essas informações que delimitam o alcance de uma exploração. Um assunto ausente ou pouco conectado pode estar sub-representado no conjunto importado, sem ser pouco importante na ciência.",
      "Os arquivos e serviços utilizados pela versão publicada determinam quais consultas estão disponíveis. Não se deve supor que o mapa seja uma reprodução em tempo real de todo o PubMed, nem que todas as atualizações do MeSH já estejam importadas. Consulte o registro original no PubMed para conferir título, data e informações bibliográficas antes de utilizar um resultado em seu trabalho.",
    ],
  },
  {
    title: "MeSH: a linguagem comum entre os artigos",
    paragraphs: [
      "MeSH organiza assuntos biomédicos por descritores padronizados, identificadores e posições hierárquicas. O identificador ajuda a distinguir conceitos com nomes parecidos, enquanto a hierarquia permite passar de uma área ampla a um assunto específico. Um descritor pode aparecer em mais de um caminho da árvore; isso reflete suas relações com diferentes ramos, não necessariamente um erro ou uma duplicação de artigos.",
      "A árvore existe para orientar a navegação temática. Já a rede mostra relações bibliográficas entre conceitos. São perspectivas complementares: proximidade na classificação e coocorrência em publicações respondem a perguntas diferentes. Ao escolher um descritor, confira seu nome e código para evitar interpretar uma categoria ampla como se fosse um conceito muito específico.",
    ],
  },
  {
    title: "Como os artigos se tornam uma rede",
    paragraphs: [
      "Na visualização do mapa, um nó corresponde a um conceito e uma aresta representa uma relação de coocorrência observada nos dados utilizados. Quando descritores aparecem associados a um mesmo artigo, eles fornecem um sinal de proximidade bibliográfica. As contagens e a estrutura da rede ajudam a explorar quais assuntos compartilham literatura e quais conceitos podem funcionar como pontes.",
      "O desenho é uma representação para exploração. A posição de um ponto na tela, sua cor ou uma ligação não demonstram causalidade, eficácia de tratamento ou equivalência entre conceitos. Limites de renderização e filtros podem reduzir o que aparece no mapa; por isso, diferencie sempre o total informado no corpus dos elementos efetivamente exibidos.",
    ],
  },
  {
    title: "Tempo, corte e perguntas retrospectivas",
    paragraphs: [
      "O seletor de ano permite explorar a configuração da literatura associada ao corte disponível. Seu objetivo é separar o conhecimento usado para propor uma conexão da literatura posterior usada para examiná-la. Antes de interpretar um resultado, verifique qual corte está ativo, pois mudar o ano modifica o contexto bibliográfico e pode alterar os pares e as evidências disponíveis.",
      "Uma relação encontrada depois do corte pode constituir um sinal posterior interessante, mas sua publicação não prova que a plataforma tenha descoberto um mecanismo. Também é necessário verificar se a relação já estava descrita em publicações ausentes dos dados, se os conceitos foram usados com o mesmo sentido e se o estudo posterior realmente sustenta a hipótese proposta.",
    ],
  },
  {
    title: "Mapa: pesquisar, combinar e interpretar",
    paragraphs: [
      "Rede, Hierarquia, 3D e Artigos oferecem entradas distintas para os assuntos. A busca textual ajuda a localizar nomes e códigos; as categorias restringem o recorte temático; os operadores E e OU mudam a forma de combinar critérios. Centralizar resultados ajuda a reencontrar o conjunto selecionado depois de navegar. Mostrar nós não selecionados preserva o contexto ao redor do recorte, quando ativado.",
      "Arestas controla a presença das linhas. Cor por grau destaca conectividade; Cor por crescimento oferece outra leitura quando essa medida está disponível. Desativar essas opções devolve a codificação por categoria. Nenhuma dessas cores é um selo de qualidade científica. Use-as para levantar perguntas, e confirme a interpretação nos números, nos descritores e nos artigos.",
    ],
  },
  {
    title: "Artigos e árvore: voltar à evidência bibliográfica",
    paragraphs: [
      "Artigos permite percorrer a organização MeSH e inspecionar publicações relacionadas ao recorte escolhido. Expanda os ramos para chegar a assuntos mais específicos, selecione descritores e observe como o conjunto de resultados se modifica. Utilize a busca de título ou PMID para localizar um registro quando esse controle estiver disponível. Os chips de descritores ajudam a sair de um artigo para explorar outros assuntos associados.",
      "A combinação OU amplia a consulta para registros que correspondam a qualquer descritor selecionado; E exige a presença conjunta dos critérios aplicáveis. Se o resultado ficar vazio, revise a combinação e o corte antes de concluir que não existe literatura. O link do PubMed abre a fonte bibliográfica, onde você pode verificar detalhes e acessar o texto completo quando houver disponibilidade.",
    ],
  },
  {
    title: "Inferência: priorizar caminhos de investigação",
    paragraphs: [
      "Busca global explora conexões no conjunto considerado pelo mecanismo de inferência. Termos-chave permite direcionar a busca a conceitos escolhidos pelo usuário. Inferir conexões executa a operação com a configuração atual e atualiza o ranking quando há resultados disponíveis. Essa separação permite primeiro definir uma pergunta e depois solicitar o cálculo, evitando tratar qualquer alteração visual como uma nova análise.",
      "A ordem do ranking é uma prioridade calculada pelo método implementado, não uma probabilidade universal de verdade. Pontes, contagens e escores devem ser lidos como sinais para triagem. Compare os conceitos envolvidos, examine intermediários e descarte interpretações que dependam apenas de uma associação superficial de palavras. Um resultado bem posicionado ainda exige revisão especializada.",
    ],
  },
  {
    title: "Agentes e Gemini: da conexão à hipótese",
    paragraphs: [
      "A aba Agentes organiza a análise de um par de conceitos e utiliza geração de linguagem para propor uma hipótese, um mecanismo possível, o raciocínio pela ponte, limitações e maneiras de refutar a proposta. Escolha o corte e o par antes de gerar. Quando a versão solicitar credencial, insira sua chave Gemini no campo protegido e confirme em Usar nesta sessão. Remover chave elimina a credencial da sessão da interface.",
      "Gerar hipótese inicia a chamada ao provedor configurado. Regerar solicita outra redação e pode produzir uma interpretação diferente; isso não equivale a obter evidência adicional. O conteúdo enviado é processado pelo provedor de IA e o uso depende de suas condições e cotas. Evite inserir informações pessoais ou confidenciais. A chave não deve ser colocada em campos de busca, perguntas do guia ou textos públicos.",
    ],
  },
  {
    title: "Verificação posterior e leitura crítica",
    paragraphs: [
      "Após a geração, Verificar no PubMed pós-corte solicita a busca de literatura posterior associada à proposta. A finalidade é reunir material para examinar se a conexão ganhou suporte bibliográfico e em que condições. Leia os estudos retornados, suas datas e seu objeto real: dois conceitos mencionados juntos podem não ter sido testados na relação sugerida pelo texto do agente.",
      "A hipótese, o mecanismo e o impacto potencial são interpretações que podem conter erros. Use o campo de limitações para reconhecer lacunas e a proposta de refutação para transformar uma narrativa plausível em uma pergunta testável. Ausência de resultados não refuta automaticamente uma hipótese; presença de resultados tampouco a confirma. A conclusão exige avaliação das evidências e, quando pertinente, investigação experimental.",
    ],
  },
  {
    title: "Um fluxo de trabalho e os limites de uso",
    paragraphs: [
      "Comece definindo um tema e o corte. Localize os descritores, compare a rede com a árvore e abra alguns artigos para entender o vocabulário empregado. Ajuste os filtros, escolha busca global ou termos-chave e solicite inferência. Selecione uma conexão relevante, formule a hipótese nos Agentes e examine a literatura posterior. Ao registrar suas conclusões, anote o corte, os conceitos e as fontes consultadas para que outra pessoa possa acompanhar seu raciocínio.",
      "A plataforma apoia exploração científica e aprendizado; seus resultados não são recomendações clínicas nem substituem revisão sistemática ou análise metodológica. O Guia oferece orientação local sobre os controles, enquanto o Gemini participa da geração científica quando solicitado. O botão de tema alterna a apresentação visual: o modo escuro é o padrão inicial e uma escolha explícita de tema pode ser lembrada pelo navegador.",
    ],
  },
];
