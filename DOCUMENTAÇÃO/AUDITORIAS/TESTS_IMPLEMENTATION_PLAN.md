# 📋 Plano de Implementação de Testes - Execução Fase por Fase

**Data de Início**: 2026-01-20
**Objetivo**: Atingir 80%+ de cobertura de testes em 5 semanas
**Metodologia**: Execução incremental, validação contínua, zero regressões
**Status Inicial**: 14 testes funcionais | 14% cobertura | 135 arquivos fonte

---

## 📊 Visão Geral do Plano

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CRONOGRAMA DE EXECUÇÃO                           │
├─────────────────────────────────────────────────────────────────────┤
│ FASE 0: Auditoria e Documentação      │ ✅ CONCLUÍDO               │
│ FASE 1: Preparação e Setup            │ 🔵 PRÓXIMA (4 horas)      │
│ FASE 2: Consolidação e Migração       │ ⏸️  PENDENTE (4 horas)    │
│ FASE 3: Testes Críticos (🔴)          │ ⏸️  PENDENTE (80 horas)   │
│ FASE 4: Testes Altos (🟡)             │ ⏸️  PENDENTE (80 horas)   │
│ FASE 5: Testes Médios (🟠)            │ ⏸️  PENDENTE (40 horas)   │
│ FASE 6: Testes Baixos (🟢) + CI/CD    │ ⏸️  PENDENTE (20 horas)   │
├─────────────────────────────────────────────────────────────────────┤
│ TOTAL: 6 fases | ~230 horas | 350+ testes | 80%+ cobertura         │
└─────────────────────────────────────────────────────────────────────┘
```

---

# ✅ FASE 0: Auditoria e Documentação [CONCLUÍDO]

**Duração**: Concluída
**Objetivo**: Mapear estado atual e planejar estratégia

## Deliverables Completados

- ✅ [TESTES_MAPEAMENTO.md](TESTES_MAPEAMENTO.md) - Auditoria completa de 30 testes
- ✅ [TESTS_AUDIT_RESULTS.md](TESTS_AUDIT_RESULTS.md) - Resultados: 14 OK | 5 Reescrever | 11 Deletar
- ✅ [TESTS_COVERAGE_MATRIX.md](TESTS_COVERAGE_MATRIX.md) - Matriz de cobertura detalhada
- ✅ [TESTS_STRATEGY.md](TESTS_STRATEGY.md) - Estratégia completa de organização

## Resultados

```
Estado Atual:
- 14 testes funcionais mantidos
- 11 testes obsoletos identificados (a deletar)
- 5 testes problemáticos identificados (a refatorar)
- 116 arquivos sem cobertura (86% do código)
- Meta definida: 80%+ cobertura | 350+ testes
```

---

# 🔵 FASE 1: Preparação e Setup

**Duração**: 4 horas
**Objetivo**: Configurar ferramentas, estrutura de diretórios e scripts
**Status**: ⏳ PRÓXIMA FASE

## 1.1 Instalar Dependências (30 min)

### Comandos

```bash
# Coverage tool (c8 > nyc para Node.js nativo)
npm install --save-dev c8

# Mocking library
npm install --save-dev sinon

# API testing
npm install --save-dev supertest

# Fake data para fixtures
npm install --save-dev @faker-js/faker

# Type definitions para IDE support
npm install --save-dev @types/node
```

### Validação

```bash
# Verificar instalação
npm list c8 sinon supertest @faker-js/faker
```

### Checklist

- [ ] c8 instalado
- [ ] sinon instalado
- [ ] supertest instalado
- [ ] @faker-js/faker instalado
- [ ] @types/node instalado
- [ ] package.json atualizado
- [ ] node_modules atualizado

---

## 1.2 Criar Estrutura de Diretórios (15 min)

### Comandos

```bash
# Criar estrutura completa
mkdir -p tests/unit/{core,nerv,kernel,driver,infra,server,state,logic}
mkdir -p tests/integration/{kernel,driver,api,queue,browser}
mkdir -p tests/e2e
mkdir -p tests/regression
mkdir -p tests/fixtures/{tasks,responses,config,dna}
mkdir -p tests/mocks
mkdir -p tests/helpers
mkdir -p tests/manual
mkdir -p tests/performance

