# PARTE-21E — Critérios e Métricas: Avaliação Profunda Pós-Roadmap

**Data**: 2026-04-12 | **Status**: BASELINE (scores pré-Faixa H) | **Versão**: 2.0 **Precedente**:
PARTE-20E (critérios v1.0), PARTE-21A (baseline v2.0), PARTE-21F (estado atual) **Scope**: Avaliação
profunda contra 13 critérios canônicos, com evidências por arquivo, projeções por Wave do roadmap
PARTE-21C, e novos sub-critérios para preparação de upgrades vastos.

> **⚠️ ATENÇÃO**: Os scores neste documento refletem o estado **pré-execução** das Faixas H–N.
> Scores atualizados pós-execução estão na PARTE-21F.

---

## 1. Nota Metodológica

### 1.1 Diferenças da v1.0

A v1.0 deste documento usou o mesmo template da PARTE-20E com scores atualizados. A v2.0 expande
radicalmente:

- **Evidências por arquivo**: cada sub-critério cita os arquivos relevantes
- **Projeção por Wave**: cada critério tem target score para W0, W1, W2, W3
- **Novos sub-critérios C14-C17**: preparação para upgrades vastos
- **Coupling assessment**: métricas quantitativas de acoplamento
- **Escala refinada**: 0.0-4.0 com granularidade de 0.25

### 1.2 Hierarquia de Camadas (CI-enforced)

```
L0: core, db   |  L1: sdk, audit   |  L2: config, observability
L3: hooks, tools, bridges   |  L4: agent, conversation-hub, channel
L5: api   |  L6: terminal
```

---

## 2. Avaliação por Critério (C1–C13)

### C1 — Princípio de Responsabilidade Única por Módulo (SRM)

**Score**: 3.25/4 ⚠️ (v1.0 reportava 4/4 — reavaliado com maior rigor)

| Sub | Critério                        | Score | Evidência                                                            |
| --- | ------------------------------- | ----- | -------------------------------------------------------------------- |
| 1.1 | README.md com scope claro       | 4/4   | 14/14 módulos documentados ✅                                        |
| 1.2 | ≤2 responsabilidades por módulo | 3/4   | `agent/` tem 4+ (lifecycle, dialog, session, queue, infra, watchdog) |
| 1.3 | Sem arquivo multi-concern (>3)  | 3/4   | 25 arquivos >400 LoC = potencial multi-concern (ver tabela abaixo)   |
| 1.4 | index.js como barrel puro       | 3/4   | 3 barrels com lógica de inicialização embutida                       |

**Arquivos que desafiam SRM (>400 LoC com concerns mistas)**:

| Arquivo                               | LoC | Concerns identificados                                |
| ------------------------------------- | --- | ----------------------------------------------------- |
| `agent/dialog/loop-manager.js`        | 735 | Turn loop, event emission, error recovery, metrics    |
| `agent/infra/tools-bootstrap.js`      | 665 | Tool registry, schema validation, DI wiring, logging  |
| `terminal/handlers/system-metrics.js` | 621 | Metric collection, formatting, aggregation, display   |
| `terminal/terminal-mode.js`           | 585 | FSM state, input parsing, command dispatch, rendering |
| `tools/introspection-tools.js`        | 534 | 5 tool definitions com schemas inline                 |
| `hooks/session-hooks.js`              | 522 | Pre/post/session hooks, validation, DI forwarding     |
| `sdk/copilot-sdk-config.js`           | 494 | Config parsing, defaults, env, schema, validation     |
| `observability/presets/production.js` | 487 | 12+ observers pré-configurados                        |
| `api/express/observability.js`        | 463 | Route handlers, middleware, metric formatters         |
| `agent/lifecycle/entry.js`            | 451 | Bootstrap, DI wiring, lifecycle, config, logging      |
| `agent/session/session-manager.js`    | 442 | Session CRUD, validation, context, persistence        |
| `terminal/rendering/progress-bar.js`  | 437 | Render, animation, calc, format, theme                |
| `sdk/types.js`                        | 418 | 40+ JSDoc typedefs (puro = OK)                        |
| `bridges/mcp-tool-bridge.js`          | 415 | Protocol, transport, registration, error handling     |

> `sdk/types.js` é exceção aceitável: arquivo puro de typedefs sem lógica. Os demais 13 arquivos são
> candidatos a split na Faixa J do roadmap.

**Projeção**:

