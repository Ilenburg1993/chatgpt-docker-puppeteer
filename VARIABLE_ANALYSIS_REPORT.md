# 📊 Relatório de Análise de Variáveis e Constantes

**Projeto:** chatgpt-docker-puppeteer **Data:** 2026-02-21 **Versão do Script:** 1.0.0

---

## 📈 Sumário Executivo

| Métrica                        | Valor |
| ------------------------------ | ----- |
| **Arquivos Analisados**        | 359   |
| **Variáveis Globais Públicas** | 11    |
| **Variáveis Globais Privadas** | 7     |
| **Variáveis Locais**           | 7782  |
| **Constantes Identificadas**   | 16    |
| **Problemas Encontrados**      | 1033  |

### Distribuição por Tipo

| Tipo      | Quantidade |
| --------- | ---------- |
| unknown   | 5795       |
| undefined | 346        |
| instance  | 335        |
| array     | 319        |
| null      | 259        |
| string    | 194        |
| boolean   | 191        |
| number    | 183        |
| function  | 105        |
| object    | 73         |

---

## 🌍 Variáveis Globais Públicas (exportadas)

> Variáveis acessíveis de outros módulos

| Nome                   | Tipo    | Valor Inicial                     | Escopo        | Arquivo             | Linha |
| ---------------------- | ------- | --------------------------------- | ------------- | ------------------- | ----- |
| `SERVER_AUTHORITIES`   | unknown | `Object.freeze({`                 | global-public | authority.js        | 12    |
| `CONNECTION_MODES`     | unknown | `{`                               | global-public | browser.js          | 16    |
| `LOG_CATEGORIES`       | unknown | `{`                               | global-public | logging.js          | 16    |
| `TASK_STATES`          | unknown | `{`                               | global-public | tasks.js            | 15    |
| `GLOBAL_CONTEXT_LIMIT` | unknown | `500000; // 500k caracteres teto` | global-public | budget_manager.js   | 8     |
| `MAX_RECURSION_DEPTH`  | number  | `3`                               | global-public | guardrails.js       | 9     |
| `MIGRATIONS`           | unknown | `[`                               | global-public | migrations.js       | 14    |
| `DecisionKind`         | unknown | `Object.freeze({`                 | global-public | execution_engine.js | 27    |
| `KernelLoopState`      | unknown | `Object.freeze({`                 | global-public | kernel_loop.js      | 28    |
| `PolicyLevel`          | unknown | `Object.freeze({`                 | global-public | policy_engine.js    | 33    |
| `PROTOCOL_VERSION`     | string  | `'2.0.0'`                         | global-public | constants.js        | 23    |

---

## 🔒 Variáveis Globais Privadas

> Variáveis acessíveis apenas no módulo onde foram declaradas

### shared.js

| Nome            | Tipo    | Valor | Linha |
| --------------- | ------- | ----- | ----- |
| `SHARED_STATUS` | unknown | `{`   | 17    |

### metadata.js

| Nome             | Tipo    | Valor | Linha |
| ---------------- | ------- | ----- | ----- |
| `METADATA_TYPES` | unknown | `{`   | 12    |

### jwt_config.js

| Nome            | Tipo | Valor  | Linha |
| --------------- | ---- | ------ | ----- |
| `_cachedSecret` | null | `null` | 22    |

### dna_evolution.js

| Nome       | Tipo | Valor  | Linha |
| ---------- | ---- | ------ | ----- |
| `dnaStore` | null | `null` | 12    |

### mcp-handler.js

| Nome       | Tipo    | Valor | Linha |
| ---------- | ------- | ----- | ----- |
| `handlers` | unknown | `{`   | 29    |

### test_sadi_migration.js

| Nome       | Tipo    | Valor                                         | Linha |
| ---------- | ------- | --------------------------------------------- | ----- |
| `analyzer` | unknown | `await import('#shared/sadi/analyzer').th...` | 6     |

### teste.js

| Nome     | Tipo    | Valor               | Linha |
| -------- | ------- | ------------------- | ----- |
| `OpenAI` | unknown | `require("openai")` | 19    |

---

## ⚙️ Constantes do Sistema

> Variáveis declaradas com const ou que representam valores fixos

### Timeouts e Números

