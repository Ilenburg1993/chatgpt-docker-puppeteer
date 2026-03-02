# src/server

**Propósito**: Servidor web do sistema — API REST, WebSocket em tempo real, dashboard, middleware e supervisor de processos.  
**Status**: Canônico.  
**Público**: Mantenedores da API e do dashboard; integradores externos.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Bootstrap do servidor (`main.js`).
- API REST com controllers e roteamento (`api/`).
- API do dashboard (`dashboard-api/`).
- Domínio de serviços do servidor (`domain/`).
- Engine do servidor (app, lifecycle, socket) (`engine/`).
- Handlers MCP e OpenAI (`handlers/`).
- Middlewares de autenticação, autorização e validação (`middleware/`).
- Bridge NERV do servidor (`nerv_adapter/`).
- Funcionalidades realtime: bus PM2, streams e telemetria (`realtime/`).
- Supervisor e remediação de processos (`supervisor/`).
- Watchers de arquivos e logs (`watchers/`).

## O que não deve ficar aqui

- Lógica de domínio de missões → `src/missions/`
- Automação de browser → `src/driver/`
- Frontend Vue → `src/dashboard-ui/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `main.js` | Bootstrap do servidor Express + Socket.io |
| `api/` | API REST: rotas e controllers |
| `engine/` | Componentes core do servidor (app, socket, lifecycle) |
| `middleware/` | Auth, autorização, validação e error handler |
| `realtime/` | Bus PM2, streams SSE e telemetria em tempo real |
| `nerv_adapter/` | Bridge servidor ↔ NERV |
| `supervisor/` | Reconciliador e remediação de processos |
| `domain/` | Serviços de domínio do servidor |
| `handlers/` | Handlers MCP e compatibilidade OpenAI |

## Regras de manutenção

- Toda rota deve ter middleware de `schema_guard.js` para validação de entrada.
- Eventos de domínio devem ser emitidos via `nerv_adapter/`, não diretamente.
- Porta padrão: 3008 (configurável via `config.json`).

## Links relacionados

- API: `src/server/api/`
- Realtime: `src/server/realtime/`
- Frontend: `src/dashboard-ui/`
- Tipos: `src/types/server/`