| Wave | Target | Ação                                                      |
| ---- | ------ | --------------------------------------------------------- |
| W0   | 3.25   | Sem mudança (pré-requisitos)                              |
| W1   | 3.50   | Barrels limpos, remover lógica dos 3 index.js             |
| W2   | 3.75   | Split dos 8 piores arquivos >500 LoC via FJ-1..FJ-8       |
| W3   | 4.00   | agent/ subdividido em sub-serviços, todos ≤300 LoC ativos |

---

### C2 — Hierarquia de Camadas

**Score**: 2.25/4 ⚠️

| Sub | Critério                 | Score | Evidência                                                             |
| --- | ------------------------ | ----- | --------------------------------------------------------------------- |
| 2.1 | Sem import ascendente    | 2.0/4 | CI reporta 0, mas existem 4 violações ocultas via `export...from`     |
| 2.2 | Horizontais justificadas | 3.5/4 | hooks→tools (L3→L3): justified; hooks→hooks intra (22): OK            |
| 2.3 | Cross-layer documentado  | 3.0/4 | DI setters documentados, mas 3 padrões de naming inconsistentes       |
| 2.4 | CI gate completo         | 0.5/4 | Gate existe, mas regex NÃO detecta `export { } from`, `export * from` |

**Violações ocultas detalhadas**:

| #   | Arquivo origem      | Target                           | Direção | Mecanismo         |
| --- | ------------------- | -------------------------------- | ------- | ----------------- |
| 1   | `core/constants.js` | `#copilot/config/env`            | L0→L2   | `export { } from` |
| 2   | `sdk/index.js`      | `#copilot/hooks/factory`         | L1→L3   | `export { } from` |
| 3   | `sdk/index.js`      | `#copilot/hooks/permission`      | L1→L3   | `export { } from` |
| 4   | `sdk/config.js`     | `#copilot/config/session-config` | L1→L2   | `export { } from` |

**Fix de CI necessário**: `scripts/check-layer-violations.mjs` — regex precisa adicionar padrão
`export\s*\{[^}]*\}\s*from` e `export\s*\*\s*from` além do `import.*from` existente.

**Projeção**:

| Wave | Target | Ação                                            |
| ---- | ------ | ----------------------------------------------- |
| W0   | 3.50   | FH-1: fix regex CI + FH-2: resolver 4 violações |
| W1   | 3.75   | ESLint rule `no-restricted-imports` por layer   |
| W2   | 4.00   | DI Container remove necessidade de re-exports   |
| W3   | 4.00   | Mantido                                         |

---

### C3 — Interfaces de Módulo Explícitas

**Score**: 2.75/4 ⚠️ (v1.0 reportava 4/4 — reavaliado com rigor de barrel bypass)

| Sub | Critério                             | Score | Evidência                                         |
| --- | ------------------------------------ | ----- | ------------------------------------------------- |
| 3.1 | Entry point único (index.js)         | 4/4   | 14/14 módulos têm index.js ✅                     |
| 3.2 | Sem import de internals cross-module | 1.5/4 | **233 deep imports** (73% do total cross-module!) |
| 3.3 | JSDoc em public API (barrel exports) | 3.0/4 | 14/14 barrels, mas ~40% dos exports sem @param    |
| 3.4 | Internals nunca expostos por barrel  | 2.5/4 | 3 barrels expõem internals desnecessariamente     |

**Análise de deep imports (violam 3.2)**:

| Módulo target    | Barrel imports | Deep imports | % Deep | Pior ofensor                    |
| ---------------- | -------------- | ------------ | ------ | ------------------------------- |
| observability    | 12             | 134          | 92%    | `observability/logger.js` (134) |
| core             | 20             | 44           | 69%    | `core/errors.js` (22)           |
| sdk              | 18             | 35           | 66%    | `sdk/copilot-sdk-config.js`     |
| config           | 8              | 36           | 82%    | `config/env.js` (30)            |
| hooks            | 6              | 25           | 81%    | `hooks/factory.js` (12)         |
| audit            | 4              | 10           | 71%    | `audit/pipeline.js` (8)         |
| agent            | 5              | 9            | 64%    | `agent/session/*` (5)           |
| conversation-hub | 3              | 10           | 77%    | `conversation-hub/hub.js` (6)   |
| channel          | 4              | 6            | 60%    | variado                         |
| bridges          | 2              | 8            | 80%    | `bridges/mcp-tool-bridge.js`    |
| tools            | 2              | 6            | 75%    | variado                         |
| db               | 1              | 1            | 50%    | `db/connection.js`              |

> O maior ofensor é `observability/logger.js` com 134 deep imports diretos. Isso sozinho representa
> 57% de todos os deep imports do sistema.

**Projeção**:

