# PARTE-22A — Situação Atual: Auditoria Rigorosa Pós-Parte-21

**Data**: 2026-04-12 | **Status**: BASELINE (pós-Wave 5 W5-4) | **Versão**: 1.0
**Scope**: Todo `src/copilot` — 313 arquivos `.js`, 53.815 LoC, 19 módulos
**Precedente**: PARTE-21A~F (executados integralmente até `35bf45da`)
**Critério**: Diagnóstico rigoroso — sem relativizar, sem aceitar "bom o suficiente"

---

## 1. Resumo Executivo — O Que Foi Resolvido vs O Que Continua Problemático

### 1.1 O Que a PARTE-21 Resolveu (Créditos Legítimos)

| Item Resolvido                       | Como                        |
| ------------------------------------ | --------------------------- |
| 0 violações de camada CI             | Faixa H — regex expandida   |
| 100% barrel coverage (17 módulos)    | Faixa I + novos módulos     |
| DI Container com 13 tokens           | Faixa K                     |
| EventBus cross-module                | Faixa M                     |
| Services facades (api/ fan-out down) | Faixa N                     |
| types/, plugins/, services/ novos    | Faixas L, N                 |
| Fan-out medição corrigida (10 real)  | W5-4                        |
| Health Score 35 → 95/100 (A)         | Acumulado de todas as waves |

### 1.2 O Que AINDA É Problemático (Diagnóstico Honesto)

> O health score **95/100 (A)** reflete métricas que foram calibradas progressivamente.
> O problema real é que o score não penaliza: tamanho de arquivo individual, falta de testes por módulo,
> cobertura funcional de EventBus, e acoplamento de estado global em padrões específicos.

**Problemas estruturais remanescentes (grau de severidade):**

| #   | Problema                                                          | Severidade | Módulos Afetados                    |
| --- | ----------------------------------------------------------------- | ---------- | ----------------------------------- |
| 1   | **23 arquivos >350 LoC com múltiplos concerns**                   | 🔴 Alto     | agent, sdk, terminal, observability |
| 2   | **EventEmitter direto em 8 módulos** (vs EventBus)                | 🔴 Alto     | agent, hooks, api, config, terminal |
| 3   | **53 singletons module-scope** que não são DI-ready               | 🔴 Alto     | bridges, terminal, tools, agent     |
| 4   | **EventBus adotado em apenas 13 arquivos** (vs 313)               | 🔴 Alto     | Sistema todo                        |
| 5   | **services/ anêmico** — 5 arquivos, 509 LoC                       | 🟡 Médio    | services/                           |
| 6   | **4 deep imports reais** ainda violam F21                         | 🟡 Médio    | Específicos                         |
| 7   | **Falta de testes por módulo** (195 arquivos, 133 mods sem teste) | 🔴 Alto     | Geral                               |
| 8   | **Sem health checks funcional** no runtime                        | 🟡 Médio    | api/, terminal/                     |
| 9   | **agent/always-alive.js (623 LoC)** — hub de estado               | 🔴 Alto     | agent/                              |
| 10  | **loop-manager.js (599 LoC)** — múltiplos protocolos              | 🔴 Alto     | agent/dialog/                       |
| 11  | **Sem rate limiting** na injeção de mensagens                     | 🟡 Médio    | terminal/, api/                     |
| 12  | **DI Container subutilizado** — apenas 13 tokens                  | 🟡 Médio    | Geral                               |
| 13  | **Sem circuit breaker** nas chamadas SDK                          | 🔴 Alto     | sdk/                                |
| 14  | **Telemetria OpenTelemetry só esqueleto (otel.js)**               | 🟡 Médio    | observability/                      |
| 15  | **Sem event sourcing** no audit pipeline                          | 🟡 Médio    | audit/                              |
| 16  | **plugins/ proto-embrionário** — 2 arquivos, 253 LoC              | 🟡 Médio    | plugins/                            |
| 17  | **Sem multi-agent isolation** — estado global compartilhado       | 🔴 Alto     | agent/, terminal/                   |
| 18  | **Falta cache manager** — lazy inits espalhados                   | 🟡 Médio    | sdk/, observability/, bridges/      |
| 19  | **Watchdog só em dialog** — sem watchdog global                   | 🟡 Médio    | agent/, bridges/                    |
| 20  | **16 typecheck errors** baseline (rpc-ops, rpc-session)           | 🟡 Médio    | sdk/                                |

---