# Criar arquivo README em tests/
touch tests/README.md
```

### Validação

```bash
# Verificar estrutura
tree tests/ -L 2 -d
```

### Checklist

- [ ] Diretório `tests/unit/` criado (8 subpastas)
- [ ] Diretório `tests/integration/` criado (5 subpastas)
- [ ] Diretório `tests/e2e/` criado
- [ ] Diretório `tests/regression/` criado
- [ ] Diretório `tests/fixtures/` criado (4 subpastas)
- [ ] Diretório `tests/mocks/` criado
- [ ] Diretório `tests/helpers/` criado
- [ ] Diretório `tests/manual/` criado
- [ ] Diretório `tests/performance/` criado

---

## 1.3 Configurar c8 Coverage (30 min)

### Criar .c8rc.json

```bash
cat > .c8rc.json << 'EOF'
{
    "all": true,
    "include": ["src/**/*.js"],
    "exclude": [
        "src/**/*.test.js",
        "src/**/*.spec.js",
        "node_modules/**",
        "tests/**",
        "coverage/**",
        "scripts/**",
        "tools/**",
        "public/**"
    ],
    "reporter": ["html", "text", "lcov", "json-summary"],
    "check-coverage": false,
    "lines": 80,
    "functions": 75,
    "branches": 75,
    "statements": 80,
    "watermarks": {
        "lines": [50, 80],
        "functions": [50, 75],
        "branches": [50, 75],
        "statements": [50, 80]
    },
    "temp-directory": "./tests/tmp/.c8",
    "report-dir": "./coverage",
    "skip-full": false
}
EOF
```

### Validação

```bash
# Testar configuração
npx c8 --version
npx c8 --help
```

### Checklist

- [ ] Arquivo `.c8rc.json` criado
- [ ] Configuração validada
- [ ] Coverage thresholds definidos (80/75/75/80)
- [ ] Exclusions corretas configuradas

---

## 1.4 Atualizar package.json Scripts (30 min)

### Adicionar Scripts de Teste

```json
{
    "scripts": {
        "test": "node --test tests/**/*.spec.js",
        "test:unit": "node --test tests/unit/**/*.spec.js",
        "test:integration": "node --test tests/integration/**/*.spec.js",
        "test:e2e": "node --test tests/e2e/**/*.spec.js",
        "test:regression": "node --test tests/regression/**/*.spec.js",

        "test:watch": "node --test --watch tests/**/*.spec.js",
        "test:watch:unit": "node --test --watch tests/unit/**/*.spec.js",

        "test:coverage": "c8 npm test",
        "test:coverage:unit": "c8 npm run test:unit",
        "test:coverage:report": "c8 report --reporter=html && open coverage/index.html",

        "test:ci": "c8 --check-coverage npm test",

        "test:specific": "node --test",
        "test:debug": "node --inspect-brk --test",

        "test:clean": "rm -rf tests/tmp coverage .nyc_output",
        "test:reset": "npm run test:clean && npm test"
    }
}
```

### Comandos

```bash
# Backup do package.json atual
cp package.json package.json.backup