| Wave | Target | Ação                                                       |
| ---- | ------ | ---------------------------------------------------------- |
| W0   | 2.75   | Sem mudança                                                |
| W1   | 3.50   | FI-1..FI-14: barrel enforcement com ESLint no-restricted   |
| W2   | 3.75   | DI reduce cross-module imports; barrel JSDoc completo      |
| W3   | 4.00   | ≤20 deep imports (allow-listed); 100% barrel exports JSDoc |

---

### C4 — Injeção de Dependência sobre Acoplamento

**Score**: 2.75/4 ⚠️ (v1.0 reportava 3.5/4 — reavaliado com rigor de singleton pattern)

| Sub | Critério                         | Score | Evidência                                        |
| --- | -------------------------------- | ----- | ------------------------------------------------ |
| 4.1 | Funções puras sem global state   | 2.5/4 | ~30 module-level `let x = null` singletons       |
| 4.2 | Singletons controlados (factory) | 2.0/4 | ~20 são `let` crus sem factory/dispose pattern   |
| 4.3 | Estado injetado como parâmetro   | 3.5/4 | 22 DI setters + 3 bootstrap functions            |
| 4.4 | setX() setters com interface     | 3.0/4 | 3 naming patterns: `setX`, `initX`, `bootstrapX` |

**Inventário de singletons (amostra)**:

| Módulo           | Singletons | Exemplos                                             |
| ---------------- | ---------- | ---------------------------------------------------- |
| observability    | 6          | `let logger`, `let metricsCollector`, `let registry` |
| agent            | 5          | `let alwaysAliveAgent`, `let sessionManager`         |
| hooks            | 4          | `let hookRegistry`, `let permissionCache`            |
| sdk              | 3          | `let sdkInstance`, `let configCache`                 |
| terminal         | 3          | `let terminalState`, `let repl`                      |
| config           | 3          | `let envCache`, `let sessionConfig`                  |
| conversation-hub | 2          | `let hub`, `let conversationStore`                   |
| tools            | 2          | `let toolRegistry`, `let schemaCache`                |
| bridges          | 1          | `let mcpServer`                                      |
| channel          | 1          | `let channelManager`                                 |

**Inventário de DI setters (22)**:

| Padrão         | Count | Exemplos                                                        |
| -------------- | ----- | --------------------------------------------------------------- |
| `setX()`       | 14    | `setLogger`, `setMetrics`, `setConfig`, `setAudit`              |
| `initX()`      | 5     | `initObservability`, `initHooks`, `initTools`                   |
| `bootstrapX()` | 3     | `bootstrapObservability`, `bootstrapLateDeps`, `bootstrapAgent` |

> **Problema**: sem container DI, a ordem de chamada dos setters é implícita em `entry.js`. Um
> reordenamento acidental causa `undefined` em runtime.

**Projeção**:

| Wave | Target | Ação                                                      |
| ---- | ------ | --------------------------------------------------------- |
| W0   | 2.75   | Sem mudança                                               |
| W1   | 3.00   | Documentar ordem de init; TSDoc em setters                |
| W2   | 3.75   | FK-1..FK-12: DI Container token-based com dispose/fork    |
| W3   | 4.00   | Singletons migrados p/ container; zero module-level state |

---

### C5 — Tamanho e Coesão de Arquivo

**Score**: 2.25/4 ⚠️ (v1.0 reportava 3/4 — reavaliado com dados quantitativos)

| Sub | Critério                        | Score | Evidência                                                       |
| --- | ------------------------------- | ----- | --------------------------------------------------------------- |
| 5.1 | ≤300 LoC (código ativo)         | 2.0/4 | 25 arquivos >400 LoC (agent=8, terminal=7, hooks=1, etc)        |
| 5.2 | 300-400: justificados em coment | 1.0/4 | 0 dos ~15 arquivos na faixa têm justificativa formal            |
| 5.3 | Nenhum >600 LoC ativo           | 2.5/4 | 3 arquivos >600 (loop-manager:735, tools-boot:665, sys-met:621) |
| 5.4 | Splits por concern completos    | 3.5/4 | God objects de PARTE-20 eliminados; novos detectados            |

**Distribuição de LoC completa**:

| Faixa     | Arquivos | % total | Estado        |
| --------- | -------- | ------- | ------------- |
| ≤100 LoC  | 98       | 34%     | ✅ Saudável   |
| 101-200   | 87       | 30%     | ✅ Saudável   |
| 201-300   | 52       | 18%     | ✅ Saudável   |
| 301-400   | 25       | 9%      | ⚠️ Justificar |
| 401-500   | 12       | 4%      | 🟠 Split      |
| 501-600   | 10       | 3%      | 🔴 Split      |
| >600      | 3        | 1%      | 🔴 Urgente    |
| **Total** | **287**  | 100%    |               |

