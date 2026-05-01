# 100 — Mapeamento completo dos fluxos de `src/copilot` (AS-IS 2026-05)

**Data:** 2026-05-01
**Escopo:** todos os fluxos arquiteturais ativos em `src/copilot/**`
**Objetivo:** consolidar mapa único de fluxo, ownership e fronteiras para orientar canonicidade total.

---

## 1) Método e evidências

Esta leitura combina:

- inventários executáveis (`module-map.js`) de `agent/{dialog,session,lifecycle}`, `terminal`, `server`, `server/routes`;
- contratos de boot (`boot/contract.js`) e runtime selection (`presentation/agent-runtime.js`);
- READMEs canônicos de `src/copilot/*`;
- varredura de imports e sinais de compat/fallback/bypass;
- catálogo de eventos (`events/catalog.md`) e bridge coverage;
- contratos unitários de governança arquitetural já ativos em `tests/unit/copilot/contracts/*`.

---

## 2) Macro topologia factual

```text
terminal/bootstrap.js
  -> bootstrap.js (bootCopilot)
    -> runtime-wiring.js
      -> agent/ (runtime vivo)
      -> server/ (HTTP/SSE/Socket)
      -> terminal/ (REPL/UX)

SDK SessionEvent
  -> event-handlers/
    -> agent/session/wiring/event-wirer.js
      -> AlwaysAliveAgent EventEmitter
        -> presentation/
        -> terminal/
        -> server/routes/
        -> observability/
```

---

## 3) Catálogo completo de fluxos (AS-IS)

## 3.1 Fluxos de bootstrap, host e ciclo de vida

| ID        | Fluxo                          | Caminho factual                                                                     | Owner atual                            | Estado                           |
| --------- | ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------- |
| F-BOOT-01 | Boot canônico terminal runtime | `terminal/bootstrap.js -> bootCopilot -> startTerminalServer -> startCopilotServer` | `boot/` + `terminal/` + `server/`      | **Canônico**                     |
| F-BOOT-02 | Entrypoint compat              | `agent.js -> bootCopilot()`                                                         | `boot/`                                | **Paralelo controlado (compat)** |
| F-BOOT-03 | PM2 compat                     | `copilot-sdk-agent` (flag opt-in)                                                   | `boot/contract.js`                     | **Paralelo controlado (compat)** |
| F-BOOT-04 | Runtime DI wiring              | `runtime-wiring.js` + `wireLegacySetters`                                           | `runtime-wiring` + `core/di-container` | **Canônico com legado residual** |
| F-LC-01   | Lifecycle start/stop/init      | `agent/lifecycle/orchestrators/agent-lifecycle.js`                                  | `agent/lifecycle`                      | **Canônico**                     |
| F-LC-02   | Process host / sinais          | `agent/lifecycle/process-host/runtime-host.js`                                      | `agent/lifecycle`                      | **Canônico**                     |

## 3.2 Fluxos SDK -> runtime

| ID       | Fluxo                         | Caminho factual                                             | Owner atual       | Estado       |
| -------- | ----------------------------- | ----------------------------------------------------------- | ----------------- | ------------ |
| F-SDK-01 | Wrappers vanilla              | `sdk/*`                                                     | `sdk/`            | **Canônico** |
| F-SDK-02 | Tradução de SessionEvent      | `event-handlers/*`                                          | `event-handlers/` | **Canônico** |
| F-SDK-03 | Wiring de eventos da sessão   | `agent/session/wiring/event-wirer.js`                       | `agent/session`   | **Canônico** |
| F-SDK-04 | Façade pública SDK do runtime | `agent/facades/agent-sdk-access.js` + `agent/facades/sdk/*` | `agent/facades`   | **Canônico** |
| F-SDK-05 | Runtime session operations    | `agent/facades/agent-sdk-runtime.js`                        | `agent/facades`   | **Canônico** |

## 3.3 Fluxos de runtime vivo (agent)

| ID      | Fluxo                           | Caminho factual                                          | Owner atual     | Estado                            |
| ------- | ------------------------------- | -------------------------------------------------------- | --------------- | --------------------------------- |
| F-AG-01 | Runtime state/invariants        | `agent/agent-context.js` + `agent/state/*`               | `agent/`        | **Canônico**                      |
| F-AG-02 | Dialog loop                     | `agent/dialog/controllers -> orchestrators -> executors` | `agent/dialog`  | **Canônico**                      |
| F-AG-03 | Session boot/recovery/keepalive | `agent/session/{initializers,boot,lifecycle}`            | `agent/session` | **Canônico**                      |
| F-AG-04 | Runtime registry                | `agent/runtime-registry.js`                              | `agent/`        | **Canônico (base multi-runtime)** |
| F-AG-05 | Event bridge to EventBus        | `agent/facades/agent-runtime-event-bridge.js`            | `agent/facades` | **Canônico**                      |

## 3.4 Fluxos compartilhados de borda (`presentation`)

| ID        | Fluxo                         | Caminho factual                                                              | Owner atual     | Estado                 |
| --------- | ----------------------------- | ---------------------------------------------------------------------------- | --------------- | ---------------------- |
| F-PRES-01 | Seleção de runtime            | `presentation/runtime-targeting.js` + `presentation/agent-runtime.js`        | `presentation/` | **Canônico**           |
| F-PRES-02 | Runtime request deps (HTTP)   | `presentation/runtime-request.js` + `runtime-route-deps.js`                  | `presentation/` | **Canônico**           |
| F-PRES-03 | Health/status projections     | `presentation/runtime-health.js`, `runtime-status.js`, `runtime-overview.js` | `presentation/` | **Canônico**           |
| F-PRES-04 | SDK session shared projection | `presentation/runtime-sdk-session.js`                                        | `presentation/` | **Canônico**           |
| F-PRES-05 | Agent control shared edge     | `presentation/agent-control.js`                                              | `presentation/` | **Canônico (hotspot)** |

