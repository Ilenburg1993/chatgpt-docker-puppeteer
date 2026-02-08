# OpenCode — Project Memory (chatgpt-docker-puppeteer)

## O que é este repositório

- Agente autônomo de automação de browser com **Puppeteer (connect-only)** + orquestração
  (Kernel/NERV) + fila de tarefas.
- O alvo “LLM” hoje é **via UI** (ex.: `chatgpt.com`) usando drivers em
  `src/driver/targets/*Driver.js`.

## Regras arquiteturais (não negociáveis)

- **Não use `puppeteer.launch()`**: o projeto conecta a um Chrome externo via DevTools Protocol
  (proxy `9224` → Chrome `9225`).
- “Chrome é propriedade do Host (Windows)”; o DevContainer **apenas conecta**.
- Ao mexer em drivers, respeite o contrato de `TargetDriver` (attach/detach context, estados,
  AbortSignal).

## Comandos úteis do projeto

- `npm run validate:all` (lint + prettier check + testes)
- `npm test` (suite padrão)
- `npm run check:chrome` (sanidade de conexão Chrome/Proxy)
- `npm run analyze:graph` (análise de dependências internas)

## Onde encontrar as coisas

- Runtime: `src/`
- Scripts: `scripts/`
- Testes: `tests/`
- Documentação detalhada: `DOCUMENTAÇÃO/` e `docs/`

## Nota sobre Ollama/OpenCode

- OpenCode pode ser usado como assistente de desenvolvimento neste repo.
- Ollama é uma boa opção local para privacidade/custo (ver
  `DOCUMENTAÇÃO/INTEGRACAO_OLLAMA_OPENCODE.md`).