**Top 5 candidatos urgentes a split**:

| #   | Arquivo                               | LoC | Nº concerns | Target LoC pós-split |
| --- | ------------------------------------- | --- | ----------- | -------------------- |
| 1   | `agent/dialog/loop-manager.js`        | 735 | 4           | 4 × ~185             |
| 2   | `agent/infra/tools-bootstrap.js`      | 665 | 4           | 4 × ~166             |
| 3   | `terminal/handlers/system-metrics.js` | 621 | 4           | 3 × ~207             |
| 4   | `terminal/terminal-mode.js`           | 585 | 4           | 3 × ~195             |
| 5   | `tools/introspection-tools.js`        | 534 | 5           | 5 × ~107             |

**Projeção**:

| Wave | Target | Ação                                                     |
| ---- | ------ | -------------------------------------------------------- |
| W0   | 2.25   | Sem mudança                                              |
| W1   | 2.75   | Justificativas formais nos 15 arquivos 301-400           |
| W2   | 3.50   | FJ-1..FJ-29: Split dos 25 arquivos >400 em sub-módulos   |
| W3   | 4.00   | Max ~350 LoC except types; 100% justificado acima de 250 |

---

### C6 — DRY Arquitetural

**Score**: 3.50/4 ✅ (v1.0 reportava 4/4 — reavaliado com análise de duplicação)

| Sub | Critério               | Score | Evidência                                               |
| --- | ---------------------- | ----- | ------------------------------------------------------- |
| 6.1 | Segurança centralizada | 4/4   | `core/security/` ✅                                     |
| 6.2 | Config centralizada    | 3.5/4 | `config/` + `sdk/copilot-sdk-config.js` (split concern) |
| 6.3 | Logging centralizado   | 3.0/4 | `observability/logger.js` + 134 deep imports diretos    |
| 6.4 | Tipos centralizados    | 3.5/4 | `sdk/types.js` (40+ typedefs) mas sem `types/` L0       |
| 6.5 | Utilitários em core/   | 4/4   | 6 issues de dup resolvidos na PARTE-20                  |

**Duplicação residual detectada**:

| Padrão duplicado            | Ocorrências | Módulos afetados            |
| --------------------------- | ----------- | --------------------------- |
| Error formatting logic      | ~5          | core, agent, hooks, api     |
| Config env access pattern   | ~8          | config, sdk, core, agent    |
| Logger creation boilerplate | ~134        | todos (deep import direto)  |
| Tool schema validation      | ~3          | tools, hooks, bridges       |
| Session context extraction  | ~4          | agent, terminal, hooks, api |

> O maior DRY violation é o padrão de logger:
> `import { getLogger } from '#copilot/observability/logger'` repetido 134 vezes. Com barrel
> enforcement, seria `import { getLogger } from '#copilot/observability'`.

**Projeção**:

| Wave | Target | Ação                                                  |
| ---- | ------ | ----------------------------------------------------- |
| W0   | 3.50   | Sem mudança                                           |
| W1   | 3.75   | Barrel enforcement reduz boilerplate de import        |
| W2   | 3.75   | DI Container centraliza wiring                        |
| W3   | 4.00   | Shared types L0 + facade services eliminam duplicação |

---

### C7 — Nomenclatura Consistente

**Score**: 3.75/4 ✅

| Sub | Critério                             | Score | Evidência                                          |
| --- | ------------------------------------ | ----- | -------------------------------------------------- |
| 7.1 | Sem utils/helpers/misc/shared        | 4/4   | Nenhum detectado ✅                                |
| 7.2 | Nomes refletem responsabilidade      | 3.5/4 | `lib/` em hooks/ é genérico demais                 |
| 7.3 | Sem nomes duplicados cross-module    | 4/4   | Verificado: sem colisões ✅                        |
| 7.4 | Subpastas com substantivos concretos | 3.5/4 | `handlers/` em terminal/ é vago (handlers de quê?) |
| 7.5 | Sufixos explícitos (-factory, etc)   | 4/4   | Padrão consistente ✅                              |

**Issues menores**:

- `hooks/lib/` → deveria ser `hooks/matchers/` ou `hooks/evaluators/`
- `terminal/handlers/` → deveria ser `terminal/command-handlers/` ou `terminal/metric-handlers/`