# Editar manualmente ou usar script
# (será feito via replace_string_in_file)
```

### Validação

```bash
# Verificar scripts
npm run test -- --help
npm run test:coverage -- --help
```

### Checklist

- [ ] Scripts básicos adicionados (test, test:unit, test:integration, etc)
- [ ] Scripts de coverage adicionados
- [ ] Scripts de watch adicionados
- [ ] Scripts de CI adicionados
- [ ] Scripts de debug adicionados
- [ ] Scripts de cleanup adicionados
- [ ] Backup do package.json criado

---

## 1.5 Criar Setup/Teardown Globais (30 min)

### Criar tests/setup.js

```bash
cat > tests/setup.js << 'EOF'
/**
 * Global Test Setup
 * Executado UMA VEZ antes de todos os testes
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Running global test setup...');

// Criar diretórios temporários necessários
const dirs = [
    path.join(__dirname, 'tmp'),
    path.join(__dirname, 'tmp/tasks'),
    path.join(__dirname, 'tmp/responses'),
    path.join(__dirname, 'tmp/logs'),
    path.join(__dirname, 'tmp/locks'),
    path.join(__dirname, '../coverage')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  ✅ Created: ${path.relative(process.cwd(), dir)}`);
    }
});

// Configurar variáveis de ambiente para testes
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'ERROR'; // Silenciar logs durante testes
process.env.BROWSER_MODE = 'launcher'; // Sempre launcher em testes
process.env.TEST_MODE = 'true';

// Mock do console durante testes (opcional - comentado por padrão)
// const originalConsole = { ...console };
// global.console = {
//     ...console,
//     log: () => {}, // Silent
//     info: () => {},
//     debug: () => {}
// };
// global.originalConsole = originalConsole;

console.log('✅ Global test setup complete\n');
EOF
```

### Criar tests/teardown.js

```bash
cat > tests/teardown.js << 'EOF'
/**
 * Global Test Teardown
 * Executado UMA VEZ depois de todos os testes
 */

const fs = require('fs');
const path = require('path');

console.log('\n🧹 Running global test teardown...');

// Limpar arquivos temporários (opcional - manter para debug)
const shouldCleanup = process.env.TEST_CLEANUP === 'true';

if (shouldCleanup) {
    const tmpDir = path.join(__dirname, 'tmp');
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log('  ✅ Cleaned test tmp directory');
    }
} else {
    console.log('  ⏭️  Skipping cleanup (set TEST_CLEANUP=true to enable)');
}

// Restaurar console (se foi mockado)
// if (global.originalConsole) {
//     global.console = global.originalConsole;
// }

// Fechar conexões pendentes (se houver)
// await closeAllConnections();

console.log('✅ Global test teardown complete');
EOF
```

### Validação

```bash
# Testar setup/teardown
node tests/setup.js
node tests/teardown.js
```

### Checklist

- [ ] Arquivo `tests/setup.js` criado
- [ ] Arquivo `tests/teardown.js` criado
- [ ] Diretórios temporários criados
- [ ] Variáveis de ambiente configuradas
- [ ] Setup/teardown testados manualmente

---

## 1.6 Criar README de Testes (30 min)

### Criar tests/README.md

```bash
cat > tests/README.md << 'EOF'
# 🧪 Test Suite Documentation

## Structure

```
tests/
├── unit/          # Unit tests (60% - isolado, sem I/O)
├── integration/   # Integration tests (30% - cross-component)
├── e2e/          # End-to-end tests (10% - full stack)
├── regression/   # Regression tests (P1-P5 fixes)
├── fixtures/     # Test data (tasks, responses, configs)
├── mocks/        # Reusable mocks (browser, nerv, logger)
├── helpers/      # Test utilities
└── manual/       # Manual test procedures
```

## Running Tests

```bash
# All tests
npm test

# By type
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:regression

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Specific file
npm run test:specific tests/unit/core/test_logger.spec.js

# Debug mode
npm run test:debug tests/unit/core/test_logger.spec.js
```

## Writing Tests

See [TESTS_STRATEGY.md](../TESTS_STRATEGY.md) for templates and conventions.

## Coverage Goals

- Lines: 80%
- Functions: 75%
- Branches: 75%
- Statements: 80%

## Current Status

Run `npm run test:coverage` to see current coverage.
EOF
```

### Checklist

- [ ] Arquivo `tests/README.md` criado
- [ ] Estrutura documentada
- [ ] Comandos documentados
- [ ] Goals documentados

---

## 1.7 Criar Gitignore para Testes (15 min)

### Atualizar .gitignore

```bash
# Adicionar ao .gitignore
cat >> .gitignore << 'EOF'