## 2. Inventário Detalhado de Módulos (Estado Real)

### 2.1 Tabela Completa

| Módulo              | Layer | Arquivos | LoC        | Max (LoC)                    | Fan-out | Singletons | Testes          |
| ------------------- | ----- | -------- | ---------- | ---------------------------- | ------- | ---------- | --------------- |
| `agent/`            | L4    | 54       | 7.779      | always-alive.js (623)        | 7       | 4          | 12              |
| `sdk/`              | L1    | 42       | 7.766      | types.js (569)               | 1       | 5          | 3               |
| `terminal/`         | L6    | 47       | 7.751      | server.js (452)              | 10      | 12         | 8               |
| `tools/`            | L3    | 28       | 6.296      | introspection-tools.js (407) | 6       | 4          | 6               |
| `observability/`    | L2    | 22       | 4.565      | metrics.js (426)             | 4       | 3          | 6               |
| `hooks/`            | L3    | 21       | 3.703      | factory.js (416)             | 5       | 4          | 5               |
| `api/`              | L5    | 21       | 3.311      | session-crud.js (351)        | 8       | 2          | 4               |
| `conversation-hub/` | L4    | 12       | 2.618      | store.js (561)               | 4       | 1          | 2               |
| `bridges/`          | L3    | 12       | 2.354      | nerv-bridge.js (434)         | 5       | 8          | 3               |
| `core/`             | L0    | 20       | 2.659      | structured-message.js (387)  | 1       | 2          | 7               |
| `channel/`          | L4    | 7        | 1.496      | client.js (557)              | 4       | 1          | 2               |
| `config/`           | L2    | 7        | 1.265      | custom-agents.js (325)       | 3       | 0          | 1               |
| `services/`         | L4    | 5        | 509        | session-service.js (208)     | 6       | 0          | 0               |
| `plugins/`          | L3    | 2        | 253        | plugin-registry.js (225)     | 1       | 0          | 0               |
| `audit/`            | L1    | 8        | 865        | pipeline-audit-log.js (330)  | 2       | 2          | 3               |
| `types/`            | L0    | 2        | 189        | events.js (149)              | 0       | 0          | 0               |
| `db/`               | L0    | 3        | 436        | sqlite.js (233)              | 1       | 3          | 2               |
| **Total**           |       | **313**  | **53.815** |                              | max=10  | **53**     | **64 arquivos** |

### 2.2 Top 25 Arquivos Maiores (God File Candidates)

| #   | Arquivo                                             | LoC | Concerns                                               |
| --- | --------------------------------------------------- | --- | ------------------------------------------------------ |
| 1   | `agent/always-alive.js`                             | 623 | State machine, queue, event-emitter, DI wiring         |
| 2   | `agent/dialog/loop-manager.js`                      | 599 | Turn queue, watchdog, protocol, fallback, backpressure |
| 3   | `sdk/types.js`                                      | 569 | Typedefs only (legítimo)                               |
| 4   | `conversation-hub/store.js`                         | 561 | Store + queries (já parcialmente split)                |
| 5   | `channel/client.js`                                 | 557 | Client + dialog helpers (já split)                     |
| 6   | `conversation-hub/socket-ns.js`                     | 482 | Auth, rate limit, bridge, public API                   |
| 7   | `terminal/server.js`                                | 452 | HTTP routes + SSE + file upload                        |
| 8   | `channel/inject.js`                                 | 450 | Inject + validation + rate limit + SSE                 |
| 9   | `conversation-hub/orchestrator.js`                  | 438 | Session CRUD + event emission + hub mgmt               |
| 10  | `terminal/repl.js`                                  | 437 | REPL loop + cmd dispatch + inline handlers             |
| 11  | `bridges/nerv-bridge.js`                            | 434 | Bridge state, events, retry, lifecycle                 |
| 12  | `bridges/mcp-tool-bridge.js`                        | 431 | Circuit breaker, health, retry, boot                   |
| 13  | `observability/metrics.js`                          | 426 | Store + histogram + singleton + snapshot               |
| 14  | `observability/observers/dialog-task-handlers.js`   | 424 | Dialog observers + span tracking + state               |
| 15  | `sdk/client.js`                                     | 416 | Client bootstrap + events + session lifecycle          |
| 16  | `hooks/factory.js`                                  | 416 | Hook factory + validation + 6 slot types               |
| 17  | `tools/introspection-tools.js`                      | 407 | 8+ tool definitions inline                             |
| 18  | `observability/event-collector.js`                  | 405 | Collector + flush + singleton + batch                  |
| 19  | `tools/web-tools.js`                                | 397 | HTTP tools + validation + rate limiting                |
| 20  | `terminal/handlers/system-metrics.js`               | 395 | Collection + formatting + display + aggregation        |
| 21  | `observability/collectors/session-handlers.js`      | 392 | 15+ event handlers inline                              |
| 22  | `core/structured-message.js`                        | 387 | Schema + builders + parser + serializers               |
| 23  | `terminal/file-context.js`                          | 382 | File scan + embed + size limits + cache                |
| 24  | `terminal/commands/gh.js`                           | 382 | GitHub CLI integration (6+ subcommands)                |
| 25  | `observability/observers/session-agent-handlers.js` | 381 | 25+ event type handlers inline                         |

