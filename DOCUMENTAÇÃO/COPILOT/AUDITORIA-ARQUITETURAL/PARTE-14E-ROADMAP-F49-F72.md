# PARTE 14E — Roadmap F49–F72: Consolidação Final de `src/copilot/agent/`

**Data**: 2026-03-15  
**Baseline**: commit `54c135c4` (pós-F48/F44)  
**Referência**: PARTE-14A/B/C/D  
**Pré-requisito**: Todos os testes existentes passando (`npm run test:unit`)

---

## Visão Geral do Roadmap

O roadmap está organizado em **6 faixas temáticas** com **24 fases (F49–F72)**, cada uma com subfases atômicas. As faixas seguem uma ordem de dependência: fundação → testes → decomposição → observabilidade → consistência → hardening.

```
┌─────────────────────────────────────────────────────────────────┐
│  FAIXA 1: Fundação e Correções Imediatas (F49–F52)             │
│  ├── F49: Barrels e organização                                │
│  ├── F50: Fix bugs e inconsistências pontuais                  │
│  ├── F51: Config migration (hardcoded → config.js)             │
│  └── F52: AgentContext invariantes                             │
├─────────────────────────────────────────────────────────────────┤
│  FAIXA 2: Testes Unitários — Onda 1 (F53–F57)                 │
│  ├── F53: Testes protocol.js + rotation.js + watchdog.js       │
│  ├── F54: Testes message-queue.js                              │
│  ├── F55: Testes task-executor.js                              │
│  ├── F56: Testes initializer.js                                │
│  └── F57: Testes webhook-manager.js                            │
├─────────────────────────────────────────────────────────────────┤
│  FAIXA 3: Decomposição Arquitetural (F58–F63)                  │
│  ├── F58: Extrair hook-context.js de initializer.js            │
│  ├── F59: Extrair backpressure.js de loop-manager.js           │
│  ├── F60: Extrair model-fallback.js de loop-manager.js         │
│  ├── F61: Extrair wireDialogLoopEvents → dialog/event-wiring.js│
│  ├── F62: Decompor event-wirer.js em event-handlers/           │
│  └── F63: Extrair session-setup.js de agent-lifecycle.js       │
├─────────────────────────────────────────────────────────────────┤
│  FAIXA 4: Testes Unitários — Onda 2 (F64–F67)                 │
│  ├── F64: Testes loop-manager.js (pós-decomposição)            │
│  ├── F65: Testes turn-executor.js (race conditions)            │
│  ├── F66: Testes cleanup.js + keepalive.js + snapshot.js       │
│  └── F67: Teste de fluxo integrado agent boot→send→stop       │
├─────────────────────────────────────────────────────────────────┤
│  FAIXA 5: Observabilidade e Performance (F68–F70)              │
│  ├── F68: OTEL spans em dialog loop, reconnect, session init   │
│  ├── F69: Async FS em snapshot.js + deprecar writeState sync   │
│  └── F70: Métricas em rotation.js + cleanup.js paralelo        │
├─────────────────────────────────────────────────────────────────┤
│  FAIXA 6: Hardening e Polimento (F71–F72)                      │
│  ├── F71: URL validator reutilizável extraído de webhook-manager│
│  └── F72: Auditoria final + documentação PARTE-15              │
└─────────────────────────────────────────────────────────────────┘
```

---

## FAIXA 1: Fundação e Correções Imediatas

### F49 — Barrels e Organização Estrutural
**Gap**: GAP-S4 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F49.1 | Criar `messaging/index.js` (barrel) | Arquivo |
| F49.2 | Criar `state/index.js` (barrel) | Arquivo |
| F49.3 | Atualizar `agent/index.js` para importar de novos barrels | Edição |
| F49.4 | Verificar que todos os consumers externos usam barrel paths | Auditoria |

**Validação**: `npm run lint && npm run test:unit`

---

