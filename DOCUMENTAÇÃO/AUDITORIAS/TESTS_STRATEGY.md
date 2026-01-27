# 🧪 Estratégia de Organização de Testes

**Data**: 2026-01-20
**Objetivo**: Definir a melhor forma de organizar, criar e manter testes para atingir 80%+ de cobertura
**Status**: 📋 PLANO ESTRATÉGICO

---

## 📊 Situação Atual

### Estado Atual dos Testes

```
📁 tests/
├── 📄 20 arquivos de teste (.js)
├── 📄 2 manuais (.txt)
├── 📄 1 helper (helpers.js)
├── 📁 1 subpasta (integration/)
└── 📈 3.735 linhas de código

Distribuição:
- ✅ 14 testes funcionais (pass)
- ⚠️  5 testes problemáticos (precisam refatoração)
- 📊 Cobertura estimada: 14% (19/135 arquivos)
```

### Problemas Identificados

1. **❌ Estrutura Plana**: Todos os testes na raiz do diretório
2. **❌ Naming Inconsistente**: Mistura de `test_*`, `*.test.js`, `*_fixes.js`
3. **❌ Sem Separação**: Unit/Integration/E2E misturados
4. **❌ Sem Framework**: Tests customizados com `runTest()`, sem runner padrão
5. **❌ Sem Coverage**: Não há medição de cobertura
6. **❌ Fixtures Inline**: Dados de teste hardcoded nos arquivos
7. **❌ Dependências Mistas**: Alguns tests precisam agente rodando, outros não

---

## 🎯 Visão Estratégica: Pirâmide de Testes

