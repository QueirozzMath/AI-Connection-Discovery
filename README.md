# PubMed Discovery Nexus

Gostaria de construir um algoritmo de visualização e análise similar ao desse site https://sciencemap.eto.tech/?mode=map , mas usando como banco de dados os MESH Terms do PubMed, poderia me ajudar a desenvolver esse código completo? Código de rascunho para as análise sobre os grafos em anexo. A ideia é a partir do rede multiplex, poder inferir usando redes informadas por biologia, datadas até o ano de corte, quais conceitos/ideias tem maior probabilidade de gerarem uma descoberta por literatura desconexa. Após inferir as conexões o sistema usará agentes de IA alimentados apenas com os artigos de cada conceito e baseado nele formularão hipóteses sobre o que a nova conexão pode formar. O sistema precisa mostrar métricas claras dos resultados do treinamento, tais como número de conexões confirmadas após o corte, tempo até cada nova conexão, se a hipótese formulada pelos agentes estava correta, qual a eficácia desse modelo em comparação a outros existentes,...

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7dd15d38-a40d-4a24-b322-bbe27eaaffce).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
