# 🧪 Guia de Testing

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores, QA
**Tempo de Leitura**: ~25 min

---

## 📖 Visão Geral

Este documento detalha **estratégia de testes** do sistema `chatgpt-docker-puppeteer`: test suite atual, padrões, escrita de testes, cobertura, CI/CD.

---

## 🎯 Estratégia de Testes

### Pirâmide de Testes

```
         ┌─────────┐
         │   E2E   │ (2) - Full workflow
         └─────────┘
        ┌───────────┐
        │Integration│ (4) - Subsystems
        └───────────┘
     ┌──────────────────┐
     │   Unit Tests     │ (8) - Pure functions
     └──────────────────┘
```

### Categorias

| Tipo            | Foco                                     | Duração     | Quantidade         |
| --------------- | ---------------------------------------- | ----------- | ------------------ |
| **Unit**        | Funções puras, sem I/O                   | <1s cada    | 8 tests            |
| **Integration** | Kernel+NERV, Driver+Browser              | 5-30s cada  | 4 tests            |
| **E2E**         | Task completo (add → execute → response) | 1-3min cada | 2 tests            |
| **Smoke**       | Health checks, cenários básicos          | <5s total   | Incluído em health |
| **Performance** | Load testing, throughput                 | 5-15min     | Manual (Artillery) |

---

## 📂 Test Suite Atual

### Localização

```
tests/
├── helpers.js                      # Utilities (mock, create, wait)
├── test_config_validation.js       # Config schema validation
├── test_driver_nerv_integration.js # Driver ↔ NERV events
├── test_boot_sequence.js           # Boot process (12 steps)
├── test_browser_pool.js            # Pool manager (allocate/release)
├── test_ariadne_thread.js          # E2E Ariadne (collection logic)
├── test_integration_complete.js    # Full task flow (add → done)
├── test_p1_fixes.js                # P1-P5 regression tests
├── test_p9_fixes.js                # P9 performance fixes
└── integration/
    └── test_identity_lifecycle.js  # DNA persistence
```

### Status (14 testes funcionais)

| Arquivo                         | Status    | Assertions | Duração   |
| ------------------------------- | --------- | ---------- | --------- |
| test_config_validation.js       | ✅ 100%    | 8          | 0.5s      |
| test_driver_nerv_integration.js | ✅ 100%    | 12         | 2s        |
| test_boot_sequence.js           | ✅ 100%    | 12         | 1s        |
| test_browser_pool.js            | ✅ 100%    | 10         | 5s        |
| test_ariadne_thread.js          | ✅ 100%    | 15         | 45s       |
| test_integration_complete.js    | ⚠️ 80%     | 18         | 90s       |
| test_p1_fixes.js                | ✅ 100%    | 10         | 3s        |
| test_p9_fixes.js                | ✅ 100%    | 13         | 2s        |
| test_identity_lifecycle.js      | ✅ 100%    | 6          | 1s        |
| **Total**                       | **✅ 89%** | **104**    | **~150s** |

**Legend**:
- ✅ = Passing (all assertions)
- ⚠️ = Flaky (occasional failures)

---

## 🛠️ Test Helpers (tests/helpers.js)

### Mock NERV

```javascript
function mockNERV() {
    const eventLog = [];

    return {
        emit: (type, payload) => {
            eventLog.push({ type, payload, ts: Date.now() });
        },
        on: jest.fn(),
        once: jest.fn(),
        eventLog,  // Inspect emitted events

        // Helpers
        getEventsByType: (type) => eventLog.filter(e => e.type === type),
        clearLog: () => eventLog.splice(0, eventLog.length)
    };
}
```

**Uso**:
```javascript
const mockNerv = mockNERV();
const driver = new ChatGPTDriver({ nerv: mockNerv });

await driver.execute(page, 'Hello');

// Assert NERV events
const execEvents = mockNerv.getEventsByType('DRIVER_EXECUTE');
expect(execEvents).toHaveLength(1);
expect(execEvents[0].payload.prompt).toBe('Hello');
```

---

### Mock Browser

```javascript
function mockBrowser() {
    const mockPage = {
        goto: jest.fn().mockResolvedValue(undefined),
        waitForSelector: jest.fn().mockResolvedValue(undefined),
        type: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue('Mocked response'),
        close: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockReturnValue('https://example.com')
    };

    return {
        allocatePage: jest.fn().mockResolvedValue(mockPage),
        releasePage: jest.fn().mockResolvedValue(undefined),
        mockPage
    };
}
```

