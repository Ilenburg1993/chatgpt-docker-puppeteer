Inventário do Código — `src/`
=================================

Resumo do mapeamento
---------------------
- Arquivos encontrados em `src/`: aproximadamente 143 (varias subpastas: `kernel/`, `nerv/`, `server/`, `driver/`, `infra/`, `core/`, `logic/`, `shared/`, entre outras).
- Entrypoint principal: `src/main.js`.
- Padrão de importação: uso extensivo de `require()` / `import` e aliases configurados via `_moduleAliases` em `package.json`.

Aliases (`_moduleAliases` em `package.json`)
------------------------------------------------
- `@` → `./src`
- `@core` → `./src/core`
- `@shared` → `./src/shared`
- `@nerv` → `./src/nerv`
- `@kernel` → `./src/kernel`
- `@driver` → `./src/driver`
- `@infra` → `./src/infra`
- `@server` → `./src/server`
- `@logic` → `./src/logic`

Dependências (runtime)
----------------------
- compression
- express
- express-rate-limit
- ghost-cursor
- js-yaml
- module-alias
- openai
- p-limit
- pm2
- puppeteer
- puppeteer-extra
- puppeteer-extra-plugin-stealth
- socket.io / socket.io-client
- tree-kill
- user-agents
- uuid
- zod

Dependências de desenvolvimento
-------------------------------
- eslint, prettier, madge, mermaid, nodemon, puppeteer-core, c8, sinon, supertest, entre outras (ver `devDependencies`).

Observações da análise de imports
--------------------------------
- Muitos `require()` locais para módulos dentro de `src/` e uso consistente de aliases (`@core`, `@infra`, etc.).
- Há scripts utilitários em `scripts/` para analisar grafo (`scripts/analyze-code-graph.js`) e para auditar dependências (`scripts/audit-dependencies.js`).
- A ferramenta recomendada para gerar grafo é `madge` (já disponível nos `devDependencies`).

Comandos úteis para regenerar/atualizar este inventário
------------------------------------------------------
- Gerar grafo de dependências (madge):

  npm run analyze:deps

- Exportar grafo completo e analisar orfãos/circularidades:

  npm run analyze:graph:full

Próximos passos recomendados
---------------------------
1. Gerar diagramas Mermaid baseados no grafo (arquitetura e sequência de boot) e salvar em `DOCUMENTAÇÃO/diagrams/`.
2. Escrever documentos detalhados por subsistema (`DOCUMENTAÇÃO/NERV.md`, `DOCUMENTAÇÃO/KERNEL.md`, etc.).
3. Construir `DOCUMENTAÇÃO/RUNBOOK.md` com comandos operacionais e procedimentos de recuperação.

Local deste arquivo
-------------------
`assistant/inventory-src.md`

Observação
---------
Este inventário é um resumo inicial produzido automaticamente. Posso refinar incluindo uma lista completa de arquivos, contagem por diretório, e um CSV/JSON detalhado se desejar.