### F50 — Fix de Bugs e Inconsistências Pontuais
**Gap**: GAP-R5, M-02 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F50.1 | Fix `answerPendingQuestion()` — chamada duplicada de `hookToolsResolveUserInput()` | Edição agent-messaging.js |
| F50.2 | Verificar se `hookToolsResolveUserInput()` é idempotente (se sim, documentar; se não, fix) | Investigação + Edição |
| F50.3 | `protocol.js` — adicionar constantes para os tipos de classificação ('ready', 'reply', 'stopped', 'question') | Edição |

**Validação**: `npm run test:unit`

---

### F51 — Config Migration (Hardcoded → config.js)
**Gap**: GAP-C4, GAP-C5, L-03 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F51.1 | Mover `WATCHDOG_THRESHOLDS` de watchdog.js para config.js | Edição config.js + watchdog.js |
| F51.2 | Mover retry count (5) de entry.js para config.js como `BOOT_MAX_RETRIES` | Edição config.js + entry.js |
| F51.3 | Mover `WEBHOOK_RETRY_BASE_MS` (500) de webhook-manager.js para config.js | Edição |
| F51.4 | Auditar quaisquer outros hardcoded values nos 37 arquivos | Investigação |

**Validação**: `npm run test:unit && npm run lint`

---

### F52 — AgentContext Invariantes
**Gap**: GAP-R1 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F52.1 | Definir FSM de status válido: starting → idle ⇄ processing/dialog_active → stopped | Documentação |
| F52.2 | Implementar `ctx.setStatus(newStatus)` com validação de transição | Edição agent-context.js |
| F52.3 | Fazer `ctx.status` read-only (getter) forçando uso de `setStatus()` | Edição |
| F52.4 | Adicionar testes para transições inválidas | Testes |

**Validação**: `npm run test:unit`

---

## FAIXA 2: Testes Unitários — Onda 1

### F53 — Testes: protocol.js + rotation.js + watchdog.js
**Gap**: GAP-Q8 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F53.1 | `test_protocol.spec.js`: classify() para cada tipo (ready, reply, stopped, question), extractReply(), buildBootPrompt() | ~10 testes |
| F53.2 | `test_rotation.spec.js`: shouldRotateSession() para cada threshold (util, age, compactions, turns), edge cases | ~8 testes |
| F53.3 | `test_watchdog.spec.js`: start/stop, ping reset, pre-stall warning, stall detection, setTaskType() | ~8 testes |

**Validação**: `npm run test:unit` (total esperado: ~72 testes)

---

### F54 — Testes: message-queue.js
**Gap**: GAP-Q5 | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F54.1 | `test_message_queue.spec.js`: enqueue/shift FIFO básico | ~4 testes |
| F54.2 | MAX_QUEUE_SIZE → reject QUEUE_FULL | ~2 testes |
| F54.3 | AbortSignal: pre-aborted reject, abort after enqueue removes from queue | ~3 testes |
| F54.4 | drain(): rejeita todos com erro fornecido, clona erro para tasks múltiplas | ~3 testes |
| F54.5 | unshift() e onEnqueue/onChanged callbacks | ~3 testes |

**Validação**: `npm run test:unit` (total esperado: ~87 testes)

---

### F55 — Testes: task-executor.js
**Gap**: GAP-Q6 | **Esforço**: Médio | **Risco**: Médio (mocking pesado do SDK)

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F55.1 | `test_task_executor.spec.js`: execução feliz com resolve | ~2 testes |
| F55.2 | Streaming delta events recebidos durante execução | ~2 testes |
| F55.3 | AbortError → reject sem reconexão | ~2 testes |
| F55.4 | Erro de rede → tryReconnect → requeue (< MAX_RETRIES) | ~2 testes |
| F55.5 | Erro de rede → max retries → reject | ~2 testes |
| F55.6 | Listeners são removidos no finally (memory leak prevention) | ~2 testes |
| F55.7 | OTEL spans criados e fechados corretamente | ~2 testes |