**Uso**:
```javascript
const mockPool = mockBrowser();

// Inject into driver
const driver = new ChatGPTDriver({ browserPool: mockPool });

await driver.execute(null, 'Hello');

// Assert browser interactions
expect(mockPool.allocatePage).toHaveBeenCalled();
expect(mockPool.mockPage.goto).toHaveBeenCalledWith('https://chat.openai.com', ...);
expect(mockPool.mockPage.type).toHaveBeenCalledWith('textarea', 'Hello');
```

---

### Create Test Task

```javascript
function createTestTask(overrides = {}) {
    return {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        target: 'chatgpt',
        prompt: 'Test prompt',
        state: 'PENDING',
        priority: 5,
        createdAt: Date.now(),
        ...overrides
    };
}
```

**Uso**:
```javascript
const task1 = createTestTask();
const task2 = createTestTask({ target: 'gemini', priority: 10 });
const task3 = createTestTask({ state: 'RUNNING', allocatedAt: Date.now() });
```

---

### Wait For State

```javascript
async function waitForState(taskId, expectedState, timeoutMs = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const task = await io.getTask(taskId);

        if (task.state === expectedState) {
            return task;
        }

        await new Promise(r => setTimeout(r, 100));  // Poll every 100ms
    }

    throw new Error(`Timeout: Task ${taskId} never reached state ${expectedState}`);
}
```

**Uso**:
```javascript
// Add task to queue
await io.saveTask(createTestTask({ id: 'test-123' }));

// Start kernel (will allocate task)
kernel.start();

// Wait for execution
const completedTask = await waitForState('test-123', 'DONE', 60000);

expect(completedTask.state).toBe('DONE');
expect(completedTask.responseLength).toBeGreaterThan(0);
```

---

## ✍️ Writing Tests

### Test Structure

```javascript
/**
 * Test: Component Name
 * Purpose: Brief description
 */

const assert = require('assert');
const { createTestTask, mockNERV, waitForState } = require('./helpers');

// Setup
let nerv, component;

beforeEach(() => {
    nerv = mockNERV();
    component = new MyComponent({ nerv });
});

afterEach(() => {
    nerv.clearLog();
});

// Test suites
describe('MyComponent', () => {
    describe('Happy Path', () => {
        test('should process valid input', async () => {
            // Arrange
            const input = createTestTask();

            // Act
            const result = await component.process(input);

            // Assert
            expect(result).toBeDefined();
            expect(result.status).toBe('ok');

            // Verify NERV events
            const events = nerv.getEventsByType('PROCESS_COMPLETE');
            expect(events).toHaveLength(1);
        });
    });

    describe('Error Cases', () => {
        test('should handle invalid input', async () => {
            // Arrange
            const invalidInput = { ...createTestTask(), target: 'unknown' };

            // Act & Assert
            await expect(component.process(invalidInput)).rejects.toThrow('Unknown target');
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty prompt', async () => {
            const task = createTestTask({ prompt: '' });
            const result = await component.process(task);
            expect(result.status).toBe('error');
        });
    });
});

// Run
if (require.main === module) {
    // Run with Jest or Node directly
    // jest myTest.js
    // node myTest.js
}
```

---

### Naming Conventions

- **Descriptive**: `should allocate task when worker available`
- **Not implementation**: ❌ `test_allocate_function` → ✅ `should allocate task`
- **Scenario-based**: Group by "Happy Path", "Error Cases", "Edge Cases"

---

### Assertions Best Practices

```javascript
// ✅ Specific matchers
expect(task.state).toBe('RUNNING');
expect(task.priority).toBeGreaterThan(5);
expect(response).toContain('Hello');
expect(errors).toHaveLength(0);

// ✅ Async matchers
await expect(asyncFunc()).resolves.toBe('result');
await expect(asyncFunc()).rejects.toThrow('Error message');

// ❌ Generic checks
expect(task).toBeTruthy();  // Too vague
expect(response.length > 0).toBe(true);  // Use toBeGreaterThan

// ✅ Check all relevant state
expect(task.state).toBe('DONE');
expect(task.responseLength).toBeGreaterThan(10);
expect(task.duration).toBeLessThan(60000);
expect(task.failureCount).toBe(0);
```

---

### Verify Side Effects