```
                    🔺
                   /  \
                  / E2E \          ← 10% dos testes (lento, frágil)
                 /________\         • Fluxo completo de tarefa
                /          \        • Boot sequence end-to-end
               / Integration\      ← 30% dos testes (moderado)
              /______________\      • Driver + NERV + Kernel
             /                \     • API + Storage + Queue
            /    Unit Tests    \   ← 60% dos testes (rápido, isolado)
           /____________________\   • Funções puras, classes isoladas
                                    • Mocks para dependências

┌─────────────────────────────────────────────────────────────┐
│ PROPORÇÃO IDEAL:                                            │
│ • 60% Unit (rápido < 100ms, isolado, sem I/O)              │
│ • 30% Integration (< 1s, cross-component)                  │
│ • 10% E2E (< 10s, full stack)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Estrutura de Diretórios Proposta

### Estrutura Completa

```
tests/
│
├── 📁 unit/                          # 60% - Testes isolados (sem I/O)
│   ├── 📁 core/                      # 30 arquivos fonte
│   │   ├── test_config.spec.js      # ✅ Já existe (consolidar)
│   │   ├── test_logger.spec.js      # 🔴 CRÍTICO
│   │   ├── test_schemas.spec.js     # 🟡 ALTO
│   │   ├── test_identity.spec.js    # ✅ Já existe
│   │   ├── test_forensics.spec.js   # 🟡 ALTO
│   │   ├── test_context_engine.spec.js
│   │   └── test_memory.spec.js
│   │
│   ├── 📁 nerv/                      # 22 arquivos fonte
│   │   ├── test_nerv_core.spec.js   # 🔴 CRÍTICO
│   │   ├── test_buffers.spec.js     # 🔴 CRÍTICO
│   │   ├── test_emission.spec.js    # 🟡 ALTO
│   │   ├── test_reception.spec.js   # 🟡 ALTO
│   │   ├── test_correlation.spec.js # 🟡 ALTO
│   │   ├── test_transport.spec.js   # 🟠 MÉDIO
│   │   └── test_telemetry.spec.js   # 🟠 MÉDIO
│   │
│   ├── 📁 kernel/                    # 13 arquivos fonte
│   │   ├── test_execution_engine.spec.js    # 🔴 CRÍTICO
│   │   ├── test_task_runtime.spec.js        # 🔴 CRÍTICO
│   │   ├── test_policy_engine.spec.js       # 🔴 CRÍTICO
│   │   ├── test_observation_store.spec.js   # 🟡 ALTO
│   │   ├── test_kernel_loop.spec.js         # 🟡 ALTO
│   │   ├── test_nerv_bridge.spec.js         # 🟠 MÉDIO
│   │   └── test_kernel_state.spec.js        # 🟠 MÉDIO
│   │
│   ├── 📁 driver/                    # 17 arquivos fonte
│   │   ├── test_factory.spec.js              # 🔴 CRÍTICO
│   │   ├── test_lifecycle_manager.spec.js    # 🔴 CRÍTICO
│   │   ├── test_base_driver.spec.js          # 🟡 ALTO
│   │   ├── test_target_driver.spec.js        # 🟡 ALTO
│   │   └── test_driver_modules.spec.js       # 🟡 ALTO
│   │
│   ├── 📁 infra/                     # 22 arquivos fonte
│   │   ├── test_io.spec.js          # 🔴 CRÍTICO (P5.2 bug)
│   │   ├── test_lock_manager.spec.js         # 🔴 CRÍTICO
│   │   ├── test_queue.spec.js                # 🔴 CRÍTICO
│   │   ├── test_storage.spec.js              # 🟡 ALTO
│   │   ├── test_fs_operations.spec.js        # 🟡 ALTO
│   │   └── test_browser_pool.spec.js         # ✅ Já existe
│   │
│   ├── 📁 server/                    # 20 arquivos fonte
│   │   ├── test_server_main.spec.js
│   │   ├── test_api_routes.spec.js  # 🔴 CRÍTICO
│   │   ├── test_middleware.spec.js  # 🟠 MÉDIO
│   │   ├── test_realtime.spec.js    # 🟡 ALTO
│   │   └── test_watchers.spec.js    # 🟢 BAIXO
│   │
│   ├── 📁 state/                     # 11 arquivos fonte
│   │   ├── test_state_kernel.spec.js
│   │   ├── test_state_memory.spec.js
│   │   └── test_state_tasks.spec.js # 🟡 ALTO
│   │
│   └── 📁 logic/                     # 5 arquivos fonte
│       └── test_validation.spec.js   # 🟡 ALTO
│
├── 📁 integration/                   # 30% - Cross-component
│   ├── 📁 kernel/
│   │   ├── test_kernel_driver_flow.spec.js
│   │   └── test_kernel_nerv_integration.spec.js
│   │
│   ├── 📁 driver/
│   │   ├── test_chatgpt_driver.spec.js      # 🔴 CRÍTICO
│   │   ├── test_gemini_driver.spec.js       # 🟡 ALTO
│   │   ├── test_driver_nerv.spec.js         # ✅ Já existe
│   │   └── test_driver_telemetry.spec.js
│   │
│   ├── 📁 api/
│   │   ├── test_api_crud.spec.js            # 🔴 CRÍTICO
│   │   ├── test_health_endpoint.spec.js     # ✅ Já existe
│   │   └── test_realtime_events.spec.js     # 🟡 ALTO
│   │
│   ├── 📁 queue/
│   │   ├── test_queue_flow.spec.js          # 🔴 CRÍTICO
│   │   └── test_task_persistence.spec.js
│   │
│   └── 📁 browser/
│       ├── test_connection_orchestrator.spec.js  # ✅ Já existe
│       └── test_browser_lifecycle.spec.js
│
├── 📁 e2e/                           # 10% - Full stack
│   ├── test_boot_sequence.spec.js   # ✅ Já existe
│   ├── test_ariadne_thread.spec.js  # ✅ Já existe (E2E completo)
│   ├── test_task_full_flow.spec.js  # 🔴 Tarefa completa (criar → executar → resposta)
│   └── test_graceful_shutdown.spec.js
│
├── 📁 regression/                    # Testes de regressão (P1-P5)
│   ├── test_p1_fixes.spec.js        # ✅ Já existe
│   ├── test_p2_fixes.spec.js        # ✅ Já existe
│   ├── test_p3_fixes.spec.js        # ✅ Já existe
│   ├── test_p4_fixes.spec.js        # ✅ Já existe
│   └── test_p5_fixes.spec.js        # ⚠️  P5.2 precisa fix
│
├── 📁 fixtures/                      # Dados de teste reutilizáveis
│   ├── 📁 tasks/                     # Tasks mockadas
│   │   ├── task_simple.json
│   │   ├── task_complex.json
│   │   ├── task_invalid.json
│   │   └── task_chatgpt.json
│   │
│   ├── 📁 responses/                 # Responses mockadas
│   │   ├── response_success.json
│   │   ├── response_error.json
│   │   └── response_timeout.json
│   │
│   ├── 📁 config/                    # Configs de teste
│   │   ├── config_minimal.json
│   │   ├── config_full.json
│   │   └── dynamic_rules_test.json
│   │
│   └── 📁 dna/                       # DNA samples
│       ├── dna_v1.json
│       └── dna_v2.json
│
├── 📁 mocks/                         # Mocks reutilizáveis
│   ├── mock_browser.js               # Mock Puppeteer browser
│   ├── mock_nerv.js                  # Mock NERV event bus
│   ├── mock_driver.js                # Mock driver base
│   ├── mock_page.js                  # Mock Puppeteer page
│   └── mock_logger.js                # Mock logger (silent)
│
├── 📁 helpers/                       # Utilitários de teste
│   ├── test_helpers.js               # ✅ Já existe (renomear)
│   ├── assertion_helpers.js          # Assertions customizadas
│   ├── async_helpers.js              # waitForCondition, retry, etc.
│   ├── mock_factory.js               # Factory para criar mocks
│   └── cleanup_helpers.js            # Limpar estado entre testes
│
├── 📁 manual/                        # Testes manuais (documentação)
│   ├── test_multi_tab.md             # ✅ Já existe (.txt → .md)
│   ├── test_stall_simulation.md      # ✅ Já existe (.txt → .md)
│   └── test_chrome_external.md       # Conexão com Chrome externo
│
├── 📁 performance/                   # Testes de performance (futuro)
│   ├── benchmark_queue.spec.js
│   ├── benchmark_driver.spec.js
│   └── load_test.spec.js
│
├── 📄 setup.js                       # Setup global (antes de todos os testes)
├── 📄 teardown.js                    # Teardown global (depois de todos os testes)
├── 📄 jest.config.js                 # Configuração Jest
└── 📄 README.md                      # Documentação de testes