**Projeção**: 3.75 → 4.00 na Wave 1 com renaming cirúrgico.

---

### C8 — Expansibilidade (Open for Extension)

**Score**: 3.50/4 ✅ (v1.0 reportava 4/4 — reavaliado com profundidade)

| Sub | Critério                         | Score | Evidência                                                  |
| --- | -------------------------------- | ----- | ---------------------------------------------------------- |
| 8.1 | Tools extensíveis sem mod agent/ | 4/4   | `allTools` array + `buildTool()` ✅                        |
| 8.2 | Bridges extensíveis              | 3.5/4 | bridges/ isolado, mas registry manual (sem autodiscovery)  |
| 8.3 | Terminal commands extensíveis    | 3.5/4 | autoload via glob, mas sem hot-reload                      |
| 8.4 | Hooks via registry               | 3.0/4 | registry.js, mas sem priority ordering ou middleware chain |
| 8.5 | Observability extensível         | 3.5/4 | observers/ + collectors/, mas sem plugin interface formal  |

**Gaps para extensibilidade vasta**:

- Sem plugin interface formal (lifecycle: load/unload/configure)
- Sem autodiscovery de bridges (manual array)
- Hooks sem priority/middleware pattern
- Sem feature flags runtime

**Projeção**:

| Wave | Target | Ação                                                         |
| ---- | ------ | ------------------------------------------------------------ |
| W0   | 3.50   | Sem mudança                                                  |
| W1   | 3.50   | Sem mudança                                                  |
| W2   | 3.75   | DI Container melhora test-time extensibility                 |
| W3   | 4.00   | FN-1..FN-18: Plugin registry + autodiscovery + feature flags |

---

### C9 — Auditabilidade e Rastreabilidade

**Score**: 3.75/4 ✅ (v1.0 reportava 4/4 — reavaliado)

| Sub | Critério                      | Score | Evidência                                                |
| --- | ----------------------------- | ----- | -------------------------------------------------------- |
| 9.1 | Tools via audit pipeline      | 4/4   | `audit/pipeline.js` ✅                                   |
| 9.2 | Session start/end auditada    | 4/4   | Via observers ✅                                         |
| 9.3 | Permissões registradas        | 3.5/4 | hooks/permission + audit, mas sem structured log         |
| 9.4 | Audit trail append-only       | 3.5/4 | Ring buffer com limit, mas sem persistence cross-restart |
| 9.5 | session_id/turn_id correlação | 4/4   | Propagado via context ✅                                 |

**Gap**: Ring buffer perde dados no restart. Event sourcing (Wave 3) resolve.

**Projeção**: 3.75 → 4.00 na Wave 3 com event sourcing + structured audit log.

---

### C10 — Isolamento de Infraestrutura

**Score**: 3.25/4 ⚠️ (v1.0 reportava 3.5/4)

| Sub  | Critério                | Score | Evidência                                            |
| ---- | ----------------------- | ----- | ---------------------------------------------------- |
| 10.1 | SDK via sdk/            | 4/4   | Wrapper completo ✅                                  |
| 10.2 | Git/GitHub via bridges/ | 3.5/4 | git-bridge + gh, mas 2 deep imports de core/errors   |
| 10.3 | MCP via bridges/        | 3.0/4 | mcp-tool-bridge.js = 415 LoC (candidato split)       |
| 10.4 | SQLite via db/          | 4/4   | better-sqlite3 isolado ✅                            |
| 10.5 | Env via config/env      | 2.0/4 | core/constants re-exporta de config (violação L0→L2) |

**Detalhe de 10.5**: `core/constants.js` faz `export { ENV_KEYS } from '#copilot/config/env'`. Isso
faz L0 depender de L2, violando a hierarquia. Fix: mover `ENV_KEYS` para `core/` (é constante).

**Projeção**:

| Wave | Target | Ação                                             |
| ---- | ------ | ------------------------------------------------ |
| W0   | 3.75   | FH-3: mover ENV_KEYS para core/                  |
| W1   | 4.00   | Barrel enforcement remove deep imports residuais |
| W2   | 4.00   | Mantido                                          |
| W3   | 4.00   | Mantido                                          |

---

### C11 — Testabilidade

**Score**: 2.00/4 ⚠️

| Sub  | Critério                            | Score | Evidência                                             |
| ---- | ----------------------------------- | ----- | ----------------------------------------------------- |
| 11.1 | Factories configuráveis             | 3.0/4 | DI setters existem, mas sem interface formal          |
| 11.2 | IO injetável/mockável               | 3.0/4 | Via DI setters, mas 30 singletons impedem mock limpo  |
| 11.3 | Testes unitários por módulo         | 1.0/4 | Apenas 6 contract tests, 0 unit tests real por módulo |
| 11.4 | Testes de integração nos boundaries | 1.0/4 | FG-3 cobre barrels, não boundaries reais              |