**Validação**: `npm run test:unit` (total esperado: ~101 testes)

---

### F56 — Testes: initializer.js
**Gap**: GAP-Q3 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F56.1 | `test_initializer.spec.js`: initOrResumeSession() — nova sessão (sem state persistido) | ~2 testes |
| F56.2 | Resume de sessão existente (state com sessionId válido) | ~2 testes |
| F56.3 | Sessão expirada (age > maxAge) → nova sessão | ~2 testes |
| F56.4 | shouldRotateSession() trigger → nova sessão | ~2 testes |
| F56.5 | _validateSessionForResume() — sessionId inválido, null, expirado | ~4 testes |
| F56.6 | buildHookSystemContext() — briefing existente, truncamento, session.json inválido | ~4 testes |
| F56.7 | buildHookSystemContextSafe() — truncamento por HOOK_CONTEXT_MAX_BYTES | ~2 testes |
| F56.8 | setBackgroundCompactionThreshold() — valores válidos e inválidos | ~3 testes |

**Validação**: `npm run test:unit` (total esperado: ~122 testes)

---

### F57 — Testes: webhook-manager.js
**Gap**: GAP-Q7 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F57.1 | `test_webhook_manager.spec.js`: register/unregister/list | ~4 testes |
| F57.2 | URL validation: protocolos inválidos, IPs privados, loopback | ~5 testes |
| F57.3 | MAX_WEBHOOKS limit | ~1 teste |
| F57.4 | emit(): payload sanitization (tokens, content, streaming redaction) | ~4 testes |
| F57.5 | #deliverWithRetry: sucesso 2xx, permanente 4xx (sem retry), retriable 5xx | ~4 testes |
| F57.6 | DNS rebinding check | ~2 testes |

**Validação**: `npm run test:unit` (total esperado: ~142 testes)

---

## FAIXA 3: Decomposição Arquitetural

### F58 — Extrair hook-context.js de initializer.js
**Gap**: GAP-S3 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F58.1 | Criar `session/hook-context.js` com `buildHookSystemContext()` e `buildHookSystemContextSafe()` | Novo arquivo (~180L) |
| F58.2 | Mover `SessionJsonSchema` (Zod) para hook-context.js | Edição |
| F58.3 | Mover constantes `BRIEFING_FILE` e `SESSION_JSON_FILE` para hook-context.js | Edição |
| F58.4 | Atualizar initializer.js para importar de hook-context.js | Edição |
| F58.5 | Atualizar barrel session/index.js | Edição |
| F58.6 | Atualizar testes F56 se necessário | Edição |

**Resultado**: initializer.js: 376L → ~200L | hook-context.js: ~180L

**Validação**: `npm run test:unit && npm run lint && npm run typecheck:node`

---

### F59 — Extrair backpressure.js de loop-manager.js
**Gap**: GAP-S1.1 | **Esforço**: Médio | **Risco**: Médio

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F59.1 | Identificar lógica de backpressure: `#turnQueueDepth`, pause/resume triggers | Investigação |
| F59.2 | Criar `dialog/backpressure.js` com classe `BackpressureMonitor` ou funções puras | Novo arquivo (~100L) |
| F59.3 | Refatorar loop-manager.js para delegar a backpressure.js | Edição |
| F59.4 | Testes unitários para backpressure.js | ~4 testes |

**Resultado**: loop-manager.js: 661L → ~560L

---

### F60 — Extrair model-fallback.js de loop-manager.js
**Gap**: GAP-S1.2 | **Esforço**: Baixo | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F60.1 | Identificar lógica de model fallback scheduling | Investigação |
| F60.2 | Criar `dialog/model-fallback.js` com funções puras | Novo arquivo (~80L) |
| F60.3 | Refatorar loop-manager.js | Edição |
| F60.4 | Testes unitários para model-fallback.js | ~3 testes |