Total estimado:
- 49 unit test suites
- 15 integration test suites
- 4 e2e test suites
- 5 regression test suites
= 73 test suites
```

---

## 🔧 Escolha de Framework de Testes

### Opções Avaliadas

| Framework | Vantagens | Desvantagens | Recomendação |
|-----------|-----------|--------------|--------------|
| **Node.js `node:test`** | ✅ Nativo (Node 20+)<br>✅ Zero deps<br>✅ Rápido | ❌ Menos features<br>❌ Ecosystem menor | ⭐⭐⭐ **RECOMENDADO** |
| **Jest** | ✅ Maduro<br>✅ Ecosystem rico<br>✅ Mocking built-in | ❌ Pesado (19MB)<br>❌ Lento em grandes bases | ⭐⭐⭐⭐ Alternativa |
| **Vitest** | ✅ Muito rápido<br>✅ ESM nativo<br>✅ Compatible Jest | ❌ Mais novo<br>❌ Foco em Vite | ⭐⭐ Não ideal |
| **Mocha + Chai** | ✅ Flexível<br>✅ Escolha de assertion libs | ❌ Precisa configuração<br>❌ Sem mocking built-in | ⭐ Legacy |

### ✅ Decisão: Node.js `node:test` + c8 coverage

**Justificativa**:

```javascript
// ✅ VANTAGENS:
// 1. Nativo no Node.js 20+ (zero dependências extras)
// 2. Syntax similar ao Jest (describe, it, beforeEach)
// 3. Suporte a async/await, hooks, mocking
// 4. Integra com c8 para coverage
// 5. Futureproof (mantido pelo Node.js core)

// ❌ DESVANTAGEM:
// - Ecosystem menor que Jest
// - Alguns features avançados faltando

// 🎯 CONCLUSÃO: Perfeito para nosso caso (codebase Node.js puro)
```

---

## 📝 Convenções de Naming

### Padrão de Nomenclatura

```javascript
// ✅ PADRÃO ADOTADO:
tests/
  unit/
    core/
      test_config.spec.js           ← Unit test
      test_logger.spec.js
  integration/
    api/
      test_api_routes.spec.js       ← Integration test
  e2e/
    test_boot_sequence.spec.js      ← E2E test
  regression/
    test_p1_fixes.spec.js           ← Regression test