**Contagem de testes atual**:

| Tipo               | Count   | Escopo                        |
| ------------------ | ------- | ----------------------------- |
| Barrel contracts   | 6 specs | Validam existência de exports |
| Layer violation CI | 1 gate  | Regex incompleto              |
| File size CI       | 1 gate  | check-file-size.mjs           |
| Unit tests         | 0       | Nenhum test unitário real     |
| Integration tests  | 0       | Nenhum boundary test          |
| E2E tests          | 0       | Nenhum                        |

> Este é o critério com menor score. A cobertura de testes é **virtualmente zero** em termos de
> comportamento testado. Os 6 contract tests validam apenas que as exports existem, não que
> funcionam.

**Projeção**:

| Wave | Target | Ação                                                  |
| ---- | ------ | ----------------------------------------------------- |
| W0   | 2.25   | FH-2: unit tests para cada gate CI                    |
| W1   | 2.75   | Unit tests para barrels (import resolve + type check) |
| W2   | 3.25   | DI Container permite mock isolado → tests por módulo  |
| W3   | 3.75   | Event bus permite integration tests por evento        |

---

### C12 — Zero Artefatos Runtime no Source

**Score**: 4.00/4 ✅

| Sub  | Critério               | Score | Evidência         |
| ---- | ---------------------- | ----- | ----------------- |
| 12.1 | Logs fora de src/      | 4/4   | var/logs/ ✅      |
| 12.2 | Snapshots fora de src/ | 4/4   | var/snapshots/ ✅ |
| 12.3 | Sem .bak em src/       | 4/4   | ✅                |
| 12.4 | .gitignore coerente    | 4/4   | ✅                |

Nenhuma mudança necessária.

---

### C13 — Performance e Resource Safety

**Score**: 3.50/4 ✅ (v1.0 reportava 4/4 — reavaliado)

| Sub  | Critério                  | Score | Evidência                                                |
| ---- | ------------------------- | ----- | -------------------------------------------------------- |
| 13.1 | MaxListeners declarado    | 3.5/4 | EventEmitter configurado; 70+ files emit sem central bus |
| 13.2 | Timers limpos no teardown | 3.5/4 | timer-registry.js, mas ~5 setTimeout soltos detectados   |
| 13.3 | Ring buffers com limites  | 4/4   | audit ring buffer ✅                                     |
| 13.4 | Streams fechados em erro  | 3.5/4 | Maioria OK; 2 streams em bridges/ sem error handler      |
| 13.5 | AbortController propagado | 3.5/4 | Propagado via context, mas 3 loops sem abort check       |

**setTimeout soltos detectados** (candidatos a timer-registry):

- `agent/dialog/loop-manager.js` — retry delay sem clearTimeout
- `terminal/rendering/progress-bar.js` — animation interval
- `hooks/session-hooks.js` — timeout guard
- `agent/lifecycle/agent-lifecycle.js` — health check interval
- `api/express/middleware.js` — request timeout

**Projeção**:

| Wave | Target | Ação                                                |
| ---- | ------ | --------------------------------------------------- |
| W0   | 3.50   | Sem mudança                                         |
| W1   | 3.75   | Fix: registrar 5 timers soltos no timer-registry    |
| W2   | 3.75   | DI Container gerencia lifecycle (auto-dispose)      |
| W3   | 4.00   | Event bus centraliza emit → MaxListeners controlado |

---

## 3. Novos Critérios (C14–C17): Preparação para Upgrades Vastos

### C14 — Preparação Multi-Agent

**Score**: 1.50/4 🔴

| Sub  | Critério                          | Score | Evidência                                        |
| ---- | --------------------------------- | ----- | ------------------------------------------------ |
| 14.1 | Agent como processo isolável      | 2.0/4 | agent/ é importável, mas usa singletons globais  |
| 14.2 | Comunicação inter-agent via bus   | 0.5/4 | EventEmitter direto, sem message bus formal      |
| 14.3 | Session scoped (não global)       | 2.0/4 | Session manager existe, mas state é module-level |
| 14.4 | Fork de contexto sem side effects | 1.5/4 | 30 singletons impedem fork limpo                 |

> Multi-agent requer que cada agent instância tenha estado isolado. Atualmente, o module-level `let`
> pattern impede instanciação paralela.

