# src/server/api

**Propósito**: API REST do servidor — roteamento, controllers e utilitários de resposta.  
**Status**: Canônico.  
**Público**: Desenvolvedores de integrações externas e mantenedores da API.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Roteador principal da API (`router.js`).
- Controllers por domínio (`controllers/`).
- Utilitários de resposta e views de tarefa (`utils/`).

## O que não deve ficar aqui

- API específica do dashboard → `src/server/dashboard-api/`
- Middlewares globais → `src/server/middleware/`
- Handlers de protocolos externos (MCP, OpenAI) → `src/server/handlers/`

## Entradas principais

| Arquivo/Pasta  | Descrição                                               |
| -------------- | ------------------------------------------------------- |
| `router.js`    | Roteador principal da API REST                          |
| `controllers/` | Controllers por domínio (tarefas, missões, audit, etc.) |
| `utils/`       | Utilitários de envelope de resposta e views             |

## Regras de manutenção

- Toda rota deve usar middleware de `schema_guard.js`.
- Controllers não devem conter lógica de domínio; delegue para `domain/`.

## Links relacionados

- Módulo pai: `src/server/`
- Controllers: `src/server/api/controllers/`
- Middleware: `src/server/middleware/`