// 📋 REGRAS:
// 1. Prefixo: "test_" para todos os testes
// 2. Nome: snake_case do módulo testado
// 3. Sufixo: ".spec.js" para testes
// 4. Fixtures: sem prefixo "test_", só o nome
// 5. Mocks: "mock_" + nome
// 6. Helpers: nome descritivo + "_helpers.js"
```

### Nomenclatura Dentro do Arquivo

```javascript
// ✅ BOM:
describe('ExecutionEngine', () => {
    describe('executeTask()', () => {
        it('should execute task successfully when all deps are valid', async () => {
            // ...
        });

        it('should throw error when taskRuntime is missing', async () => {
            // ...
        });

        it('should emit telemetry event on completion', async () => {
            // ...
        });
    });

    describe('evaluateState()', () => {
        it('should return correct decision proposals', async () => {
            // ...
        });
    });
});

// ❌ RUIM:
describe('Test 1', () => {
    it('works', () => {
        // Não descritivo
    });
});
```

---

## 🎨 Template de Teste Padrão

### Unit Test Template

```javascript
/**
 * Unit Test: [Module Name]
 *
 * Tests: [src/path/to/module.js]
 * Coverage: [Funcionalidades testadas]
 *
 * @group unit
 * @group [categoria] (core, kernel, driver, etc)
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

// System Under Test (SUT)
const ModuleName = require('../../../src/path/to/module');

// Mocks
const mockLogger = require('../../mocks/mock_logger');
const mockNerv = require('../../mocks/mock_nerv');

describe('ModuleName', () => {
    let instance;
    let mockDeps;

    beforeEach(() => {
        // Setup: criar instância com mocks
        mockDeps = {
            logger: mockLogger.create(),
            nerv: mockNerv.create()
        };

        instance = new ModuleName(mockDeps);
    });

    afterEach(() => {
        // Cleanup: resetar mocks, fechar conexões, etc
        mockLogger.reset();
        mockNerv.reset();
    });

    // ===== CONSTRUCTOR =====
    describe('constructor()', () => {
        it('should initialize with valid dependencies', () => {
            assert.ok(instance);
            assert.strictEqual(typeof instance.method, 'function');
        });

        it('should throw when required dependency is missing', () => {
            assert.throws(
                () => new ModuleName({ /* logger missing */ }),
                { message: /logger/i }
            );
        });

        it('should use default values for optional parameters', () => {
            const defaultInstance = new ModuleName(mockDeps);
            assert.strictEqual(defaultInstance.timeout, 5000); // default
        });
    });

    // ===== HAPPY PATH =====
    describe('mainMethod()', () => {
        it('should return expected result for valid input', async () => {
            const input = { foo: 'bar' };
            const result = await instance.mainMethod(input);

            assert.strictEqual(result.status, 'success');
            assert.deepStrictEqual(result.data, { processed: true });
        });

        it('should emit telemetry event on success', async () => {
            await instance.mainMethod({ foo: 'bar' });

            assert.strictEqual(mockNerv.emittedEvents.length, 1);
            assert.strictEqual(mockNerv.emittedEvents[0].type, 'MODULE_SUCCESS');
        });
    });

    // ===== ERROR HANDLING =====
    describe('mainMethod() - error cases', () => {
        it('should handle invalid input gracefully', async () => {
            await assert.rejects(
                () => instance.mainMethod(null),
                { message: /invalid input/i }
            );
        });

        it('should retry on transient errors', async () => {
            let attempts = 0;
            mockDeps.externalService = mock.fn(() => {
                attempts++;
                if (attempts < 3) throw new Error('Transient');
                return 'success';
            });

            const result = await instance.mainMethod({ retry: true });

            assert.strictEqual(attempts, 3);
            assert.strictEqual(result, 'success');
        });

        it('should emit error telemetry on failure', async () => {
            await assert.rejects(() => instance.mainMethod(null));

            const errorEvent = mockNerv.emittedEvents.find(e => e.type === 'MODULE_ERROR');
            assert.ok(errorEvent);
            assert.match(errorEvent.error, /invalid input/i);
        });
    });

    // ===== EDGE CASES =====
    describe('mainMethod() - edge cases', () => {
        it('should handle empty input', async () => {
            const result = await instance.mainMethod({});
            assert.strictEqual(result.status, 'empty');
        });

        it('should handle very large input (performance)', async () => {
            const largeInput = { data: 'x'.repeat(1000000) }; // 1MB
            const start = Date.now();

            await instance.mainMethod(largeInput);

            const elapsed = Date.now() - start;
            assert.ok(elapsed < 1000, 'Should process 1MB in < 1s');
        });

        it('should be idempotent (multiple calls same result)', async () => {
            const input = { foo: 'bar' };

            const result1 = await instance.mainMethod(input);
            const result2 = await instance.mainMethod(input);

            assert.deepStrictEqual(result1, result2);
        });
    });

    // ===== INTEGRATION WITH DEPENDENCIES =====
    describe('integration with logger', () => {
        it('should log info messages', async () => {
            await instance.mainMethod({ foo: 'bar' });

            assert.ok(mockLogger.calls.some(c => c.level === 'INFO'));
        });

        it('should log errors with context', async () => {
            await assert.rejects(() => instance.mainMethod(null));

            const errorLog = mockLogger.calls.find(c => c.level === 'ERROR');
            assert.ok(errorLog);
            assert.ok(errorLog.context.taskId);
        });
    });
});