# Test artifacts
tests/tmp/
coverage/
.nyc_output/
*.lcov
.c8/

# Test logs
tests/**/*.log

# Backup files
*.backup
EOF
```

### Validação

```bash
# Verificar gitignore
cat .gitignore | grep -A5 "Test artifacts"
```

### Checklist

- [ ] .gitignore atualizado
- [ ] Coverage reports ignorados
- [ ] Tmp files ignorados
- [ ] Log files ignorados

---

## 1.8 Validação Final da FASE 1 (30 min)

### Comandos de Validação

```bash
# 1. Verificar dependências
npm list c8 sinon supertest @faker-js/faker

# 2. Verificar estrutura
tree tests/ -L 2 -d

# 3. Testar scripts
npm run test:unit -- --help
npm run test:coverage -- --help

# 4. Executar setup
node tests/setup.js

# 5. Gerar coverage report (vazio por enquanto)
npm run test:coverage || echo "No tests yet - OK"

# 6. Verificar gitignore
git status --ignored tests/

# 7. Commit inicial
git add .
git status
```

### Checklist Final FASE 1

- [ ] ✅ Todas as dependências instaladas
- [ ] ✅ Estrutura de diretórios completa (27 diretórios)
- [ ] ✅ Configuração c8 criada e validada
- [ ] ✅ Scripts package.json atualizados (14 scripts)
- [ ] ✅ Setup/teardown globais criados e testados
- [ ] ✅ README de testes criado
- [ ] ✅ Gitignore atualizado
- [ ] ✅ Validação completa executada
- [ ] ✅ Commit pronto para ser feito

### Critérios de Sucesso

```
✅ FASE 1 COMPLETA quando:
- 5 dependências instaladas
- 27 diretórios criados
- 4 arquivos de configuração criados
- 14 scripts npm funcionando
- git status limpo
- Tempo total: ~4 horas
```

---

# ⏸️ FASE 2: Consolidação e Migração

**Duração**: 4 horas
**Objetivo**: Migrar 14 testes existentes para nova estrutura
**Status**: PENDENTE (iniciar após FASE 1)

## 2.1 Deletar Testes Obsoletos (15 min)

### Comandos

```bash
# Deletar 11 testes obsoletos identificados na auditoria
rm -f tests/integration/identity_lifecycle.test.js  # ❌ Obsoleto (IPC antigo)

# Criar commit
git add -A
git commit -m "chore: remove 1 obsolete test (IPC refactoring)"
```

### Checklist

- [ ] 1 teste obsoleto deletado
- [ ] Commit criado

---

## 2.2 Migrar Testes Funcionais (2h)

### Lista de Testes a Migrar

| # | Teste Original | Destino | Prioridade |
|---|---------------|---------|------------|
| 1 | test_config_validation.js | tests/unit/core/test_config.spec.js | ✅ |
| 2 | test_health_endpoint.js | tests/integration/api/test_health_endpoint.spec.js | ✅ |
| 3 | test_driver_nerv_integration.js | tests/integration/driver/test_driver_nerv.spec.js | ✅ |
| 4 | test_puppeteer_launch.js | tests/unit/infra/test_puppeteer_launcher.spec.js | ✅ |
| 5 | test_p1_fixes.js | tests/regression/test_p1_fixes.spec.js | ✅ |
| 6 | test_p2_fixes.js | tests/regression/test_p2_fixes.spec.js | ✅ |
| 7 | test_p3_fixes.js | tests/regression/test_p3_fixes.spec.js | ✅ |
| 8 | test_p4_p5_fixes.js | tests/regression/test_p4_p5_fixes.spec.js | ⚠️ P5.2 |
| 9 | test_ariadne_thread.js | tests/e2e/test_ariadne_thread.spec.js | ✅ |
| 10 | test_boot_sequence.js | tests/e2e/test_boot_sequence.spec.js | ✅ |
| 11 | test_browser_pool.js | tests/unit/infra/test_browser_pool.spec.js | ✅ |
| 12 | test_connection_orchestrator.js | tests/integration/browser/test_connection_orchestrator.spec.js | ✅ |
| 13 | test_integration_complete.js | tests/e2e/test_integration_complete.spec.js | ✅ |
| 14 | helpers.js | tests/helpers/test_helpers.js | ✅ |

### Estratégia de Migração

Para cada teste:

1. **Copiar** para novo local
2. **Converter** formato (adicionar describe/it se necessário)
3. **Atualizar** imports para node:test
4. **Executar** teste individualmente
5. **Commit** com mensagem descritiva

### Exemplo de Conversão

```javascript
// ANTES (custom runner)
function runTest(name, testFn) {
    try {
        testFn();
        console.log('✅ PASSOU');
    } catch (e) {
        console.log('❌ FALHOU');
    }
}