**Resultado**: loop-manager.js: ~560L → ~480L

---

### F61 — Extrair wireDialogLoopEvents → dialog/event-wiring.js
**Gap**: GAP-S1.3, D-05 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F61.1 | Criar `dialog/event-wiring.js` com `wireDialogLoopEvents()` | Novo arquivo (~120L) |
| F61.2 | Atualizar imports em loop-manager.js | Edição |
| F61.3 | Atualizar barrel dialog/index.js | Edição |
| F61.4 | Testes para os 13 event forwarders | ~5 testes |

**Resultado**: loop-manager.js: ~480L → ~360L (meta <400L alcançada! ✅)

---

### F62 — Decompor event-wirer.js em event-handlers/
**Gap**: GAP-S2 | **Esforço**: Alto | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F62.1 | Criar `session/event-handlers/` diretório | — |
| F62.2 | Extrair `_wireCompactionEvents` → `compaction.js` (~60L) | Novo arquivo |
| F62.3 | Extrair `_wireStreamingEvents` → `streaming.js` (~80L) | Novo arquivo |
| F62.4 | Extrair `_wireTokenBudgetEvents` → `token-budget.js` (~50L) | Novo arquivo |
| F62.5 | Extrair `_wireModeAndToolEvents` → `mode-and-tools.js` (~40L) | Novo arquivo |
| F62.6 | Extrair `_wireSystemNotificationEvents` → `system-notifications.js` (~80L) | Novo arquivo |
| F62.7 | Extrair `_wireSdkResponseEvents` → `sdk-responses.js` (~60L) | Novo arquivo |
| F62.8 | Extrair `_wireUsageEvent` → `usage.js` (~30L) | Novo arquivo |
| F62.9 | Extrair `_wireCatchAll` → `catch-all.js` (~40L) + mover KNOWN_SDK_EVENTS | Novo arquivo |
| F62.10 | Criar `event-handlers/index.js` (barrel) | Novo arquivo |
| F62.11 | Refatorar `event-wirer.js` para orquestrar imports (~150L) | Edição |
| F62.12 | Atualizar barrel session/index.js | Edição |

**Resultado**: event-wirer.js: 591L → ~150L (orquestrador) | 8 novos handler files

**Validação**: `npm run test:unit && npm run lint && npm run typecheck:node`

---

### F63 — Extrair session-setup.js de agent-lifecycle.js
**Gap**: GAP-S5 | **Esforço**: Médio | **Risco**: Baixo

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F63.1 | Identificar passos de `initSession()` que são session-specific (MCP, tools, hooks) | Investigação |
| F63.2 | Criar `lifecycle/session-setup.js` com funções extraídas | Novo arquivo (~120L) |
| F63.3 | Refatorar agent-lifecycle.js para delegar | Edição |
| F63.4 | Testes para session-setup.js | ~4 testes |

**Resultado**: agent-lifecycle.js: 362L → ~280L

---

## FAIXA 4: Testes Unitários — Onda 2

### F64 — Testes: loop-manager.js (pós-decomposição)
**Gap**: GAP-Q1 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F64.1 | `test_loop_manager.spec.js`: start/stop lifecycle | ~3 testes |
| F64.2 | Turn mutex serialization (concurrent sendTurn bloqueado) | ~3 testes |
| F64.3 | pause/resume com strategy A (0 PR) e B (1 PR) | ~4 testes |
| F64.4 | handleProtocolInput routing | ~3 testes |
| F64.5 | forceDeactivate durante turno ativo | ~2 testes |
| F64.6 | handleTokenBudget → compaction trigger | ~2 testes |
| F64.7 | Watchdog integration (stall → forceDeactivate) | ~2 testes |

**Validação**: `npm run test:unit` (total esperado: ~165+ testes)

---