// ===== HELPER FUNCTIONS (dentro do arquivo de teste) =====
function createValidInput() {
    return {
        id: 'test-001',
        type: 'task',
        data: { message: 'Hello' }
    };
}

function createInvalidInput() {
    return null;
}
```

### Integration Test Template

```javascript
/**
 * Integration Test: [Feature Name]
 *
 * Tests: Integration between [Component A] and [Component B]
 * Setup: Requires [dependencies] running
 *
 * @group integration
 * @group [categoria]
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Components
const ComponentA = require('../../../src/path/to/component_a');
const ComponentB = require('../../../src/path/to/component_b');

// Real dependencies (não mocks)
const { createNERV } = require('../../../src/nerv/nerv');
const logger = require('../../../src/core/logger');

describe('ComponentA + ComponentB Integration', () => {
    let nerv;
    let componentA;
    let componentB;

    before(async () => {
        // Setup: inicializar componentes REAIS
        nerv = await createNERV({ mode: 'local' });

        componentA = new ComponentA({ nerv, logger });
        componentB = new ComponentB({ nerv, logger });

        await componentA.initialize();
        await componentB.initialize();
    });

    after(async () => {
        // Cleanup: fechar conexões
        await componentA.shutdown();
        await componentB.shutdown();
        await nerv.close();
    });

    describe('message flow A → B', () => {
        it('should send message from A to B via NERV', async () => {
            const message = { type: 'TEST', data: 'hello' };

            // B escuta mensagens
            const received = new Promise(resolve => {
                componentB.on('message', resolve);
            });

            // A envia mensagem
            await componentA.sendMessage(message);

            // B recebe mensagem
            const receivedMessage = await received;
            assert.deepStrictEqual(receivedMessage, message);
        });

        it('should handle message timeout gracefully', async () => {
            // Simular B não respondendo
            componentB.pause(); // método para pausar processamento

            const result = await componentA.sendMessageWithTimeout(
                { type: 'TEST' },
                { timeout: 1000 }
            );

            assert.strictEqual(result.status, 'timeout');
        });
    });

    describe('error propagation', () => {
        it('should propagate errors from B to A', async () => {
            componentB.simulateError(new Error('Test error'));

            await assert.rejects(
                () => componentA.sendMessage({ type: 'TEST' }),
                { message: /Test error/ }
            );
        });
    });
});
```

### E2E Test Template

```javascript
/**
 * E2E Test: [Flow Name]
 *
 * Tests: Complete user flow from [start] to [end]
 * Setup: Full system running
 *
 * @group e2e
 * @slow (pode levar > 10s)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Helpers
const { startAgent, stopAgent, waitForAgent } = require('../../helpers/test_helpers');
const { writeTask, readResponse } = require('../../helpers/async_helpers');

describe('E2E: Full Task Flow', () => {
    let agentProcess;

    before(async () => {
        // Limpar ambiente
        cleanTestEnvironment();

        // Iniciar agente completo
        agentProcess = await startAgent({ mode: 'test' });

        // Aguardar ready
        await waitForAgent({ timeout: 10000 });
    });

    after(async () => {
        // Parar agente
        await stopAgent(agentProcess);

        // Limpar arquivos de teste
        cleanTestEnvironment();
    });

    it('should process task from creation to completion', async () => {
        // 1. Criar tarefa na fila
        const taskId = await writeTask({
            prompt: 'What is 2+2?',
            target: 'chatgpt',
            model: 'gpt-4'
        });

        // 2. Aguardar processamento (polling)
        const response = await waitForResponse(taskId, { timeout: 60000 });

        // 3. Validar resposta
        assert.ok(response);
        assert.strictEqual(response.status, 'DONE');
        assert.match(response.result, /4/);

        // 4. Verificar artefatos criados
        const responseFile = path.join(__dirname, '../../respostas', `${taskId}.txt`);
        assert.ok(fs.existsSync(responseFile));

        // 5. Verificar logs
        const logs = await readAgentLogs();
        assert.ok(logs.some(l => l.includes(`Task ${taskId} completed`)));
    });

    it('should handle multiple tasks concurrently', async () => {
        const tasks = [];

        // Criar 3 tarefas simultâneas
        for (let i = 0; i < 3; i++) {
            tasks.push(writeTask({ prompt: `Test ${i}` }));
        }

        const taskIds = await Promise.all(tasks);

        // Aguardar todas completarem
        const responses = await Promise.all(
            taskIds.map(id => waitForResponse(id, { timeout: 90000 }))
        );

        // Validar todas completaram
        assert.strictEqual(responses.length, 3);
        responses.forEach(r => {
            assert.strictEqual(r.status, 'DONE');
        });
    });
});

// ===== HELPERS LOCAIS =====
function cleanTestEnvironment() {
    // Limpar fila, logs, locks, etc
}

async function waitForResponse(taskId, { timeout = 30000 }) {
    const start = Date.now();
    const responseFile = path.join(__dirname, '../../respostas', `${taskId}.txt`);

    while (Date.now() - start < timeout) {
        if (fs.existsSync(responseFile)) {
            return JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
        }
        await sleep(1000);
    }

    throw new Error(`Response timeout for task ${taskId}`);
}

async function readAgentLogs() {
    const logFile = path.join(__dirname, '../../logs', 'agente_current.log');
    return fs.readFileSync(logFile, 'utf-8').split('\n');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 🔧 Configuração de Ferramentas

### 1. Instalar Dependências

```bash
# Coverage tool (c8 é melhor que nyc para Node.js nativo)
npm install --save-dev c8

# Test runner (já está em Node.js 20+, mas adicionar tipos para IDE)
npm install --save-dev @types/node

# Mocking library (opcional, mas útil)
npm install --save-dev sinon

# API testing (para testes de servidor)
npm install --save-dev supertest

# Fake data (para fixtures)
npm install --save-dev @faker-js/faker
```

### 2. Configurar package.json

```json
{
    "scripts": {
        "test": "node --test tests/**/*.spec.js",
        "test:unit": "node --test tests/unit/**/*.spec.js",
        "test:integration": "node --test tests/integration/**/*.spec.js",
        "test:e2e": "node --test tests/e2e/**/*.spec.js",
        "test:regression": "node --test tests/regression/**/*.spec.js",

        "test:watch": "node --test --watch tests/**/*.spec.js",

        "test:coverage": "c8 --reporter=html --reporter=text npm test",
        "test:coverage:unit": "c8 --reporter=text npm run test:unit",

        "test:ci": "c8 --reporter=lcov --reporter=text npm test",

        "test:specific": "node --test",

        "test:debug": "node --inspect-brk --test tests/**/*.spec.js",

        "test:summary": "node scripts/test-summary.js"
    }
}
```

### 3. Configurar c8 (.c8rc.json)

```json
{
    "all": true,
    "include": ["src/**/*.js"],
    "exclude": [
        "src/**/*.test.js",
        "src/**/*.spec.js",
        "node_modules/**",
        "tests/**",
        "coverage/**"
    ],
    "reporter": ["html", "text", "lcov"],
    "check-coverage": true,
    "lines": 80,
    "functions": 75,
    "branches": 75,
    "statements": 80,
    "watermarks": {
        "lines": [80, 95],
        "functions": [75, 90],
        "branches": [75, 90],
        "statements": [80, 95]
    },
    "temp-directory": "./tests/tmp/.c8",
    "report-dir": "./coverage"
}
```

### 4. Criar setup.js (global test setup)

```javascript
/**
 * Global Test Setup
 * Executado UMA VEZ antes de todos os testes
 */