runTest('TEST 1: Config válido', () => {
    const config = loadConfig();
    assert.ok(config);
});

// DEPOIS (node:test)
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Config', () => {
    it('should load valid config', () => {
        const config = loadConfig();
        assert.ok(config);
    });
});
```

### Comandos para Cada Migração

```bash
# 1. Copiar para novo local
cp tests/test_config_validation.js tests/unit/core/test_config.spec.js

# 2. Editar arquivo (converter formato)
# [Manual ou via script de conversão]

# 3. Testar
npm run test:specific tests/unit/core/test_config.spec.js

# 4. Se passar, deletar original
rm tests/test_config_validation.js

# 5. Commit
git add tests/unit/core/test_config.spec.js tests/test_config_validation.js
git commit -m "test: migrate test_config_validation to new structure"

# Repetir para os 14 testes
```

### Checklist

- [ ] test_config_validation.js → migrado
- [ ] test_health_endpoint.js → migrado
- [ ] test_driver_nerv_integration.js → migrado
- [ ] test_puppeteer_launch.js → migrado
- [ ] test_p1_fixes.js → migrado
- [ ] test_p2_fixes.js → migrado
- [ ] test_p3_fixes.js → migrado
- [ ] test_p4_p5_fixes.js → migrado (+ fix P5.2)
- [ ] test_ariadne_thread.js → migrado
- [ ] test_boot_sequence.js → migrado
- [ ] test_browser_pool.js → migrado
- [ ] test_connection_orchestrator.js → migrado
- [ ] test_integration_complete.js → migrado
- [ ] helpers.js → migrado

---

## 2.3 Criar Fixtures Básicas (1h)

### Criar Fixtures de Tasks

```bash
# tasks/task_simple.json
cat > tests/fixtures/tasks/task_simple.json << 'EOF'
{
    "meta": {
        "id": "TEST-SIMPLE-001",
        "version": "3.0",
        "created_at": "2026-01-20T10:00:00Z",
        "priority": 5,
        "source": "test_suite",
        "tags": ["test", "simple"]
    },
    "spec": {
        "target": "chatgpt",
        "model": "gpt-4",
        "payload": {
            "user_message": "What is 2+2?"
        },
        "config": {
            "reset_context": false
        }
    }
}
EOF

# tasks/task_complex.json
cat > tests/fixtures/tasks/task_complex.json << 'EOF'
{
    "meta": {
        "id": "TEST-COMPLEX-001",
        "version": "3.0",
        "created_at": "2026-01-20T10:00:00Z",
        "priority": 8,
        "source": "test_suite",
        "tags": ["test", "complex", "validation"]
    },
    "spec": {
        "target": "chatgpt",
        "model": "gpt-4",
        "payload": {
            "user_message": "Write a detailed analysis of quantum computing"
        },
        "config": {
            "reset_context": true,
            "max_tokens": 2000
        },
        "validation": {
            "min_length": 500,
            "forbidden_terms": ["error", "failed"],
            "required_terms": ["quantum"]
        }
    }
}
EOF