```javascript
test('should emit NERV events', async () => {
    await component.execute(task);

    // Check NERV emissions
    expect(nerv.eventLog).toHaveLength(2);
    expect(nerv.eventLog[0].type).toBe('TASK_START');
    expect(nerv.eventLog[1].type).toBe('TASK_COMPLETE');
});

test('should write response file', async () => {
    await component.execute(task);

    // Check file system
    const responsePath = path.join('respostas', `${task.id}.txt`);
    expect(fs.existsSync(responsePath)).toBe(true);

    const content = fs.readFileSync(responsePath, 'utf8');
    expect(content).toContain('Expected response text');
});
```

---

## 🧪 Running Tests

### Via Makefile (Recomendado)

```bash
# Fast tests (pre-commit, 5min)
make test-fast

# Integration tests (15min)
make test-integration

# All tests
make test-all

# CI mode (strict, fail-fast)
make ci-test
```

---

### Via npm

```bash
# All tests
npm test

# Specific test
npm test -- tests/test_config_validation.js

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

---

### Via Node.js (Direct)

```bash
# Run single test
node tests/test_config_validation.js

# With debug logs
LOG_LEVEL=DEBUG node tests/test_boot_sequence.js

# With breakpoint (VS Code)
node --inspect-brk tests/test_p9_fixes.js
```

---

## 📊 Coverage Goals

### Current Coverage (~50%)

| Module      | Coverage | Goal    | Status   |
| ----------- | -------- | ------- | -------- |
| **core/**   | 85%      | 90%     | ✅ Good   |
| **nerv/**   | 75%      | 85%     | ⚠️ Medium |
| **kernel/** | 60%      | 85%     | ⏳ Low    |
| **driver/** | 45%      | 70%     | ⏳ Low    |
| **infra/**  | 55%      | 80%     | ⏳ Low    |
| **server/** | 40%      | 75%     | ⏳ Low    |
| **logic/**  | 50%      | 75%     | ⏳ Low    |
| **TOTAL**   | **58%**  | **80%** | ⚠️ Medium |

---

### Focus Areas

**High Priority** (Critical paths):
- `kernel/kernel_loop.js` - Main execution cycle (60% → 90%)
- `kernel/task_runtime.js` - Task allocation (70% → 95%)
- `infra/lock_manager.js` - Locking (P5.1) (50% → 90%)
- `infra/pool_manager.js` - Browser pool (P9.2) (55% → 85%)

**Medium Priority**:
- `driver/targets/chatgpt.js` - ChatGPT automation (40% → 70%)
- `logic/collection_logic.js` - Response collection (45% → 75%)
- `server/routes/queue.js` - API routes (35% → 70%)

**Low Priority** (Nice to have):
- `core/logger.js` - Logging (85% → 90%)
- `nerv/telemetry.js` - Metrics (80% → 85%)

---

### Coverage Reports

```bash
# Generate coverage
npm test -- --coverage

# Output:
# File                   | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
# -----------------------|---------|----------|---------|---------|-------------------
# All files              |   58.23 |    52.10 |   61.45 |   57.89 |
#  src/core              |   85.12 |    78.45 |   90.23 |   84.56 |
#  src/kernel            |   60.45 |    55.12 |   65.89 |   59.34 |
#  ...

# HTML report
open coverage/lcov-report/index.html
```

---

## 🏗️ CI/CD Integration

### GitHub Actions Workflow

**Arquivo**: `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18.x, 20.x]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Run tests
        run: npm test -- --ci --coverage --maxWorkers=2
        env:
          CI: true
          NODE_ENV: test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella

      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 50" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 50% threshold"
            exit 1
          fi
```

---

### Pre-commit Hook (Husky)

```bash
# Install Husky
npm install --save-dev husky

# Init
npx husky init

# Add pre-commit hook
echo "make test-fast" > .husky/pre-commit
chmod +x .husky/pre-commit
```

**Efeito**: Cada `git commit` executa `make test-fast` (5min). Se falhar, commit bloqueado.

---

## 🐛 Flaky Tests

### Known Issues (2 testes)

**1. test_integration_complete.js** (⚠️ 80% pass rate)

**Sintoma**: Timeout ao conectar browser externo

**Causa**: Browser externo não iniciado ou port 9222 ocupado

**Workaround**:
```bash
# Start external browser BEFORE test
chrome --remote-debugging-port=9222 &