**Projeção**: 1.50 → 3.50 após Wave 2 (DI Container com fork/dispose).

---

### C15 — Preparação Plugin Architecture

**Score**: 1.75/4 🔴

| Sub  | Critério                       | Score | Evidência                                               |
| ---- | ------------------------------ | ----- | ------------------------------------------------------- |
| 15.1 | Plugin lifecycle (load/unload) | 0.5/4 | Inexiste                                                |
| 15.2 | Plugin registry formal         | 2.0/4 | tools/registry-like mas sem interface genérica          |
| 15.3 | Extension points documentados  | 2.0/4 | tools + bridges + hooks, mas sem contrato formal        |
| 15.4 | Sandbox/isolation per plugin   | 2.5/4 | Módulos são isoláveis via import, mas sem runtime fence |

**Projeção**: 1.75 → 3.75 após Wave 3 (FN: plugin registry + autodiscovery).

---

### C16 — Preparação TypeScript Migration

**Score**: 2.75/4 ⚠️

| Sub  | Critério                     | Score | Evidência                                          |
| ---- | ---------------------------- | ----- | -------------------------------------------------- |
| 16.1 | JSDoc types em todas exports | 3.0/4 | ~80% cobertura estimada; 40+ typedefs em sdk/types |
| 16.2 | tsconfig.json configurado    | 3.5/4 | tsconfig.node.json com strict mode; 0 erros        |
| 16.3 | @ts-check em arquivos core   | 2.5/4 | Parcial; muitos arquivos sem @ts-check             |
| 16.4 | .d.ts declarations emit      | 2.0/4 | tsconfig.declarations.json existe, mas com erros   |

> O caminho de menor atrito é JSDoc-first → declarations → gradual .ts conversion. O sistema é
> tipável (0 erros tsserver), mas @ts-check não está universalizado.

**Projeção**: 2.75 → 3.75 após Wave 2 (Shared types L0 + barrel-only simplifica declarations).

---

### C17 — Preparação Observability-First

**Score**: 2.50/4 ⚠️

| Sub  | Critério                       | Score | Evidência                                           |
| ---- | ------------------------------ | ----- | --------------------------------------------------- |
| 17.1 | Structured logging (JSON)      | 2.5/4 | logger.js suporta, mas nem todos os call sites usam |
| 17.2 | Metrics collection padronizado | 3.0/4 | collectors/ pattern ✅                              |
| 17.3 | Trace/Span propagation         | 1.5/4 | session_id propagado, mas sem span tree formal      |
| 17.4 | Health check endpoints         | 3.5/4 | api/express/ tem routes, mas sem liveness/readiness |

> Para horizontal scaling e API federation, observability precisa de distributed tracing
> (OpenTelemetry).

**Projeção**: 2.50 → 3.75 após Wave 3 (Event bus + OpenTelemetry integration).

---

## 4. Resumo Comparativo Expandido

| #   | Critério                  | v1.0 (PARTE-20) | v1.0 (Pós-20) | v2.0 (Revisitado) | Target W3 |
| --- | ------------------------- | --------------- | ------------- | ----------------- | --------- |
| C1  | SRM                       | 1.50            | 4.00          | **3.25**          | 4.00      |
| C2  | Hierarquia de Camadas     | 0.50            | 2.50          | **2.25**          | 4.00      |
| C3  | Interfaces                | 2.00            | 4.00          | **2.75**          | 4.00      |
| C4  | DI                        | 1.50            | 3.50          | **2.75**          | 4.00      |
| C5  | Tamanho/Coesão            | 0.50            | 3.00          | **2.25**          | 4.00      |
| C6  | DRY                       | 3.00            | 4.00          | **3.50**          | 4.00      |
| C7  | Nomenclatura              | 2.50            | 4.00          | **3.75**          | 4.00      |
| C8  | Expansibilidade           | 4.00            | 4.00          | **3.50**          | 4.00      |
| C9  | Auditabilidade            | 4.00            | 4.00          | **3.75**          | 4.00      |
| C10 | Isolamento Infraestrutura | 3.50            | 3.50          | **3.25**          | 4.00      |
| C11 | Testabilidade             | 1.00            | 2.50          | **2.00**          | 3.75      |
| C12 | Zero Artefatos Runtime    | 4.00            | 4.00          | **4.00**          | 4.00      |
| C13 | Performance/Safety        | 3.50            | 4.00          | **3.50**          | 4.00      |
| C14 | Multi-Agent Ready         | —               | —             | **1.50**          | 3.50      |
| C15 | Plugin Architecture       | —               | —             | **1.75**          | 3.75      |
| C16 | TypeScript Migration      | —               | —             | **2.75**          | 3.75      |
| C17 | Observability-First       | —               | —             | **2.50**          | 3.75      |
|     | **Total (C1-C13)**        | **32.00/52**    | **47.00/52**  | **40.50/52**      | **51.75** |
|     | **Total (C1-C17)**        | —               | —             | **50.00/68**      | **66.50** |
|     | **% (C1-C13)**            | 61.5%           | 90.4%         | **77.9%**         | **99.5%** |
|     | **% (C1-C17)**            | —               | —             | **73.5%**         | **97.8%** |

