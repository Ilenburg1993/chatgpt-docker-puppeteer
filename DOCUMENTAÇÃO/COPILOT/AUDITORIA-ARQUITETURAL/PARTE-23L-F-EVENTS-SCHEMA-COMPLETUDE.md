# PARTE-23L-F — Events: Schema 100%, Rastreio Centralizado & Tratamento

**Data**: 2026-04-12 | **Status**: ✅ CONCLUÍDO | **Versão**: 2.0
**Precedente**: PARTE-23L-E v5.1 (L19-L28 concluídas, Score 96/100)
**Commits**: `e571fbd4` (L29-L32), `338e5dae` (L33-L35+L38)

---

## 1. Auditoria Pós-L28 — Situação Atual

### 1.1 Inventário Numérico

| Métrica                           | Valor       |
| --------------------------------- | ----------- |
| **Constantes SSOT (bus)**         | 120         |
| **Constantes SSOT (emitter)**     | 56          |
| **Total constantes**              | 176         |
| **Schemas registrados**           | 42          |
| **Schemas com match SSOT**        | 29 (24%)    |
| **Schemas orphan (sem SSOT)**     | 13          |
| **Bus events SEM schema**         | 91 (76%)    |
| **Bridge coverage**               | 51/56 (91%) |
| **Emitter events não-bridgeados** | 5           |
| **Bus-actions ativos**            | 6           |
| **Middleware stages**             | 4           |
| **Dynamic catalog entries**       | 176         |

### 1.2 Schemas Orphan (type não existe no SSOT)

Estes 13 schemas foram registrados com types que não correspondem a nenhuma constante SSOT:

| Schema Type                  | Problema                               | Correção                                   |
| ---------------------------- | -------------------------------------- | ------------------------------------------ |
| `agent:session:created`      | SSOT é `service:session:created`       | Renomear → `service:session:created`       |
| `agent:streaming:start`      | Não existe no SSOT                     | Remover ou criar constante                 |
| `agent:streaming:token`      | Não existe no SSOT                     | Remover ou criar constante                 |
| `agent:streaming:complete`   | Não existe no SSOT                     | Remover ou criar constante                 |
| `agent:tool:start`           | SSOT é `agent:tool:execution_start`    | Renomear → `agent:tool:execution_start`    |
| `agent:tool:end`             | SSOT é `agent:tool:execution_complete` | Renomear → `agent:tool:execution_complete` |
| `agent:tool:error`           | SSOT é `agent:task:error` (tool-level) | Avaliar necessidade                        |
| `hook:registered`            | Não existe no SSOT                     | Remover ou criar constante                 |
| `hub:session:created`        | SSOT `session:created` (hub-events)    | Renomear → `session:created`               |
| `hub:session:closed`         | SSOT `session:closed` (hub-events)     | Renomear → `session:closed`                |
| `memory:compaction_complete` | Não existe no SSOT                     | Remover (coberto por session:compaction)   |
| `system:health:check`        | SSOT é `health:check` (system-events)  | Renomear → `health:check`                  |
| `system:shutdown:start`      | SSOT é `system:shutdown:started`       | Renomear → `system:shutdown:started`       |

### 1.3 Emitter Events Não-Bridgeados (5)

| Constante                        | Valor               | Ação                                                    |
| -------------------------------- | ------------------- | ------------------------------------------------------- |
| `EMITTER_PROCESS_QUEUE`          | `__processQueue`    | ❌ Internal — não bridgear (ok)                          |
| `EMITTER_TURN_START`             | `turn_start`        | ❌ Já bridgeado via `dialog.turn_start` (ok)             |
| `EMITTER_TURN_END`               | `turn_end`          | ❌ Já bridgeado via `dialog.turn_end` (ok)               |
| `EMITTER_LOOP_PRE_STALL_WARNING` | `pre_stall_warning` | 🔸 Candidato a bridge → `agent:dialog:pre_stall_warning` |
| `EMITTER_SESSION_IDLE`           | `session.idle`      | 🔸 Candidato a bridge → `agent:session:idle`             |

### 1.4 Hardcoded Strings Residuais

| Local                         | String                  | Tipo       | Ação          |
| ----------------------------- | ----------------------- | ---------- | ------------- |
| `config/pinned-files.js` (×2) | `'changed'`             | Local      | ❌ Legítimo    |
| `terminal/state.js`           | `'phase:changed'`       | Local      | ❌ Legítimo    |
| `bridges/nerv-bridge.js`      | `'before-stop'/'ready'` | DEPRECATED | 🔸 Delete file |

