# Arquitetura de Tipos, Enums e Constantes

## 1. Estrutura de Arquivos

```
src/core/
├── constants/           # Constantes centralizadas (NEW)
│   ├── index.js        # Barrel export de todas as constantes
│   ├── tasks.js        # TASK_STATES, TASK_PRIORITIES
│   ├── nerv.js         # NERV_EVENTS, MESSAGE_TYPES
│   ├── browser.js      # CONNECTION_MODES, BROWSER_STATES
│   ├── drivers.js      # DRIVER_TYPES, DRIVER_EVENTS
│   ├── logging.js      # LOG_LEVELS, LOG_CATEGORIES
│   └── errors.js       # ERROR_TYPES, FAILURE_CATEGORIES
│
└── schemas.js          # Usa constantes via import (UPDATED)
```

## 2. Padrão de Implementação

### 2.1 Definição de Constantes (tasks.js exemplo)

```javascript
/**
 * Estados válidos de uma tarefa
 * @readonly
 * @enum {string}
 */
const TASK_STATES = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
});

/**
 * Array de valores para validação Zod
 * @type {ReadonlyArray<string>}
 */
const TASK_STATES_VALUES = Object.freeze(Object.values(TASK_STATES));

/**
 * Helper para validar estado
 * @param {string} state
 * @returns {boolean}
 */
const isValidTaskState = (state) => TASK_STATES_VALUES.includes(state);

module.exports = {
    TASK_STATES,
    TASK_STATES_VALUES,
    isValidTaskState
};
```

### 2.2 Uso em Schemas (schemas.js)

```javascript
const { z } = require('zod');
const { TASK_STATES_VALUES } = require('./constants/tasks');
const { LOG_LEVELS_VALUES } = require('./constants/logging');

const taskSchema = z.object({
    id: z.string().uuid(),
    state: z.enum(TASK_STATES_VALUES), // ✅ Type-safe
    priority: z.enum(['HIGH', 'NORMAL', 'LOW']),
    // ...
});
```

### 2.3 Uso em Código (exemplo)

```javascript
const { TASK_STATES } = require('./core/constants/tasks');
const { NERV_EVENTS } = require('./core/constants/nerv');

// ❌ ANTES: Magic strings
if (task.state === 'RUNNING') { ... }
nerv.emit('TASK_STATE_CHANGE', data);

// ✅ DEPOIS: Type-safe
if (task.state === TASK_STATES.RUNNING) { ... }
nerv.emit(NERV_EVENTS.TASK_STATE_CHANGE, data);
```

## 3. Categorias a Mapear

### 3.1 Task Management (tasks.js)
- **TASK_STATES**: PENDING, RUNNING, DONE, FAILED, CANCELLED
- **TASK_PRIORITIES**: HIGH, NORMAL, LOW
- **TASK_TYPES**: SINGLE, BATCH, SCHEDULED

### 3.2 NERV Events (nerv.js)
- **NERV_EVENTS**:
  - DRIVER_EXECUTE
  - TASK_STATE_CHANGE
  - KERNEL_READY
  - SHUTDOWN_REQUEST
  - HEALTH_CHECK
  - TELEMETRY_UPDATE
- **MESSAGE_TYPES**: REQUEST, RESPONSE, EVENT, ERROR
- **TRANSPORT_MODES**: LOCAL, REMOTE, HYBRID

### 3.3 Browser Management (browser.js)
- **CONNECTION_MODES**: launcher, external, auto
- **BROWSER_STATES**: (do ConnectionOrchestrator)
  - INIT
  - WAITING_FOR_BROWSER
  - CONNECTING_BROWSER
  - BROWSER_READY
  - BROWSER_LOST
  - CONNECTION_ERROR
- **BROWSER_EVENTS**: connected, disconnected, error

### 3.4 Driver System (drivers.js)
- **DRIVER_TYPES**: chatgpt, gemini, claude (extensível)
- **DRIVER_STATES**: IDLE, BUSY, ERROR, COOLDOWN
- **DRIVER_EVENTS**:
  - EXECUTE_REQUEST
  - EXECUTE_SUCCESS
  - EXECUTE_FAILURE
  - COOLDOWN_START
  - COOLDOWN_END

