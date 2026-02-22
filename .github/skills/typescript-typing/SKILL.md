---
name: typescript-typing
description:
  Adicione tipagem TypeScript robusta (interfaces, types, generics) em JS via JSDoc ou migração
  progressiva para TS. Use quando o pedido envolver "tipar", "TypeScript", "interface", "type",
  "migração TS", "definir tipos", ou "fortalecer sistema de tipos" no projeto. Siga o padrão de
  @typedef do projeto e use @ts-check onde apropriado.
license: MIT
---

# Skill — TypeScript Typing (Rigorosa e Robusta)

## Objetivo

Adicionar tipagem robusta ao código JavaScript do projeto:

- **Interfaces e Types**: Definir estruturas de dados
- **Generics**: Para funções e classes genéricas
- **Unions e Intersections**: Para tipos variantes
- **Type Guards**: Para narrowing de tipos
- **Migração progressiva**: JS → TS com JSDoc

## Premissas do projeto (obrigatórias)

- **Runtime:** Node.js 24
- **Módulos:** **ESM** (`import`/`export`)
- **Padrão de tipos:** JSDoc com `@typedef`, `@type`, `@template`
- **TypeScript:** Suportado via `// @ts-check` e arquivos `.ts`

## Quando invocar (gatilhos)

Invocar quando o usuário pedir ou o contexto exigir:

- "tipar", "TypeScript", "interface", "type"
- "migração TS", "migrar para TypeScript"
- "definir tipos", "fortalecer sistema de tipos"
- "generics", "union type", "type guard"
- objetos sem tipagem (identificados na análise de variáveis)

Não invocar quando:

- o usuário quer apenas explicação conceitual
- o arquivo já tem tipagem robusta e consistente

## Regras obrigatórias (não negociáveis)

### 1. Preferir Interfaces para objetos

```javascript
/**
 * @typedef {Object} TaskConfig
 * @property {string} taskId
 * @property {number} priority
 * @property {boolean} isEnabled
 */
```

### 2. Usar Types para uniões e interseções

```javascript
/** @typedef {'PENDING'|'ACTIVE'|'TERMINATED'} TaskState */

/** @typedef {{
 *   id: string,
 *   status: TaskState
 * } & BaseConfig} TaskWithBase */
```

### 3. Generics para funções genéricas

```javascript
/**
 * @template T
 * @param {T[]} items
 * @returns {T | undefined}
 */
function first(items) {
  return items[0];
}
```

### 4. Type Guards para narrowing

```javascript
/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
  return typeof value === 'string';
}
```

### 5. Nunca usar `any`

- Usar `unknown` para tipos genéricos
- Usar `never` para tipos impossíveis
- Usar unions para tipos variantes

### 6. Consistência com constantes existentes

- Usar ENUMs de `#core/constants` quando possível
- Manter consistência de nomenclatura

## Procedimento (passo a passo)

### 1) Análise do código-alvo

- Identificar objetos e funções que precisam de tipagem
- Verificar se já existem tipos canônicos no projeto
- Mapear dependências de tipos

### 2) Definir tipos no topo do arquivo

Após imports:

- `@typedef` para objetos
- `@type` para aliases
- `@template` para generics

### 3) Aplicar tipos às funções/classes

- Parâmetros tipados
- Retornos tipados
- Propriedades de classes

### 4) Testar com @ts-check

- Habilitar `// @ts-check` se não existir
- Resolver warnings com melhores tipos
- Não usar `any` para "silenciar"

## Padrões de nomenclatura

| Tipo      | Padrão                | Exemplo                     |
| --------- | --------------------- | --------------------------- |
| Interface | PascalCase descritivo | `TaskConfig`, `DriverState` |
| Type      | PascalCase descritivo | `TaskStateUnion`            |
| Enum      | SCREAMING_SNAKE_CASE  | `TASK_STATES`               |
| Generic   | T, U, K, V            | `@template T`               |

## Formato de entrega (output)

Ao aplicar no arquivo:

- Incluir diff se pedido "corrigir/atualizar"
- Caso contrário, devolver arquivo completo
- Incluir 3–7 bullets finais:
  - tipos criados/definicões
  - interfaces adicionadas
  - generics implementados
  - type guards (se aplicável)

## Critérios de aceitação (Definition of Done)

- Todas as funções/export têm tipagem de parâmetros e retorno
- Objetos têm @typedef com @property
- Generics usados onde apropriado
- Nenhum `any` novo
- Consistência com tipos existentes do projeto
- @ts-check funcionando sem erros críticos