## 3.5 Fluxos de borda server

| ID       | Fluxo                    | Caminho factual                                                            | Owner atual            | Estado                            |
| -------- | ------------------------ | -------------------------------------------------------------------------- | ---------------------- | --------------------------------- |
| F-SRV-01 | HTTP app/router          | `server/app.js` + `server/router.js`                                       | `server/`              | **Canônico**                      |
| F-SRV-02 | Copilot API routes       | `server/routes/copilot-api/*`                                              | `server/routes`        | **Canônico**                      |
| F-SRV-03 | SDK API routes           | `server/routes/sdk/*` via `sdk/deps.js`                                    | `server/routes/sdk`    | **Canônico**                      |
| F-SRV-04 | SSE global/critical/task | `server/routes/sse.js` + `copilot-api/stream.js` + `sdk/session-stream.js` | `server/routes`        | **Canônico**                      |
| F-SRV-05 | Runtime state registries | `server/runtime-state/*`                                                   | `server/runtime-state` | **Canônico (base multi-runtime)** |
| F-SRV-06 | Handler bridge legado    | `server/handler-bridge.js`                                                 | `server/`              | **Paralelo controlado (compat)**  |

## 3.6 Fluxos de borda terminal

| ID        | Fluxo                     | Caminho factual                                                                        | Owner atual                               | Estado                             |
| --------- | ------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------- |
| F-TERM-01 | REPL lifecycle            | `terminal/repl*.js`                                                                    | `terminal/`                               | **Canônico**                       |
| F-TERM-02 | Command routing           | `terminal/repl-command-router.js` + `commands/*`                                       | `terminal/commands`                       | **Canônico**                       |
| F-TERM-03 | Frontend projections      | `terminal/frontend/projections/*`                                                      | `terminal/frontend`                       | **Canônico**                       |
| F-TERM-04 | Frontend gateways         | `terminal/frontend/gateways/*`                                                         | `terminal/frontend`                       | **Canônico**                       |
| F-TERM-05 | Runtime events adapters   | `terminal/agent-runtime-events.js` + `sdk-session-events.js` + `task-stream-events.js` | `terminal/`                               | **Canônico**                       |
| F-TERM-06 | SSE fallback genérico     | `terminal/agent-sse-fallback.js`                                                       | `terminal/`                               | **Paralelo controlado (fallback)** |
| F-TERM-07 | Dialog bridge LLM-A↔LLM-B | `terminal/frontend/gateways/dialog.js -> #copilot/channel`                             | `terminal/frontend/gateways` + `channel/` | **Canônico (ponte dedicada)**      |

## 3.7 Fluxos de transporte e persistência

| ID       | Fluxo                  | Caminho factual                                     | Owner atual                          | Estado       |
| -------- | ---------------------- | --------------------------------------------------- | ------------------------------------ | ------------ |
| F-CH-01  | Transporte LLM-A↔LLM-B | `channel/client.js` + `channel/inject.js`           | `channel/`                           | **Canônico** |
| F-HUB-01 | Sessões/turnos/memória | `conversation-hub/{hub,store,orchestrator}`         | `conversation-hub/`                  | **Canônico** |
| F-HUB-02 | Socket namespace       | `conversation-hub/socket-ns.js` + `server/socket/*` | `conversation-hub` + `server/socket` | **Canônico** |

## 3.8 Fluxos de observabilidade e governança

| ID       | Fluxo                 | Caminho factual                                                         | Owner atual               | Estado                    |
| -------- | --------------------- | ----------------------------------------------------------------------- | ------------------------- | ------------------------- |
| F-OBS-01 | EventBus central      | `core/event-bus.js`                                                     | `core/`                   | **Canônico**              |
| F-OBS-02 | Event bridge coverage | `agent/facades/agent-runtime-event-bridge.js` + `hooks` + `hub` bridges | `agent` + `hooks` + `hub` | **Canônico**              |
| F-OBS-03 | Audit pipeline        | `audit/*`                                                               | `audit/`                  | **Canônico**              |
| F-OBS-04 | NERV bridge           | `bridges/nerv-event-bus-adapter.js`                                     | `bridges/`                | **Canônico (integração)** |

---

## 4) Leitura consolidada da maturidade de fluxo

### 4.1 Forte (canônico consolidado)

- boot único (`terminal/bootstrap`) com contrato explícito;
- boundary SDK e tradução de eventos;
- runtime registry + runtime targeting compartilhado;
- projections/gateways no terminal após remoção de shims;
- SDK HTTP com composição por `deps.js`;
- event-bus + bridge coverage formal.

### 4.2 Médio (canônico com dívida estrutural)

- `presentation/agent-control.js` e parte das rotas SDK continuam hotspots;
- `terminal/index.js`, `repl.js`, `terminal-agent-wiring.js` ainda densos;
- coexistência de compat paths (entrypoint, handler-bridge, setters legados).

### 4.3 Frágil (paralelos tolerados por necessidade)

- fallback SSE genérico ainda necessário;
- fallback implícito para runtime default quando `runtimeId` não existe;
- trilha compat PM2/entrypoint ainda viva para operação legada.

---

## 5) Conclusão factual

O sistema já opera majoritariamente em fluxo canônico por camada, mas ainda possui **rotas paralelas controladas** para compatibilidade e resiliência operacional. O próximo passo não é “inventar nova topologia”: é **fechar os paralelos remanescentes com governança e migração incremental**, preservando o caminho para multi-runtime e multi-agent.
