# Módulo Consolidado — `agent/` (01-agent.md)

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-23). Base: 22 auditorias individuais
> de F05-01 a F05-22.

---

## 1. Visão Geral do Módulo

| Propriedade      | Valor                                 |
| ---------------- | ------------------------------------- |
| **Diretório**    | `src/copilot/agent/`                  |
| **Arquivos**     | 22                                    |
| **LOC total**    | ~4914                                 |
| **Camada**       | Layer 5 — Orchestration               |
| **Barrel**       | `index.js` (41 LOC, ~35 re-exports)   |
| **Entry points** | `entry.js` (PM2), `index.js` (barrel) |

### Responsabilidade

Módulo orquestrador principal do Copilot SDK Agent. Gerencia o ciclo de vida completo: sessão SDK
(init/resume), fila de tarefas, dialog loop (mutex, backpressure, watchdog, protocol), reconexão com
backoff, permissões, webhooks, state persistence, task execution com retry, tool bootstrap, audit
logging, e status snapshots.

---

## 2. Catálogo de Arquivos (Score Heatmap)

| #   | Arquivo                  | LOC  | Score | Findings | Destaque                        |
| --- | ------------------------ | ---- | ----- | -------- | ------------------------------- |
| 01  | agent-contract.js        | 69   | 8.1   | 0        | Pure typedef                    |
| 02  | always-alive.js          | 1241 | 5.6   | 16       | **God class — maior risco**     |
| 03  | dialog-loop-manager.js   | 484  | —     | —        | Mutex + backpressure + watchdog |
| 04  | dialog-loop-wirer.js     | 40   | —     | —        | Event forwarding thin adapter   |
| 05  | dialog-protocol.js       | 115  | —     | —        | READY/REPLY/DONE/STOPPED        |
| 06  | dialog-turn-executor.js  | 324  | —     | —        | Pure funcs: emit/wait/dispatch  |
| 07  | dialog-watchdog.js       | 114  | —     | —        | Inactivity monitor              |
| 08  | entry.js                 | 154  | 7.0   | 3        | PM2 entry; session.fatal issue  |
| 09  | events.js                | 115  | 9.8   | 1        | Exemplar: as-const enum         |
| 10  | index.js                 | 41   | 9.1   | 1        | Barrel; internal re-exports     |
| 11  | message-queue.js         | 212  | 8.5   | 2        | FIFO + AbortSignal              |
| 12  | permission-controller.js | 152  | 8.3   | 2        | Strategy Pattern: 3 modes       |
| 13  | reconnect-policy.js      | 99   | 9.5   | 1        | Exemplar: pure fun + DI         |
| 14  | session-event-wirer.js   | 438  | 7.6   | 3        | SDK→Agent event adapter         |
| 15  | session-hooks.js         | 11   | 9.8   | 0        | Deprecated re-export            |
| 16  | session-initializer.js   | 287  | 7.5   | 3        | Zod validation + prompt inject  |
| 17  | state-io.js              | 204  | 7.5   | 3        | Sync/async race; mutex serial   |
| 18  | status-snapshot.js       | 101  | 10.0  | 0        | Exemplar: pure function         |
| 19  | task-executor.js         | 190  | 9.1   | 2        | DI callbacks + OTEL spans       |
| 20  | tool-audit-logger.js     | 190  | 7.8   | 3        | Decorator + JSONL rotation      |
| 21  | tools-bootstrap.js       | 127  | 8.5   | 1        | Registry bootstrap + summary    |
| 22  | webhook-manager.js       | 206  | 8.1   | 3        | SSRF protection + sanitization  |

---

## 3. Score Consolidado do Módulo

| Dimensão            | Score (0-10) | Justificativa                                     |
| ------------------- | ------------ | ------------------------------------------------- |
| Contratos (tipos)   | 8.5          | JSDoc extensivo; algumas lacunas em always-alive  |
| Error handling      | 7.5          | Race conditions em state-io; silent catches       |
| Segurança           | 8.0          | SSRF ✅; prompt inject mitigado; DNS rebinding ❌ |
| Performance         | 8.0          | Cache ✅; mutex ✅; sync I/O em cold paths        |
| Testabilidade       | 7.5          | DI ✅ na maioria; always-alive difícil de isolar  |
| Manutenibilidade    | 7.0          | always-alive 1241 LOC; module-level state         |
| **Média ponderada** | **7.8**      |                                                   |