---

## 2. Situação Ideal (Target)

### 2.1 Schema Coverage: 100%

Todos os 120 bus events SSOT devem ter um schema com:
- `type`: correspondendo exatamente à constante SSOT
- `required`: campos mínimos obrigatórios
- `fields`: tipagem de campos (`string`, `number`, `boolean`, `object`, `array`)
- `description`: descrição em português

### 2.2 Schema Orphan: 0

Todos os schemas devem corresponder a uma constante SSOT válida. Schemas orphan devem ser corrigidos ou removidos.

### 2.3 Rastreio Fino Centralizado

- **Correlation ID**: Já funcional (L16, correlation-enricher)
- **Timestamp**: Já funcional (L17, timestamp-enricher)
- **Schema Validation**: Funcional mas parcial (42 schemas, precisa 120)
- **Dead-letter tracking**: Funcional no event-catalog.js
- **Flow tracing**: Falta registrar graph de causalidade (event A → trigger → event B)
- **Event lifecycle**: Falta rastreio de created → validated → delivered → error states

### 2.4 Tratamento Adequado

- **Validation errors**: Devem ser logados com nível warn (dev) ou silenciosos (prod)
- **Dead letters**: Events emitidos sem subscriber devem ser rastreados
- **Rate limiting**: Já funcional (rate-limiter middleware)
- **Error propagation**: Events que falham no handler devem ser isolados (não travar o bus)

---

## 3. Roadmap v6.0 — Faixas L29–L38

### Onda 8 — Schema 100% (eliminação de gaps de cobertura)

#### FAIXA-L29 — Schema Orphan Cleanup ✅ CONCLUÍDO (`e571fbd4`)

**Objetivo**: Corrigir os 13 schemas orphan para que apontem para constantes SSOT válidas.

**Subfases**:
1. **L29.1** — Renomear 7 schemas com type errado para o SSOT correto
2. **L29.2** — Criar constantes SSOT faltantes para 3 schemas legítimos (`agent:streaming:*`) ou remover se não usados
3. **L29.3** — Remover 3 schemas obsoletos (`memory:compaction_complete`, `hook:registered`, `agent:tool:error`)
4. **L29.4** — Testes de regressão: todos schemas devem matchar SSOT

**Critério**: `schemaCount()` = N onde N = schemas com match SSOT 1:1

#### FAIXA-L30 — Agent Event Schemas (81 → 100%) ✅ CONCLUÍDO (`e571fbd4`)

**Objetivo**: Criar schemas para todos os 79 agent-events.

**Subfases**:
1. **L30.1** — agent:dialog domain (8 events sem schema: boot_recovery, compaction:requested, delta, paused, ready, reply, resumed, stopped)
2. **L30.2** — agent:session domain (16 events sem schema)
3. **L30.3** — agent:assistant domain (4 events)
4. **L30.4** — agent:task domain (2 events: delta, reasoning)
5. **L30.5** — agent:tool domain (3 events: execution_start, execution_complete, execution_progress)
6. **L30.6** — Remaining agent events (abort, background, context, elicitation, emitter:error, exit_plan_mode, external_tool, mcp, pending_messages, pr, question, quota, sdk, shell, status, steering, subagent, system:message)

**Critério**: Todos os 79 agent:* events têm schema

#### FAIXA-L31 — Non-Agent Event Schemas (41 → 100%) ✅ CONCLUÍDO (`e571fbd4`)

**Objetivo**: Criar schemas para todos os 41 non-agent bus events.

**Subfases**:
1. **L31.1** — audit events (4): entry, flush, log, quick
2. **L31.2** — bridge events (3): mcp:reconnected, nerv:connected, nerv:disconnected
3. **L31.3** — config events (1): changed
4. **L31.4** — health events (2): degraded, recovered
5. **L31.5** — hook events (1): prompt_submitted
6. **L31.6** — hub events (1): error
7. **L31.7** — nerv events (5): command:pause/received/restart/resume/send_message
8. **L31.8** — service events (5): session:created/disconnected/message/resumed, tool:invoked
9. **L31.9** — session events (2): closed, created
10. **L31.10** — system events (1): shutdown:started
11. **L31.11** — terminal events (3): command, started, stopped
12. **L31.12** — turn events (4): complete, delta, sent, user_pending
13. **L31.13** — user events (1): injected

