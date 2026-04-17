# R-07B — Matriz de Ownership e Contratos de Topo

**Programa**: P0 / Faixa A
**Data-base**: 2026-04-16
**Status**: canônico para governança de fronteiras

---

## 1. Propósito

Este documento transforma o discurso de “ownership claro” em uma matriz operacional.

Ele existe para reduzir quatro classes de erro recorrente:

1. módulo certo com responsabilidade errada;
2. módulo errado carregando contrato de outro domínio;
3. barrel/adapter/shim virando pseudo-fonte canônica;
4. refactor local que melhora um arquivo e piora a fronteira do sistema.

---

## 2. Regra central de leitura

Ao decidir onde algo novo deve morar, a ordem correta é:

1. **runtime truth**;
2. **contrato compartilhado de borda**;
3. **adapter de apresentação**;
4. **UX local / wiring local**.

Se uma decisão começar pelo adapter ou pelo comando local, ela provavelmente está começando do lado
errado da arquitetura.

---

## 3. Matriz de ownership por módulo

| Módulo              | Ownership canônico                                                                                | Não deve ser dono de                                                                      | Superfícies públicas / contratos de topo                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agent/`            | runtime principal da LLM-B, lifecycle, dialog, session runtime, health, background tasks          | persistência conversacional completa, ownership do registry do SDK, pseudo-endpoints HTTP | `alwaysAliveAgent`, `getAgent()`, snapshot de health, runtime control                              |
| `sdk/`              | wrapper fino do vendor SDK, builders técnicos, tipos e adapters do SDK                            | ownership de sessão ativa, replay conversacional, state orchestration profundo            | `#copilot/sdk`, session/client wrappers, model surfaces, SDK types                                 |
| `conversation-hub/` | store, replay, histórico, memória conversacional, lifecycle da sessão conversacional              | runtime operacional do agente, política de tools, transport LLM-A ↔ LLM-B                 | sessions, turns, memory, replay/store orchestration                                                |
| `channel/`          | transporte e protocolo LLM-A ↔ LLM-B, parsing estruturado, retry/reconnect de canal               | state ownership do agente, replay/store conversacional, pseudo-UX                         | `client.js`, `inject.js`, contrato de canal                                                        |
| `presentation/`     | SSOT de projections e handlers compartilhados entre bordas (`server/` / `terminal/`)              | runtime truth, store conversacional, wiring de REPL, regra de sessão profunda             | `system-config`, `conversation-hub`, `realtime`, `system-metrics`, `agent-control`, `sdk-sessions` |
| `server/`           | API HTTP/SSE/Socket, roteamento remoto, auth/headers/middlewares, presentation remota             | UX local do terminal, runtime truth do agente, store interna do hub                       | `routes/`, `middleware/`, `socket/`, endpoints remotos                                             |
| `terminal/`         | UX local da LLM-B: REPL, renderização, aliases, anexos, contexto local, streaming local, commands | SSOT compartilhada de borda, pseudo-backend do server, ownership de sessão do SDK         | `repl.js`, `commands/`, `dialog/`, estado local, wiring local                                      |
| `tools/`            | catálogo e runtime de tools, permission hooks e execução de superfícies operacionais              | ownership do agente, storage conversacional, presentation remota                          | shell/web/file/task/permission/introspection/hub tools                                             |
| `hooks/`            | políticas de sessão, permissões, transforms e filtros operacionais                                | coleta observability ampla, ownership do runtime principal                                | factories de hooks, permission/session hooks                                                       |
| `event-handlers/`   | efeitos de domínio disparados por eventos                                                         | catálogo de eventos, health projections, pseudo-runtime do agent                          | handlers por domínio/evento                                                                        |
| `events/`           | naming, schemas, catálogo e governança de eventos                                                 | observers, collectors, reação de domínio                                                  | schemas, catálogos, eventos canônicos                                                              |
| `observability/`    | métricas, tracing, pipeline de erro, projections de health, coletores/observers                   | ownership do fluxo de negócio, policy runtime                                             | metrics, collectors, logger, health projections                                                    |
| `config/`           | builders, defaults, prompt/config runtime                                                         | ownership de sessão ativa, lógica de diálogo, wrappers do SDK                             | session-config, agent config, system prompt                                                        |
| `core/`             | contratos centrais, DI, utilidades fundamentais, validação e primitives                           | lógica profunda de domínio, ownership de subsistemas grandes                              | constants, errors, interfaces, DI tokens, validators                                               |
| `infra/`            | recursos técnicos compartilhados: storage, queues, locks, SSE infra, filesystem helpers           | regras de negócio e policy                                                                | queues, locks, storage, SSE infra                                                                  |
| `types/`            | contratos de superfície realmente compartilhados                                                  | typedef incidental duplicada que só serve a um módulo                                     | contracts/ typedefs compartilhados                                                                 |
| `bridges/`          | integrações externas, adapters de borda, Git/GitHub/MCP/NERV                                      | ownership interno do runtime ou de UX local                                               | git/gh/mcp/nerv bridges                                                                            |
| `audit/`            | trilha e pipeline transversal de auditoria                                                        | runtime principal do agente, health canônica do sistema                                   | audit pipeline, relatórios transversais                                                            |
| `plugins/`          | extensão/plugin model quando amadurecido                                                          | taxonomia fantasma sem programa                                                           | backlog futuro de extensibilidade                                                                  |