### 3.5 Logging (logging.js)
- **LOG_LEVELS**: DEBUG, INFO, WARN, ERROR, CRITICAL
- **LOG_CATEGORIES**: BOOT, TASK, DRIVER, NERV, KERNEL, SERVER, INFRA

### 3.6 Error Handling (errors.js)
- **ERROR_TYPES**:
  - VALIDATION_ERROR
  - TIMEOUT_ERROR
  - NETWORK_ERROR
  - BROWSER_ERROR
  - TASK_ERROR
  - INFRA_ERROR
- **FAILURE_CATEGORIES**: (para classifyFailure)
  - TASK_FAILURE
  - INFRA_FAILURE
  - SEMANTIC_FAILURE

### 3.7 Infra (infra.js)
- **LOCK_TYPES**: EXCLUSIVE, SHARED
- **LOCK_STATES**: ACQUIRED, RELEASED, ORPHANED
- **QUEUE_OPERATIONS**: ADD, REMOVE, UPDATE, QUERY

### 3.8 Server/API (server.js)
- **HTTP_METHODS**: GET, POST, PUT, DELETE
- **API_ROUTES**: (como constantes)
- **SOCKET_EVENTS**:
  - task_update
  - status_broadcast
  - queue_change

## 4. Ferramentas de Scan Sugeridas

### 4.1 AST-based Analysis
```bash
# Usar esprima/acorn para parsear JS e extrair literais
npm install --save-dev esprima
```

### 4.2 Grep Pattern Analysis
```bash
# Buscar padrões comuns de magic strings
grep -r "state === '[A-Z_]*'" src/
grep -r "\.emit\('[A-Z_]*'" src/
grep -r "mode: '[a-z]*'" src/
```

### 4.3 Custom Node Script
```javascript
// scripts/scan_literals.js
const fs = require('fs');
const path = require('path');
const esprima = require('esprima');

// Scan AST para Literal strings em comparações, emits, etc.
```

## 5. Plano de Migração

### Fase 1: Setup (1 arquivo)
1. Criar `src/core/constants/index.js` vazio
2. Criar estrutura de pastas

### Fase 2: Core Constants (3 arquivos)
1. `tasks.js` - Estados e prioridades de tarefas
2. `nerv.js` - Eventos NERV
3. `browser.js` - Modos de conexão

### Fase 3: Atualizar Schemas (1 arquivo)
1. Modificar `src/core/schemas.js` para usar enums

### Fase 4: Scan & Replace (automático)
1. Executar script de scan
2. Gerar relatório de ocorrências
3. Aplicar replacements via jscodeshift/AST

### Fase 5: Validação (testes)
1. Rodar suite de testes
2. Verificar ESLint
3. Verificar tipos em runtime

## 6. Benefícios Esperados

### 6.1 Development Experience
- ✅ Autocomplete em IDE
- ✅ Detecção de typos em desenvolvimento
- ✅ Refactoring seguro (rename all references)
- ✅ Documentação inline via JSDoc

### 6.2 Runtime Safety
- ✅ Validação Zod mais forte
- ✅ Erros detectados cedo (fail-fast)
- ✅ Stack traces mais claras

### 6.3 Maintainability
- ✅ Single source of truth
- ✅ Fácil adicionar novos valores
- ✅ Documentação centralizada
- ✅ Menos bugs de string mismatch

## 7. Compatibilidade

### Retrocompatibilidade
- ✅ Valores finais são strings (sem quebra)
- ✅ Schemas Zod continuam validando igual
- ✅ Migração incremental possível
- ✅ Testes garantem comportamento

### TypeScript Future-Proof
```typescript
// Se migrar para TS no futuro
export enum TaskState {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    DONE = 'DONE',
    FAILED = 'FAILED'
}
```

## 8. Próximos Passos

1. **Aprovar arquitetura** ✅
2. **Escolher ferramenta de scan** (grep vs AST)
3. **Executar scan completo**
4. **Revisar relatório de literais encontrados**
5. **Implementar constants/ progressivamente**
6. **Aplicar replacements**
7. **Validar com testes**
8. **Atualizar copilot-instructions.md**

---

**Estimativa de impacto:**
- ~50-80 magic strings substituídas
- ~8 arquivos de constantes criados
- ~1 arquivo schemas.js atualizado
- ~30+ arquivos de código atualizado (importações)
- 0 breaking changes (valores permanecem strings)
