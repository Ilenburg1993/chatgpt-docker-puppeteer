# 🧪 Matriz de Cobertura Completa de Testes

**Data**: 2026-01-20 **Objetivo**: Mapear TODOS os módulos do sistema vs. testes necessários para
atingir 80%+ de cobertura **Status Atual**: 14 testes funcionais | 135 arquivos fonte | 3.688 LOC

---

## 📊 Status Atual da Cobertura

```
┌──────────────────────────────────────────────────────────┐
│               COBERTURA ATUAL                            │
├──────────────────────────────────────────────────────────┤
│ ✅ Arquivos testados:         19 / 135  (14%)          │
│ ✅ Testes funcionais:         14 testes                 │
│ ❌ Arquivos sem testes:       116 / 135 (86%)          │
│ 🎯 Meta de cobertura:         80%+                      │
│ 📈 Testes necessários:        ~70-90 novos testes       │
└──────────────────────────────────────────────────────────┘
```

---

## 🏗️ Matriz de Cobertura por Camada Arquitetural

### 1️⃣ CORE (30 arquivos | 17% da base)

| Módulo                      | Arquivos | LOC Est. | Testes Existentes                      | Testes Faltando                        | Prioridade  |
| --------------------------- | -------- | -------- | -------------------------------------- | -------------------------------------- | ----------- |
| **config.js**               | 1        | 180      | ✅ test_config_validation.js (4 tests) | -                                      | ✅ COMPLETO |
| **logger.js**               | 1        | 150      | ❌ Nenhum                              | test_logger_unit.js (5 tests)          | 🔴 CRÍTICO  |
| **identity_manager.js**     | 1        | 120      | ✅ identity_lifecycle.test.js          | -                                      | ✅ COMPLETO |
| **forensics.js**            | 1        | 200      | ❌ Nenhum                              | test_forensics_unit.js (6 tests)       | 🟡 ALTO     |
| **schemas.js** + schemas/   | 6        | 450      | ✅ test_schema (indireto)              | test_schemas_unit.js (8 tests)         | 🟡 ALTO     |
| **context/** (9 arquivos)   | 9        | 600      | ❌ Nenhum                              | test_context_engine_unit.js (10 tests) | 🟠 MÉDIO    |
| **constants/**              | 4        | 100      | ✅ (via import nos testes)             | -                                      | ✅ COMPLETO |
| **doctor.js**               | 1        | 80       | ❌ Nenhum                              | test_doctor_unit.js (4 tests)          | 🟢 BAIXO    |
| **environment_resolver.js** | 1        | 60       | ❌ Nenhum                              | test_env_resolver_unit.js (3 tests)    | 🟢 BAIXO    |
| **memory.js**               | 1        | 100      | ❌ Nenhum                              | test_memory_unit.js (5 tests)          | 🟠 MÉDIO    |
| **i18n.js**                 | 1        | 40       | ❌ Nenhum                              | -                                      | ⚪ SKIP     |
| **infra_failure_policy.js** | 1        | 70       | ❌ Nenhum                              | test_infra_failure_unit.js (4 tests)   | 🟠 MÉDIO    |

**Subtotal CORE**:

- ✅ Cobertura atual: 3/30 arquivos (10%)
- 🎯 Testes novos necessários: **9 suites de teste (47 tests)**

---

### 2️⃣ NERV (22 arquivos | 12% da base)

| Módulo             | Arquivos | LOC Est. | Testes Existentes              | Testes Faltando                         | Prioridade |
| ------------------ | -------- | -------- | ------------------------------ | --------------------------------------- | ---------- |
| **nerv.js** (main) | 1        | 200      | ✅ test_driver_nerv (indireto) | test_nerv_core_unit.js (8 tests)        | 🔴 CRÍTICO |
| **buffers/**       | 3        | 250      | ❌ Nenhum                      | test_nerv_buffers_unit.js (10 tests)    | 🔴 CRÍTICO |
| **emission/**      | 3        | 180      | ❌ Nenhum                      | test_nerv_emission_unit.js (6 tests)    | 🟡 ALTO    |
| **reception/**     | 3        | 180      | ❌ Nenhum                      | test_nerv_reception_unit.js (6 tests)   | 🟡 ALTO    |
| **correlation/**   | 3        | 200      | ❌ Nenhum                      | test_nerv_correlation_unit.js (7 tests) | 🟡 ALTO    |
| **transport/**     | 3        | 150      | ❌ Nenhum                      | test_nerv_transport_unit.js (5 tests)   | 🟠 MÉDIO   |
| **telemetry/**     | 3        | 120      | ❌ Nenhum                      | test_nerv_telemetry_unit.js (4 tests)   | 🟠 MÉDIO   |
| **health/**        | 3        | 100      | ✅ test_health_endpoint.js     | test_nerv_health_unit.js (3 tests)      | 🟢 BAIXO   |

**Subtotal NERV**:

- ✅ Cobertura atual: 2/22 arquivos (9%)
- 🎯 Testes novos necessários: **7 suites de teste (49 tests)**

---

### 3️⃣ KERNEL (13 arquivos | 7% da base)

| Módulo                  | Arquivos | LOC Est. | Testes Existentes                      | Testes Faltando                           | Prioridade |
| ----------------------- | -------- | -------- | -------------------------------------- | ----------------------------------------- | ---------- |
| **kernel.js** (factory) | 1        | 250      | ✅ test_ariadne_thread.js              | test_kernel_factory_unit.js (5 tests)     | 🟡 ALTO    |
| **execution_engine/**   | 1        | 400      | ❌ Nenhum                              | test_execution_engine_unit.js (12 tests)  | 🔴 CRÍTICO |
| **kernel_loop/**        | 1        | 200      | ✅ test_boot_sequence.js               | test_kernel_loop_unit.js (8 tests)        | 🟡 ALTO    |
| **task_runtime/**       | 1        | 350      | ✅ test_running_recovery.js (quebrado) | test_task_runtime_unit.js (10 tests)      | 🔴 CRÍTICO |
| **observation_store/**  | 1        | 180      | ❌ Nenhum                              | test_observation_store_unit.js (7 tests)  | 🟡 ALTO    |
| **policy_engine/**      | 1        | 200      | ❌ Nenhum                              | test_policy_engine_unit.js (9 tests)      | 🔴 CRÍTICO |
| **nerv_bridge/**        | 1        | 150      | ✅ test_driver_nerv (indireto)         | test_kernel_nerv_bridge_unit.js (6 tests) | 🟠 MÉDIO   |
| **telemetry/**          | 1        | 100      | ❌ Nenhum                              | test_kernel_telemetry_unit.js (4 tests)   | 🟠 MÉDIO   |
| **state/**              | 2        | 120      | ❌ Nenhum                              | test_kernel_state_unit.js (5 tests)       | 🟠 MÉDIO   |
| **policies/**           | 1        | 80       | ❌ Nenhum                              | test_policies_unit.js (4 tests)           | 🟢 BAIXO   |
| **adapters/**           | 1        | 60       | ❌ Nenhum                              | -                                         | ⚪ SKIP    |
| **example/**            | 1        | 50       | ❌ Nenhum                              | -                                         | ⚪ SKIP    |

**Subtotal KERNEL**:

- ✅ Cobertura atual: 3/13 arquivos (23%)
- 🎯 Testes novos necessários: **9 suites de teste (70 tests)**

---

### 4️⃣ DRIVER (17 arquivos | 10% da base)

| Módulo                        | Arquivos | LOC Est. | Testes Existentes             | Testes Faltando                               | Prioridade  |
| ----------------------------- | -------- | -------- | ----------------------------- | --------------------------------------------- | ----------- |
| **factory.js**                | 1        | 150      | ❌ Nenhum                     | test_driver_factory_unit.js (8 tests)         | 🔴 CRÍTICO  |
| **DriverLifecycleManager.js** | 1        | 200      | ❌ Nenhum                     | test_driver_lifecycle_unit.js (10 tests)      | 🔴 CRÍTICO  |
| **core/BaseDriver.js**        | 1        | 250      | ✅ test_driver_nerv (parcial) | test_base_driver_unit.js (8 tests)            | 🟡 ALTO     |
| **core/TargetDriver.js**      | 1        | 180      | ❌ Nenhum                     | test_target_driver_unit.js (6 tests)          | 🟡 ALTO     |
| **targets/ChatGPTDriver.js**  | 1        | 600      | ❌ Nenhum                     | test_chatgpt_driver_integration.js (15 tests) | 🔴 CRÍTICO  |
| **targets/GeminiDriver.js**   | 1        | 500      | ❌ Nenhum                     | test_gemini_driver_integration.js (12 tests)  | 🟡 ALTO     |
| **targets/ClaudeDriver.js**   | 1        | 450      | ❌ Nenhum                     | test_claude_driver_integration.js (10 tests)  | 🟠 MÉDIO    |
| **modules/** (8 arquivos)     | 8        | 800      | ❌ Nenhum                     | test_driver_modules_unit.js (12 tests)        | 🟡 ALTO     |
| **nerv_adapter/**             | 2        | 150      | ✅ test_driver_nerv (8 tests) | -                                             | ✅ COMPLETO |

**Subtotal DRIVER**:

- ✅ Cobertura atual: 2/17 arquivos (12%)
- 🎯 Testes novos necessários: **8 suites de teste (81 tests)**

---

### 5️⃣ INFRA (22 arquivos | 12% da base)

| Módulo            | Arquivos | LOC Est. | Testes Existentes          | Testes Faltando                          | Prioridade  |
| ----------------- | -------- | -------- | -------------------------- | ---------------------------------------- | ----------- |
| **io.js**         | 1        | 250      | ❌ Nenhum                  | test_io_unit.js (8 tests)                | 🔴 CRÍTICO  |
| **browser_pool/** | 3        | 400      | ✅ test_browser_pool.js    | test_connection_orchestrator (já existe) | ✅ COMPLETO |
| **locks/**        | 3        | 300      | ✅ test_lock.js (quebrado) | test_lock_manager_unit.js (10 tests)     | 🔴 CRÍTICO  |
| **queue/**        | 4        | 450      | ❌ Nenhum                  | test_queue_unit.js (12 tests)            | 🔴 CRÍTICO  |
| **storage/**      | 3        | 250      | ❌ Nenhum                  | test_storage_unit.js (9 tests)           | 🟡 ALTO     |
| **fs/**           | 5        | 350      | ❌ Nenhum                  | test_fs_unit.js (10 tests)               | 🟡 ALTO     |
| **ipc/**          | 2        | 120      | ❌ Nenhum (obsoleto)       | test_ipc_unit.js (6 tests)               | 🟠 MÉDIO    |
| **transport/**    | 1        | 80       | ❌ Nenhum                  | test_transport_unit.js (4 tests)         | 🟢 BAIXO    |

**Subtotal INFRA**:

- ✅ Cobertura atual: 2/22 arquivos (9%)
- 🎯 Testes novos necessários: **7 suites de teste (59 tests)**

---

### 6️⃣ SERVER (20 arquivos | 11% da base)

| Módulo                    | Arquivos | LOC Est. | Testes Existentes                    | Testes Faltando                            | Prioridade |
| ------------------------- | -------- | -------- | ------------------------------------ | ------------------------------------------ | ---------- |
| **main.js**               | 1        | 200      | ✅ test_health_endpoint.js (parcial) | test_server_main_integration.js (8 tests)  | 🟡 ALTO    |
| **api/** (5 routes)       | 5        | 400      | ❌ Nenhum                            | test_api_routes_integration.js (15 tests)  | 🔴 CRÍTICO |
| **engine/**               | 3        | 250      | ❌ Nenhum                            | test_server_engine_unit.js (8 tests)       | 🟡 ALTO    |
| **middleware/**           | 3        | 150      | ❌ Nenhum                            | test_middleware_unit.js (6 tests)          | 🟠 MÉDIO   |
| **realtime/** (Socket.io) | 3        | 200      | ❌ Nenhum                            | test_realtime_integration.js (10 tests)    | 🟡 ALTO    |
| **supervisor/**           | 2        | 120      | ❌ Nenhum                            | test_supervisor_unit.js (5 tests)          | 🟠 MÉDIO   |
| **watchers/**             | 2        | 100      | ❌ Nenhum                            | test_watchers_unit.js (4 tests)            | 🟢 BAIXO   |
| **nerv_adapter/**         | 1        | 80       | ❌ Nenhum                            | test_server_nerv_adapter_unit.js (4 tests) | 🟠 MÉDIO   |

**Subtotal SERVER**:

- ✅ Cobertura atual: 1/20 arquivos (5%)
- 🎯 Testes novos necessários: **8 suites de teste (60 tests)**

---

### 7️⃣ STATE (11 arquivos | 6% da base)

| Módulo         | Arquivos | LOC Est. | Testes Existentes | Testes Faltando                        | Prioridade |
| -------------- | -------- | -------- | ----------------- | -------------------------------------- | ---------- |
| **kernel/**    | 3        | 150      | ❌ Nenhum         | test_state_kernel_unit.js (6 tests)    | 🟠 MÉDIO   |
| **memory/**    | 3        | 120      | ❌ Nenhum         | test_state_memory_unit.js (5 tests)    | 🟠 MÉDIO   |
| **tasks/**     | 3        | 180      | ❌ Nenhum         | test_state_tasks_unit.js (7 tests)     | 🟡 ALTO    |
| **workflows/** | 2        | 100      | ❌ Nenhum         | test_state_workflows_unit.js (4 tests) | 🟢 BAIXO   |

**Subtotal STATE**:

- ✅ Cobertura atual: 0/11 arquivos (0%)
- 🎯 Testes novos necessários: **4 suites de teste (22 tests)**

---

### 8️⃣ LOGIC (5 arquivos | 3% da base)

| Módulo          | Arquivos | LOC Est. | Testes Existentes | Testes Faltando                          | Prioridade |
| --------------- | -------- | -------- | ----------------- | ---------------------------------------- | ---------- |
| **validation/** | 5        | 250      | ❌ Nenhum         | test_validation_logic_unit.js (10 tests) | 🟡 ALTO    |

**Subtotal LOGIC**:

- ✅ Cobertura atual: 0/5 arquivos (0%)
- 🎯 Testes novos necessários: **1 suite de teste (10 tests)**

---

### 9️⃣ OUTROS (15 arquivos | 8% da base)

| Módulo                    | Arquivos | LOC Est. | Testes Existentes         | Testes Faltando                       | Prioridade  |
| ------------------------- | -------- | -------- | ------------------------- | ------------------------------------- | ----------- |
| **scripts/** (18 scripts) | 18       | 800      | ❌ Nenhum                 | test_scripts_integration.js (8 tests) | 🟢 BAIXO    |
| **shared/nerv/**          | 2        | 80       | ❌ Nenhum                 | test_shared_nerv_unit.js (4 tests)    | 🟠 MÉDIO    |
| **index.js** (main entry) | 1        | 150      | ✅ test_ariadne_thread.js | -                                     | ✅ COMPLETO |

**Subtotal OUTROS**:

- ✅ Cobertura atual: 1/21 arquivos (5%)
- 🎯 Testes novos necessários: **2 suites de teste (12 tests)**

---

## 📈 Resumo Executivo de Gaps

```
┌─────────────────────────────────────────────────────────────────┐
│                  GAPS DE COBERTURA POR PRIORIDADE               │
├─────────────────────────────────────────────────────────────────┤
│ 🔴 CRÍTICO (bloqueia produção):      18 suites | 156 tests     │
│ 🟡 ALTO (risco moderado):            15 suites | 128 tests     │
│ 🟠 MÉDIO (pode esperar):             12 suites |  68 tests     │
│ 🟢 BAIXO (opcional):                  6 suites |  33 tests     │
├─────────────────────────────────────────────────────────────────┤
│ 🎯 TOTAL NECESSÁRIO:                 51 suites | 385 tests     │
│ ✅ JÁ EXISTEM:                       14 testes funcionais       │
│ 📊 META FINAL:                       ~65 suites | 400 tests    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Plano de Implementação Sugerido

### FASE 1: Fundação Crítica (Prioridade 🔴 - 2 semanas)

**Objetivo**: Testar componentes core que bloqueiam produção

#### Semana 1: KERNEL + INFRA

1. ✅ **test_execution_engine_unit.js** (12 tests)
   - Decisões de execução
   - Propostas de ação
   - Integração com PolicyEngine
   - Cenários de falha

2. ✅ **test_task_runtime_unit.js** (10 tests)
   - Lifecycle completo de tarefas
   - Transições de estado
   - Histórico imutável
   - Snapshots thread-safe

3. ✅ **test_policy_engine_unit.js** (9 tests)
   - Avaliação de políticas
   - Limites de segurança
   - Retries e timeouts
   - Alertas

4. ✅ **test_queue_unit.js** (12 tests)
   - Cache de fila
   - Task loader
   - Query engine
   - Atomic operations

5. ✅ **test_lock_manager_unit.js** (10 tests)
   - Two-phase commit
   - PID validation
   - Zombie detection
   - Concurrent access

6. ✅ **test_io_unit.js** (8 tests)
   - saveTask/deleteTask
   - Cache invalidation (fix P5.2)
   - Atomic writes
   - Error handling

#### Semana 2: DRIVER + NERV

7. ✅ **test_driver_factory_unit.js** (8 tests)
   - Instanciação de drivers
   - Cache de drivers
   - Target validation
   - Error handling

8. ✅ **test_driver_lifecycle_unit.js** (10 tests)
   - Lifecycle manager
   - Execute task flow
   - Interrupt handling
   - Telemetry integration

9. ✅ **test_chatgpt_driver_integration.js** (15 tests)
   - DOM analysis
   - Input resolution
   - Submission flow
   - Response collection
   - Error recovery

10. ✅ **test_nerv_core_unit.js** (8 tests)
    - Event emission
    - Event reception
    - Buffer management
    - Transport layer

11. ✅ **test_nerv_buffers_unit.js** (10 tests)
    - Event queue overflow
    - Priority handling
    - Buffer flush
    - Memory management

12. ✅ **test_logger_unit.js** (5 tests)
    - Severity levels
    - Structured logging
    - File rotation
    - Error handling

**Total Fase 1**: 12 suites | **117 tests** | ~80 horas

---

### FASE 2: Integração Alta Prioridade (Prioridade 🟡 - 2 semanas)

**Objetivo**: Testar integrações entre componentes

#### Semana 3: API + Storage

13. ✅ **test_api_routes_integration.js** (15 tests)
    - CRUD de tarefas
    - Health endpoint
    - Status endpoint
    - Error responses

14. ✅ **test_storage_unit.js** (9 tests)
    - Task store
    - Response store
    - DNA store
    - Persistence

15. ✅ **test_fs_unit.js** (10 tests)
    - Safe read/write
    - Atomic operations
    - Control store
    - Path resolution

16. ✅ **test_observation_store_unit.js** (7 tests)
    - Event registration
    - Factual tracking
    - Query interface
    - Retention policy

17. ✅ **test_kernel_loop_unit.js** (8 tests)
    - Adaptive polling
    - Cycle control
    - Pause/resume
    - Shutdown

18. ✅ **test_base_driver_unit.js** (8 tests)
    - Driver interface
    - Common methods
    - Error handling
    - Telemetry

#### Semana 4: NERV + State

19. ✅ **test_nerv_emission_unit.js** (6 tests)
    - Emit events
    - Correlation
    - Telemetry
    - Error handling

20. ✅ **test_nerv_reception_unit.js** (6 tests)
    - Receive events
    - Dispatch
    - Handler registration
    - Error handling

21. ✅ **test_nerv_correlation_unit.js** (7 tests)
    - Message correlation
    - Request/response matching
    - Timeout handling
    - Cleanup

22. ✅ **test_state_tasks_unit.js** (7 tests)
    - Task state management
    - State persistence
    - State queries
    - State transitions

23. ✅ **test_validation_logic_unit.js** (10 tests)
    - Input validation
    - Semantic validation
    - Post-response validation
    - Error messages

24. ✅ **test_server_main_integration.js** (8 tests)
    - Server startup
    - Graceful shutdown
    - Health checks
    - Error handling

25. ✅ **test_realtime_integration.js** (10 tests)
    - Socket.io connections
    - Event streams
    - Broadcasts
    - Disconnects

**Total Fase 2**: 13 suites | **111 tests** | ~80 horas

---

### FASE 3: Cobertura Média Prioridade (Prioridade 🟠 - 1 semana)

**Objetivo**: Fechar gaps restantes de prioridade média

26. ✅ **test_context_engine_unit.js** (10 tests)
27. ✅ **test_memory_unit.js** (5 tests)
28. ✅ **test_infra_failure_unit.js** (4 tests)
29. ✅ **test_nerv_transport_unit.js** (5 tests)
30. ✅ **test_nerv_telemetry_unit.js** (4 tests)
31. ✅ **test_kernel_nerv_bridge_unit.js** (6 tests)
32. ✅ **test_kernel_telemetry_unit.js** (4 tests)
33. ✅ **test_kernel_state_unit.js** (5 tests)
34. ✅ **test_server_engine_unit.js** (8 tests)
35. ✅ **test_middleware_unit.js** (6 tests)
36. ✅ **test_supervisor_unit.js** (5 tests)
37. ✅ **test_server_nerv_adapter_unit.js** (4 tests)
38. ✅ **test_state_kernel_unit.js** (6 tests)
39. ✅ **test_state_memory_unit.js** (5 tests)
40. ✅ **test_ipc_unit.js** (6 tests)
41. ✅ **test_shared_nerv_unit.js** (4 tests)

**Total Fase 3**: 16 suites | **87 tests** | ~40 horas

---

### FASE 4: Cobertura Baixa Prioridade (Prioridade 🟢 - Opcional)

**Objetivo**: Completar para 80%+ cobertura

42. ✅ **test_doctor_unit.js** (4 tests)
43. ✅ **test_env_resolver_unit.js** (3 tests)
44. ✅ **test_nerv_health_unit.js** (3 tests)
45. ✅ **test_transport_unit.js** (4 tests)
46. ✅ **test_watchers_unit.js** (4 tests)
47. ✅ **test_state_workflows_unit.js** (4 tests)
48. ✅ **test_policies_unit.js** (4 tests)
49. ✅ **test_scripts_integration.js** (8 tests)

**Total Fase 4**: 8 suites | **34 tests** | ~20 horas

---

## 🎯 Roadmap Consolidado

```
FASE 1 (🔴 Crítico)    - Semanas 1-2  - 12 suites | 117 tests | 80h
FASE 2 (🟡 Alto)       - Semanas 3-4  - 13 suites | 111 tests | 80h
FASE 3 (🟠 Médio)      - Semana 5     - 16 suites |  87 tests | 40h
FASE 4 (🟢 Baixo)      - Opcional     -  8 suites |  34 tests | 20h
───────────────────────────────────────────────────────────────────
TOTAL                  - 5 semanas    - 49 suites | 349 tests | 220h
```

**Estimativa**: 1 desenvolvedor a tempo completo = 5-6 semanas **Meta**: 80%+ cobertura de linhas |
90%+ cobertura de branches críticas

---

## 📝 Template de Teste Padrão

```javascript
/**
 * Teste Unitário: [Nome do Módulo]
 * Arquivo: tests/unit/[categoria]/test_[modulo]_unit.js
 * Cobertura: [Módulo Path]
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const [ModuleName] = require('../../../src/[path]/[module]');

describe('[ModuleName] - Unit Tests', () => {
  let instance;

  beforeEach(() => {
    // Setup
    instance = new [ModuleName]({
      /* deps */
    });
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Constructor', () => {
    it('should initialize with valid config', () => {
      assert.ok(instance);
    });

    it('should throw on missing required params', () => {
      assert.throws(() => new [ModuleName]());
    });
  });

  describe('[Method Name]', () => {
    it('should [behavior] when [condition]', async () => {
      const result = await instance.method();
      assert.strictEqual(result, expectedValue);
    });

    it('should handle errors gracefully', async () => {
      await assert.rejects(() => instance.methodThatFails(), { message: /expected error/ });
    });
  });
});
```

---

## 🔧 Convenções de Teste

### Estrutura de Diretórios

```
tests/
├── unit/                      # Testes unitários (isolados, sem I/O)
│   ├── core/                  # Testes do CORE
│   ├── kernel/                # Testes do KERNEL
│   ├── nerv/                  # Testes do NERV
│   ├── driver/                # Testes do DRIVER
│   ├── infra/                 # Testes da INFRA
│   ├── server/                # Testes do SERVER
│   ├── state/                 # Testes do STATE
│   └── logic/                 # Testes da LOGIC
├── integration/               # Testes de integração (cross-component)
│   ├── api/                   # Testes de API
│   ├── driver/                # Testes de drivers completos
│   ├── queue/                 # Testes de fila end-to-end
│   └── realtime/              # Testes Socket.io
├── e2e/                       # Testes end-to-end (full stack)
│   ├── task_flow/             # Fluxo completo de tarefa
│   └── boot_sequence/         # Sequência de boot
├── fixtures/                  # Dados de teste
│   ├── tasks/                 # Tasks mockadas
│   ├── responses/             # Responses mockadas
│   └── config/                # Configs de teste
└── helpers.js                 # Utilidades compartilhadas
```

### Naming Conventions

- **Unit Tests**: `test_[module]_unit.js`
- **Integration Tests**: `test_[feature]_integration.js`
- **E2E Tests**: `test_[flow]_e2e.js`
- **Fixtures**: `[entity]_[scenario].json`

### Princípios

1. **Isolamento**: Unit tests não dependem de I/O ou estado externo
2. **Determinismo**: Testes devem passar 100% do tempo
3. **Velocidade**: Unit tests < 100ms, Integration < 1s, E2E < 10s
4. **Clareza**: Nomes descritivos, 1 assertion por test quando possível
5. **Cobertura**: Testar paths críticos + edge cases + error handling

---

## 📊 Métricas de Sucesso

### Cobertura de Código

- **Linhas**: ≥80%
- **Branches**: ≥75%
- **Funções**: ≥85%
- **Statements**: ≥80%

### Qualidade de Testes

- **Tempo de execução**: Unit < 5min, Integration < 10min, E2E < 15min
- **Taxa de falso positivo**: <1%
- **Taxa de falso negativo**: <0.1%
- **Flakiness**: 0 testes instáveis

### CI/CD

- **Green builds**: ≥95%
- **Build time**: <15min total
- **Coverage trend**: +5% por mês até meta

---

## 🚀 Próximos Passos Imediatos

### 1. Preparação (Hoje - 1h)

- [ ] Revisar esta matriz com o time
- [ ] Definir prioridades específicas
- [ ] Configurar estrutura de diretórios `tests/unit/`
- [ ] Criar template de teste padrão

### 2. Setup Tooling (Hoje - 2h)

- [ ] Instalar ferramentas de teste (c8, nyc)
- [ ] Configurar npm scripts (`test:coverage`, `test:unit`, `test:integration`)
- [ ] Setup CI/CD para rodar testes automaticamente
- [ ] Criar fixtures básicas

### 3. Implementação FASE 1 (Semanas 1-2)

- [ ] Começar pelos 12 testes críticos (🔴)
- [ ] 1-2 suites de teste por dia
- [ ] Code review obrigatório
- [ ] Atualizar matriz conforme progresso

---

**Status**: ✅ Matriz completa criada **Próxima ação**: Revisar com equipe e começar FASE 1
**Responsável**: [A definir] **Deadline**: [A definir]