---

## 4. Inventory de Findings (43 total)

### Por Severidade

| Severidade | Count | Finding IDs                                              |
| ---------- | ----- | -------------------------------------------------------- |
| **P2**     | 2     | LEAK-AGENT-001, LEAK-AGENT-002                           |
| **P3**     | 13    | ARCH-001~~003, RACE-001~~003, BUG-006~~008, SEC-003~~005 |
| **P4**     | 16    | PERF-001~~004, GAP-005~~015, ARCH-005~~009, BUG-009~~010 |
| **P5**     | 6     | GAP-AGENT-007/008/012, ARCH-AGENT-006/008                |

### Por Categoria

| Categoria | Count | Exemplos                                                              |
| --------- | ----- | --------------------------------------------------------------------- |
| BUG       | 5     | session.fatal sem cleanup, abort listener leak, sync/async race       |
| ARCH      | 6     | God class, barrel bypass, SDK direto, internal re-exports             |
| RACE      | 3     | writeState vs writeStateAsync, DLM mutex                              |
| LEAK      | 2     | Listeners em always-alive, Map unbounded                              |
| SEC       | 3     | SSRF DNS rebinding, env var sanitization, prompt inject               |
| PERF      | 4     | Sync I/O cold path, writeStateAsync per usage event                   |
| GAP       | 11    | Naming inconsistência, silent catches, overly aggressive sanitization |
| INC/UPG   | 9     | (from always-alive-audit.md F05-02)                                   |

---

## 5. Top 5 Findings Críticos (Ação Recomendada)

### 1. LEAK-AGENT-001/002 — Memory leaks em always-alive.js

- **Risco**: Listeners e Maps sem cleanup em reconexão/restart
- **Ação**: Extrair lifecycle management; implementar `destroy()` que limpa tudo

### 2. RACE-AGENT-003 — writeState sync vs writeStateAsync race

- **Risco**: Perda de dados de state (billing, session resumption)
- **Ação**: Deprecar `writeState()` sync; forçar `writeStateAsync()` em todos os callers

### 3. SEC-AGENT-005 — DNS rebinding em webhook SSRF validation

- **Risco**: SSRF bypass em cenários com DNS controlado por atacante
- **Ação**: Resolver DNS no momento do fetch; verificar IP resultante

### 4. BUG-AGENT-006 — session.fatal → process.exit(1) sem cleanup

- **Risco**: Corrupção de state-io se writeStateAsync em andamento
- **Ação**: Chamar `shutdown('session.fatal')` com await antes de exit

### 5. ARCH-AGENT-001/002/003 — always-alive.js é god class (1241 LOC)

- **Risco**: Difícil de testar, manter, e evoluir
- **Ação**: Continuar extração (DLM, task-executor já feitos; extrair session lifecycle e event
  forwarding)

---

## 6. Padrões Arquiteturais Observados

### Positivos ✅

1. **DI via callbacks** — task-executor, reconnect-policy, dialog-turn-executor: zero acesso a
   privados
2. **Pure functions** — status-snapshot, buildStatusSnapshot, reconnect-policy: altamente testáveis
3. **Mutex serial** — writeStateAsync com Promise chain: previne race em escritas concorrentes
4. **Decorator Pattern** — buildAuditingPermissionHandler wraps PermissionHandler
5. **Strategy Pattern** — PermissionController com 3 modos trocáveis em runtime
6. **Bounded resources** — MessageQueue MAX_SIZE, WebhookManager MAX_WEBHOOKS
7. **OTEL spans** — task-executor com spans por task e tool call
8. **Zod validation** — session.json validado com schema

### Negativos ❌

1. **God class** — always-alive.js (1241 LOC, 16 findings, score 5.6)
2. **Barrel bypasses** — 14+ imports diretos de sub-módulos dentro de agent/
3. **Module-level mutable state** — \_backgroundCompactionThreshold, \_logBytes, \_stateCache,
   \_writeQueue
4. **SDK direto** — 4 arquivos importam de `@github/copilot-sdk` diretamente
5. **Sync I/O** — readState, writeState usam readFileSync/writeFileSync (cold paths)

---

## 7. Dependências Cross-Module

### Módulos dos quais agent/ depende:

- `config/` (3 imports: session-config, system-prompt, tools/state, custom-agents)
- `hooks/` (2 imports: session-lifecycle, bus)
- `lib/` (3 imports: session, utils, tools-registry, permissions, models)
- `observability/` (2 imports: logger, otel)
- `tools/` (1 import: barrel)
- `core/` (1 import: constants, errors)

### Módulos que dependem de agent/:

- `bridges/` (consome events, consult status)
- `routes/` (API endpoints para status/send/config)
- `hooks/` (session-lifecycle ↔ agent — **cuidado: potencial circular**)
- `api/` (thin wrapper sobre routes)

### Risco circular: hooks/ ↔ agent/

- `session-hooks.js` importa de `#copilot/hooks/session`
- `hooks/session-lifecycle.js` pode importar de `agent/` (session init)
- **Mitigação**: session-hooks.js é re-export deprecated; hooks/ → agent/ direto via index.js

---

## 8. Recomendações de Refactoring

### R1: Continuar decomposição de always-alive.js

- **Status atual**: DLM, task-executor, state-io, permission-controller, webhook-manager, dialog-\*
  já extraídos
- **Próximo**: Extrair session lifecycle (init/resume/stop) para `session-lifecycle-agent.js`
- **Próximo**: Extrair event forwarding/subscription para `event-subscription-manager.js`
- **Alvo**: always-alive.js < 500 LOC

### R2: Unificar writeState → writeStateAsync

- Deprecar `writeState()` sync
- Ajustar callers: 3 chamadas diretas (session-initializer, session-event-wirer, always-alive)

### R3: Centralizar KNOWN_SDK_EVENTS

- Mover para `events.js` ou módulo compartilhado
- Importar em session-event-wirer.js e event-collector.js

### R4: Reduzir barrel bypasses

- 14+ imports diretos poderiam usar `#copilot/agent` barrel
- Priorizar: logger bypass é systemic (76 arquivos no codebase)

---

## 9. Relação com Audit Existentes

Este consolidado agrega e referencia:

| ID     | Arquivo                  | Audit Individual               |
| ------ | ------------------------ | ------------------------------ |
| F05-01 | agent-contract.js        | agent-contract-audit.md        |
| F05-02 | always-alive.js          | always-alive-audit.md          |
| F05-03 | dialog-loop-manager.js   | dialog-loop-manager-audit.md   |
| F05-04 | dialog-loop-wirer.js     | dialog-loop-wirer-audit.md     |
| F05-05 | dialog-protocol.js       | dialog-protocol-audit.md       |
| F05-06 | dialog-turn-executor.js  | dialog-turn-executor-audit.md  |
| F05-07 | dialog-watchdog.js       | dialog-watchdog-audit.md       |
| F05-08 | entry.js                 | entry-audit.md                 |
| F05-09 | events.js                | events-audit.md                |
| F05-10 | index.js                 | index-audit.md                 |
| F05-11 | message-queue.js         | message-queue-audit.md         |
| F05-12 | permission-controller.js | permission-controller-audit.md |
| F05-13 | reconnect-policy.js      | reconnect-policy-audit.md      |
| F05-14 | session-event-wirer.js   | session-event-wirer-audit.md   |
| F05-15 | session-hooks.js         | session-hooks-audit.md         |
| F05-16 | session-initializer.js   | session-initializer-audit.md   |
| F05-17 | state-io.js              | state-io-audit.md              |
| F05-18 | status-snapshot.js       | status-snapshot-audit.md       |
| F05-19 | task-executor.js         | task-executor-audit.md         |
| F05-20 | tool-audit-logger.js     | tool-audit-logger-audit.md     |
| F05-21 | tools-bootstrap.js       | tools-bootstrap-audit.md       |
| F05-22 | webhook-manager.js       | webhook-manager-audit.md       |

---

## 10. Conclusão

O módulo `agent/` é o coração orquestrador do sistema Copilot SDK Agent. A decomposição progressiva
de `always-alive.js` (originalmente ~2000+ LOC) em sub-módulos especializados é positiva e deve
continuar. Os módulos extraídos (task-executor, reconnect-policy, status-snapshot) são exemplares em
testabilidade e desacoplamento.

**Prioridades imediatas**:

1. RACE-AGENT-003: unificar write paths para eliminar race condition
2. BUG-AGENT-006: fix session.fatal shutdown
3. always-alive.js: continuar decomposição (alvo: < 500 LOC)

**Score do módulo**: **7.8/10** — Bom com margens claras de melhoria.