### F65 — Testes: turn-executor.js (race conditions)
**Gap**: GAP-Q2 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F65.1 | `test_turn_executor.spec.js`: executeTurnImpl happy path | ~2 testes |
| F65.2 | Race: reply antes de session.idle | ~2 testes |
| F65.3 | Race: stopped antes de reply | ~2 testes |
| F65.4 | Race: timeout antes de reply | ~2 testes |
| F65.5 | waitForRestartAndReply → restart + novo reply | ~2 testes |
| F65.6 | waitForRestartAndReply → timeout sem restart | ~1 teste |
| F65.7 | AbortSignal durante turn | ~1 teste |

**Validação**: `npm run test:unit` (total esperado: ~177+ testes)

---

### F66 — Testes: cleanup.js + keepalive.js + snapshot.js
**Gap**: GAP-Q9 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F66.1 | `test_cleanup.spec.js`: sessões expiradas removidas, sessão ativa preservada, sem sessões | ~5 testes |
| F66.2 | `test_keepalive.spec.js`: start/stop, ping reset, idle detection, client.ping() vs session.send() fallback | ~6 testes |
| F66.3 | `test_snapshot.spec.js`: createSnapshot, saveSnapshot, listSnapshots, loadSnapshot, pruneSnapshots | ~8 testes |

**Validação**: `npm run test:unit` (total esperado: ~196+ testes)

---

### F67 — Teste de Integração: Agent Boot → Send → Stop
**Gap**: GAP-Q10 | **Esforço**: Alto | **Risco**: Médio

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F67.1 | Criar mock do CopilotClient e CopilotSession para integração | Helpers de teste |
| F67.2 | `test_agent_integration.spec.js`: boot completo (start → ready event) | ~2 testes |
| F67.3 | Send message → process → resolve | ~2 testes |
| F67.4 | Dialog loop start → turns → stop | ~2 testes |
| F67.5 | Graceful shutdown → snapshot saved → drained | ~2 testes |
| F67.6 | Reconexão após erro de rede simulado | ~1 teste |

**Validação**: `npm run test:unit && npm run test:integration` (total esperado: ~205+ testes)

---

## FAIXA 5: Observabilidade e Performance

### F68 — OTEL Spans em Dialog, Reconnect e Session Init
**Gap**: GAP-O1, GAP-O2, GAP-O3 | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F68.1 | Span `copilot.dialog.turn` em turn-executor.js (start → end) | Edição |
| F68.2 | Span `copilot.dialog.loop` em loop-manager.js (start → stop) | Edição |
| F68.3 | Span `copilot.reconnect` em reconnect-policy.js (per attempt) | Edição |
| F68.4 | Span `copilot.session.init` em agent-lifecycle.js (initSession) | Edição |
| F68.5 | Atributos: model, sessionId, attempt, success | Edição |

---

### F69 — Async FS em snapshot.js + Deprecação writeState Sync
**Gap**: GAP-C1, GAP-C2 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F69.1 | Migrar `saveSnapshot()` de writeFileSync → writeFile (async) | Edição |
| F69.2 | Migrar `listSnapshots()` de readdirSync/readFileSync → readdir/readFile (async) | Edição |
| F69.3 | Migrar `loadSnapshot()` de readFileSync → readFile (async) | Edição |
| F69.4 | Migrar `pruneSnapshots()` de rmSync → rm (async) | Edição |
| F69.5 | Adicionar `@deprecated` em `writeState()` sync de state-io.js | Edição |
| F69.6 | Atualizar todos os callers de writeState() → writeStateAsync() | Investigação + Edição |
| F69.7 | Atualizar testes de snapshot.js para async | Edição testes |

---

### F70 — Métricas em Rotation + Cleanup Paralelo
**Gap**: GAP-O4, GAP-C3, S-05 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F70.1 | rotation.js: `defaultMetrics.recordSessionRotation()` quando `shouldRotate: true` | Edição |
| F70.2 | cleanup.js: migrar `for...of await deleteSession` → `Promise.allSettled` | Edição |
| F70.3 | cleanup.js: limitar paralelismo a 5 com `Promise.all(batch)` para não sobrecarregar SDK | Edição |