---

## 3. Análise de Saúde por Dimensão

### 3.1 Dimensão: Tamanho e Coesão de Arquivos

**Estado atual:** 23 arquivos com ≥380 LoC. Muitos têm múltiplos concerns mascarados por JSDoc.
**Critério rigoroso:** Nenhum arquivo de lógica deve exceder 250 LoC. Arquivos de 300+ com ≥2 concerns = god file.

| Categoria                    | Count | Ação Necessária       |
| ---------------------------- | ----- | --------------------- |
| >500 LoC (god files severos) | 5     | Split obrigatório     |
| 400-500 LoC (god files)      | 11    | Split recomendado     |
| 350-400 LoC (borderline)     | 7     | Refatoração interna   |
| <350 LoC (aceitável)         | 290   | Monitorar crescimento |

### 3.2 Dimensão: EventBus vs EventEmitter Direto

**Estado atual:** 8 arquivos ainda usam `new EventEmitter()` / `extends EventEmitter`:

| Arquivo                            | Tipo                   | Problema                           |
| ---------------------------------- | ---------------------- | ---------------------------------- |
| `hooks/bus.js`                     | `extends EventEmitter` | Deveria ser EventBus namespace     |
| `conversation-hub/orchestrator.js` | `extends EventEmitter` | Hub emite diretamente, sem bus     |
| `agent/dialog/loop-manager.js`     | `new EventEmitter()`   | DialogProtocol tem emitter interno |
| `agent/always-alive.js`            | `extends EventEmitter` | AlwaysAliveAgent é um emitter      |
| `agent/infra/handoff-manager.js`   | `new EventEmitter()`   | Handoff state via emitter          |
| `api/sse/fanout.js`                | `new EventEmitter()`   | SSE fanout, fora do bus            |
| `config/pinned-files.js`           | `extends EventEmitter` | Watcher de arquivos pinados        |
| `terminal/state.js`                | `new EventEmitter()`   | Terminal state via emitter         |

**EventBus adotado em apenas 13 arquivos** num sistema de 313. A infraestrutura foi criada na Faixa M mas não expandida.

### 3.3 Dimensão: Singletons e Estado Global

**Estado atual:** 73 module-scope `let` declarações (53 após exclusões legítimas).
Os **53 refined** incluem padrões genuinamente problemáticos:

| Categoria                          | Count | Problema                       |
| ---------------------------------- | ----- | ------------------------------ |
| Lazy init nula (`let x = null`)    | 18    | Stale ref, não testável via DI |
| Estado de request in-progress      | 8     | Race condition risk            |
| Config vars mutáveis               | 7     | Não isoladas por instância     |
| Mutexes/Promises globais           | 5     | Não limpáveis em test teardown |
| Circuit breaker state              | 4     | Não resetável externalmente    |
| Outros flags e counters relevantes | 11    | Variam por tipo                |

**Padrão crítico em `bridges/nerv-bridge.js`** (5 module-scope lets):
```
let _agent = null
let _nerv = null
let _inboundUnsub = null
let _beforeStopRegistered = false
let _pendingReadyHandler = null
```
Não testável em isolamento — qualquer teste de bridge exige mocking global.

### 3.4 Dimensão: Cobertura de Testes

**Estado atual:** 195 arquivos de teste para 313 arquivos de produção.
**Problema real:** Os 195 test files não distribuem uniformemente:

| Módulo      | Arquivos prod | Test files estimados | Cobertura modulada |
| ----------- | ------------- | -------------------- | ------------------ |
| `terminal/` | 47            | ~8                   | 17% ⚠️              |
| `agent/`    | 54            | ~12                  | 22% ⚠️              |
| `bridges/`  | 12            | ~3                   | 25% ⚠️              |
| `sdk/`      | 42            | ~3                   | 7% 🔴               |
| `tools/`    | 28            | ~6                   | 21% ⚠️              |
| `services/` | 5             | ~0                   | 0% 🔴               |
| `plugins/`  | 2             | ~0                   | 0% 🔴               |
| `types/`    | 2             | ~0                   | 0% 🔴               |

### 3.5 Dimensão: DI Container Subutilizado

**Estado atual:** 13 tokens DI registrados. Análise dos usos:

| Token             | Tipo          | Quem injeta        | Quem resolve          |
| ----------------- | ------------- | ------------------ | --------------------- |
| SHUTDOWN_LOGGER   | Logger proxy  | observability/boot | core/shutdown         |
| DB_LOGGER         | Logger proxy  | observability/boot | db/sqlite             |
| SDK_LOGGER        | Logger proxy  | observability/boot | sdk/logger            |
| AUDIT_LOGGER      | Logger proxy  | observability/boot | audit/logger          |
| AUDIT_BUS         | Event emitter | observability/boot | audit/pipeline-perm   |
| TOOLS_BUILDER     | Factory fn    | terminal/boot      | sdk/custom-tools      |
| BRIDGE_AGENT      | Agent ref     | terminal/boot      | bridges/nerv-bridge   |
| FALLBACK_AGENT    | Agent ref     | conv-hub/boot      | conv-hub/orchestrator |
| HUB               | Hub singleton | terminal/boot      | multiple              |
| PERMISSION_AGENT  | Agent ref     | hooks/factory      | tools/permission      |
| SESSION_RPC       | RPC facade    | terminal/boot      | sdk/rpc-session       |
| NERV_BRIDGE_AGENT | Agent ref     | bridges/boot       | bridges/nerv          |
| EVENT_BUS         | EventBus      | observability/boot | services/*            |

**Lacunas severas:** Nenhum token para: `ConversationStore`, `MetricsStore`, `AuditPipeline`, `DialogLoopManager`, `AlwaysAliveAgent`, `InjectServer`, `SocketNamespace`, `RateLimiter`.

### 3.6 Dimensão: Profundidade de Grafo (Coupling)

**Fan-out realista por módulo (import #copilot apenas):**

```
terminal (10): agent, api, audit, bridges, channel, config, conversation-hub, core, observability, sdk
api (8):       agent, audit, config, conversation-hub, core, observability, sdk, services
services (6):  agent, audit, config, conversation-hub, core, observability
tools (6):     agent, bridges, config, core, observability, sdk
hooks (5):     agent, audit, config, core, observability
bridges (5):   agent, config, core, observability, sdk
...
```

**Problema de coupling cluster:**
- `observability` é importado por TODOS os 10 módulos acima — impede testabilidade
- `core` é importado por 8 módulos — é um "god L0"
- `config` é importado por 7 módulos — 43 deep imports restantes (env.js)
- agent é importado por 5 módulos (services, terminal, api, tools, bridges) — L4 capturado demais

### 3.7 Dimensão: Qualidade do Código por God Files

**`agent/always-alive.js` (623 LoC) — Análise de Concerns:**
- Concern 1: Delegação de métodos (`sendMessage`, `steerMessage`, etc.) — 80 LoC
- Concern 2: EventEmitter + EventBus bridge — 30 LoC
- Concern 3: `starts()` / `stop()` — 40 LoC
- Concern 4: `processQueue()` orchestration — 60 LoC
- Concern 5: Status snapshot/diagnostics — 40 LoC
- Concern 6: Dialog loop lifecycle — 100 LoC
- Concern 7: `_setupEventHandlers()` — 80 LoC
- Concern 8: `_handleAgentEvent()` — 80 LoC
- Concern 9: Config wiring — 60 LoC

**Veredicto:** 9 concerns distintos. Deveria ser reduzido a ≤200 LoC como puro orchestrator.

**`agent/dialog/loop-manager.js` (599 LoC) — Análise de Concerns:**
- Concern 1: Turn queue + backpressure — 80 LoC
- Concern 2: Watchdog (stall detection) — 60 LoC
- Concern 3: DialogProtocol state machine — 100 LoC
- Concern 4: Pause/Resume state — 60 LoC
- Concern 5: Model fallback scheduler — 80 LoC
- Concern 6: Turn executor coordination — 100 LoC
- Concern 7: Event emission — 80 LoC
- Concern 8: Mutex serialization — 40 LoC

**Veredicto:** 8 concerns. Já tem `watchdog.js`, `backpressure.js`, `protocol.js` separados mas `loop-manager.js` ainda orquestra tudo.

---

## 4. Inconsistências e Dívida Técnica Específica

### 4.1 Padrão Misto de Bootstrap

O sistema tem 4 formas diferentes de inicializar dependências:
1. **DI Container** (`container.register + container.resolve`) — 13 tokens
2. **wireLegacySetters** (`setBridgeAgent`, `setHub`, etc.) — ~8 setters
3. **Singleton direto** (`let x = null; export function init(val){ x = val; }`) — ~15 padrões
4. **Import direto** de singleton exportado (`import { defaultMetrics }`) — ~20 casos

### 4.2 Typedefs Sem Arquivo `.d.ts`

`sdk/types.js` tem 569 LoC de `@typedef`. São usados como se fossem tipos TS via JSDoc, mas não geram `.d.ts` real. TypeScript resolve via `tsconfig.base.json` com `allowJs`, mas 16 erros persistem porque alguns tipos não são acessíveis via `#copilot/sdk`.

### 4.3 Inconsistência de Nomenclatura de Eventos

3 sistemas de eventos paralelos com namespaces sobrepostos:
- **`HUB_EVENTS`** (conversation-hub/events.js): `SESSION_CREATED`, `TURN_SENT`, etc.
- **`AGENT_EVENTS`** (core/constants.js): `AGENT_READY`, `AGENT_STOPPED`, etc.
- **Strings literais** espalhadas: `'phase:changed'`, `'error'`, `'connected'`, etc.

Nenhum schema central de eventos typed.

### 4.4 Audit Pipeline sem Event Sourcing

`audit/pipeline.js` usa um ring buffer em memória + flush periódico para disco. Não tem:
- Imutabilidade (pode ser overwritten)
- Replay de eventos
- Compactação/archival
- Query por range de tempo

### 4.5 SSE Fanout sem Backpressure

`api/sse/fanout.js` usa EventEmitter direto. Não tem:
- Backpressure para clientes lentos
- Max concurrent connections
- Health monitoring por conexão

---

## 5. Métricas Absolutas do Estado Atual

| Métrica                              | Valor Atual | Score PARTE-22 | Meta Rigorosa |
| ------------------------------------ | ----------- | -------------- | ------------- |
| Health Score (arch-health calibrado) | 95/100 (A)  | C+ (ver §6)    | A (98/100)    |
| Arquivos >400 LoC                    | 17          | —              | 0             |
| Arquivos >250 LoC (lógica)           | 35          | —              | ≤10           |
| EventEmitter direto (files)          | 8           | —              | 0             |
| EventBus adoption (files)            | 13          | —              | ≥80           |
| Singletons reais problemáticos       | 53          | —              | ≤15           |
| DI tokens                            | 13          | —              | ≥40           |
| services/ API coverage               | ~20%        | —              | 100%          |
| plugins/ extensions registradas      | 0 ativos    | —              | n/a           |
| Test coverage (módulo)               | ~30% est.   | —              | ≥70%          |
| 16 typecheck errors                  | 16          | —              | 0             |
| FIXME/HACK markers                   | 0           | —              | 0             |
| TODOs em produção                    | 0 (código)  | —              | 0             |
| Circuit breakers                     | 1 (MCP)     | —              | 6+            |

### 5.1 Score PARTE-22 (Critérios Rigorosos Novos)

O health score do `arch-health.mjs` foi calibrado progressivamente. Para a PARTE-22, adotamos **critérios sem relativização**:

| Critério                 | Peso | Score Atual | Nota                   |
| ------------------------ | ---- | ----------- | ---------------------- |
| Sem god files (>300 LoC) | 20%  | 0/20        | 🔴 0 god files aceitos  |
| EventBus primário        | 15%  | 3/15        | EventEmitter em 8 mods |
| DI completo (≥40 tokens) | 15%  | 5/15        | 13 tokens vs 40+ ideal |
| Test coverage ≥70%       | 20%  | 6/20        | ~30% atual             |
| Zero typecheck errors    | 10%  | 4/10        | 16 erros               |
| Singletons ≤15           | 10%  | 3/10        | 53 refined             |
| Services cobertura total | 10%  | 3/10        | 20% coverage           |
| **TOTAL**                |      | **24/100**  | **F**                  |

**Diagnóstico real: 24/100 (F) nos critérios PARTE-22, não 95/100 (A) antigo.**
Isso é o ponto de partida honesto para a PARTE-22.

---

## 6. Comparativo PARTE-21 vs PARTE-22 (Critérios)

| Critério PARTE-21          | Critério PARTE-22 (mais rigoroso)                 |
| -------------------------- | ------------------------------------------------- |
| Barrel coverage 100%       | **Barrel + re-export clean** (sem cross-layer)    |
| De 0 fan-out (calibrado)   | **Fan-out ≤6 para todos** (atual: terminal=10)    |
| 0 camada violations        | **0 violations + 0 EventEmitter direto**          |
| DI tokens ≥13              | **DI tokens ≥40 + container.resolve em 100%**     |
| Health Score A             | **God files 0 + EventBus primário + DI completo** |
| Deep imports refinados ≤10 | **Zero deep imports** (nenhum bypass de barrel)   |
| Tests 195 files            | **Cobertura unitária ≥70% por módulo**            |

---

## 7. Itens da PARTE-21 Não Executados (Pendências)

Os seguintes itens do roadmap PARTE-21C **NÃO foram executados** e devem ser priorizados:

| Item | Descrição                                 | Status PARTE-21C |
| ---- | ----------------------------------------- | ---------------- |
| W4-3 | Migrar 31 deep imports reais (não-logger) | ❌ Não feito      |
| W5-1 | Extract terminal facades (fan-out 19→12)  | ❌ Não feito      |
| W5-2 | Domain Event Bus por módulo               | ❌ Não feito      |
| W5-3 | Event sourcing para audit pipeline        | ❌ Não feito      |
| W5-5 | Mutex pool com timeout                    | ❌ Não feito      |
| W5-6 | Timer manager com cleanup                 | ❌ Não feito      |
| W5-7 | Split `agent/always-alive.js`             | ❌ Não feito      |
| W5-8 | Split `agent/dialog/loop-manager.js`      | ❌ Não feito      |
| W5-9 | DI.fork() para multi-agent prep           | ❌ Não feito      |
| W6-5 | Resolver 16 typecheck errors (rpc-*.js)   | ❌ Não feito      |
| W6-6 | Observable-first metrics (OpenTelemetry)  | ❌ Não feito      |

---

## 8. Análise de Riscos

### 8.1 Riscos de Alta Gravidade no Estado Atual

| Risco                                          | Probabilidade | Impacto | Mitigação Necessária          |
| ---------------------------------------------- | ------------- | ------- | ----------------------------- |
| Race condition em singleton global bridges/    | Média         | Alto    | DI isolation por instância    |
| Memory leak em EventEmitters não removidos     | Alta          | Médio   | Registro/cleanup centralizado |
| Dialog loop stall sem watchdog global          | Média         | Alto    | Watchdog de processo          |
| SSE fanout sem backpressure → OOM              | Baixa         | Alto    | Circuit breaker no fanout     |
| Plugin mal-formado → crash no runtime          | Média         | Alto    | Sandbox + schema validation   |
| session-rpc typecheck errors → silently wrong  | Alta          | Médio   | Fix typecheck + tests         |
| Audit pipeline overflow → audit log silenciado | Média         | Alto    | Event sourcing / WAL          |

---

## 9. Próximidade com a Situação Ideal (Ver PARTE-22B)

A distância entre o estado atual e a situação ideal (PARTE-22B) pode ser resumida:

| Dimensão                | Distância    | Complexidade de Fechar        |
| ----------------------- | ------------ | ----------------------------- |
| God files (>300 LoC)    | 17 arquivos  | Alta — cada split é cirúrgico |
| EventEmitter → EventBus | 8 arquivos   | Média — padrão definido       |
| DI tokens 13 → 40+      | +27 tokens   | Média — injeção incremental   |
| Test coverage 30→70%    | +40%         | Alta — escrever testes reais  |
| Typecheck 16 → 0 errors | -16 erros    | Baixa — 2 arquivos rpc        |
| services/ completo      | +80%         | Média — facades por domínio   |
| EventBus primário       | 300 arquivos | Alta — migração gradual       |
| plugins/ funcional      | +90%         | Média — sistema novo          |
| Circuit breakers 1→6    | +5           | Baixa — padrão existe         |