**Critério**: `schemaCount()` >= 120 e todos com match SSOT

### Onda 9 — Rastreio Fino & Tratamento

#### FAIXA-L32 — Bridge Completude ✅ CONCLUÍDO (`e571fbd4`)

**Objetivo**: Bridgear os 2 emitter events candidatos + criar constantes SSOT.

**Subfases**:
1. **L32.1** — Criar `AGENT_DIALOG_PRE_STALL_WARNING` em agent-events.js
2. **L32.2** — Criar `AGENT_SESSION_IDLE` em agent-events.js
3. **L32.3** — Adicionar bridge entries em always-alive.js
4. **L32.4** — Criar schemas para os 2 novos eventos

**Critério**: Bridge coverage 53/56 → 53/56 (3 não-bridgeáveis)

#### FAIXA-L33 — Schema Validation Strict Mode ✅ CONCLUÍDO (`338e5dae`)

**Objetivo**: Ativar validação de schema em runtime com tratamento adequado.

**Subfases**:
1. **L33.1** — schema-validator middleware: log warning para events sem schema (dev mode)
2. **L33.2** — schema-validator middleware: validar payload contra schema (dev mode → warn, prod mode → silent)
3. **L33.3** — Expor métricas de validação: total validated, total failed, total no-schema
4. **L33.4** — Dashboard endpoint `/api/events/schema-health` com coverage stats

**Critério**: Todas emissões passam por validação; métricas expostas

#### FAIXA-L34 — Dead Letter Queue Enhancement ✅ CONCLUÍDO (`338e5dae`)

**Objetivo**: Aprimorar rastreio de events sem subscribers.

**Subfases**:
1. **L34.1** — event-bus.js: detectar emit sem nenhum subscriber ativo → registrar dead letter
2. **L34.2** — event-catalog.js: dead letter agora inclui timestamp, payload hash, correlation_id
3. **L34.3** — Bus-action dead-letter-tracker: subscribe wildcard `*`, verificar se existem outros subscribers
4. **L34.4** — Dashboard endpoint `/api/events/dead-letters` com lista paginada

**Critério**: Zero events silenciados; todos dead letters rastreados

#### FAIXA-L35 — Flow Causality Tracing ✅ CONCLUÍDO (`338e5dae`)

**Objetivo**: Registrar graph de causalidade event→event.

**Subfases**:
1. **L35.1** — Novo middleware `causality-enricher`: quando event A causa emit de event B, registrar `B._causedBy = A.correlation_id`
2. **L35.2** — Bus-action flow-recorder: registrar edges A→B num Map por session
3. **L35.3** — `event-catalog.js`: `getCausalityGraph(sessionId)` retorna edges
4. **L35.4** — Dashboard endpoint `/api/events/flow/:sessionId` com Mermaid graph

**Critério**: Causality graph disponível para qualquer sessão

### Onda 10 — Hardening & Cleanup Final

#### FAIXA-L36 — nerv-bridge.js Deletion ✅ CONCLUÍDO

**Objetivo**: Remover arquivo legado.

**Subfases**:
1. **L36.1** — Verificar zero imports ativos de nerv-bridge.js
2. **L36.2** — Remover arquivo + atualizar bridges/index.js
3. **L36.3** — Atualizar NERV adapter docs

**Critério**: Arquivo deletado, zero referências

#### FAIXA-L37 — Event System TypeCheck Full Clean ✅ CONCLUÍDO (0 erros em node + strict)

**Objetivo**: Zero erros TS em todos os arquivos do event system.

**Subfases**:
1. **L37.1** — Fix JSDoc tipos em todos os emit/on/once call-sites
2. **L37.2** — Adicionar `@template T` generics nos bus.on<T>
3. **L37.3** — Tipar todos os EventSchema.fields com precisão
4. **L37.4** — `npm run typecheck:node` → 0 errors em events/ + observability/

**Critério**: TypeCheck clean

#### FAIXA-L38 — Schema Coverage CI Script ✅ CONCLUÍDO (`338e5dae`)

**Objetivo**: Script automatizado que falha se schema coverage < 100%.