---

## FAIXA 6: Hardening e Polimento

### F71 — URL Validator Reutilizável
**Gap**: GAP-R3 | **Esforço**: Baixo | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F71.1 | Criar `infra/url-validator.js` com `validateWebhookUrl()` e `checkResolvedIp()` | Novo arquivo (~80L) |
| F71.2 | Refatorar webhook-manager.js para usar url-validator.js | Edição |
| F71.3 | Atualizar barrel infra/index.js | Edição |
| F71.4 | Testes para url-validator.js | ~6 testes |

---

### F72 — Auditoria Final + Documentação PARTE-15
**Gap**: — | **Esforço**: Médio | **Risco**: Nenhum

| Subfase | Descrição | Entregável |
|---------|-----------|-----------|
| F72.1 | Executar full validation: lint + format + typecheck + test:unit + test:integration | Validação |
| F72.2 | Re-auditar todos os 50+ arquivos do agent/ (pós-decomposição) | Investigação |
| F72.3 | Verificar cobertura de testes ≥ 60% dos arquivos | Métrica |
| F72.4 | Criar PARTE-15 com status final pós-F72 | Documento |
| F72.5 | Atualizar PARTE-13 (status) com referência a PARTE-14/15 | Edição |

---

## Estimativa de Entregáveis por Faixa

| Faixa | Fases | Novos Arquivos | Testes Adicionais | Entregável de Doc |
|-------|-------|---------------|-------------------|-------------------|
| 1: Fundação | F49–F52 | 2 barrels | ~8 | — |
| 2: Testes Onda 1 | F53–F57 | 5 spec files | ~96 | — |
| 3: Decomposição | F58–F63 | 12+ arquivos | ~16 | — |
| 4: Testes Onda 2 | F64–F67 | 4 spec files + helpers | ~54 | — |
| 5: Observabilidade | F68–F70 | — | ~0 | — |
| 6: Hardening | F71–F72 | 1 arquivo + 1 spec | ~6 | PARTE-15 |
| **TOTAL** | **24 fases** | **~25 novos** | **~180** | **PARTE-15** |

---

## Dependências entre Fases

```
F49 ──► F50 ──► F51 ──► F52    (Faixa 1: sequencial)
                  │
                  ▼
         F53 ──► F54 ──► F55 ──► F56 ──► F57   (Faixa 2: sequencial)
                                           │
                                           ▼
                  F58 ──► F59 ──► F60 ──► F61 ──► F62 ──► F63   (Faixa 3)
                                                            │
                                                            ▼
                                    F64 ──► F65 ──► F66 ──► F67   (Faixa 4)
                                                             │
                                                             ▼
                                            F68 ──► F69 ──► F70   (Faixa 5)
                                                             │
                                                             ▼
                                                    F71 ──► F72   (Faixa 6)
```

**Paralelização possível**:
- F53 pode rodar em paralelo com F49–F52 (são independentes)
- F68 pode iniciar após F63 (não depende de F64–F67)
- F71 pode rodar em paralelo com F68–F70

---

## Critérios de Aceitação Global

Para considerar o roadmap F49–F72 completo:

1. ✅ Nenhum arquivo em `agent/` excede 400L
2. ✅ Cobertura de testes ≥ 60% dos arquivos (30+/50)
3. ✅ Total de testes unitários ≥ 200
4. ✅ Zero FS sync calls fora de paths de shutdown
5. ✅ OTEL spans em dialog loop, reconnect, e session init
6. ✅ Todos os barrels consistentes (1 index.js por subsistema)
7. ✅ Todos os valores configuráveis em config.js
8. ✅ `npm run lint && npm run format:check && npm run typecheck:node && npm run test:unit` passando
9. ✅ PARTE-15 criada documentando estado final