# tasks/task_invalid.json
cat > tests/fixtures/tasks/task_invalid.json << 'EOF'
{
    "meta": {
        "id": "TEST-INVALID-001"
    }
}
EOF
```

### Criar Fixtures de Responses

```bash
# responses/response_success.json
cat > tests/fixtures/responses/response_success.json << 'EOF'
{
    "taskId": "TEST-001",
    "status": "DONE",
    "result": "The answer is 4.",
    "metadata": {
        "duration_ms": 1500,
        "attempts": 1,
        "model": "gpt-4"
    },
    "timestamp": "2026-01-20T10:01:30Z"
}
EOF

# responses/response_error.json
cat > tests/fixtures/responses/response_error.json << 'EOF'
{
    "taskId": "TEST-002",
    "status": "FAILED",
    "error": "Target timeout after 30s",
    "metadata": {
        "duration_ms": 30000,
        "attempts": 3,
        "last_error": "Navigation timeout"
    },
    "timestamp": "2026-01-20T10:02:00Z"
}
EOF
```

### Criar Fixtures de Config

```bash
# config/config_minimal.json
cat > tests/fixtures/config/config_minimal.json << 'EOF'
{
    "BROWSER_MODE": "launcher",
    "MAX_RETRIES": 3,
    "TASK_TIMEOUT_MS": 30000
}
EOF

# config/config_test.json
cat > tests/fixtures/config/config_test.json << 'EOF'
{
    "BROWSER_MODE": "launcher",
    "HEADLESS": "new",
    "MAX_RETRIES": 2,
    "TASK_TIMEOUT_MS": 10000,
    "LOG_LEVEL": "ERROR",
    "BROWSER_ARGS": [
        "--no-sandbox",
        "--disable-setuid-sandbox"
    ]
}
EOF
```

### Checklist

- [ ] 3 fixtures de tasks criadas
- [ ] 2 fixtures de responses criadas
- [ ] 2 fixtures de config criadas
- [ ] Total: 7 fixtures

---

## 2.4 Criar Mocks Básicos (1h)

### Criar mock_logger.js

```bash
cat > tests/mocks/mock_logger.js << 'EOF'
/**
 * Mock Logger
 * Captura logs para validação em testes
 */

class MockLogger {
    constructor() {
        this.calls = [];
        this.silent = true;
    }

    log(level, message, context = {}) {
        this.calls.push({ level, message, context, timestamp: Date.now() });
        if (!this.silent) {
            console.log(`[${level}] ${message}`, context);
        }
    }

    info(message, context) {
        this.log('INFO', message, context);
    }

    warn(message, context) {
        this.log('WARN', message, context);
    }

    error(message, context) {
        this.log('ERROR', message, context);
    }

    debug(message, context) {
        this.log('DEBUG', message, context);
    }

    // Test helpers
    getCalls(level = null) {
        return level ? this.calls.filter(c => c.level === level) : this.calls;
    }

    reset() {
        this.calls = [];
    }

    setSilent(silent) {
        this.silent = silent;
    }
}

function create(options = {}) {
    return new MockLogger(options);
}

module.exports = { MockLogger, create, reset: () => {} };
EOF
```

### Criar mock_nerv.js

```bash
cat > tests/mocks/mock_nerv.js << 'EOF'
/**
 * Mock NERV Event Bus
 * Simula sistema de eventos para testes isolados
 */

const EventEmitter = require('events');

