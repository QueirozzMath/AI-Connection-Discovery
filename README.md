# PubMed Discovery Nexus

Prompt inicial que usei: Gostaria de construir um algoritmo de visualização e análise similar ao desse site https://sciencemap.eto.tech/?mode=map , mas usando como banco de dados os MESH Terms do PubMed, poderia me ajudar a desenvolver esse código completo? Código de rascunho para as análise sobre os grafos em anexo. A ideia é a partir do rede multiplex, poder inferir usando redes informadas por biologia, datadas até o ano de corte, quais conceitos/ideias tem maior probabilidade de gerarem uma descoberta por literatura desconexa. Após inferir as conexões o sistema usará agentes de IA alimentados apenas com os artigos de cada conceito e baseado nele formularão hipóteses sobre o que a nova conexão pode formar. O sistema precisa mostrar métricas claras dos resultados do treinamento, tais como número de conexões confirmadas após o corte, tempo até cada nova conexão, se a hipótese formulada pelos agentes estava correta, qual a eficácia desse modelo em comparação a outros existentes,...

Arquitetura e execu??o: [guia do pipeline e do mapa](pipeline/MAP_ARCHITECTURE.md).

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
