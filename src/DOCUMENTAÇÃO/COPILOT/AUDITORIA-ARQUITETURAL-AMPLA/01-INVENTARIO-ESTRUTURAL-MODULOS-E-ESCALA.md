# 01 — Inventário Estrutural: Módulos, Pastas e Escala

> Gerado automaticamente a partir do filesystem em 2026-04-27T17:37:19.350Z.

## 1. Escala global de `src/copilot`

- Diretórios totais (incluindo raiz): **69**
- Arquivos totais: **541**
- Arquivos raiz imediatos em `src/copilot/`: **3**
- Módulos de primeiro nível: **24**

## 2. Arquivos raiz imediatos

- `src/copilot/README.md`
- `src/copilot/bootstrap.js`
- `src/copilot/runtime-wiring.js`

> Atualização 2026-05-04: `src/copilot/agent.js` foi removido; `terminal/bootstrap.js` é o único
> owner executável do runtime local.

## 3. Módulos de primeiro nível e escala

| Módulo              | Arquivos | LOC aprox. | Subpastas | Tipo predominante | Observação inicial                             |
| ------------------- | -------: | ---------: | --------: | ----------------- | ---------------------------------------------- |
| `agent/`            |       79 |      17412 |         8 | código            | candidato a trilha de auditoria                |
| `terminal/`         |       59 |       9862 |         4 | código            | candidato a trilha de auditoria                |
| `sdk/`              |       44 |      10212 |         6 | código            | candidato a trilha de auditoria                |
| `server/`           |       43 |       7117 |         6 | código            | candidato a trilha de auditoria                |
| `tools/`            |       35 |       7951 |         4 | código            | candidato a trilha de auditoria                |
| `observability/`    |       34 |       6276 |         3 | código            | candidato a trilha de auditoria                |
| `presentation/`     |       30 |       5261 |         0 | código            | candidato a trilha de auditoria                |
| `config/`           |       29 |       2777 |         3 | código            | candidato a trilha de auditoria                |
| `hooks/`            |       27 |       5482 |         1 | código            | candidato a trilha de auditoria                |
| `core/`             |       21 |       3348 |         1 | código            | candidato a trilha de auditoria                |
| `events/`           |       21 |       2575 |         2 | código            | candidato a trilha de auditoria                |
| `bridges/`          |       14 |       2230 |         1 | código            | candidato a trilha de auditoria                |
| `conversation-hub/` |       14 |       2713 |         0 | código            | candidato a trilha de auditoria                |
| `event-handlers/`   |       14 |       1074 |         0 | código            | candidato a trilha de auditoria                |
| `infra/`            |       13 |       1349 |         1 | código            | candidato a trilha de auditoria                |
| `logs/`             |       13 |     277431 |         0 | artefato/runtime  | não é domínio de negócio; tratar separadamente |
| `audit/`            |       10 |        936 |         0 | código            | candidato a trilha de auditoria                |
| `channel/`          |        9 |       1780 |         0 | código            | candidato a trilha de auditoria                |
| `.github/`          |        7 |        205 |         3 | artefato/runtime  | não é domínio de negócio; tratar separadamente |
| `boot/`             |        7 |        723 |         0 | código            | candidato a trilha de auditoria                |
| `types/`            |        5 |        255 |         1 | código            | candidato a trilha de auditoria                |
| `db/`               |        4 |        498 |         0 | código            | candidato a trilha de auditoria                |
| `plugins/`          |        3 |        271 |         0 | código            | candidato a trilha de auditoria                |
| `dialog/`           |        2 |        119 |         0 | código            | candidato a trilha de auditoria                |

## 4. Árvore completa de diretórios

```text
src/copilot
src/copilot/.github
src/copilot/.github/hooks
src/copilot/.github/hooks/state
src/copilot/.github/hooks/state/snapshots
src/copilot/agent
src/copilot/agent/dialog
src/copilot/agent/facades
src/copilot/agent/infra
src/copilot/agent/lifecycle
src/copilot/agent/messaging
src/copilot/agent/ports
src/copilot/agent/session
src/copilot/agent/state
src/copilot/audit
src/copilot/boot
src/copilot/bridges
src/copilot/bridges/gh
src/copilot/channel
src/copilot/config
src/copilot/config/system-prompt
src/copilot/config/system-prompt/sdk-defaults
src/copilot/config/system-prompt/sections
src/copilot/conversation-hub
src/copilot/core
src/copilot/core/security
src/copilot/db
src/copilot/dialog
src/copilot/event-handlers
src/copilot/events
src/copilot/events/middleware
src/copilot/events/schemas
src/copilot/hooks
src/copilot/hooks/presets
src/copilot/infra
src/copilot/infra/sse
src/copilot/logs
src/copilot/observability
src/copilot/observability/bus-actions
src/copilot/observability/collectors
src/copilot/observability/observers
src/copilot/plugins
src/copilot/presentation
src/copilot/sdk
src/copilot/sdk/agent
src/copilot/sdk/models
src/copilot/sdk/rpc
src/copilot/sdk/session
src/copilot/sdk/telemetry
src/copilot/sdk/tools
src/copilot/server
src/copilot/server/middleware
src/copilot/server/routes
src/copilot/server/routes/copilot-api
src/copilot/server/routes/sdk
src/copilot/server/socket
src/copilot/server/sse
src/copilot/terminal
src/copilot/terminal/commands
src/copilot/terminal/dialog
src/copilot/terminal/frontend
src/copilot/terminal/handlers
src/copilot/tools
src/copilot/tools/file
src/copilot/tools/git
src/copilot/tools/shell
src/copilot/tools/todo
src/copilot/types
src/copilot/types/contracts
```

## 5. Observações estruturais preliminares

1. `agent/`, `terminal/`, `sdk/`, `server/`, `tools/`, `observability/` e `presentation/` concentram
   a maior parte da massa arquitetural.
2. `logs/` e `.github/` existem sob `src/copilot/`, mas não pertencem à mesma natureza semântica dos
   módulos de runtime; precisam de tratamento de boundary/documentação distintos.
3. Há convivência de camadas declaradas em READMEs e camadas implementadas no gate
   `scripts/check-copilot-global-architecture.mjs`; a auditoria deverá reconciliar as duas.
4. O inventário completo de arquivos foi quebrado nos anexos 02 e 03 para manter legibilidade e
   evitar arquivos excessivamente grandes.