---

## 4. Contratos de topo que devem permanecer únicos

### 4.1 Runtime truth

| Domínio                                  | SSOT atual / alvo                             |
| ---------------------------------------- | --------------------------------------------- |
| runtime da LLM-B                         | `agent/`                                      |
| health operacional da LLM-B              | `agent/health-check.js` + projeções derivadas |
| sessão conversacional / replay / memória | `conversation-hub/`                           |
| transporte LLM-A ↔ LLM-B                 | `channel/`                                    |
| wrapper do vendor SDK                    | `sdk/`                                        |
| projections compartilhadas de borda      | `presentation/`                               |

### 4.2 Regra de uso

- `server/` e `terminal/` podem consumir `presentation/` como SSOT de borda;
- `presentation/` pode consumir `agent/`, `conversation-hub/`, `channel/`, `bridges/`, `core/` e
  `config/` quando necessário;
- `presentation/` **não** deve depender de `server/` nem de `terminal/`;
- `terminal/` continua consumidor legítimo de `agent/`, `conversation-hub/`, `channel/` e SDK quando
  isso for UX operacional real da LLM-B.

---

## 5. Critérios de placement para código novo

### Coloque em `agent/` quando

- a lógica altera lifecycle, dialog, retry/abort/stop, keepalive, health, background tasks ou estado
  operacional do runtime da LLM-B.

### Coloque em `conversation-hub/` quando

- a lógica é dona de sessão conversacional, turnos, memória, replay, retenção ou sincronização de
  histórico.

### Coloque em `presentation/` quando

- a lógica é projection/handler compartilhado entre `server/` e `terminal/`;
- não é UX local;
- não é runtime truth;
- não deve morar como detalhe de borda de apenas um consumidor.

### Coloque em `terminal/` quando

- a lógica é REPL, renderização, aliases, file/workspace context, streaming local, commands ou
  estado legítimo de interação humana da LLM-B.

### Coloque em `server/` quando

- a lógica é auth, middleware, rate limiting HTTP, route table, namespace Socket/SSE ou presentation
  remota.

---

## 6. Sinais de placement errado

Considere a mudança suspeita se ela:

- cria nova projection compartilhada diretamente em `terminal/` ou `server/`;
- coloca ownership de sessão no SDK fino;
- usa `observability/` como atalho para business logic;
- usa `core/` como gaveta de “qualquer coisa compartilhável”;
- aumenta o número de importadores de `sdk/`, `agent/` ou `observability/` sem justificativa de
  domínio;
- faz `server/` voltar a importar `terminal/` diretamente.

---

## 7. Critérios de aceitação por programa

| Programa | Critério central de aceitação                                                        |
| -------- | ------------------------------------------------------------------------------------ |
| P0       | baseline, ownership, fronteiras e gates publicados e usáveis                         |
| P1       | runtime do `agent/` mais fino, health/background canônicos, compat residual reduzida |
| P2       | SDK fino e menos stateful, com ownership de sessão fora do wrapper                   |
| P3       | eventos/observability governados por naming, schema e ownership explícitos           |
| P4       | `server/` e `terminal/` como consumidores irmãos de SSOTs de borda                   |
| P5       | tools/config/core/infra/types com fronteiras técnicas mais estáveis                  |
| P6       | segurança, testes, typing e documentação operando como gates reais                   |
| P7       | capabilities avançadas sem reabrir dívida estrutural de base                         |

---

## 8. Regra final

Quando houver conflito entre “é conveniente pôr aqui” e “é canonicamente dono disso”, **vence o
ownership canônico**.

Conveniência local não é critério suficiente para redefinir arquitetura.