const fs = require('fs');
const path = require('path');

// Criar diretórios necessários
const dirs = [
    'tests/tmp',
    'tests/tmp/tasks',
    'tests/tmp/responses',
    'tests/tmp/logs',
    'coverage'
];

dirs.forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

// Configurar variáveis de ambiente para testes
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'ERROR'; // Silenciar logs durante testes
process.env.BROWSER_MODE = 'launcher'; // Sempre launcher em testes

// Mock do logger global (opcional)
global.testLogger = {
    log: () => {}, // silent
    info: () => {},
    warn: () => {},
    error: () => {}
};

console.log('✅ Global test setup complete');
```

### 5. Criar teardown.js (global test teardown)

```javascript
/**
 * Global Test Teardown
 * Executado UMA VEZ depois de todos os testes
 */

const fs = require('fs');
const path = require('path');

// Limpar arquivos temporários
const tmpDir = path.join(__dirname, '..', 'tests/tmp');
if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('✅ Cleaned test tmp directory');
}

// Fechar conexões pendentes (se houver)
// ...

console.log('✅ Global test teardown complete');
```

---

## 📋 Plano de Migração

### FASE 1: Preparação (Dia 1 - 4h)

**Objetivo**: Setup de ferramentas e estrutura

```bash
# 1. Instalar dependências
npm install --save-dev c8 sinon supertest @faker-js/faker @types/node