**Subfases**:
1. **L38.1** — `scripts/check-schema-coverage.mjs`: lista todos SSOT, verifica schema, exit 1 se faltando
2. **L38.2** — npm script `analyze:events:schema-coverage`
3. **L38.3** — Integrar no `validate:all` task

**Critério**: CI falha se qualquer SSOT constant não tiver schema

---

## 4. Pré-requisitos e Dependências

```
L29 (Schema Orphan Cleanup)    ──→ independente (começar aqui)
L30 (Agent Schemas)            ──→ depende de L29
L31 (Non-Agent Schemas)        ──→ depende de L29
L32 (Bridge Completude)        ──→ independente
L33 (Validation Strict)        ──→ depende de L30 + L31
L34 (Dead Letter)              ──→ independente
L35 (Flow Tracing)             ──→ depende de L33
L36 (nerv-bridge delete)       ──→ independente
L37 (TypeCheck)                ──→ depende de L30 + L31
L38 (CI Script)                ──→ depende de L30 + L31 + L33
```

```
Grafo:
START ──→ L29 (Orphan Fix) ──→ L30 (Agent Schemas) ──→ L33 (Strict Mode) ──→ L35 (Flow Tracing)
     │                     └──→ L31 (Non-Agent Schemas) ─┘            │
     │                                                                └──→ L38 (CI Script)
     ├──→ L32 (Bridge)                                                └──→ L37 (TypeCheck)
     ├──→ L34 (Dead Letter)
     └──→ L36 (nerv-bridge delete)
```

## 5. Ordem de Execução Recomendada

| Seq | Faixa | Risco     | Prioridade | Dependência | Esforço |
| --- | ----- | --------- | ---------- | ----------- | ------- |
| 1   | L29   | 🔴 CRÍTICO | ALTA       | Nenhuma     | Baixo   |
| 2   | L30   | 🔴 CRÍTICO | ALTA       | L29         | Alto    |
| 3   | L31   | 🟡 MÉDIO   | MÉDIA      | L29         | Médio   |
| 4   | L32   | 🟢 BAIXO   | BAIXA      | Nenhuma     | Baixo   |
| 5   | L33   | 🟡 MÉDIO   | MÉDIA      | L30+L31     | Médio   |
| 6   | L34   | 🟡 MÉDIO   | MÉDIA      | Nenhuma     | Médio   |
| 7   | L36   | 🟢 BAIXO   | BAIXA      | Nenhuma     | Trivial |
| 8   | L35   | 🟢 BAIXO   | BAIXA      | L33         | Alto    |
| 9   | L37   | 🟡 MÉDIO   | MÉDIA      | L30+L31     | Médio   |
| 10  | L38   | 🟢 BAIXO   | BAIXA      | L30+L31+L33 | Baixo   |

## 6. Score Estimado

| Marco                | Score Estimado | Delta |
| -------------------- | -------------- | ----- |
| Pós-L28 (atual)      | 96/100 (A+)    | —     |
| Pós-Onda8 (L29-L31)  | 98/100 (A+)    | +2    |
| Pós-Onda9 (L32-L35)  | 99/100 (A+)    | +1    |
| Pós-Onda10 (L36-L38) | 100/100 (S)    | +1    |

---

## 7. Changelog

| Versão | Data       | Mudanças                                                  |
| ------ | ---------- | --------------------------------------------------------- |
| 1.0    | 2026-04-12 | Auditoria pós-L28, 10 faixas L29-L38, schema 100% roadmap |
| 2.0    | 2026-04-12 | L29-L35+L38 concluídos; L36-L37 adiados                   |
| 3.0    | 2026-04-12 | L36-L37 concluídos — roadmap 100% completo                |

---

## 8. Resultado Final

| Métrica               | Antes (L28)   | Depois (L38)                          |
| --------------------- | ------------- | ------------------------------------- |
| Constantes SSOT (bus) | 120           | 122                                   |
| Schemas registrados   | 42 (29 match) | 122 (100%)                            |
| Orphans               | 13            | 0                                     |
| Bridge coverage       | 51/56         | 53/56                                 |
| Schema validation     | Warn-only     | Strict mode                           |
| Dead letter tracking  | Básico        | Enhanced (reason, correlationId, cap) |
| Causality tracing     | Nenhum        | eventId + causationId                 |
| CI schema check       | Nenhum        | `npm run test:check-schemas`          |
| Score                 | 96/100 (A+)   | 100/100 (S)                           |