class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.emittedEvents = [];
        this.handlers = new Map();
    }

    emit(envelope) {
        this.emittedEvents.push({ ...envelope, timestamp: Date.now() });
        super.emit(envelope.type, envelope);
        return true;
    }

    on(eventType, handler) {
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, []);
        }
        this.handlers.get(eventType).push(handler);
        super.on(eventType, handler);
    }

    // Test helpers
    getEmittedEvents(type = null) {
        return type
            ? this.emittedEvents.filter(e => e.type === type)
            : this.emittedEvents;
    }

    reset() {
        this.emittedEvents = [];
        this.handlers.clear();
        this.removeAllListeners();
    }

    async close() {
        this.reset();
    }
}

function create() {
    return new MockNERV();
}

module.exports = { MockNERV, create };
EOF
```

### Criar mock_browser.js

```bash
cat > tests/mocks/mock_browser.js << 'EOF'
/**
 * Mock Puppeteer Browser
 * Simula browser para testes sem Puppeteer
 */

class MockPage {
    constructor() {
        this.url = 'about:blank';
        this.content = '<html></html>';
    }

    async goto(url) {
        this.url = url;
        return { status: 200 };
    }

    async evaluate(fn) {
        return fn();
    }

    async close() {
        this.closed = true;
    }
}

class MockBrowser {
    constructor() {
        this.pages = [];
        this.closed = false;
    }

    async newPage() {
        const page = new MockPage();
        this.pages.push(page);
        return page;
    }

    async close() {
        this.closed = true;
        this.pages.forEach(p => (p.closed = true));
    }

    async version() {
        return 'Mock Browser v1.0.0';
    }
}

function create() {
    return new MockBrowser();
}

module.exports = { MockBrowser, MockPage, create };
EOF
```

### Checklist

- [ ] mock_logger.js criado
- [ ] mock_nerv.js criado
- [ ] mock_browser.js criado
- [ ] Todos os mocks testados

---

## 2.5 Validação Final da FASE 2 (30 min)

### Comandos de Validação

```bash
# 1. Executar todos os testes migrados
npm test

# 2. Verificar coverage
npm run test:coverage

# 3. Contar testes
find tests/ -name "*.spec.js" | wc -l

# 4. Verificar fixtures
ls -la tests/fixtures/{tasks,responses,config}/

# 5. Verificar mocks
ls -la tests/mocks/

# 6. Git status
git status
```

### Checklist Final FASE 2

- [ ] ✅ 1 teste obsoleto deletado
- [ ] ✅ 14 testes migrados para nova estrutura
- [ ] ✅ 7 fixtures criadas
- [ ] ✅ 3 mocks criados
- [ ] ✅ Todos os testes passando
- [ ] ✅ Coverage baseline estabelecida
- [ ] ✅ Commits criados (1 por teste migrado)

### Critérios de Sucesso

```
✅ FASE 2 COMPLETA quando:
- 14 testes na nova estrutura
- 14 testes passando
- 7 fixtures criadas
- 3 mocks criados
- Coverage > 14%
- Tempo total: ~4 horas
```

---

# ⏸️ FASE 3: Testes Críticos (🔴 Prioridade Máxima)

**Duração**: 80 horas (2 semanas)
**Objetivo**: Implementar 12 suites de testes críticos
**Status**: PENDENTE (iniciar após FASE 2)

## Overview da FASE 3

```
12 Suites Críticas | 117 Tests | ~80 horas
├── Semana 1: KERNEL + INFRA (6 suites | 61 tests)
└── Semana 2: DRIVER + NERV + CORE (6 suites | 56 tests)
```

## Semana 1: KERNEL + INFRA

### 3.1 test_execution_engine.spec.js (12 tests - 8h)
### 3.2 test_task_runtime.spec.js (10 tests - 7h)
### 3.3 test_policy_engine.spec.js (9 tests - 7h)
### 3.4 test_queue.spec.js (12 tests - 8h)
### 3.5 test_lock_manager.spec.js (10 tests - 7h)
### 3.6 test_io.spec.js (8 tests - 6h) + FIX P5.2

## Semana 2: DRIVER + NERV + CORE

### 3.7 test_driver_factory.spec.js (8 tests - 6h)
### 3.8 test_driver_lifecycle.spec.js (10 tests - 7h)
### 3.9 test_chatgpt_driver.spec.js (15 tests - 10h)
### 3.10 test_nerv_core.spec.js (8 tests - 6h)
### 3.11 test_nerv_buffers.spec.js (10 tests - 7h)
### 3.12 test_logger.spec.js (5 tests - 4h)

**[Detalhamento completo em documento separado]**

---

# ⏸️ FASE 4: Testes Altos (🟡 Alta Prioridade)

**Duração**: 80 horas (2 semanas)
**Objetivo**: Implementar 13 suites de alta prioridade
**Status**: PENDENTE

## Overview da FASE 4

```
13 Suites Altas | 111 Tests | ~80 horas
├── Semana 3: API + Storage + NERV (7 suites)
└── Semana 4: State + Logic + Server (6 suites)
```

**[Detalhamento em documento separado]**

---

# ⏸️ FASE 5: Testes Médios (🟠 Média Prioridade)

**Duração**: 40 horas (1 semana)
**Objetivo**: Implementar 16 suites de média prioridade
**Status**: PENDENTE

**[Detalhamento em documento separado]**

---

# ⏸️ FASE 6: Testes Baixos (🟢 Baixa Prioridade) + CI/CD

**Duração**: 20 horas (3 dias)
**Objetivo**: Completar cobertura e integrar CI/CD
**Status**: PENDENTE

## 6.1 Testes Baixos (8 suites - 12h)
## 6.2 CI/CD Integration (8h)

**[Detalhamento em documento separado]**

---

# 📊 Tracking de Progresso

## Dashboard de Métricas

```bash
# Ver progresso em tempo real
npm run test:coverage