| Nome                  | Valor                                    | Tipo    | Arquivo                |
| --------------------- | ---------------------------------------- | ------- | ---------------------- |
| `MAX_RECURSION_DEPTH` | `3`                                      | number  | guardrails.js          |
| `analyzer`            | `await import('#shared/sadi/analyzer...` | unknown | test_sadi_migration.js |

### Strings de Texto

| Nome               | Valor     | Tipo   | Arquivo      |
| ------------------ | --------- | ------ | ------------ |
| `PROTOCOL_VERSION` | `'2.0.0'` | string | constants.js |

### Outros

| Nome                   | Valor                             | Tipo    | Arquivo             |
| ---------------------- | --------------------------------- | ------- | ------------------- |
| `SERVER_AUTHORITIES`   | `Object.freeze({`                 | unknown | authority.js        |
| `CONNECTION_MODES`     | `{`                               | unknown | browser.js          |
| `LOG_CATEGORIES`       | `{`                               | unknown | logging.js          |
| `SHARED_STATUS`        | `{`                               | unknown | shared.js           |
| `TASK_STATES`          | `{`                               | unknown | tasks.js            |
| `GLOBAL_CONTEXT_LIMIT` | `500000; // 500k caracteres teto` | unknown | budget_manager.js   |
| `METADATA_TYPES`       | `{`                               | unknown | metadata.js         |
| `MIGRATIONS`           | `[`                               | unknown | migrations.js       |
| `DecisionKind`         | `Object.freeze({`                 | unknown | execution_engine.js |
| `KernelLoopState`      | `Object.freeze({`                 | unknown | kernel_loop.js      |
| `PolicyLevel`          | `Object.freeze({`                 | unknown | policy_engine.js    |
| `handlers`             | `{`                               | unknown | mcp-handler.js      |
| `OpenAI`               | `require("openai")`               | unknown | teste.js            |

---

## 🚨 Problemas Identificados

### ⚠️ Magic Values (Valores Mágicos)

Valores hardcoded que deveriam ser constantes nomeadas:

| Variável                 | Valor | Arquivo                   | Linha |
| ------------------------ | ----- | ------------------------- | ----- |
| `consumed`               | `0`   | budget_manager.js         | 23    |
| `MAX_RECURSION_DEPTH`    | `3`   | guardrails.js             | 9     |
| `_errorCount`            | `0`   | TargetDriver.js           | 201   |
| `validationCount`        | `0`   | DriverReadinessGuard.js   | 60    |
| `continuationCount`      | `0`   | ChatGPTDriver.js          | 95    |
| `thoughtBlocksPruned`    | `0`   | ChatGPTDriver.js          | 96    |
| `continuationCount`      | `0`   | ChatGPTDriver.js          | 294   |
| `thoughtBlocksPruned`    | `0`   | ChatGPTDriver.js          | 295   |
| `turnCount`              | `0`   | PageSessionTracker.js     | 121   |
| `_metricsLastCalculated` | `0`   | PageSessionTracker.js     | 128   |
| `turnCount`              | `0`   | PageSessionTracker.js     | 293   |
| `retryCount`             | `0`   | ConnectionOrchestrator.js | 186   |
| `retryCount`             | `0`   | ConnectionOrchestrator.js | 531   |
| `eventsReceived`         | `0`   | PageLifecycleMonitor.js   | 62    |
| `rebindCount`            | `0`   | PageLifecycleMonitor.js   | 63    |
| `maxHistorySize`         | `10`  | circuit_breaker.js        | 40    |
| `recoveryAttempts`       | `0`   | circuit_breaker.js        | 43    |
| `maxRecoveryAttempts`    | `3`   | circuit_breaker.js        | 44    |
| `recoveryAttempts`       | `0`   | circuit_breaker.js        | 444   |
| `roundRobinIndex`        | `0`   | pool_manager.js           | 33    |

_...e mais 30 valores mágicos_

### 🔄 Variáveis Duplicadas

Nomes usados em múltiplos lugares:

| Nome                      | Ocorrências | Arquivos                                                                 |
| ------------------------- | ----------- | ------------------------------------------------------------------------ |
| `kernel`                  | 7           | agent_loop.js, queue_worker.js, main.js                                  |
| `browserPool`             | 12          | agent_loop.js, task_orchestration_worker.js, boot_resilience_manager.js  |
| `queueWorker`             | 2           | agent_loop.js, main.js                                                   |
| `taskControlWatcher`      | 2           | agent_loop.js, main.js                                                   |
| `missionRunner`           | 2           | agent_loop.js, main.js                                                   |
| `missionPlannerProcessor` | 2           | agent_loop.js, main.js                                                   |
| `attemptWatchdog`         | 2           | agent_loop.js, main.js                                                   |
| `taskOrchestrationWorker` | 2           | agent_loop.js, main.js                                                   |
| `_timer`                  | 28          | agent_loop.js, attempt_watchdog.js, heartbeat_watchdog.js                |
| `_running`                | 25          | agent_loop.js, attempt_watchdog.js, mission_planner_processor.js         |
| `_stopped`                | 25          | agent_loop.js, attempt_watchdog.js, heartbeat_watchdog.js                |
| `now`                     | 71          | agent_loop.js, attempt_watchdog.js, heartbeat_watchdog.js                |
| `nerv`                    | 24          | attempt_watchdog.js, task_control_watcher.js, task_state_projector.js    |
| `intervalMs`              | 10          | attempt_watchdog.js, heartbeat_watchdog.js, mission_planner_processor.js |
| `db`                      | 107         | attempt_watchdog.js, heartbeat_watchdog.js, mission_execution_service.js |

### 📝 let que deveria ser const

Variáveis declaradas com let mas que nunca são modificadas:

| Variável               | Valor                                  | Arquivo                 | Linha |
| ---------------------- | -------------------------------------- | ----------------------- | ----- |
| `total`                | `0`                                    | queue_worker.js         | 85    |
| `text`                 | `''`                                   | queue_worker.js         | 105   |
| `nextStatus`           | `'CANCELLED'`                          | task_state_projector.js | 603   |
| `injectedContent`      | `''`                                   | context_engine.js       | 127   |
| `depth`                | `0`                                    | json_logic.js           | 19    |
| `start`                | `-1`                                   | json_logic.js           | 20    |
| `data`                 | `''`                                   | doctor.js               | 134   |
| `ioLatency`            | `9999`                                 | doctor.js               | 280   |
| `queueStats`           | `{ pending: 0, running: 0, total: 0 }` | doctor.js               | 360   |
| `matchQuality`         | `0`                                    | environment_resolver.js | 37    |
| `idle`                 | `0`                                    | hardware.js             | 70    |
| `total`                | `0`                                    | hardware.js             | 71    |
| `attempts`             | `0`                                    | i18n.js                 | 68    |
| `attempts`             | `0`                                    | BaseDriver.js           | 490   |
| `thoughtBlocksRemoved` | `0`                                    | structured_extractor.js | 100   |

---

## 💡 Recomendações de Refatoração

### 1. Criar ENUMs

Os seguintes valores são usados em múltiplos lugares e devem ser transformados em ENUMs:

**"CLOSED"** - usado 3 vezes:

```javascript
const CLOSED = 'CLOSED';
// ou
enum CLOSED {
  CLOSED = 'CLOSED'
}
```

### 2. Extrair Magic Values

Valores hardcoded devem ser movidos para um arquivo de constantes:

```javascript
// Antes
if (status === 1) { ... }

// Depois
const TaskStatus = { ACTIVE: 1, COMPLETED: 2, FAILED: 3 };
if (status === TaskStatus.ACTIVE) { ... }
```

### 3. Converter let para const

Variáveis que não são reatribuídas devem usar `const`:

- Melhora legibilidade
- Permite otimizações do motor JS
- Evita reassign acidental

### 4. Considerar TypeScript

Os seguintes padrões foram identificados:

- Objetos com estrutura fixa → `interface`
- Funções com tipos específicos → `type annotations`
- Variáveis que aceitam múltiplos tipos → `union types`

### 5. Boas Práticas de Nomenclatura

| Tipo       | Padrão               | Exemplo       |
| ---------- | -------------------- | ------------- |
| Constantes | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| Variáveis  | camelCase            | `userName`    |
| Classes    | PascalCase           | `TaskManager` |
| Booleanos  | Prefixo is/has/can   | `isEnabled`   |
| Funções    | Verb + Noun          | `getUsers()`  |

---