# Run test
node tests/test_integration_complete.js
```

**Long-term fix**: Use launcher mode em testes (não depende de external browser)

---

**2. test_browser_pool.js** (⚠️ 90% pass rate)

**Sintoma**: Race condition em `allocatePage()` paralelo

**Causa**: Circuit breaker não thread-safe (P9.2)

**Fix** (em progresso):
```javascript
// pool_manager.js
const mutex = require('async-mutex');
const lock = new mutex.Mutex();

async function allocatePage() {
    return lock.runExclusive(async () => {
        // Allocation logic (now serialized)
    });
}
```

---

### Debugging Flaky Tests

```bash
# Run 10 times
for i in {1..10}; do
    echo "Run $i"
    node tests/test_browser_pool.js || echo "FAILED on run $i"
done

# Output:
# Run 1 ✅
# Run 2 ✅
# Run 3 ❌ FAILED on run 3
# ...

# Analyze failure pattern
# - Intermittent? → Race condition
# - After N runs? → Resource leak
# - Random? → Timing issue
```

---

## 🚀 Performance Testing

### Artillery.io (Load Testing)

**Install**:
```bash
npm install -g artillery
```

**Config**: `load-test.yml`

```yaml
config:
  target: 'http://localhost:3008'
  phases:
    - duration: 60
      arrivalRate: 5  # 5 requests/sec for 1 min
    - duration: 120
      arrivalRate: 10  # Ramp up to 10 req/sec for 2 min

scenarios:
  - name: "Add tasks"
    flow:
      - post:
          url: "/api/queue/add"
          headers:
            Content-Type: "application/json"
          json:
            target: "chatgpt"
            prompt: "Hello {{ $randomString() }}"
            priority: 5
      - think: 2  # Wait 2s between requests
```

**Run**:
```bash
artillery run load-test.yml

# Output:
# Summary report @ 14:30:00
#   Scenarios launched: 900
#   Scenarios completed: 895
#   Requests completed: 895
#   Mean response/sec: 7.45
#   Response time (msec):
#     min: 25
#     max: 1250
#     median: 120
#     p95: 450
#     p99: 850
#   Errors:
#     ETIMEDOUT: 5 (0.5%)
```

---

### Metrics Collection

```bash
# During load test, monitor:

# 1. System resources
htop  # CPU/Memory usage

# 2. PM2 dashboard
pm2 monit

# 3. Health metrics (P9.1)
watch -n 2 'curl -s http://localhost:3008/api/health-metrics | jq'

# 4. Queue status
watch -n 5 'curl -s http://localhost:3008/api/queue | jq ".summary"'
```

---

### Performance Benchmarks

| Scenario                             | Throughput  | Latency (p95) | CPU | Memory |
| ------------------------------------ | ----------- | ------------- | --- | ------ |
| **Baseline** (1 worker)              | 15 tasks/h  | 3500ms        | 15% | 200MB  |
| **Standard** (3 workers)             | 45 tasks/h  | 2800ms        | 25% | 400MB  |
| **High-throughput** (10 workers)     | 150 tasks/h | 4200ms        | 70% | 1.2GB  |
| **Low-resource** (1 worker, no pool) | 10 tasks/h  | 5000ms        | 8%  | 120MB  |

---

## 📋 Test Checklist

### Before Commit

- [ ] Tests passam localmente (`make test-fast`)
- [ ] Lint OK (`make lint`)
- [ ] Coverage não caiu (>50%)
- [ ] No console.logs (apenas logger)
- [ ] Tests seguem padrões (describe/test, arrange/act/assert)

### Before PR

- [ ] Todos testes passam (`make test-all`)
- [ ] Coverage >58% (current baseline)
- [ ] Flaky tests documentados (se aplicável)
- [ ] Novos testes para novos features
- [ ] Integration tests passam (15min suite)

### Before Release

- [ ] CI/CD green (GitHub Actions)
- [ ] Coverage >60% (goal)
- [ ] Performance benchmarks OK (Artillery)
- [ ] Load test 100 req/min por 10min (sem crashes)
- [ ] All known bugs documented em issues

---

## 📚 Referências

- [DEVELOPMENT.md](DEVELOPMENT.md) - Debugging técnicas
- [CONTRIBUTING.md](CONTRIBUTING.md) - PR process
- [PATTERNS.md](PATTERNS.md) - Test patterns (mocking, fixtures)
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Component interfaces (para mocking)

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, QA Team*
