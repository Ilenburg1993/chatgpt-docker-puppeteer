# PARTE 14E — Roadmap F49–F120: Consolidação Integral de `src/copilot/`

**Data original**: 2026-03-15 | **Revisão expandida**: 2026-04-07
**Baseline**: commit `a1a4a2cf` (pós-F48/PARTE-14)
**Referência**: PARTE-14A/B/C/D + auditoria cross-módulo 2026-04-07
**Pré-requisito**: Quality gates passando (`npm run lint && npx tsc --noEmit`)

---

## Visão Geral do Roadmap

O roadmap expandido está organizado em **14 faixas temáticas** com **72 fases (F49–F120)**, cada uma
com subfases atômicas. As faixas seguem uma ordem de dependência lógica, mas várias podem ser
paralelizadas (ver grafo de dependências ao final).

### Escopo da Expansão

A versão original (v1) focava exclusivamente em `agent/`. Esta revisão (v2) abrange:

- **agent/** — decomposição restante, testes, config, observabilidade (Faixas 1–6, preservadas)
- **Testes legados** — correção dos 269 test files quebrados por paths obsoletos (Faixa 7)
- **Tipagem & JSDoc** — migração para strict mode, cobertura JSDoc, `@ts-check` 100% (Faixa 8)
- **Error handling** — hierarquia de erros, eliminação de `throw new Error()` raw (Faixa 9)
- **Async FS global** — eliminar todos os 18+ `*Sync()` calls em produção (Faixa 10)
- **Segurança** — JSON.parse validation, input sanitization, SSRF hardening (Faixa 11)
- **God Modules externos** — decomposição dos 14 arquivos >400L fora de agent/ (Faixa 12)
- **Observabilidade cross-módulo** — OTEL, métricas, error tracking unificado (Faixa 13)
- **Hardening final** — CI gates, cobertura, documentação PARTE-15 (Faixa 14)

### Métricas da auditoria (2026-04-07)

| Métrica                             | Valor                                       |
| ----------------------------------- | ------------------------------------------- |
| Total de arquivos `.js` em copilot/ | 225                                         |
| Arquivos com `@ts-check`            | 221/225 (98.2%)                             |
| Arquivos sem `@ts-check`            | 4 (barrels de index)                        |
| Linhas totais em agent/             | 7.057                                       |
| Linhas totais em copilot/           | ~43.800                                     |
| God Modules >400L (agent/)          | 3 (loop-manager, always-alive, event-wirer) |
| God Modules >400L (fora de agent/)  | 14 arquivos                                 |
| Test files                          | 275 total                                   |
| Test files FAIL                     | 269 (97.8%)                                 |
| Test files PASS                     | 6 (2.2%)                                    |
| Tests individuais passando          | 46/46 (nossos novos)                        |
| `*Sync()` calls em produção         | 18+ (agent: 11, outros: 7+)                 |
| `JSON.parse()` sem validação        | 15+ ocorrências                             |
| Typed errors vs raw `new Error()`   | ~40 typed, ~5 raw                           |
| Event catalog                       | 73 eventos em AGENT_EVENTS                  |
| Singletons globais                  | 1 (alwaysAliveAgent)                        |
| Import aliases `#copilot/*`         | 25 distintos usados por agent/              |

```
┌─────────────────────────────────────────────────────────────────────┐
│  FAIXA 1: Fundação e Correções Imediatas (F49–F52)                 │
│  ├── F49: Barrels e organização                                    │
│  ├── F50: Fix bugs e inconsistências pontuais                      │
│  ├── F51: Config migration (hardcoded → config.js)                 │
│  └── F52: AgentContext invariantes (FSM de status)                 │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 2: Testes Unitários — Onda 1 (F53–F57)                     │
│  ├── F53: Testes protocol.js + rotation.js + watchdog.js           │
│  ├── F54: Testes message-queue.js                                  │
│  ├── F55: Testes task-executor.js                                  │
│  ├── F56: Testes initializer.js                                    │
│  └── F57: Testes webhook-manager.js                                │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 3: Decomposição Arquitetural (F58–F63)                      │
│  ├── F58: Extrair hook-context.js de initializer.js                │
│  ├── F59: Extrair backpressure.js de loop-manager.js               │
│  ├── F60: Extrair model-fallback.js de loop-manager.js             │
│  ├── F61: Extrair wireDialogLoopEvents → dialog/event-wiring.js    │
│  ├── F62: Decompor event-wirer.js em event-handlers/               │
│  └── F63: Extrair session-setup.js de agent-lifecycle.js           │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 4: Testes Unitários — Onda 2 (F64–F67)                     │
│  ├── F64: Testes loop-manager.js (pós-decomposição)                │
│  ├── F65: Testes turn-executor.js (race conditions)                │
│  ├── F66: Testes cleanup.js + keepalive.js + snapshot.js           │
│  └── F67: Teste de fluxo integrado agent boot→send→stop           │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 5: Observabilidade e Performance — agent/ (F68–F70)         │
│  ├── F68: OTEL spans em dialog loop, reconnect, session init       │
│  ├── F69: Async FS em snapshot.js + deprecar writeState sync       │
│  └── F70: Métricas em rotation.js + cleanup.js paralelo            │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 6: Hardening agent/ (F71–F72)                               │
│  ├── F71: URL validator reutilizável extraído de webhook-manager   │
│  └── F72: Auditoria final agent/ + documentação PARTE-15A          │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 7: Recuperação de Testes Legados (F73–F78)          ★ NOVA  │
│  ├── F73: Triage e categorização de 269 test files quebrados       │
│  ├── F74: Fix path imports em testes copilot/ (68 arquivos)        │
│  ├── F75: Fix path imports em testes server/ (10 arquivos)         │
│  ├── F76: Fix path imports em regression/ (63 arquivos)            │
│  ├── F77: Fix integration/ + e2e/ + manual/ (39 arquivos)          │
│  └── F78: Quarentena de testes irrecuperáveis + relatório          │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 8: Tipagem Strict & JSDoc (F79–F84)                 ★ NOVA  │
│  ├── F79: @ts-check nos 4 barrels faltantes                        │
│  ├── F80: JSDoc missing em funções exportadas de agent/            │
│  ├── F81: JSDoc missing em funções exportadas de sdk/              │
│  ├── F82: JSDoc missing em funções exportadas de tools/            │
│  ├── F83: Migração incremental para tsconfig.strict.json           │
│  └── F84: Typedef centralizado para SDK types (session, client)    │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 9: Error Handling Unificado (F85–F89)               ★ NOVA  │
│  ├── F85: Eliminar throw new Error() raw → typed errors            │
│  ├── F86: Novas classes: ToolError estendido, TimeoutError         │
│  ├── F87: Error codes catalog (constantes exportadas)              │
│  ├── F88: JSON.parse wrapping com try-catch + typed error          │
│  └── F89: Padronizar catch blocks (nunca engolir sem log)          │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 10: Async FS Global (F90–F93)                       ★ NOVA  │
│  ├── F90: Migrar snapshot.js (11 *Sync calls → async)              │
│  ├── F91: Migrar state-io.js (6 *Sync calls → async)              │
│  ├── F92: Migrar sdk/custom-tools.js + tools-state.js              │
│  └── F93: Migrar terminal/alias-store.js + db/sqlite.js init       │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 11: Segurança & Validação de Input (F94–F98)        ★ NOVA  │
│  ├── F94: JSON.parse com schema validation (Zod) em paths críticos │
│  ├── F95: Input validation nos endpoints API/express               │
│  ├── F96: Rate limiting defensivo em channel/inject.js             │
│  ├── F97: Audit log para operações administrativas                 │
│  └── F98: Revisão SSRF/DNS-rebinding em bridges                   │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 12: Decomposição God Modules Externos (F99–F107)    ★ NOVA  │
│  ├── F99:  tools/shell/index.js (714L → <400L)                     │
│  ├── F100: conversation-hub/orchestrator.js (658L → <400L)         │
│  ├── F101: conversation-hub/store.js (609L → <400L)                │
│  ├── F102: terminal/dialog/engine.js (589L → <400L)                │
│  ├── F103: terminal/repl.js (575L → <400L)                         │
│  ├── F104: sdk/models/registry.js (557L → <400L)                   │
│  ├── F105: channel/client.js (556L) + channel/inject.js (546L)     │
│  ├── F106: observability/metrics.js (552L → <400L)                 │
│  └── F107: bridges/mcp-tool-bridge.js (531L → <400L)               │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 13: Observabilidade Cross-Módulo (F108–F113)        ★ NOVA  │
│  ├── F108: OTEL spans em sdk/client.js e bridges                   │
│  ├── F109: Error tracker unificado (singleton → DI)                │
│  ├── F110: Structured logging padronizado (log levels)             │
│  ├── F111: Health check endpoint com componentes degradados        │
│  ├── F112: Métricas de latência por bridge (git, mcp, nerv)        │
│  └── F113: Dashboard de eventos (catálogo + dead-letter tracking)  │
├─────────────────────────────────────────────────────────────────────┤
│  FAIXA 14: Hardening Final & CI (F114–F120)                ★ NOVA  │
│  ├── F114: CI gate — lint + typecheck + test:unit obrigatório      │
│  ├── F115: Coverage mínima (v8) com threshold bloqueante           │
│  ├── F116: Dependency audit (npm audit + license check)            │
│  ├── F117: Retry/backoff utility (eliminar padrão duplicado)       │
│  ├── F118: AbortController patterns padronizados                   │
│  ├── F119: Graceful shutdown unificado (entry.js + terminal)       │
│  └── F120: Auditoria final integral + PARTE-15B                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## FAIXA 1: Fundação e Correções Imediatas

### F49 — Barrels e Organização Estrutural
**Gap**: GAP-S4 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                   | Entregável |
| ------- | ----------------------------------------------------------- | ---------- |
| F49.1   | Criar `messaging/index.js` (barrel)                         | Arquivo    |
| F49.2   | Criar `state/index.js` (barrel)                             | Arquivo    |
| F49.3   | Atualizar `agent/index.js` para importar de novos barrels   | Edição     |
| F49.4   | Verificar que todos os consumers externos usam barrel paths | Auditoria  |

**Validação**: `npm run lint && npm run test:unit`

---

### F50 — Fix de Bugs e Inconsistências Pontuais
**Gap**: GAP-R5, M-02 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                                                     | Entregável                |
| ------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| F50.1   | Fix `answerPendingQuestion()` — chamada duplicada de `hookToolsResolveUserInput()`                            | Edição agent-messaging.js |
| F50.2   | Verificar se `hookToolsResolveUserInput()` é idempotente (se sim, documentar; se não, fix)                    | Investigação + Edição     |
| F50.3   | `protocol.js` — adicionar constantes para os tipos de classificação ('ready', 'reply', 'stopped', 'question') | Edição                    |

**Validação**: `npm run test:unit`

---

### F51 — Config Migration (Hardcoded → config.js)
**Gap**: GAP-C4, GAP-C5, L-03 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                | Entregável                     |
| ------- | ------------------------------------------------------------------------ | ------------------------------ |
| F51.1   | Mover `WATCHDOG_THRESHOLDS` de watchdog.js para config.js                | Edição config.js + watchdog.js |
| F51.2   | Mover retry count (5) de entry.js para config.js como `BOOT_MAX_RETRIES` | Edição config.js + entry.js    |
| F51.3   | Mover `WEBHOOK_RETRY_BASE_MS` (500) de webhook-manager.js para config.js | Edição                         |
| F51.4   | Auditar quaisquer outros hardcoded values nos 37 arquivos                | Investigação                   |

**Validação**: `npm run test:unit && npm run lint`

---

### F52 — AgentContext Invariantes
**Gap**: GAP-R1 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                          | Entregável              |
| ------- | ---------------------------------------------------------------------------------- | ----------------------- |
| F52.1   | Definir FSM de status válido: starting → idle ⇄ processing/dialog_active → stopped | Documentação            |
| F52.2   | Implementar `ctx.setStatus(newStatus)` com validação de transição                  | Edição agent-context.js |
| F52.3   | Fazer `ctx.status` read-only (getter) forçando uso de `setStatus()`                | Edição                  |
| F52.4   | Adicionar testes para transições inválidas                                         | Testes                  |

**Validação**: `npm run test:unit`

---

## FAIXA 2: Testes Unitários — Onda 1

### F53 — Testes: protocol.js + rotation.js + watchdog.js
**Gap**: GAP-Q8 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                                                               | Entregável |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| F53.1   | `test_protocol.spec.js`: classify() para cada tipo (ready, reply, stopped, question), extractReply(), buildBootPrompt() | ~10 testes |
| F53.2   | `test_rotation.spec.js`: shouldRotateSession() para cada threshold (util, age, compactions, turns), edge cases          | ~8 testes  |
| F53.3   | `test_watchdog.spec.js`: start/stop, ping reset, pre-stall warning, stall detection, setTaskType()                      | ~8 testes  |

**Validação**: `npm run test:unit` (total esperado: ~72 testes)

---

### F54 — Testes: message-queue.js
**Gap**: GAP-Q5 | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                                  | Entregável |
| ------- | -------------------------------------------------------------------------- | ---------- |
| F54.1   | `test_message_queue.spec.js`: enqueue/shift FIFO básico                    | ~4 testes  |
| F54.2   | MAX_QUEUE_SIZE → reject QUEUE_FULL                                         | ~2 testes  |
| F54.3   | AbortSignal: pre-aborted reject, abort after enqueue removes from queue    | ~3 testes  |
| F54.4   | drain(): rejeita todos com erro fornecido, clona erro para tasks múltiplas | ~3 testes  |
| F54.5   | unshift() e onEnqueue/onChanged callbacks                                  | ~3 testes  |

**Validação**: `npm run test:unit` (total esperado: ~87 testes)

---

### F55 — Testes: task-executor.js
**Gap**: GAP-Q6 | **Esforço**: Médio | **Risco**: Médio (mocking pesado do SDK)

| Subfase | Descrição                                                   | Entregável |
| ------- | ----------------------------------------------------------- | ---------- |
| F55.1   | `test_task_executor.spec.js`: execução feliz com resolve    | ~2 testes  |
| F55.2   | Streaming delta events recebidos durante execução           | ~2 testes  |
| F55.3   | AbortError → reject sem reconexão                           | ~2 testes  |
| F55.4   | Erro de rede → tryReconnect → requeue (< MAX_RETRIES)       | ~2 testes  |
| F55.5   | Erro de rede → max retries → reject                         | ~2 testes  |
| F55.6   | Listeners são removidos no finally (memory leak prevention) | ~2 testes  |
| F55.7   | OTEL spans criados e fechados corretamente                  | ~2 testes  |

**Validação**: `npm run test:unit` (total esperado: ~101 testes)

---

### F56 — Testes: initializer.js
**Gap**: GAP-Q3 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                              | Entregável |
| ------- | -------------------------------------------------------------------------------------- | ---------- |
| F56.1   | `test_initializer.spec.js`: initOrResumeSession() — nova sessão (sem state persistido) | ~2 testes  |
| F56.2   | Resume de sessão existente (state com sessionId válido)                                | ~2 testes  |
| F56.3   | Sessão expirada (age > maxAge) → nova sessão                                           | ~2 testes  |
| F56.4   | shouldRotateSession() trigger → nova sessão                                            | ~2 testes  |
| F56.5   | _validateSessionForResume() — sessionId inválido, null, expirado                       | ~4 testes  |
| F56.6   | buildHookSystemContext() — briefing existente, truncamento, session.json inválido      | ~4 testes  |
| F56.7   | buildHookSystemContextSafe() — truncamento por HOOK_CONTEXT_MAX_BYTES                  | ~2 testes  |
| F56.8   | setBackgroundCompactionThreshold() — valores válidos e inválidos                       | ~3 testes  |

**Validação**: `npm run test:unit` (total esperado: ~122 testes)

---

### F57 — Testes: webhook-manager.js
**Gap**: GAP-Q7 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                 | Entregável |
| ------- | ------------------------------------------------------------------------- | ---------- |
| F57.1   | `test_webhook_manager.spec.js`: register/unregister/list                  | ~4 testes  |
| F57.2   | URL validation: protocolos inválidos, IPs privados, loopback              | ~5 testes  |
| F57.3   | MAX_WEBHOOKS limit                                                        | ~1 teste   |
| F57.4   | emit(): payload sanitization (tokens, content, streaming redaction)       | ~4 testes  |
| F57.5   | #deliverWithRetry: sucesso 2xx, permanente 4xx (sem retry), retriable 5xx | ~4 testes  |
| F57.6   | DNS rebinding check                                                       | ~2 testes  |

**Validação**: `npm run test:unit` (total esperado: ~142 testes)

---

## FAIXA 3: Decomposição Arquitetural

### F58 — Extrair hook-context.js de initializer.js
**Gap**: GAP-S3 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                                       | Entregável           |
| ------- | ----------------------------------------------------------------------------------------------- | -------------------- |
| F58.1   | Criar `session/hook-context.js` com `buildHookSystemContext()` e `buildHookSystemContextSafe()` | Novo arquivo (~180L) |
| F58.2   | Mover `SessionJsonSchema` (Zod) para hook-context.js                                            | Edição               |
| F58.3   | Mover constantes `BRIEFING_FILE` e `SESSION_JSON_FILE` para hook-context.js                     | Edição               |
| F58.4   | Atualizar initializer.js para importar de hook-context.js                                       | Edição               |
| F58.5   | Atualizar barrel session/index.js                                                               | Edição               |
| F58.6   | Atualizar testes F56 se necessário                                                              | Edição               |

**Resultado**: initializer.js: 376L → ~200L | hook-context.js: ~180L

**Validação**: `npm run test:unit && npm run lint && npm run typecheck:node`

---

### F59 — Extrair backpressure.js de loop-manager.js
**Gap**: GAP-S1.1 | **Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição                                                                        | Entregável           |
| ------- | -------------------------------------------------------------------------------- | -------------------- |
| F59.1   | Identificar lógica de backpressure: `#turnQueueDepth`, pause/resume triggers     | Investigação         |
| F59.2   | Criar `dialog/backpressure.js` com classe `BackpressureMonitor` ou funções puras | Novo arquivo (~100L) |
| F59.3   | Refatorar loop-manager.js para delegar a backpressure.js                         | Edição               |
| F59.4   | Testes unitários para backpressure.js                                            | ~4 testes            |

**Resultado**: loop-manager.js: 661L → ~560L

---

### F60 — Extrair model-fallback.js de loop-manager.js
**Gap**: GAP-S1.2 | **Esforço**: Baixo | **Risco**: Baixo

| Subfase | Descrição                                          | Entregável          |
| ------- | -------------------------------------------------- | ------------------- |
| F60.1   | Identificar lógica de model fallback scheduling    | Investigação        |
| F60.2   | Criar `dialog/model-fallback.js` com funções puras | Novo arquivo (~80L) |
| F60.3   | Refatorar loop-manager.js                          | Edição              |
| F60.4   | Testes unitários para model-fallback.js            | ~3 testes           |

**Resultado**: loop-manager.js: ~560L → ~480L

---

### F61 — Extrair wireDialogLoopEvents → dialog/event-wiring.js
**Gap**: GAP-S1.3, D-05 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                   | Entregável           |
| ------- | ----------------------------------------------------------- | -------------------- |
| F61.1   | Criar `dialog/event-wiring.js` com `wireDialogLoopEvents()` | Novo arquivo (~120L) |
| F61.2   | Atualizar imports em loop-manager.js                        | Edição               |
| F61.3   | Atualizar barrel dialog/index.js                            | Edição               |
| F61.4   | Testes para os 13 event forwarders                          | ~5 testes            |

**Resultado**: loop-manager.js: ~480L → ~360L (meta <400L alcançada! ✅)

---

### F62 — Decompor event-wirer.js em event-handlers/
**Gap**: GAP-S2 | **Esforço**: Alto | **Risco**: Baixo

| Subfase | Descrição                                                                  | Entregável   |
| ------- | -------------------------------------------------------------------------- | ------------ |
| F62.1   | Criar `session/event-handlers/` diretório                                  | —            |
| F62.2   | Extrair `_wireCompactionEvents` → `compaction.js` (~60L)                   | Novo arquivo |
| F62.3   | Extrair `_wireStreamingEvents` → `streaming.js` (~80L)                     | Novo arquivo |
| F62.4   | Extrair `_wireTokenBudgetEvents` → `token-budget.js` (~50L)                | Novo arquivo |
| F62.5   | Extrair `_wireModeAndToolEvents` → `mode-and-tools.js` (~40L)              | Novo arquivo |
| F62.6   | Extrair `_wireSystemNotificationEvents` → `system-notifications.js` (~80L) | Novo arquivo |
| F62.7   | Extrair `_wireSdkResponseEvents` → `sdk-responses.js` (~60L)               | Novo arquivo |
| F62.8   | Extrair `_wireUsageEvent` → `usage.js` (~30L)                              | Novo arquivo |
| F62.9   | Extrair `_wireCatchAll` → `catch-all.js` (~40L) + mover KNOWN_SDK_EVENTS   | Novo arquivo |
| F62.10  | Criar `event-handlers/index.js` (barrel)                                   | Novo arquivo |
| F62.11  | Refatorar `event-wirer.js` para orquestrar imports (~150L)                 | Edição       |
| F62.12  | Atualizar barrel session/index.js                                          | Edição       |

**Resultado**: event-wirer.js: 591L → ~150L (orquestrador) | 8 novos handler files

**Validação**: `npm run test:unit && npm run lint && npm run typecheck:node`

---

### F63 — Extrair session-setup.js de agent-lifecycle.js
**Gap**: GAP-S5 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                          | Entregável           |
| ------- | ---------------------------------------------------------------------------------- | -------------------- |
| F63.1   | Identificar passos de `initSession()` que são session-specific (MCP, tools, hooks) | Investigação         |
| F63.2   | Criar `lifecycle/session-setup.js` com funções extraídas                           | Novo arquivo (~120L) |
| F63.3   | Refatorar agent-lifecycle.js para delegar                                          | Edição               |
| F63.4   | Testes para session-setup.js                                                       | ~4 testes            |

**Resultado**: agent-lifecycle.js: 362L → ~280L

---

## FAIXA 4: Testes Unitários — Onda 2

### F64 — Testes: loop-manager.js (pós-decomposição)
**Gap**: GAP-Q1 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                | Entregável |
| ------- | -------------------------------------------------------- | ---------- |
| F64.1   | `test_loop_manager.spec.js`: start/stop lifecycle        | ~3 testes  |
| F64.2   | Turn mutex serialization (concurrent sendTurn bloqueado) | ~3 testes  |
| F64.3   | pause/resume com strategy A (0 PR) e B (1 PR)            | ~4 testes  |
| F64.4   | handleProtocolInput routing                              | ~3 testes  |
| F64.5   | forceDeactivate durante turno ativo                      | ~2 testes  |
| F64.6   | handleTokenBudget → compaction trigger                   | ~2 testes  |
| F64.7   | Watchdog integration (stall → forceDeactivate)           | ~2 testes  |

**Validação**: `npm run test:unit` (total esperado: ~165+ testes)

---

### F65 — Testes: turn-executor.js (race conditions)
**Gap**: GAP-Q2 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                | Entregável |
| ------- | -------------------------------------------------------- | ---------- |
| F65.1   | `test_turn_executor.spec.js`: executeTurnImpl happy path | ~2 testes  |
| F65.2   | Race: reply antes de session.idle                        | ~2 testes  |
| F65.3   | Race: stopped antes de reply                             | ~2 testes  |
| F65.4   | Race: timeout antes de reply                             | ~2 testes  |
| F65.5   | waitForRestartAndReply → restart + novo reply            | ~2 testes  |
| F65.6   | waitForRestartAndReply → timeout sem restart             | ~1 teste   |
| F65.7   | AbortSignal durante turn                                 | ~1 teste   |

**Validação**: `npm run test:unit` (total esperado: ~177+ testes)

---

### F66 — Testes: cleanup.js + keepalive.js + snapshot.js
**Gap**: GAP-Q9 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                                                  | Entregável |
| ------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| F66.1   | `test_cleanup.spec.js`: sessões expiradas removidas, sessão ativa preservada, sem sessões                  | ~5 testes  |
| F66.2   | `test_keepalive.spec.js`: start/stop, ping reset, idle detection, client.ping() vs session.send() fallback | ~6 testes  |
| F66.3   | `test_snapshot.spec.js`: createSnapshot, saveSnapshot, listSnapshots, loadSnapshot, pruneSnapshots         | ~8 testes  |

**Validação**: `npm run test:unit` (total esperado: ~196+ testes)

---

### F67 — Teste de Integração: Agent Boot → Send → Stop
**Gap**: GAP-Q10 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                             | Entregável       |
| ------- | --------------------------------------------------------------------- | ---------------- |
| F67.1   | Criar mock do CopilotClient e CopilotSession para integração          | Helpers de teste |
| F67.2   | `test_agent_integration.spec.js`: boot completo (start → ready event) | ~2 testes        |
| F67.3   | Send message → process → resolve                                      | ~2 testes        |
| F67.4   | Dialog loop start → turns → stop                                      | ~2 testes        |
| F67.5   | Graceful shutdown → snapshot saved → drained                          | ~2 testes        |
| F67.6   | Reconexão após erro de rede simulado                                  | ~1 teste         |

**Validação**: `npm run test:unit && npm run test:integration` (total esperado: ~205+ testes)

---

## FAIXA 5: Observabilidade e Performance — agent/

### F68 — OTEL Spans em Dialog, Reconnect e Session Init
**Gap**: GAP-O1, GAP-O2, GAP-O3 | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                       | Entregável |
| ------- | --------------------------------------------------------------- | ---------- |
| F68.1   | Span `copilot.dialog.turn` em turn-executor.js (start → end)    | Edição     |
| F68.2   | Span `copilot.dialog.loop` em loop-manager.js (start → stop)    | Edição     |
| F68.3   | Span `copilot.reconnect` em reconnect-policy.js (per attempt)   | Edição     |
| F68.4   | Span `copilot.session.init` em agent-lifecycle.js (initSession) | Edição     |
| F68.5   | Atributos: model, sessionId, attempt, success                   | Edição     |

---

### F69 — Async FS em snapshot.js + Deprecação writeState Sync
**Gap**: GAP-C1, GAP-C2 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                       | Entregável            |
| ------- | ------------------------------------------------------------------------------- | --------------------- |
| F69.1   | Migrar `saveSnapshot()` de writeFileSync → writeFile (async)                    | Edição                |
| F69.2   | Migrar `listSnapshots()` de readdirSync/readFileSync → readdir/readFile (async) | Edição                |
| F69.3   | Migrar `loadSnapshot()` de readFileSync → readFile (async)                      | Edição                |
| F69.4   | Migrar `pruneSnapshots()` de rmSync → rm (async)                                | Edição                |
| F69.5   | Adicionar `@deprecated` em `writeState()` sync de state-io.js                   | Edição                |
| F69.6   | Atualizar todos os callers de writeState() → writeStateAsync()                  | Investigação + Edição |
| F69.7   | Atualizar testes de snapshot.js para async                                      | Edição testes         |

---

### F70 — Métricas em Rotation + Cleanup Paralelo
**Gap**: GAP-O4, GAP-C3, S-05 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                               | Entregável |
| ------- | --------------------------------------------------------------------------------------- | ---------- |
| F70.1   | rotation.js: `defaultMetrics.recordSessionRotation()` quando `shouldRotate: true`       | Edição     |
| F70.2   | cleanup.js: migrar `for...of await deleteSession` → `Promise.allSettled`                | Edição     |
| F70.3   | cleanup.js: limitar paralelismo a 5 com `Promise.all(batch)` para não sobrecarregar SDK | Edição     |

---

## FAIXA 6: Hardening agent/

### F71 — URL Validator Reutilizável
**Gap**: GAP-R3 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                       | Entregável          |
| ------- | ------------------------------------------------------------------------------- | ------------------- |
| F71.1   | Criar `infra/url-validator.js` com `validateWebhookUrl()` e `checkResolvedIp()` | Novo arquivo (~80L) |
| F71.2   | Refatorar webhook-manager.js para usar url-validator.js                         | Edição              |
| F71.3   | Atualizar barrel infra/index.js                                                 | Edição              |
| F71.4   | Testes para url-validator.js                                                    | ~6 testes           |

---

### F72 — Auditoria Final agent/ + Documentação PARTE-15A
**Gap**: — | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                                          | Entregável   |
| ------- | ---------------------------------------------------------------------------------- | ------------ |
| F72.1   | Executar full validation: lint + format + typecheck + test:unit + test:integration | Validação    |
| F72.2   | Re-auditar todos os 50+ arquivos do agent/ (pós-decomposição)                      | Investigação |
| F72.3   | Verificar cobertura de testes ≥ 60% dos arquivos de agent/                         | Métrica      |
| F72.4   | Criar PARTE-15A com status final de agent/ pós-F72                                 | Documento    |
| F72.5   | Atualizar PARTE-13 (status) com referência a PARTE-14/15A                          | Edição       |

---

## FAIXA 7: Recuperação de Testes Legados ★

> **Contexto**: 269 de 275 test files falham. Root cause primária: paths de import quebrados
> após refatorações (ex: `src/copilot/agent/reconnect-policy.js` → movido para
> `lifecycle/reconnect-policy.js`). Testes usam `node:test` mas o runner é Vitest, causando
> coexistência frágil. Apenas os 6 spec files com 46 testes criados nas fases F35–F48 passam.

### F73 — Triage e Categorização dos 269 Test Files Quebrados
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                                                           | Entregável             |
| ------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| F73.1   | Script automatizado que roda cada test file isolado e captura o erro (ENOENT, import error, etc.)   | Script de triage       |
| F73.2   | Categorizar falhas: (A) path quebrado, (B) mock desatualizado, (C) lógica errada, (D) irrecuperável | Relatório categorizado |
| F73.3   | Priorizar por impacto: testes copilot/ > server/ > regression/ > integration/ > resto               | Lista priorizada       |
| F73.4   | Estimar esforço por categoria                                                                       | Documento              |

**Validação**: Relatório gerado com categorização de todos os 269 files

---

### F74 — Fix Path Imports em Testes copilot/ (68 arquivos)
**Esforço**: Alto | **Risco**: Baixo

| Subfase | Descrição                                                                              | Entregável         |
| ------- | -------------------------------------------------------------------------------------- | ------------------ |
| F74.1   | Batch fix paths de `agent/reconnect-policy.js` → `agent/lifecycle/reconnect-policy.js` | Edição em massa    |
| F74.2   | Batch fix paths de `agent/state-io.js` → `agent/lifecycle/state-io.js`                 | Edição em massa    |
| F74.3   | Fix todos os imports que usam paths diretos ao invés de barrels                        | Edição em massa    |
| F74.4   | Fix mocks desatualizados (vi.mock paths incorretos)                                    | Edição por arquivo |
| F74.5   | Rodar `npx vitest run tests/unit/copilot/` e verificar redução de falhas               | Validação          |
| F74.6   | Meta: ≥50 dos 68 arquivos passando                                                     | Métrica            |

**Validação**: `npx vitest run tests/unit/copilot/ --reporter=verbose`

---

### F75 — Fix Path Imports em Testes server/ (10 arquivos)
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                           | Entregável      |
| ------- | --------------------------------------------------- | --------------- |
| F75.1   | Identificar imports quebrados em tests/unit/server/ | Investigação    |
| F75.2   | Fix paths e mocks                                   | Edição em massa |
| F75.3   | Meta: ≥8 dos 10 arquivos passando                   | Métrica         |

---

### F76 — Fix Path Imports em regression/ (63 arquivos)
**Esforço**: Alto | **Risco**: Médio (podem ter dependências de runtime)

| Subfase | Descrição                                                                  | Entregável      |
| ------- | -------------------------------------------------------------------------- | --------------- |
| F76.1   | Categorizar: (A) import fix simples, (B) precisa mock, (C) precisa runtime | Triage          |
| F76.2   | Fix categoria A (estimativa: ~40 arquivos)                                 | Edição em massa |
| F76.3   | Fix categoria B (estimativa: ~15 arquivos)                                 | Edição manual   |
| F76.4   | Quarentena categoria C (mover para `tests/quarantine/`)                    | Reorganização   |

---

### F77 — Fix integration/ + e2e/ + manual/ (39 arquivos)
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                            | Entregável      |
| ------- | -------------------------------------------------------------------- | --------------- |
| F77.1   | Fix integration/copilot/ (3 arquivos — lifecycle, session, terminal) | Edição          |
| F77.2   | Fix integration/server/ (14 arquivos)                                | Edição em massa |
| F77.3   | Fix integration/ outros (rag, mcp, audit, driver, kernel, api)       | Edição em massa |
| F77.4   | Fix e2e/ (3 arquivos — boot, ariadne, integration_complete)          | Edição          |
| F77.5   | Mover manual/ para tests/quarantine/ se dependerem de infra real     | Reorganização   |

---

### F78 — Quarentena + Relatório Final de Testes
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                            | Entregável    |
| ------- | ------------------------------------------------------------------------------------ | ------------- |
| F78.1   | Criar `tests/quarantine/` para testes irrecuperáveis sem rewrite                     | Diretório     |
| F78.2   | Mover testes irrecuperáveis com `// QUARANTINE: razão` no header                     | Reorganização |
| F78.3   | Criar `vitest.config.js` exclude para quarantine/                                    | Edição config |
| F78.4   | Relatório: tests passando vs antes, categorias de falha, dívida técnica remanescente | Documento     |
| F78.5   | Meta: ≥180 test files passando (de 269 falhando → ≤89 em quarentena)                 | Métrica       |

**Validação**: `npx vitest run` — verificar que test files passando ≥ 180

---

## FAIXA 8: Tipagem Strict & JSDoc ★

> **Contexto**: 221/225 arquivos têm `@ts-check`. O typecheck passa com tsconfig.node.json
> (modo normal). Falta migração incremental para strict e cobertura JSDoc nos módulos externos.

### F79 — @ts-check nos 4 Barrels Faltantes
**Esforço**: Trivial | **Risco**: Nenhum

| Subfase | Descrição                                            | Entregável |
| ------- | ---------------------------------------------------- | ---------- |
| F79.1   | Adicionar `// @ts-check` em `bridges/index.js`       | Edição     |
| F79.2   | Adicionar `// @ts-check` em `hooks/presets/index.js` | Edição     |
| F79.3   | Adicionar `// @ts-check` em `api/sse/index.js`       | Edição     |
| F79.4   | Adicionar `// @ts-check` em `db/index.js`            | Edição     |

**Validação**: `npx tsc --noEmit` — zero regressões

---

### F80 — JSDoc Missing em Funções Exportadas de agent/
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                           | Entregável |
| ------- | ------------------------------------------------------------------- | ---------- |
| F80.1   | Auditar todas as funções `export` em agent/ sem `@param`/`@returns` | Lista      |
| F80.2   | Adicionar JSDoc em funções de agent-context.js                      | Edição     |
| F80.3   | Adicionar JSDoc em funções de boot-wiring.js                        | Edição     |
| F80.4   | Adicionar JSDoc em funções restantes dos 36 arquivos                | Edição     |
| F80.5   | Meta: 100% de funções exportadas com @param/@returns/@throws        | Métrica    |

---

### F81 — JSDoc Missing em Funções Exportadas de sdk/
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                              | Entregável |
| ------- | ------------------------------------------------------ | ---------- |
| F81.1   | Auditar exports em sdk/ (18 arquivos, 3.149L)          | Lista      |
| F81.2   | JSDoc em client.js, session.js, tools-registry.js      | Edição     |
| F81.3   | JSDoc em models/registry.js, models/helpers.js         | Edição     |
| F81.4   | JSDoc em agents.js, event-helpers.js, url-validator.js | Edição     |

---

### F82 — JSDoc Missing em Funções Exportadas de tools/
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                          | Entregável |
| ------- | ------------------------------------------------------------------ | ---------- |
| F82.1   | Auditar exports em tools/ (22 arquivos, 6.086L)                    | Lista      |
| F82.2   | JSDoc nas tool definitions (shell, file, todo, web, introspection) | Edição     |
| F82.3   | JSDoc nos hooks-tools e permission-tools                           | Edição     |

---

### F83 — Migração Incremental para tsconfig.strict.json
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                                  | Entregável      |
| ------- | -------------------------------------------------------------------------- | --------------- |
| F83.1   | Rodar strict typecheck e categorizar erros por tipo (TS2345, TS7006, etc.) | Relatório       |
| F83.2   | Fix erros de tipo em agent/ (maior prioridade)                             | Edições         |
| F83.3   | Fix erros de tipo em core/ + config/                                       | Edições         |
| F83.4   | Fix erros de tipo em sdk/                                                  | Edições         |
| F83.5   | Adicionar agent/ e core/ aos projects strict                               | Edição tsconfig |
| F83.6   | Meta: agent/ + core/ + config/ passando em strict                          | Validação       |

**Validação**: `npx tsc --project tsconfig.strict.json --noEmit`

---

### F84 — Typedef Centralizado para SDK Types
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                     | Entregável      |
| ------- | ----------------------------------------------------------------------------- | --------------- |
| F84.1   | Criar `core/sdk-types.js` com typedefs de CopilotSession, CopilotClient, etc. | Arquivo (~100L) |
| F84.2   | Migrar typedefs duplicados de agent/types.js para usar re-export              | Edição          |
| F84.3   | Atualizar JSDoc imports para usar canonical path do core/sdk-types            | Edição em massa |

---

## FAIXA 9: Error Handling Unificado ★

> **Contexto**: A hierarquia de erros (CopilotError → SessionError/BridgeError/ConfigError/ToolError)
> é boa, mas há ~5 instâncias de `throw new Error()` raw (sem tipo), e ~15 `JSON.parse()` sem
> try-catch. Os error codes são adhoc strings, não constantes exportadas.

### F85 — Eliminar throw new Error() Raw → Typed Errors
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                             | Entregável |
| ------- | --------------------------------------------------------------------- | ---------- |
| F85.1   | Inventariar todos os `throw new Error()` em copilot/ (excluir testes) | Lista      |
| F85.2   | Substituir por ConfigError, SessionError, ToolError conforme contexto | Edição     |
| F85.3   | Verificar que nenhum catch depende de `instanceof Error` genérico     | Auditoria  |

---

### F86 — Novas Classes de Erro
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                               | Entregável             |
| ------- | ----------------------------------------------------------------------- | ---------------------- |
| F86.1   | Criar `TimeoutError extends CopilotError` em core/errors.js             | Edição (~15L)          |
| F86.2   | Criar `ValidationError extends CopilotError` em core/errors.js          | Edição (~15L)          |
| F86.3   | Criar `StateTransitionError extends CopilotError` em core/errors.js     | Edição (~15L)          |
| F86.4   | Migrar timeout patterns (Promise.race + setTimeout) usando TimeoutError | Edição (6 ocorrências) |

---

### F87 — Error Codes Catalog
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                 | Entregável      |
| ------- | ------------------------------------------------------------------------- | --------------- |
| F87.1   | Criar `core/error-codes.js` com constantes para todos os codes existentes | Arquivo (~60L)  |
| F87.2   | Migrar adhoc strings ('NO_SESSION', 'QUEUE_FULL', etc.) para constantes   | Edição em massa |
| F87.3   | Documentar catalog em JSDoc module header                                 | Edição          |

---

### F88 — JSON.parse Wrapping com Typed Error
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                    | Entregável     |
| ------- | ---------------------------------------------------------------------------- | -------------- |
| F88.1   | Criar `core/safe-json.js` com `safeJsonParse(raw, fallback?)` → typed result | Arquivo (~40L) |
| F88.2   | Migrar JSON.parse em snapshot.js (3 calls)                                   | Edição         |
| F88.3   | Migrar JSON.parse em state-io.js (1 call)                                    | Edição         |
| F88.4   | Migrar JSON.parse em terminal/ (alias-store, server, handlers)               | Edição         |
| F88.5   | Migrar JSON.parse em sdk/ (custom-tools, tools-state)                        | Edição         |
| F88.6   | Migrar JSON.parse em channel/inject.js (3 calls)                             | Edição         |

---

### F89 — Padronizar Catch Blocks
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                         | Entregável       |
| ------- | --------------------------------------------------------------------------------- | ---------------- |
| F89.1   | Auditar todos os catch blocks em copilot/ — identificar os que engolhem sem log   | Lista            |
| F89.2   | Garantir que todo catch tem no mínimo `log('WARN', ...)` ou re-throw              | Edição           |
| F89.3   | Garantir que erros em `void` async calls são logados (ex: `void fn().catch(log)`) | Edição (4 calls) |
| F89.4   | Documentar pattern de error handling no README do projeto                         | Documentação     |

---

## FAIXA 10: Async FS Global ★

> **Contexto**: 18+ chamadas `*Sync()` em produção bloqueiam o event loop. Distribuição:
> - `snapshot.js`: 11 calls (existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync)
> - `state-io.js`: 6 calls
> - `sdk/custom-tools.js`: 4 calls (readFileSync, writeFileSync, renameSync, existsSync)
> - `sdk/tools-state.js`: 3 calls
> - `terminal/alias-store.js`: 2 calls (readFileSync, writeFileSync)
> - `config/pinned-files.js`: 5 calls
> - `db/sqlite.js`: 1 call (mkdirSync)
> - `terminal/workspace-context.js`: 1 call (execSync)

### F90 — Async FS em snapshot.js
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                       | Entregável |
| ------- | ------------------------------------------------------------------------------- | ---------- |
| F90.1   | Migrar `saveSnapshot()` de writeFileSync → writeFile (async)                    | Edição     |
| F90.2   | Migrar `listSnapshots()` de readdirSync/readFileSync → readdir/readFile (async) | Edição     |
| F90.3   | Migrar `loadSnapshot()` de readFileSync → readFile (async)                      | Edição     |
| F90.4   | Migrar `pruneSnapshots()` de rmSync → rm (async)                                | Edição     |
| F90.5   | Migrar existsSync checks → stat com catch ENOENT                                | Edição     |
| F90.6   | Atualizar todos os callers para await                                           | Edição     |

**Validação**: `npm run test:unit` — snapshot tests passando

---

### F91 — Async FS em state-io.js
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                    | Entregável |
| ------- | ------------------------------------------------------------ | ---------- |
| F91.1   | Adicionar `@deprecated` em `writeState()` sync               | Edição     |
| F91.2   | Migrar `readState()` de readFileSync → readFile (async)      | Edição     |
| F91.3   | Migrar `clearState()` de rmSync/existsSync → rm/stat (async) | Edição     |
| F91.4   | Atualizar callers (entry.js, agent-lifecycle.js) para await  | Edição     |

---

### F92 — Async FS em sdk/custom-tools.js + tools-state.js
**Esforço**: Baixo | **Risco**: Baixo

| Subfase | Descrição                                                     | Entregável |
| ------- | ------------------------------------------------------------- | ---------- |
| F92.1   | Migrar `_loadFromDisk()` em custom-tools.js para async        | Edição     |
| F92.2   | Migrar `_persistToDisk()` de writeFileSync/renameSync → async | Edição     |
| F92.3   | Migrar `_loadConfig()` em tools-state.js para async           | Edição     |
| F92.4   | Migrar `_saveConfig()` de writeFileSync → async               | Edição     |

---

### F93 — Async FS em terminal/ + db/ + config/
**Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição                                                               | Entregável |
| ------- | ----------------------------------------------------------------------- | ---------- |
| F93.1   | Migrar `alias-store.js` readFileSync/writeFileSync → async              | Edição     |
| F93.2   | Migrar `db/sqlite.js` mkdirSync na inicialização → async                | Edição     |
| F93.3   | Migrar `config/pinned-files.js` existsSync/readdirSync/statSync → async | Edição     |
| F93.4   | Migrar `terminal/workspace-context.js` execSync → exec (com timeout)    | Edição     |
| F93.5   | Auditar se restam *Sync calls em src/copilot/ (meta: zero em prod code) | Validação  |

**Validação**: `grep -r 'Sync(' src/copilot/ | grep -v test | grep -v node_modules` → vazio

---

## FAIXA 11: Segurança & Validação de Input ★

> **Contexto**: webhook-manager.js tem boa proteção SSRF com DNS rebinding check. Porém, há
> 15+ chamadas JSON.parse sem schema validation, e endpoints API/express não validam body
> de forma consistente. channel/inject.js aceita HTTP posts sem rate limiting.

### F94 — JSON.parse com Schema Validation em Paths Críticos
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                              | Entregável |
| ------- | -------------------------------------------------------------------------------------- | ---------- |
| F94.1   | Criar schemas Zod para: snapshot data, state-io data, alias config, tools-state config | Schemas    |
| F94.2   | Aplicar `z.safeParse()` em snapshot.js (loadSnapshot, listSnapshots)                   | Edição     |
| F94.3   | Aplicar `z.safeParse()` em state-io.js (readState)                                     | Edição     |
| F94.4   | Aplicar `z.safeParse()` em sdk/custom-tools.js (_loadFromDisk)                         | Edição     |
| F94.5   | Aplicar `z.safeParse()` em channel/inject.js (parse body)                              | Edição     |

**Validação**: `npm run test:unit && npm run lint`

---

### F95 — Input Validation nos Endpoints API/express
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                        | Entregável |
| ------- | -------------------------------------------------------------------------------- | ---------- |
| F95.1   | Auditar todos os `req.body` e `req.params` em api/express/ (21 arquivos, 3.007L) | Lista      |
| F95.2   | Criar middleware de validação com Zod (ou equivalente)                           | Arquivo    |
| F95.3   | Aplicar validação em session-crud.js (359L)                                      | Edição     |
| F95.4   | Aplicar validação em session-messaging.js (283L)                                 | Edição     |
| F95.5   | Aplicar validação em bridge/ endpoints (control, stream, dialog, tasks)          | Edição     |

---

### F96 — Rate Limiting Defensivo em channel/inject.js
**Esforço**: Baixo | **Risco**: Baixo

| Subfase | Descrição                                                         | Entregável |
| ------- | ----------------------------------------------------------------- | ---------- |
| F96.1   | Implementar rate limiter simples (token bucket ou sliding window) | Edição     |
| F96.2   | Configurar via env: `INJECT_RATE_LIMIT_PER_SEC` (default: 30)     | Edição     |
| F96.3   | Retornar 429 Too Many Requests quando exceder                     | Edição     |

---

### F97 — Audit Log para Operações Administrativas
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                                             | Entregável |
| ------- | ------------------------------------------------------------------------------------- | ---------- |
| F97.1   | Criar `observability/audit-logger.js` com interface `logAdminAction(action, details)` | Arquivo    |
| F97.2   | Instrumentar: session create/delete, webhook register/unregister, permission changes  | Edição     |
| F97.3   | Instrumentar: tool toggle, config changes, agent start/stop                           | Edição     |
| F97.4   | Formato: JSON-line para integração com ELK/Loki                                       | Validação  |

---

### F98 — Revisão SSRF/DNS-Rebinding em Bridges
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                       | Entregável |
| ------- | ------------------------------------------------------------------------------- | ---------- |
| F98.1   | Auditar nerv-bridge.js (385L) — verificar se URLs são validadas                 | Auditoria  |
| F98.2   | Auditar mcp-tool-bridge.js (531L) — verificar fetch/connect de URLs externas    | Auditoria  |
| F98.3   | Auditar git-bridge.js (402L) — verificar se URLs de remote são validadas        | Auditoria  |
| F98.4   | Auditar web-tools.js (397L) — fetch de URLs fornecidas pelo modelo              | Auditoria  |
| F98.5   | Aplicar url-validator.js (F71) em todos os paths que fazem fetch de URL externa | Edição     |
| F98.6   | Bloquear protocolos não-HTTP(S) em fetch calls                                  | Edição     |

---

## FAIXA 12: Decomposição God Modules Externos ★

> **Contexto**: 14 arquivos fora de agent/ excedem 400L. Estes são os maiores contribuintes para
> complexidade cognitiva e acoplamento. A decomposição segue o mesmo padrão aplicado em agent/:
> identificar responsabilidades distintas, extrair para módulos coesos, manter facade.

### F99 — Decompor tools/shell/index.js (714L)
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                              | Entregável      |
| ------- | ---------------------------------------------------------------------- | --------------- |
| F99.1   | Mapear responsabilidades: setup, execution, output parsing, sandboxing | Investigação    |
| F99.2   | Extrair `shell/executor.js` — lógica de execução de comandos           | Arquivo (~200L) |
| F99.3   | Extrair `shell/output-parser.js` — parsing e formatação de output      | Arquivo (~150L) |
| F99.4   | Extrair `shell/sandbox.js` — validação de comandos e sandboxing        | Arquivo (~120L) |
| F99.5   | shell/index.js vira facade/barrel                                      | Edição (~250L)  |
| F99.6   | Testes para modules extraídos                                          | ~6 testes       |

**Resultado**: 714L → ~250L (facade) + 3 módulos

---

### F100 — Decompor conversation-hub/orchestrator.js (658L)
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                                | Entregável      |
| ------- | ------------------------------------------------------------------------ | --------------- |
| F100.1  | Mapear responsabilidades: routing, session management, dialog delegation | Investigação    |
| F100.2  | Extrair routing logic → `conversation-hub/router.js`                     | Arquivo (~200L) |
| F100.3  | Extrair dialog delegation → `conversation-hub/dialog-delegate.js`        | Arquivo (~150L) |
| F100.4  | orchestrator.js vira facade                                              | Edição (~300L)  |
| F100.5  | Testes para modules extraídos                                            | ~4 testes       |

---

### F101 — Decompor conversation-hub/store.js (609L)
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                          | Entregável      |
| ------- | -------------------------------------------------- | --------------- |
| F101.1  | Mapear: CRUD operations, search/query, persistence | Investigação    |
| F101.2  | Extrair `conversation-hub/store-query.js`          | Arquivo (~180L) |
| F101.3  | Extrair `conversation-hub/store-persistence.js`    | Arquivo (~150L) |
| F101.4  | store.js vira facade (<300L)                       | Edição          |

---

### F102 — Decompor terminal/dialog/engine.js (589L)
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                    | Entregável      |
| ------- | ------------------------------------------------------------ | --------------- |
| F102.1  | Mapear: input processing, turn management, output formatting | Investigação    |
| F102.2  | Extrair `terminal/dialog/input-processor.js`                 | Arquivo (~180L) |
| F102.3  | Extrair `terminal/dialog/turn-manager.js`                    | Arquivo (~150L) |
| F102.4  | engine.js mantém orquestração (<300L)                        | Edição          |

---

### F103 — Decompor terminal/repl.js (575L)
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                       | Entregável      |
| ------- | --------------------------------------------------------------- | --------------- |
| F103.1  | Mapear: command parsing, REPL loop, completion, history         | Investigação    |
| F103.2  | Extrair `terminal/repl-commands.js` (dispatch table + handlers) | Arquivo (~200L) |
| F103.3  | Extrair `terminal/repl-completion.js` (auto-complete logic)     | Arquivo (~100L) |
| F103.4  | repl.js mantém loop principal (<300L)                           | Edição          |

---

### F104 — Decompor sdk/models/registry.js (557L)
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                              | Entregável      |
| ------- | ---------------------------------------------------------------------- | --------------- |
| F104.1  | Mapear: model catalog, capability detection, fallback logic            | Investigação    |
| F104.2  | Extrair `sdk/models/capabilities.js` (capability detection + matching) | Arquivo (~180L) |
| F104.3  | Extrair `sdk/models/fallback.js` (fallback chain logic)                | Arquivo (~120L) |
| F104.4  | registry.js mantém catalog + facade (<280L)                            | Edição          |

---

### F105 — Decompor channel/client.js (556L) + channel/inject.js (546L)
**Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição                                                           | Entregável      |
| ------- | ------------------------------------------------------------------- | --------------- |
| F105.1  | client.js: extrair `channel/client-retry.js` (retry/backoff logic)  | Arquivo (~150L) |
| F105.2  | client.js: extrair `channel/client-batch.js` (batch operations)     | Arquivo (~100L) |
| F105.3  | inject.js: extrair `channel/inject-sse.js` (SSE stream handling)    | Arquivo (~180L) |
| F105.4  | inject.js: extrair `channel/inject-routes.js` (HTTP route handlers) | Arquivo (~150L) |
| F105.5  | Ambos mantêm facade (<350L cada)                                    | Edição          |

---

### F106 — Decompor observability/metrics.js (552L)
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                          | Entregável      |
| ------- | ------------------------------------------------------------------ | --------------- |
| F106.1  | Mapear: counters, gauges, histograms, registries                   | Investigação    |
| F106.2  | Extrair `observability/metrics-registry.js` (metric definitions)   | Arquivo (~180L) |
| F106.3  | Extrair `observability/metrics-helpers.js` (calculation utilities) | Arquivo (~120L) |
| F106.4  | metrics.js mantém facade + export (<280L)                          | Edição          |

---

### F107 — Decompor bridges/mcp-tool-bridge.js (531L)
**Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição                                                              | Entregável      |
| ------- | ---------------------------------------------------------------------- | --------------- |
| F107.1  | Mapear: RPC layer, tool marshalling, connection management             | Investigação    |
| F107.2  | Extrair `bridges/mcp-rpc.js` (JSON-RPC protocol handling)              | Arquivo (~180L) |
| F107.3  | Extrair `bridges/mcp-connection.js` (connection lifecycle + reconnect) | Arquivo (~120L) |
| F107.4  | mcp-tool-bridge.js mantém tool marshalling + facade (<250L)            | Edição          |

---

## FAIXA 13: Observabilidade Cross-Módulo ★

> **Contexto**: OTEL está parcialmente implementado (otel.js 230L). error-tracker.js usa
> process.on global. Logger é funcional mas sem níveis estruturados. Falta health-check com
> componentes degradados e dashboard de dead-letter events.

### F108 — OTEL Spans em sdk/client.js e Bridges
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                               | Entregável |
| ------- | ----------------------------------------------------------------------- | ---------- |
| F108.1  | Span `copilot.sdk.request` em sdk/client.js (cada request ao SDK)       | Edição     |
| F108.2  | Span `copilot.bridge.nerv` em bridges/nerv-bridge.js (cada chamada)     | Edição     |
| F108.3  | Span `copilot.bridge.mcp` em bridges/mcp-tool-bridge.js (cada RPC call) | Edição     |
| F108.4  | Span `copilot.bridge.git` em bridges/git-bridge.js (cada operação git)  | Edição     |
| F108.5  | Atributos: bridge_type, method, status_code, duration_ms                | Edição     |

---

### F109 — Error Tracker Unificado (Singleton → DI)
**Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição                                                                          | Entregável |
| ------- | ---------------------------------------------------------------------------------- | ---------- |
| F109.1  | Refatorar error-tracker.js para aceitar injeção de handlers ao invés de process.on | Edição     |
| F109.2  | Criar `ErrorTracker.create(options)` factory com configuração explícita            | Edição     |
| F109.3  | Mover process.on para entry.js (único ponto de registro de handlers globais)       | Edição     |
| F109.4  | Testes para error-tracker com handlers injetados                                   | ~4 testes  |

---

### F110 — Structured Logging Padronizado
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                            | Entregável |
| ------- | -------------------------------------------------------------------- | ---------- |
| F110.1  | Padronizar `log()` signature para incluir metadata object opcional   | Edição     |
| F110.2  | Garantir que `log('WARN', msg)` inclui stack trace quando disponível | Edição     |
| F110.3  | Adicionar correlation ID (sessionId) em todos os log calls do agent/ | Edição     |
| F110.4  | Formato JSON-line para prod, human-readable para dev                 | Edição     |

---

### F111 — Health Check Endpoint com Componentes Degradados
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                    | Entregável |
| ------- | ------------------------------------------------------------ | ---------- |
| F111.1  | Estender health endpoint para reportar status por componente | Edição     |
| F111.2  | Componentes: agent, sdk_session, terminal, database, bridges | Edição     |
| F111.3  | Status: healthy, degraded, unhealthy com detalhes            | Edição     |
| F111.4  | Retornar 200 se healthy/degraded, 503 se unhealthy           | Edição     |

---

### F112 — Métricas de Latência por Bridge
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                | Entregável |
| ------- | ------------------------------------------------------------------------ | ---------- |
| F112.1  | Histogram `copilot.bridge.latency_ms` com label bridge_type              | Edição     |
| F112.2  | Instrumentar nerv-bridge.js, git-bridge.js, mcp-tool-bridge.js           | Edição     |
| F112.3  | Counter `copilot.bridge.errors_total` com label bridge_type + error_code | Edição     |

---

### F113 — Dashboard de Eventos (Catálogo + Dead-Letter)
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                                              | Entregável     |
| ------- | -------------------------------------------------------------------------------------- | -------------- |
| F113.1  | Criar `observability/event-catalog.js` — catálogo runtime de todos os eventos emitidos | Arquivo (~80L) |
| F113.2  | Implementar dead-letter tracking (eventos emitidos sem listeners)                      | Edição (~60L)  |
| F113.3  | Expor via endpoint `/api/events/catalog` e `/api/events/dead-letter`                   | Edição         |
| F113.4  | Counter `copilot.events.dead_letter_total`                                             | Edição         |

---

## FAIXA 14: Hardening Final & CI ★

> **Contexto**: Sem CI gates formais. Nenhum coverage threshold. Padrão de retry/backoff
> está duplicado em 6+ lugares. AbortController não é usado (todos usam timeout manual).
> Graceful shutdown está registrado em entry.js e terminal/index.js separadamente.

### F114 — CI Gate: lint + typecheck + test:unit Obrigatório
**Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição                                                         | Entregável |
| ------- | ----------------------------------------------------------------- | ---------- |
| F114.1  | Criar `.github/workflows/ci.yml` com lint + typecheck + test:unit | Workflow   |
| F114.2  | Configurar para rodar em push (main) e PR                         | Edição     |
| F114.3  | Fail-fast: bloquear merge se quality gates falham                 | Edição     |
| F114.4  | Cache de node_modules para performance                            | Edição     |

---

### F115 — Coverage Mínima com Threshold Bloqueante
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                        | Entregável      |
| ------- | ---------------------------------------------------------------- | --------------- |
| F115.1  | Configurar vitest coverage v8 com thresholds em vitest.config.js | Edição          |
| F115.2  | Threshold inicial: lines 30%, branches 20%, functions 30%        | Edição          |
| F115.3  | Adicionar coverage report no CI (upload artifact)                | Edição workflow |
| F115.4  | Meta progressiva: aumentar 5% por faixa concluída                | Documentação    |

---

### F116 — Dependency Audit
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                   | Entregável      |
| ------- | ----------------------------------------------------------- | --------------- |
| F116.1  | `npm audit` no CI — fail em vulnerabilidades high/critical  | Edição workflow |
| F116.2  | License check — identificar licensas incompatíveis          | Script          |
| F116.3  | Dependency graph — mapear deps diretas vs transitivas       | Relatório       |
| F116.4  | Identificar deps com alternativas mais leves (se aplicável) | Investigação    |

---

### F117 — Retry/Backoff Utility (Eliminar Padrão Duplicado)
**Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição                                                                      | Entregável     |
| ------- | ------------------------------------------------------------------------------ | -------------- |
| F117.1  | Criar `core/retry.js` com `withRetry(fn, opts)` (backoff exponencial + jitter) | Arquivo (~60L) |
| F117.2  | Migrar reconnect-policy.js para usar `withRetry`                               | Edição         |
| F117.3  | Migrar webhook-manager.js `#deliverWithRetry` para usar `withRetry`            | Edição         |
| F117.4  | Migrar entry.js boot retry loop para usar `withRetry`                          | Edição         |
| F117.5  | Migrar channel/client.js retry logic para usar `withRetry`                     | Edição         |
| F117.6  | Testes para `withRetry` (happy, max retries, abort, jitter)                    | ~6 testes      |

---

### F118 — AbortController Patterns Padronizados
**Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição                                                                     | Entregável     |
| ------- | ----------------------------------------------------------------------------- | -------------- |
| F118.1  | Criar `core/abort-utils.js` com `withTimeout(fn, ms)` usando AbortController  | Arquivo (~40L) |
| F118.2  | Migrar `Promise.race([fn, setTimeout reject])` em entry.js → `withTimeout`    | Edição         |
| F118.3  | Migrar padrão em state-io.js (drainStateWrites) → `withTimeout`               | Edição         |
| F118.4  | Migrar padrão em agent-lifecycle.js (shutdown timeout) → `withTimeout`        | Edição         |
| F118.5  | Migrar padrão em turn-executor.js → `withTimeout` (opcional — é FSM complexo) | Investigação   |

---

### F119 — Graceful Shutdown Unificado
**Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição                                                                          | Entregável     |
| ------- | ---------------------------------------------------------------------------------- | -------------- |
| F119.1  | Criar `core/shutdown.js` com `registerShutdownHandler(name, fn)` e `runShutdown()` | Arquivo (~80L) |
| F119.2  | Migrar entry.js signal handlers para usar shutdown.js                              | Edição         |
| F119.3  | Migrar terminal/index.js SIGHUP handler para usar shutdown.js                      | Edição         |
| F119.4  | Migrar db/sqlite.js process.on('exit') para usar shutdown.js                       | Edição         |
| F119.5  | Garantir ordem: agent.stop() → db.close() → terminal.stop() → process.exit()       | Documentação   |
| F119.6  | Testes de shutdown sequence                                                        | ~3 testes      |

---

### F120 — Auditoria Final Integral + PARTE-15B
**Esforço**: Alto | **Risco**: Nenhum

| Subfase | Descrição                                                                          | Entregável   |
| ------- | ---------------------------------------------------------------------------------- | ------------ |
| F120.1  | Executar full validation: lint + format + typecheck + test:unit + test:integration | Validação    |
| F120.2  | Re-auditar todos os 225+ arquivos de copilot/ (pós-decomposição total)             | Investigação |
| F120.3  | Verificar que nenhum arquivo em copilot/ excede 400L                               | Métrica      |
| F120.4  | Verificar coverage ≥ 50% lines                                                     | Métrica      |
| F120.5  | Verificar zero `*Sync()` em production code                                        | Métrica      |
| F120.6  | Gerar relatório comparativo: antes (pré-F49) vs depois (pós-F120)                  | Relatório    |
| F120.7  | Criar PARTE-15B com status final integral de copilot/                              | Documento    |
| F120.8  | Atualizar PARTE-13 com referência a PARTE-15A/15B e status COMPLETO                | Edição       |

---

## Estimativa de Entregáveis por Faixa

| Faixa                               | Fases        | Novos Arquivos         | Testes Adicionais | Entregável Doc |
| ----------------------------------- | ------------ | ---------------------- | ----------------- | -------------- |
| 1: Fundação                         | F49–F52      | 2 barrels              | ~8                | —              |
| 2: Testes Onda 1                    | F53–F57      | 5 spec files           | ~96               | —              |
| 3: Decomposição agent/              | F58–F63      | 12+ arquivos           | ~16               | —              |
| 4: Testes Onda 2                    | F64–F67      | 4 spec files + helpers | ~54               | —              |
| 5: Observabilidade agent/           | F68–F70      | —                      | ~0                | —              |
| 6: Hardening agent/                 | F71–F72      | 1 arquivo + 1 spec     | ~6                | PARTE-15A      |
| **7: Recuperação Testes Legados** ★ | F73–F78      | 1 dir + script         | ~0 (fix 180+)     | Relatório      |
| **8: Tipagem Strict & JSDoc** ★     | F79–F84      | 1 arquivo              | ~0                | —              |
| **9: Error Handling Unificado** ★   | F85–F89      | 3 arquivos             | ~6                | —              |
| **10: Async FS Global** ★           | F90–F93      | —                      | ~8                | —              |
| **11: Segurança & Validação** ★     | F94–F98      | 2 arquivos             | ~10               | —              |
| **12: God Modules Externos** ★      | F99–F107     | ~22 arquivos           | ~20               | —              |
| **13: Observabilidade Cross** ★     | F108–F113    | 2 arquivos             | ~10               | —              |
| **14: Hardening Final & CI** ★      | F114–F120    | 4 arquivos + workflow  | ~15               | PARTE-15B      |
| **TOTAL**                           | **72 fases** | **~55 novos**          | **~249**          | **2 docs**     |

---

## Dependências entre Faixas

```
┌──────────────────────────────── CORE PATH ─────────────────────────────────┐
│                                                                             │
│  FAIXA 1 ──► FAIXA 2 ──► FAIXA 3 ──► FAIXA 4 ──► FAIXA 5 ──► FAIXA 6    │
│  (F49-52)    (F53-57)    (F58-63)    (F64-67)    (F68-70)    (F71-72)     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── PARALLEL TRACKS ───────────────────────────────┐
│                                                                             │
│  FAIXA 7 (F73-78)  ←── pode iniciar em paralelo com FAIXA 1              │
│  (Testes legados)       depende apenas de estado atual do código           │
│                                                                             │
│  FAIXA 8 (F79-84)  ←── pode iniciar após FAIXA 1 (F49 barrels)           │
│  (Tipagem/JSDoc)        F83 strict depende de FAIXA 9 (typed errors)      │
│                                                                             │
│  FAIXA 9 (F85-89)  ←── pode iniciar em paralelo com FAIXA 2              │
│  (Error handling)       sem dependência de testes onda 1                   │
│                                                                             │
│  FAIXA 10 (F90-93) ←── depende de FAIXA 5 (F69 inicia migração)          │
│  (Async FS)             estende F69 para o restante de copilot/            │
│                                                                             │
│  FAIXA 11 (F94-98) ←── depende de FAIXA 6 (F71 url-validator)            │
│  (Segurança)            e FAIXA 9 (F88 safe-json)                         │
│                                                                             │
│  FAIXA 12 (F99-107) ←── depende de FAIXA 3 (padrões estabelecidos)       │
│  (God Modules ext.)      pode rodar em paralelo com FAIXAS 10-11          │
│                                                                             │
│  FAIXA 13 (F108-113) ←── depende de FAIXA 5 (F68 OTEL agent/)           │
│  (Observ. cross)         pode rodar em paralelo com FAIXA 12              │
│                                                                             │
│  FAIXA 14 (F114-120) ←── depende de TODAS as anteriores                   │
│  (Hardening final)       F120 é o checkpoint final                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Grafo de Dependências entre Fases (detalhado)

```
                FAIXA 1          FAIXA 7 (paralela)
                F49→F50→F51→F52  F73→F74→F75→F76→F77→F78
                    │                         │
                    ▼                         │
                FAIXA 2          FAIXA 9      │
                F53→F54→F55→F56→F57  F85→F86→F87→F88→F89
                    │                    │         │
                    ▼                    │         │
                FAIXA 3          FAIXA 8 │         │
                F58→F59→F60→F61→F62→F63  F79→F80→F81→F82→F83→F84
                    │                              │
                    ▼                              │
                FAIXA 4                            │
                F64→F65→F66→F67                    │
                    │                              │
                    ▼                              │
                FAIXA 5                   FAIXA 12 │
                F68→F69→F70          F99→...→F107  │
                 │       │                │        │
                 │       ▼                │        │
                 │   FAIXA 10             │        │
                 │   F90→F91→F92→F93      │        │
                 │       │                │        │
                 ▼       │                │        │
                FAIXA 6  │                │        │
                F71→F72  │                │        │
                 │       │                │        │
                 ▼       │                │        │
                FAIXA 11 │                │        │
                F94→F95→F96→F97→F98       │        │
                         │                │        │
                         ▼                ▼        │
                     FAIXA 13                      │
                     F108→F109→F110→F111→F112→F113 │
                              │                    │
                              ▼                    ▼
                          FAIXA 14
                          F114→F115→F116→F117→F118→F119→F120
```

**Paralelização recomendada:**
- **Onda A (imediata)**: FAIXA 1 + FAIXA 7 + FAIXA 9
- **Onda B (após Onda A)**: FAIXA 2 + FAIXA 8.F79-F82
- **Onda C**: FAIXA 3 + FAIXA 8.F83-F84 + FAIXA 12
- **Onda D**: FAIXA 4 + FAIXA 10 + FAIXA 11
- **Onda E**: FAIXA 5 + FAIXA 6 + FAIXA 13
- **Sprint Final**: FAIXA 14

---

## Critérios de Aceitação Global

Para considerar o roadmap F49–F120 completo:

### Faixas 1–6 (agent/ consolidation):
1. ✅ Nenhum arquivo em `agent/` excede 400L
2. ✅ Cobertura de testes ≥ 60% dos arquivos de agent/ (30+/50)
3. ✅ Total de testes unitários agent/ ≥ 200
4. ✅ OTEL spans em dialog loop, reconnect, e session init
5. ✅ Todos os barrels consistentes (1 index.js por subsistema)
6. ✅ Todos os valores configuráveis em config.js

### Faixa 7 (testes legados):
7. ✅ ≥ 180 test files passando (de 6 atual para 180+)
8. ✅ Testes irrecuperáveis em quarantine/ com documentação

### Faixa 8 (tipagem):
9. ✅ 225/225 arquivos com `@ts-check`
10. ✅ agent/ + core/ + config/ passando em strict typecheck
11. ✅ 100% de funções exportadas com JSDoc (@param/@returns/@throws)

### Faixa 9 (error handling):
12. ✅ Zero `throw new Error()` raw em production code
13. ✅ Error codes em constantes exportadas (core/error-codes.js)
14. ✅ Todos os catch blocks com log ou re-throw

### Faixa 10 (async FS):
15. ✅ Zero `*Sync()` calls em production code

### Faixa 11 (segurança):
16. ✅ JSON.parse com schema validation em paths críticos
17. ✅ Input validation em todos os endpoints API/express
18. ✅ URL validation reutilizável aplicada em todos os fetch de URLs externas

### Faixa 12 (God Modules):
19. ✅ Nenhum arquivo em `copilot/` excede 400L (meta: <350L)
20. ✅ 14 God Modules decompostos com ~22 novos módulos coesos

### Faixa 13 (observabilidade):
21. ✅ OTEL spans em sdk/client e bridges
22. ✅ Health endpoint com status por componente
23. ✅ Dead-letter event tracking operacional

### Faixa 14 (CI + hardening):
24. ✅ CI workflow bloqueante (lint + typecheck + test + coverage)
25. ✅ Coverage mínima 30% lines (progressivo para 50%)
26. ✅ Retry utility reutilizável em uso por 4+ módulos
27. ✅ Graceful shutdown unificado
28. ✅ `npm run lint && npm run format:check && npm run typecheck:node && npm run test:unit` passando
29. ✅ PARTE-15A (agent/) e PARTE-15B (integral) criadas

---

## Resumo Comparativo: v1 → v2

| Dimensão             | v1 (original)       | v2 (expandido)      | Delta      |
| -------------------- | ------------------- | ------------------- | ---------- |
| Faixas               | 6                   | 14                  | +8 (133%)  |
| Fases                | 24 (F49–F72)        | 72 (F49–F120)       | +48 (200%) |
| Escopo               | agent/ apenas       | copilot/ integral   | 7x mais    |
| Novos arquivos       | ~25                 | ~55                 | +30        |
| Testes adicionais    | ~180                | ~249                | +69        |
| Test files fixados   | 0                   | ≥180                | ★ novo     |
| God Modules atacados | 3 (agent/)          | 17 (14 ext + 3 int) | +14        |
| Coverage target      | 60% arquivos agent/ | 50% lines copilot/  | ★ ampliado |
| *Sync() eliminação   | parcial (snapshot)  | total (zero)        | ★ completo |
| Security faixas      | 1 (SSRF parcial)    | 5 fases dedicadas   | ★ ampliado |
| CI/CD                | nenhum              | workflow bloqueante | ★ novo     |
| Documentação final   | PARTE-15            | PARTE-15A + 15B     | ★ ampliado |