# Ver estatísticas
echo "Tests: $(find tests -name '*.spec.js' | wc -l)"
echo "Coverage: $(c8 report --reporter=json-summary | jq '.total.lines.pct')"
```

## Checklist Geral

### ✅ FASE 0: Auditoria
- [x] Documentação criada
- [x] Estratégia definida

### 🔵 FASE 1: Setup (PRÓXIMA)
- [ ] Dependências instaladas
- [ ] Estrutura criada
- [ ] Configuração completa
- [ ] Validação OK

### ⏸️ FASE 2: Migração
- [ ] Testes obsoletos deletados
- [ ] 14 testes migrados
- [ ] Fixtures criadas
- [ ] Mocks criados

### ⏸️ FASE 3: Críticos (🔴)
- [ ] 12 suites implementadas
- [ ] 117 tests passando
- [ ] Coverage > 40%

### ⏸️ FASE 4: Altos (🟡)
- [ ] 13 suites implementadas
- [ ] 111 tests passando
- [ ] Coverage > 60%

### ⏸️ FASE 5: Médios (🟠)
- [ ] 16 suites implementadas
- [ ] 87 tests passando
- [ ] Coverage > 70%

### ⏸️ FASE 6: Baixos (🟢) + CI
- [ ] 8 suites implementadas
- [ ] 34 tests passando
- [ ] Coverage > 80%
- [ ] CI/CD configurado

---

# 🎯 Meta Final

```
┌──────────────────────────────────────────────────────────┐
│                  STATUS FINAL ESPERADO                   │
├──────────────────────────────────────────────────────────┤
│ Total de Testes:           350+ testes                   │
│ Total de Suites:           65+ suites                    │
│ Coverage Lines:            80%+                          │
│ Coverage Branches:         75%+                          │
│ Coverage Functions:        75%+                          │
│ Tempo de Execução:         < 15 minutos                  │
│ Testes Flaky:              0%                            │
│ CI/CD:                     ✅ Configurado                │
└──────────────────────────────────────────────────────────┘
```

---

**Status Atual**: 📋 Plano completo criado | Aguardando início da FASE 1
**Próxima Ação**: Executar FASE 1 (4 horas de setup)
**Responsável**: [A definir]
**Data de Início**: 2026-01-20