### 4.1 Explicação da Diferença v1.0 → v2.0

A v1.0 reportava 47.0/52 (91%). A v2.0 reporta 40.5/52 (78%). A diferença **não** é regressão — é
**rigor aumentado**:

| Critério | v1.0 → v2.0 | Motivo da redução                                            |
| -------- | ----------- | ------------------------------------------------------------ |
| C1       | 4.0 → 3.25  | agent/ tem 4+ responsabilidades; 25 arquivos >400 LoC        |
| C3       | 4.0 → 2.75  | 233 deep imports = 73% de bypass de barrel                   |
| C4       | 3.5 → 2.75  | 30 singletons crus sem factory; 3 naming patterns            |
| C5       | 3.0 → 2.25  | 25 arquivos >400 LoC (antes contados como 9 >300)            |
| C6       | 4.0 → 3.50  | 134 deep imports de logger = duplicação de import pattern    |
| C7       | 4.0 → 3.75  | hooks/lib/ e terminal/handlers/ genéricos demais             |
| C8       | 4.0 → 3.50  | Sem plugin interface, sem hook priorities, sem autodiscovery |
| C9       | 4.0 → 3.75  | Ring buffer sem persistence cross-restart                    |
| C10      | 3.5 → 3.25  | mcp-tool-bridge 415 LoC = candidato split                    |
| C13      | 4.0 → 3.50  | 5 setTimeout soltos; 2 streams sem error handler             |

> A v2.0 é um "honest assessment" — revela o trabalho real necessário para os vastos upgrades.

---

## 5. Evolução Global (Visualização)

```
PARTE-20 (pré-roadmap):  32.0/52  (62%)  ███████████░░░░░░░░░
v1.0 (pós-roadmap):      47.0/52  (90%)  ██████████████████░░
v2.0 (honest assess):    40.5/52  (78%)  ████████████████░░░░
Target W0:               43.0/52  (83%)  ████████████████░░░░
Target W1:               46.0/52  (88%)  █████████████████░░░
Target W2:               49.5/52  (95%)  ███████████████████░
Target W3 (C1-C13):      51.75/52 (100%) ████████████████████

Com C14-C17 (vastos upgrades):
v2.0 atual:              50.0/68  (74%)  ██████████████░░░░░░
Target W3 (C1-C17):      66.5/68  (98%)  ████████████████████
```

---

## 6. Mapa de Ações por Wave

| Wave | Critérios impactados      | Score delta (C1-C17) | Subfases principais             |
| ---- | ------------------------- | -------------------- | ------------------------------- |
| W0   | C2, C10, C11              | +4.25                | Fix CI, fix violações, tests    |
| W1   | C1, C3, C5, C6, C7        | +6.25                | Barrels, justificativas, rename |
| W2   | C4, C5, C8, C14, C15, C16 | +8.50                | DI Container, splits, types     |
| W3   | C9, C13, C14, C15, C17    | +7.50                | Event bus, plugins, OTel        |

---

## 7. Conclusão

A avaliação v2.0 com rigor aumentado revela que o sistema está a **78% (C1-C13)** ou **74%
(C1-C17)** do ideal — significativamente abaixo do que a v1.0 otimista reportava (91%).

Os **5 critérios mais distantes do ideal** são:

1. **C11 Testabilidade** (2.00/4) — zero testes de comportamento
2. **C14 Multi-Agent** (1.50/4) — singletons impedem fork
3. **C15 Plugin Architecture** (1.75/4) — sem lifecycle/registry formal
4. **C5 Tamanho/Coesão** (2.25/4) — 25 arquivos >400 LoC
5. **C2 Hierarquia** (2.25/4) — CI gate com regex incompleto

O roadmap PARTE-21C (Faixas H-N, 153 subfases, 4 Waves) endereça sistematicamente cada gap, com
projeção para **99.5% (C1-C13)** e **97.8% (C1-C17)** ao fim da Wave 3.