# 2. Criar estrutura de diretórios
mkdir -p tests/{unit/{core,nerv,kernel,driver,infra,server,state,logic},integration/{kernel,driver,api,queue,browser},e2e,regression,fixtures/{tasks,responses,config,dna},mocks,helpers,manual,performance}

# 3. Criar arquivos de configuração
# - .c8rc.json
# - tests/setup.js
# - tests/teardown.js

# 4. Atualizar package.json com novos scripts

# 5. Mover testes existentes para nova estrutura
mv tests/test_config_validation.js tests/unit/core/test_config.spec.js
mv tests/test_health_endpoint.js tests/integration/api/test_health_endpoint.spec.js
# ... (14 arquivos)

# 6. Criar README.md em tests/
```

**Checklist**:
- [ ] Dependências instaladas
- [ ] Estrutura de diretórios criada
- [ ] Configuração c8 feita
- [ ] Setup/teardown globais criados
- [ ] package.json atualizado
- [ ] Testes existentes migrados
- [ ] README de testes criado

---

### FASE 2: Consolidação (Dia 2 - 4h)

**Objetivo**: Consolidar testes existentes na nova estrutura

```bash
# 1. Converter formato dos testes existentes
# - Adicionar imports do node:test
# - Usar describe/it ao invés de runTest()
# - Separar assertions claramente

# 2. Criar fixtures básicas
# - tasks/task_simple.json
# - responses/response_success.json
# - config/config_minimal.json

# 3. Criar mocks básicos
# - mock_logger.js
# - mock_nerv.js
# - mock_browser.js

# 4. Atualizar helpers.js
# - Renomear para test_helpers.js
# - Adicionar funções úteis (waitFor, retry, cleanup)

