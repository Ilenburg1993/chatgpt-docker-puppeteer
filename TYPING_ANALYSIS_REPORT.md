# Relatório de Análise de Tipagem

## Visão Geral

Este relatório identifica oportunidades de melhoria na tipagem do código-fonte JavaScript do
projeto.

## Estatísticas de Tipagem

| Métrica             | Valor  |
| ------------------- | ------ |
| Total de variáveis  | 7.800  |
| Variáveis tipadas   | ~2.000 |
| Variáveis "unknown" | 5.783  |
| Percentual tipado   | ~25%   |

## Distribuição de Tipos Atuais

| Tipo      | Quantidade | Percentual |
| --------- | ---------- | ---------- |
| unknown   | 5.783      | 74%        |
| undefined | 346        | 4%         |
| instance  | 335        | 4%         |
| array     | 319        | 4%         |
| null      | 259        | 3%         |
| string    | 201        | 3%         |
| boolean   | 191        | 2%         |
| number    | 183        | 2%         |
| function  | 105        | 1%         |
| object    | 73         | 1%         |

## Arquivos com Maior Necessidade de Tipagem

### 1. Arquivos com objetos complexos (tipo "unknown")

| Arquivo             | Problema                  | Recomendação                     |
| ------------------- | ------------------------- | -------------------------------- |
| authority.js        | SERVER_AUTHORITIES object | Criar interface BrowserAuthority |
| browser.js          | CONNECTION_MODES object   | Já tem @enum                     |
| logging.js          | LOG_CATEGORIES object     | Já tem @enum                     |
| migrations.js       | MIGRATIONS array          | Criar interface Migration        |
| execution_engine.js | DecisionKind object       | Criar interface DecisionKind     |
| kernel_loop.js      | KernelLoopState object    | Criar interface KernelLoopState  |
| policy_engine.js    | PolicyLevel object        | Criar interface PolicyLevel      |

### 2. Arquivos com funções sem tipagem de retorno

Verificar arquivos em:

- src/kernel/
- src/orchestrator/
- src/server/
- src/infra/

### 3. Interfaces Canônicas Recomendadas

```javascript
// === CORE TYPES ===

/**
 * Configuration object for browser pool
 * @typedef {Object} BrowserPoolConfig
 * @property {number} maxSize - Maximum number of browsers
 * @property {number} minSize - Minimum number of browsers
 * @property {number} idleTimeout - Idle timeout in ms
 */

/**
 * Task execution result
 * @typedef {Object} TaskResult
 * @property {string} taskId - Unique task identifier
 * @property {'SUCCESS'|'FAILED'|'CANCELLED'} status - Task status
 * @property {unknown} data - Task result data
 * @property {string} [error] - Error message if failed
 */

/**
 * Driver state representation
 * @typedef {Object} DriverState
 * @property {string} driverId - Driver identifier
 * @property {'IDLE'|'BUSY'|'ERROR'} state - Current state
 * @property {string} [currentDomain] - Current domain context
 * @property {number} createdAt - Creation timestamp
 */

/**
 * Connection metadata
 * @typedef {Object} ConnectionInfo
 * @property {string} id - Connection identifier
 * @property {string} mode - Connection mode
 * @property {boolean} isActive - Active status
 * @property {number} connectedAt - Connection timestamp
 */

// === ENUM TYPES ===

/** @typedef {'INITIALIZATION'|'UNKNOWN_CONTEXT'|'MAIN_PAGE'|'IFRAME'|'POPUP'} DriverDomain */

/** @typedef {'PENDING'|'RUNNING'|'SUCCESS'|'FAILED'|'CANCELLED'} TaskStatus */

/** @typedef {'CONTROL'|'META'|'SHIFT'|'ALT'} ModifierKey */

// === GENERIC TYPES ===

/**
 * Result wrapper for operations
 * @template T
 * @typedef {Object} Result<T>
 * @property {boolean} success - Operation success
 * @property {T} [data] - Result data
 * @property {string} [error] - Error message
 */

/**
 * Pagination parameters
 * @typedef {Object} PaginationParams
 * @property {number} page - Page number (0-indexed)
 * @property {number} pageSize - Items per page
 * @property {string} [sortBy] - Sort field
 * @property {'asc'|'desc'} [sortOrder] - Sort direction
 */
```

## Plano de Tipagem

### Fase 1: Tipos Core (prioridade alta)

1. Adicionar tipos a `src/core/constants/`
2. Criar `src/types/core.d.ts` para tipos compartilhados

### Fase 2: Interfaces de Domínio (prioridade média)

1. Browser pool → BrowserPoolConfig
2. Task execution → TaskResult, TaskStatus
3. Driver state → DriverState

### Fase 3: Funções e Métodos (prioridadebaixa)

1. Tipar parâmetros e retornos
2. Adicionar @template para generics
3. Criar type guards

## Skill de Tipagem

Uma skill de tipagem foi criada em: `.github/skills/typescript-typing/SKILL.md`

Esta skill define:

- Quando invocar tipagem
- Padrões de @typedef
- Regras para generics
- Critérios de aceitação

## Métricas-Alvo

| Métrica                | Atual | Meta  |
| ---------------------- | ----- | ----- |
| % tipado               | 25%   | 60%   |
| Variáveis unknown      | 5.783 | 2.000 |
| Arquivos com @ts-check | ~50   | 150   |

## Conclusão

O projeto tem oportunidade significativa de melhoria na tipagem. A maior necessidade está em:

1. Objetos de configuração
2. Interfaces de domínio
3. Tipos de retorno de funções

A implementação deve seguir a skill de tipagem criada para manter consistência.