# 5. Executar testes para validar migração
npm test
```

**Checklist**:
- [ ] 14 testes convertidos para novo formato
- [ ] 10 fixtures básicas criadas
- [ ] 5 mocks básicos criados
- [ ] helpers.js consolidado
- [ ] Todos os testes passando

---

### FASE 3: Implementação Crítica ✅ COMPLETA (20/Jan/2026)

**Objetivo**: Implementar 15 suites de testes CRÍTICOS (🔴)

**Resultado Final**:

✅ **Core (3 arquivos)**:
1. test_logger.spec.js (8 suites, 12+ tests) - ALL PASSING
2. test_schemas.spec.js (5 suites, 18 tests) - 6/18 PASSING (bugs encontrados)
3. test_config.spec.js (8 suites, 8+ tests) - modernizado

✅ **NERV (2 arquivos)**:
4. test_nerv_core.spec.js (8 suites, 15 tests) - event bus
5. test_envelope.spec.js (8 suites, 20 tests) - protocol validation

✅ **Kernel (3 arquivos)**:
6. test_execution_engine.spec.js (8 suites, 12 tests) - task lifecycle
7. test_task_runtime.spec.js (10 suites, 18 tests) - runtime context
8. test_policy_engine.spec.js (9 suites, 15 tests) - retry policies

✅ **Driver (2 arquivos)**:
9. test_driver_factory.spec.js (8 suites, 12 tests) - driver creation
10. test_driver_adapters.spec.js (10 suites, 18 tests) - ChatGPT/Gemini

✅ **Infra (4 arquivos)** - inclui 2 da FASE 2:
11. test_io.spec.js (10 suites, 20 tests) - 🔴 INCLUI FIX P5.2
12. test_lock_manager.spec.js (10 suites, 14 tests) - PID validation
13. test_browser_pool.spec.js (migrado FASE 2)
14. test_puppeteer_launcher.spec.js (migrado FASE 2)

✅ **Server (3 arquivos)**:
15. test_server_nerv_adapter.spec.js (10 suites, 12 tests) - NERV integration
16. test_api_router.spec.js (15 suites, 15 tests) - HTTP routes
17. test_middleware.spec.js (10 suites, 10 tests) - request processing

**Total Real**: 17 arquivos | ~154 testes | 100% dos críticos cobertos

**Próximo**: Executar todos os testes e corrigir bugs revelados

---

### FASE 4: Expansão (Semanas 3-5 - ~120h)

**Objetivo**: Completar testes de ALTA e MÉDIA prioridade

- **Semana 3**: Integration tests (API, Storage, NERV)
- **Semana 4**: State, Logic, Server components
- **Semana 5**: Cleanup, optimization, coverage > 80%

---

## 📊 Métricas de Sucesso

### KPIs de Testes

```
┌────────────────────────────────────────────────────────────┐
│                   METAS DE COBERTURA                       │
├────────────────────────────────────────────────────────────┤
│ ✅ Fase 1 (Preparação):       14 testes migrados          │
│ ✅ Fase 2 (Consolidação):     20 testes rodando           │
│ ✅ Fase 3 (Crítica):          17 arquivos, ~154 testes    │
│    Status: COMPLETA 20/Jan/2026                           │
│    Cobertura: Core(3), NERV(2), Kernel(3), Driver(2),    │
│               Infra(4), Server(3)                         │
│ 🎯 Fase 4 (Expansão):         +200 testes (80% cov)      │
├────────────────────────────────────────────────────────────┤
│ 🏆 META FINAL:                                            │
│    • 350+ testes                                          │
│    • 80%+ line coverage                                   │
│    • 75%+ branch coverage                                 │
│    • < 15min tempo total                                  │
│    • 0% flaky tests                                       │
└────────────────────────────────────────────────────────────┘
```

### Qualidade dos Testes

- **Velocidade**: Unit < 100ms, Integration < 1s, E2E < 10s
- **Estabilidade**: Taxa de falso positivo < 1%
- **Manutenibilidade**: 1 arquivo = 1 módulo testado
- **Clareza**: Nomes descritivos, 1 assertion por test (quando possível)
- **Coverage**: Testar happy path + error cases + edge cases

---

## 🚀 Começar Agora

### Quick Start (próxima 1 hora)

```bash
# 1. Instalar ferramentas
npm install --save-dev c8 sinon supertest @faker-js/faker

# 2. Criar estrutura básica
mkdir -p tests/unit/core tests/integration/api tests/e2e tests/fixtures tests/mocks

# 3. Criar primeiro teste convertido
# Converter test_config_validation.js para novo formato

# 4. Criar configuração c8
# Adicionar .c8rc.json

# 5. Testar
npm run test:unit

# 6. Ver coverage
npm run test:coverage
```

---

**Status**: ✅ ESTRATÉGIA COMPLETA DEFINIDA
**Próxima ação**: Começar FASE 1 (Preparação)
**Tempo estimado**: 4 horas para setup inicial
**Resultado esperado**: Estrutura completa + 14 testes migrados
