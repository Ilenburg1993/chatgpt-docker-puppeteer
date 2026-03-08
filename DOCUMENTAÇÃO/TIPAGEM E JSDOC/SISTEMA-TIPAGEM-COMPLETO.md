# Sistema de Tipagem — Guia Completo

> **Versão**: 1.0.0 | **Data**: 7 de março de 2026
>
> **Status**: Canônico — documento mestre do sistema de tipagem TypeScript/JSDoc/TSServer.
>
> **Navegação**: [Hub](./) · [ROADMAP](./ROADMAP.md) · [PADRÕES](./PADROES.md) ·
> [CONFIGS](./CONFIGURACOES-TSCONFIG.md) · [SCRIPTS](./SCRIPTS-E-AUTOMACAO.md)

---

## Índice

1. [Visão geral do sistema](#1-visão-geral-do-sistema)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Hierarquia de configurações TypeScript](#3-hierarquia-de-configurações-typescript)
4. [Sistema de lanes strict (41 lanes)](#4-sistema-de-lanes-strict-41-lanes)
5. [Flags TypeScript — estado e justificativas](#5-flags-typescript--estado-e-justificativas)
6. [JSDoc — padrões e cobertura](#6-jsdoc--padrões-e-cobertura)
7. [Sistema TSServer / LSP local](#7-sistema-tsserver--lsp-local)
8. [Aliases de módulo](#8-aliases-de-módulo)
9. [Scripts npm de tipagem](#9-scripts-npm-de-tipagem)
10. [CI/CD — quality gates de tipagem](#10-cicd--quality-gates-de-tipagem)
11. [Decisões arquiteturais registradas](#11-decisões-arquiteturais-registradas)
12. [Roadmap de fases concluídas e próximas](#12-roadmap-de-fases-concluídas-e-próximas)
13. [Guia prático — como trabalhar com tipagem](#13-guia-prático--como-trabalhar-com-tipagem)

---

## 1. Visão geral do sistema

Este repositório é uma **aplicação Node.js 24+ puramente ESM**, escrita em JavaScript com
**JSDoc como linguagem de tipagem**. O TypeScript é usado apenas como verificador estático
(`allowJs + checkJs`), sem transpilar código.

### Filosofia central

```
JavaScript de produção (runtime)    →  .js/.mjs/.cjs
Tipagem pública (contratos)         →  JSDoc @param/@returns/@typedef
Verificação estática (CI)           →  TypeScript 5.9 (tsc --noEmit)
Declarações públicas (API)          →  src/types/**/*.d.ts
LSP / IntelliSense                  →  tsserver local wrapper
```

### Princípios

1. **JS-first**: nunca converter `.js` de produção para `.ts`. JSDoc é o contrato público.
2. **Verificação sem emissão**: `noEmit: true` em todas as configs base. TypeScript não gera código.
3. **Strict global**: `strict: true` em `tsconfig.base.json` — todas as verificações strict ativas.
4. **Lanes isoladas**: cada domínio do código tem sua própria config strict para isolamento de erros.
5. **Cobertura 100%**: toda exportação pública deve ter JSDoc completo com tipos explícitos.
6. **Sem @ts-nocheck**: proibido. Sem @ts-ignore em src/.

---

## 2. Stack tecnológico

| Componente     | Versão/Valor | Papel                                          |
| -------------- | ------------ | ---------------------------------------------- |
| Node.js        | 24.13.0      | Runtime obrigatório (ESM nativo)               |
| TypeScript     | 5.9.3        | Verificador estático (via tsc, não runtime)    |
| `tsc`          | 5.9.3        | Compilador/verificador TypeScript              |
| `vue-tsc`      | ≥ 2.x        | Verificação de SFCs Vue em `src/dashboard-ui/` |
| jsServer local | wrapper      | `src/integration/lsp/tsserver-daemon.mjs`      |
| ESLint         | 9.x          | Lint de JS + regras custom                     |
| Prettier       | 3.8.0        | Formatação (4 espaços, 120 colunas)            |

### Dependências de tipos (`@types/`)

| Pacote                  | Cobertura                            |
| ----------------------- | ------------------------------------ |
| `@types/node`           | Node.js 24 APIs globais              |
| `@types/express`        | Express 4.x tipagem                  |
| `@types/better-sqlite3` | SQLite3 para `src/infra/db/*.js`     |
| `@types/ws`             | WebSocket para `scripts/root/*.mjs`  |
| `@types/sinon`          | Mocking em testes                    |
| `@types/supertest`      | HTTP testing em testes de integração |
| `puppeteer`             | Tipos internos (browser automation)  |

---

## 3. Hierarquia de configurações TypeScript

### 3.1 Árvore de herança

```
tsconfig.base.json                     ← BASE: flags globais, allowJs, strict
│
├── tsconfig.node.json                 ← Backend (src/, scripts/) — NodeNext
├── tsconfig.tools.json                ← Ferramentas (tools/) — NodeNext
├── tsconfig.browser.json              ← Dashboard Vue (src/dashboard-ui/) — ESNext
├── tsconfig.tests.json                ← Testes (tests/) — NodeNext + src/types/*.d.ts
├── tsconfig.declarations.json         ← Emissão de .d.ts (src/types/) — noEmit:false
├── tsconfig.isolated-declarations.json← Isolated declarations (src/types/, LSP contract)
└── tsconfig.strict.json               ← Workspace de referências — 41 lanes individuais
    └── config/typing/strict/
        └── tsconfig.strict.<nome>.json  (uma por domínio)
```

### 3.2 `tsconfig.base.json` — configuração raiz

```jsonc
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // Verificação de JS
    "allowJs": true,                    // aceita .js como entrada
    "checkJs": true,                    // aplica verificação TypeScript a .js
    "noEmit": true,                     // não gera arquivos — só valida
    "incremental": true,                // cache incremental para velocidade

    // Target
    "target": "ES2024",                 // alinhado ao Node.js 24
    "verbatimModuleSyntax": true,       // preserva import/export como escrito (ESM puro)
    "resolvePackageJsonExports": true,  // respeita campo exports de packages
    "resolvePackageJsonImports": true,  // respeita imports internos (#alias)
    "downlevelIteration": true,         // iteradores compatíveis

    // Strict — TODOS ATIVOS desde Fase D (7 mar 2026)
    "strict": true,                     // ativa conjunto completo de strict flags
    "useUnknownInCatchVariables": true, // catch (e) → e: unknown (não any)
    "strictNullChecks": true,           // explicitado (já incluído em strict:true)

    // Biblioteca e resolução
    "skipLibCheck": true,               // não verifica node_modules/*.d.ts
    "maxNodeModuleJsDepth": 0,          // não infere tipos de JS em node_modules

    // Aliases de módulo (paths)
    "baseUrl": ".",
    "paths": { "#core/*": ["src/core/*"], /* ... ver seção 8 */ }
  }
}
```

**Flags habilitadas implicitamente por `strict: true`**:

| Flag                           | Efeito                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `strictNullChecks`             | `null`/`undefined` não são atribuíveis a outros tipos      |
| `noImplicitAny`                | Parâmetros sem tipo explícito geram erro                   |
| `strictFunctionTypes`          | Funções verificadas por contra-variância em parâmetros     |
| `strictBindCallApply`          | `.bind()/.call()/.apply()` verificados contra a assinatura |
| `strictPropertyInitialization` | Propriedades de classe devem ser inicializadas             |
| `noImplicitThis`               | `this` com tipo implícito `any` gera erro                  |
| `alwaysStrict`                 | Gera `"use strict"` em todos os arquivos de saída          |
| `useUnknownInCatchVariables`   | `catch (e)` → `e: unknown` (não `any`)                     |

**Flags intencionalmente NÃO ativadas** (com justificativa):

| Flag                                 | Razão para não ativar                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| `noUncheckedIndexedAccess`           | Geraria ~400 erros em código válido; reservado para Fase F    |
| `exactOptionalPropertyTypes`         | Incompatível com padrões `options?` já consolidados           |
| `noPropertyAccessFromIndexSignature` | Muito restritivo para o estilo JS-first com objetos dinâmicos |

### 3.3 Configurações de superfície (não-strict)

#### `tsconfig.node.json`

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "types": ["node"],
    "tsBuildInfoFile": "/home/node/.cache/typescript/tsconfig.node.tsbuildinfo"
  },
  "include": ["src/**/*", "scripts/**/*", "*.{js,mjs,cjs}"],
  "exclude": ["src/dashboard-ui/**", "node_modules", "dist", ...]
}
```

- **Escopo**: todo o backend (`src/`) exceto dashboard, mais `scripts/` e raiz
- **Alias npm**: `npm run typecheck:node`
- **Meta**: 0 erros (atingida desde Fase 0)

#### `tsconfig.tools.json`

- **Escopo**: `tools/**`
- **Alias npm**: `npm run typecheck:tools`

#### `tsconfig.browser.json`

- **Escopo**: `src/dashboard-ui/**` (Vue 3 + Vite)
- **Módulo**: `ESNext` (não NodeNext)
- **Lib**: `ES2024, DOM, DOM.Iterable`
- **Alias npm**: `npm run typecheck:browser`
- **Verificação Vue**: `npm run typecheck:dashboard` (via vue-tsc separado)

#### `tsconfig.tests.json`

- **Escopo**: `tests/**` + `src/types/**/*.d.ts`
- **Inclui src/types** para que testes acessem declarações públicas do projeto
- **Alias npm**: `npm run typecheck:tests`

#### `tsconfig.declarations.json`

- **Propósito**: emitir `.d.ts` para APIs públicas (não-strict, apenas emissão)
- **`noEmit`: false** — único config que gera artefatos
- **Saída**: `tmp/types-public/`
- **Alias npm**: `npm run typecheck:declarations`

#### `tsconfig.isolated-declarations.json`

- **Propósito**: verificar conformidade com `isolatedDeclarations: true`
- **Escopo**: `src/types/**/*.d.ts` + `src/integration/lsp/tsserver-contract.d.ts`
- **Efeito**: todos os tipos públicos devem ser inferíveis sem processar implementações
- **Alias npm**: `npm run typecheck:isolated`

#### `tsconfig.strict.json`

- **Propósito**: workspace de referências para as 41 lanes strict
- **Contém apenas** `"references"` apontando para cada lane individual
- **Alias npm**: `npm run typecheck:strict:all`

---

## 4. Sistema de lanes strict (41 lanes)

### 4.1 Estrutura de uma lane

Cada arquivo em `config/typing/strict/tsconfig.strict.<nome>.json` segue o padrão:

```jsonc
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,                  // obrigatório para referências
    "noImplicitReturns": true,          // funções devem retornar em todos os caminhos
    "noFallthroughCasesInSwitch": true, // switch sem break explícito gera erro
    "tsBuildInfoFile": "/home/node/.cache/typescript/tsconfig.strict.<nome>.tsbuildinfo",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "types": ["node"]
  },
  "include": ["<diretório-específico>/**/*", "src/types/**/*.d.ts"]
}
```

As lanes adicionam duas flags extras além do `strict: true` herdado:
- `noImplicitReturns`: funções com retorno não-nulo devem retornar em todos os caminhos
- `noFallthroughCasesInSwitch`: evita fallthrough acidental em switch

### 4.2 Lista completa das 41 lanes

| Lane                    | Diretório                | Status |
| ----------------------- | ------------------------ | ------ |
| `public`                | raiz (index.js)          | ✅ 0    |
| `configs`               | `config/`                | ✅ 0    |
| `agents`                | `agents/`                | ✅ 0    |
| `tools.workspace`       | `tools/`                 | ✅ 0    |
| `src.root`              | `src/*.js`               | ✅ 0    |
| `src.types`             | `src/types/`             | ✅ 0    |
| `src.core`              | `src/core/`              | ✅ 0    |
| `src.nerv`              | `src/nerv/`              | ✅ 0    |
| `src.kernel`            | `src/kernel/`            | ✅ 0    |
| `src.agent`             | `src/agent/`             | ✅ 0    |
| `src.driver`            | `src/driver/`            | ✅ 0    |
| `src.infra`             | `src/infra/`             | ✅ 0    |
| `src.server`            | `src/server/`            | ✅ 0    |
| `src.orchestrator`      | `src/orchestrator/`      | ✅ 0    |
| `src.missions`          | `src/missions/`          | ✅ 0    |
| `src.logic`             | `src/logic/`             | ✅ 0    |
| `src.shared`            | `src/shared/`            | ✅ 0    |
| `src.validation`        | `src/validation/`        | ✅ 0    |
| `src.audit_agent`       | `src/audit_agent/`       | ✅ 0    |
| `src.inference_gateway` | `src/inference_gateway/` | ✅ 0    |
| `src.integration`       | `src/integration/`       | ✅ 0    |
| `src.dashboard-ui`      | `src/dashboard-ui/`      | ✅ 0    |
| `scripts.root`          | `scripts/*.{mjs,cjs}`    | ✅ 0    |
| `scripts.analysis`      | `scripts/analysis/`      | ✅ 0    |
| `scripts.audit`         | `scripts/audit/`         | ✅ 0    |
| `scripts.build`         | `scripts/build/`         | ✅ 0    |
| `scripts.ci`            | `scripts/ci/`            | ✅ 0    |
| `scripts.env`           | `scripts/env/`           | ✅ 0    |
| `scripts.health`        | `scripts/health/`        | ✅ 0    |
| `scripts.legacy`        | `scripts/legacy/`        | ✅ 0    |
| `scripts.ops`           | `scripts/ops/`           | ✅ 0    |
| `scripts.setup`         | `scripts/setup/`         | ✅ 0    |
| `tests.unit`            | `tests/unit/`            | ✅ 0    |
| `tests.integration`     | `tests/integration/`     | ✅ 0    |
| `tests.regression`      | `tests/regression/`      | ✅ 0    |
| `tests.e2e`             | `tests/e2e/`             | ✅ 0    |
| `tests.helpers`         | `tests/helpers/`         | ✅ 0    |
| `tests.fixtures`        | `tests/fixtures/`        | ✅ 0    |
| `tests.mocks`           | `tests/mocks/`           | ✅ 0    |
| `tests.manual`          | `tests/manual/`          | ✅ 0    |
| `tests.legacy`          | `tests/legacy/`          | ✅ 0    |

### 4.3 Como rodar uma lane individualmente

```bash
# Lane específica
npm run typecheck:strict:src.kernel

# Todas as lanes
npm run typecheck:strict:all

# Atalhos de domínio
npm run typecheck:strict:core     # → src.core
npm run typecheck:strict:infra    # → src.infra
npm run typecheck:strict:tests    # → todas as lanes de tests.*
```

### 4.4 Como adicionar uma nova lane

1. Criar `config/typing/strict/tsconfig.strict.<nome>.json` seguindo o template da seção 4.1
2. Adicionar no `tsconfig.strict.json`: `{ "path": "./config/typing/strict/tsconfig.strict.<nome>.json" }`
3. Adicionar script npm em `package.json`:
   ```json
   "typecheck:strict:<nome>": "tsc -p config/typing/strict/tsconfig.strict.<nome>.json"
   ```
4. Incluir no script `typecheck:strict:all`
5. Documentar na seção 4.2 deste arquivo e no `ROADMAP.md`

---

## 5. Flags TypeScript — estado e justificativas

### 5.1 Estado completo em tsconfig.base.json (7 mar 2026)

| Flag                         | Valor    | Ativado em | Justificativa                                  |
| ---------------------------- | -------- | ---------- | ---------------------------------------------- |
| `allowJs`                    | `true`   | Início     | Repositório JS-first                           |
| `checkJs`                    | `true`   | Início     | Verificação TS sobre JS via JSDoc              |
| `noEmit`                     | `true`   | Início     | Verificação apenas, sem transpilação           |
| `incremental`                | `true`   | Início     | Cache em `/home/node/.cache/typescript/`       |
| `target`                     | `ES2024` | Início     | Node.js 24 suporta ES2024 nativamente          |
| `verbatimModuleSyntax`       | `true`   | Fase 0     | Previne import-elision indesejado em ESM       |
| `resolvePackageJsonExports`  | `true`   | Fase 0     | Respeita campo `exports` em package.json       |
| `resolvePackageJsonImports`  | `true`   | Fase 0     | Respeita imports internos com `#alias`         |
| `downlevelIteration`         | `true`   | Fase 0     | Iteradores corretos em ES baixo                |
| `strict`                     | `true`   | **Fase D** | Ativa todas as strict flags de uma vez         |
| `useUnknownInCatchVariables` | `true`   | **Fase D** | `catch (e) → e: unknown` (mais seguro que any) |
| `strictNullChecks`           | `true`   | **Fase D** | Explicitado (já incluído em strict)            |
| `skipLibCheck`               | `true`   | Início     | node_modules não verificado (perf)             |
| `maxNodeModuleJsDepth`       | `0`      | Fase 0     | Não infere tipos de JS em node_modules         |

### 5.2 Flags adicionais nas lanes strict

| Flag                         | Valor  | Presente em |
| ---------------------------- | ------ | ----------- |
| `composite`                  | `true` | todas lanes |
| `noImplicitReturns`          | `true` | todas lanes |
| `noFallthroughCasesInSwitch` | `true` | todas lanes |

### 5.3 Flags da config isolatedDeclarations

| Flag                   | Valor   | Motivo                                            |
| ---------------------- | ------- | ------------------------------------------------- |
| `isolatedDeclarations` | `true`  | Tipos públicos inferíveis sem processar impls     |
| `declaration`          | `true`  | Emite .d.ts para verificação                      |
| `emitDeclarationOnly`  | `true`  | Só emite .d.ts, não .js                           |
| `noEmit`               | `false` | Precisa emitir para validar isolated declarations |
| `allowJs`              | `false` | Só verifica .d.ts (não .js neste config)          |

---

## 6. JSDoc — padrões e cobertura

### 6.1 Padrões obrigatórios

Todo arquivo de produção (`src/**/*.js`) deve ter na primeira linha:

```js
// @ts-check
```

Todo export público deve ter JSDoc completo:

```js
/**
 * Executa uma tarefa no kernel.
 *
 * @param {string} taskId - Identificador único da tarefa
 * @param {ExecuteOptions} options - Opções de execução
 * @returns {Promise<TaskResult>} Resultado da execução
 * @throws {TaskNotFoundError} Se taskId não existir na fila
 */
export async function executeTask(taskId, options) { ... }
```

### 6.2 Tipagem de objetos de opções

Para parâmetros `options`, crie um `@typedef` nomeado **antes** da função:

```js
/**
 * @typedef {object} ExecuteOptions
 * @property {number} [timeout=30000] - Timeout em ms
 * @property {boolean} [retry=true] - Tentar novamente em falha transitória
 * @property {string} [label] - Rótulo para observabilidade
 */

/**
 * @param {ExecuteOptions} options
 */
export function execute(options) { ... }
```

### 6.3 Importação de tipos externos

**Padrão moderno** (use para novos usos):
```js
/** @import { Page } from 'puppeteer-core' */
/** @import { Database } from 'better-sqlite3' */
```

**Padrão legado** (não usar em código novo):
```js
// EVITAR — usar @import acima
/** @typedef {import('puppeteer-core').Page} Page */
```

### 6.4 Casts de tipo

Para forçar um tipo específico:
```js
const typed = /** @type {MyType} */ (value);
```

Para acesso dinâmico a chave (use com moderação):
```js
const val = /** @type {any} */ (obj)[dynamicKey];  // cast interno — aceitável
```

**Proibido em posições públicas** (`@param`, `@returns`, `@type` de propriedade exportada):
```js
// PROIBIDO em API pública
/** @param {any} options */  // use um typedef específico
```

### 6.5 Tags TS avançadas em JSDoc

| Tag           | Quando usar                                              | Exemplo                                  |
| ------------- | -------------------------------------------------------- | ---------------------------------------- |
| `@import`     | Importar tipo de módulo externo (padrão moderno TS 5.5+) | `/** @import { T } from 'mod' */`        |
| `@template`   | Função ou classe genuinamente genérica                   | `/** @template T */`                     |
| `@satisfies`  | Objeto literal deve conformar a tipo sem widening        | `const x = /** @satisfies {T} */({}) `   |
| `@overload`   | Múltiplas assinaturas para mesma função                  | Ver `@overload` em TS docs               |
| `@deprecated` | Marcar símbolo obsoleto                                  | `/** @deprecated Usar X em vez disso */` |

### 6.6 Métricas de cobertura atual (7 mar 2026)

| Métrica                             | Atual     | Meta    |
| ----------------------------------- | --------- | ------- |
| `coverage_pct` (exports)            | **100%**  | 100%    |
| `functions_missing_returns_tag`     | **0** ✅   | 0       |
| `functions_missing_param_tags`      | **0** ✅   | 0       |
| `functions_missing_options_typedef` | **52** ⚠️  | ≤ 10    |
| `unsafe_generic_tags_total`         | **511** ⚠️ | ≤ 300   |
| `@ts-check` src/                    | **100%**  | 100%    |
| `@ts-check` scripts/                | **100%**  | 100%    |
| `@ts-check` tests/                  | **98.1%** | 100%    |
| `@type{any}` em src/ (total rg)     | **3.276** | reduzir |

### 6.7 Como rodar auditoria JSDoc

```bash
# Cobertura completa (console)
npm run jsdoc:coverage

# Cobertura completa em JSON (atualiza jsdoc-coverage-report.json)
npm run jsdoc:coverage:json

# Ver apenas gaps (arquivos/funções sem cobertura)
npm run jsdoc:coverage:gaps

# Cobertura apenas do delta (arquivos modificados)
npm run jsdoc:delta
```

---

## 7. Sistema TSServer / LSP local

### 7.1 Arquitetura

O repositório possui um **wrapper local do tsserver** com contrato formal:

```
src/integration/lsp/
├── tsserver-daemon.mjs         ← implementação do daemon (wrapper node)
├── tsserver-contract.d.ts      ← tipos TypeScript públicos do contrato
└── tsserver-protocol.js        ← protocolo de comunicação

schemas/typing/
├── tsserver-tool-contract.schema.json   ← JSON Schema 2020-12 (v1.1.0)
└── jsdoc-coverage-report.schema.json   ← schema do relatório JSDoc
```

### 7.2 Operações suportadas

O contrato v1.1.0 expõe 10 operações:

| Operação            | Descrição                                 |
| ------------------- | ----------------------------------------- |
| `definition`        | Ir para definição de um símbolo           |
| `references`        | Listar todas as referências de um símbolo |
| `hover`             | Informações de tipo e JSDoc ao hover      |
| `document_symbols`  | Todos os símbolos em um arquivo           |
| `workspace_symbols` | Busca de símbolo em todo o workspace      |
| `diagnostics`       | Erros e warnings TypeScript em um arquivo |
| `code_actions`      | Sugestões de correção automática          |
| `apply_code_action` | Aplicar uma code action específica        |
| `completion`        | Sugestões de auto-completar               |
| `updateFile`        | Notificar daemon de mudança de arquivo    |

### 7.3 Schema do contrato (v1.1.0)

O envelope JSON para cada operação:

```json
{
  "schema_version": "1.1.0",
  "operation": "hover",
  "params": {
    "file": "/workspace/src/kernel/kernel.js",
    "line": 42,
    "offset": 15
  }
}
```

### 7.4 Auditoria de contrato

```bash
# Verifica sincronizaçõa entre schema, daemon e skill
npm run check:schemas:typing

# Saúde do LSP (tsserver daemon)
npm run lsp:health
```

### 7.5 Cache do tsserver

O tsserver usa cache em `/home/node/.cache/typescript/`. Para limpar:

```bash
rm -rf /home/node/.cache/typescript/
```

---

## 8. Aliases de módulo

### 8.1 Aliases configurados em `tsconfig.base.json`

| Alias             | Resolve para         | Módulo                     |
| ----------------- | -------------------- | -------------------------- |
| `#core/*`         | `src/core/*`         | Core do sistema            |
| `#shared/*`       | `src/shared/*`       | Utilitários compartilhados |
| `#nerv/*`         | `src/nerv/*`         | Barramento de eventos      |
| `#kernel/*`       | `src/kernel/*`       | Engine de decisão          |
| `#driver/*`       | `src/driver/*`       | Browser automation         |
| `#agent/*`        | `src/agent/*`        | Workers internos           |
| `#infra/*`        | `src/infra/*`        | Infraestrutura             |
| `#integration/*`  | `src/integration/*`  | Integrações externas       |
| `#types/*`        | `src/types/*`        | Tipos públicos             |
| `#main`           | `src/main.js`        | Bootstrap                  |
| `#server/*`       | `src/server/*`       | API e servidor             |
| `#logic/*`        | `src/logic/*`        | Lógica de negócio          |
| `#orchestrator/*` | `src/orchestrator/*` | Estratégias                |
| `#missions/*`     | `src/missions/*`     | Domínio de missões         |
| `#validation/*`   | `src/validation/*`   | Validação                  |

### 8.2 Uso no código

```js
// Preferir aliases a caminhos relativos profundos
import { createKernel } from '#kernel/kernel.js';       // ✅ correto
import { createKernel } from '../../../kernel/kernel.js'; // ❌ evitar
```

### 8.3 Resolução de aliases em Node.js 24 (imports field)

Os aliases de TS (`paths`) são para verificação estática. Em runtime, o Node.js resolve via
`imports` em `package.json`:

```json
{
  "imports": {
    "#core/*": "./src/core/*",
    "#infra/*": "./src/infra/*"
    // ...
  }
}
```

Os dois devem estar sincronizados.

---

## 9. Scripts npm de tipagem

### 9.1 Typecheck

| Script                    | Comando                              | Escopo              |
| ------------------------- | ------------------------------------ | ------------------- |
| `typecheck:node`          | `tsc -p tsconfig.node.json`          | src/ + scripts/     |
| `typecheck:tools`         | `tsc -p tsconfig.tools.json`         | tools/              |
| `typecheck:browser`       | `tsc -p tsconfig.browser.json`       | src/dashboard-ui/   |
| `typecheck:tests`         | `tsc -p tsconfig.tests.json`         | tests/              |
| `typecheck:declarations`  | `tsc -p tsconfig.declarations.json`  | src/types/ (emite)  |
| `typecheck:isolated`      | `tsc -p tsconfig.isolated-decl.json` | isolated decl check |
| `typecheck:dashboard`     | `vue-tsc --noEmit`                   | SFCs Vue (vue-tsc)  |
| `typecheck:full`          | node + tools + browser               | base sem tests      |
| `typecheck:repo`          | full + tests + dashboard + isolated  | **completo**        |
| `typecheck:strict:all`    | todas as 41 lanes                    | strict mode total   |
| `typecheck:strict:<nome>` | lane individual                      | domínio específico  |

### 9.2 JSDoc e análise

| Script                  | Propósito                                 |
| ----------------------- | ----------------------------------------- |
| `jsdoc:coverage`        | Relatório de cobertura JSDoc (console)    |
| `jsdoc:coverage:json`   | Gera `jsdoc-coverage-report.json`         |
| `jsdoc:coverage:gaps`   | Lista símbolos sem cobertura              |
| `jsdoc:coverage:public` | Cobertura de APIs públicas específicas    |
| `jsdoc:delta`           | Cobertura apenas dos arquivos modificados |
| `analyze:typing`        | Auditoria de hardening geral              |
| `analyze:typing:gaps`   | Gaps de @ts-check e strict coverage       |
| `analyze:typing:json`   | Auditoria em formato JSON                 |
| `analyze:typing:public` | Foco em APIs públicas                     |

### 9.3 Validação de schemas e contratos

| Script                 | Propósito                                  |
| ---------------------- | ------------------------------------------ |
| `check:schemas:typing` | Valida schema JSDoc + contrato tsserver    |
| `check:skills:strict`  | Verifica skills de tipagem em conformidade |

### 9.4 Fluxo de uso recomendado

```bash
# Verificação rápida (durante desenvolvimento)
npm run typecheck:node

# Verificação completa (antes de commit)
npm run typecheck:repo && npm run typecheck:strict:all

# Auditoria de qualidade JSDoc
npm run jsdoc:coverage:json && npm run analyze:typing
```

---

## 10. CI/CD — quality gates de tipagem

### 10.1 Gates mínimos por tipo de mudança

| Tipo de mudança                 | Gates obrigatórios                                     |
| ------------------------------- | ------------------------------------------------------ |
| Qualquer arquivo JS em `src/`   | `typecheck:node` + `typecheck:strict:<lane>`           |
| Arquivo em `src/dashboard-ui/`  | `typecheck:browser` + `typecheck:dashboard`            |
| Arquivo em `tests/`             | `typecheck:tests` + `typecheck:strict:tests.<grupo>`   |
| Arquivo em `scripts/`           | `typecheck:tools` + `typecheck:strict:scripts.<grupo>` |
| Arquivo `.d.ts` em `src/types/` | `typecheck:isolated` + `typecheck:declarations`        |
| Mudança em `tsconfig.base.json` | `typecheck:repo` + `typecheck:strict:all`              |

### 10.2 Gates proibidos de ignorar

- Nunca use `--skipLibCheck` adicional para esconder erros de produção
- Nunca adicione `// @ts-ignore` em `src/` (zero ocorrências é a meta permanente)
- Nunca adicione `// @ts-nocheck` em qualquer arquivo novo
- Nunca desative uma lane strict já em 0 erros

### 10.3 Integração com GitHub Actions

Os workflows CI verificam:

```yaml
- name: Typecheck completo
  run: npm run typecheck:repo

- name: Strict lanes
  run: npm run typecheck:strict:all

- name: JSDoc coverage
  run: npm run check:schemas:typing
```

---

## 11. Decisões arquiteturais registradas

### ADR-001: JS-first em vez de migração para TypeScript

**Decisão**: manter arquivos de produção em `.js` com JSDoc como tipagem.

**Razão**: migrar ~300 arquivos `.js` para `.ts` seria um risco operacional enorme sem benefício
proporcional. O TypeScript 5.x suporta verificação completa de JS via `allowJs + checkJs + JSDoc`.

**Consequências**:
- Todos os tipos públicos via JSDoc (não `.ts`)
- Declarações públicas via `src/types/**/*.d.ts` (mantidas em TypeScript puro)
- `strict: true` aplicado via lanes e tsconfig.base

### ADR-002: Lanes strict por domínio (não verificação global)

**Decisão**: 41 configs individuais em `config/typing/strict/` em vez de uma única config estrita.

**Razão**: permite isolar erros por domínio, fazer progresso incremental e identificar regressões
com granularidade. Uma única config estrita tornaria o pipeline de CI lento e difícil de triagem.

### ADR-003: `noUncheckedIndexedAccess` adiado para Fase F

**Decisão**: não ativar `noUncheckedIndexedAccess` nas Fases 0–E.

**Razão**: geraria ~400 erros legítimos em código válido que usa indexação dinâmica de objetos.
São necessários typedefs específicos para objetos dicionário antes de ativar esta flag.

### ADR-004: `@import` em vez de `@typedef {import()}` (TS 5.5+)

**Decisão**: adotar `/** @import { Type } from 'module' */` para novos usos.

**Razão**: `@import` é o padrão moderno, TypeScript 5.5+ suporta nativamente, menos verboso
e alinhado com o futuro da linguagem. Os 4 usos legados de `@typedef {import()}` devem ser
migrados como parte da Fase E.

### ADR-005: `isolatedDeclarations` apenas para `src/types/` (por ora)

**Decisão**: `isolatedDeclarations: true` aplicado apenas a `src/types/**/*.d.ts` e
`src/integration/lsp/tsserver-contract.d.ts`.

**Razões**: `isolatedDeclarations` exige que tipos sejam completamente autoexplicativos sem
processar outras implementações. Aplicar a todo `src/` requereria tipagem explícita de retorno
em centenas de funções. Fase E.4 avaliará expansão gradual.

---

## 12. Roadmap de fases concluídas e próximas

### Fases concluídas

| Fase   | Período    | Marco                                                   |
| ------ | ---------- | ------------------------------------------------------- |
| Fase 0 | mar 2026   | Eliminação TS8032/TS8024 (214 erros JSDoc malformados)  |
| Fase A | mar 2026   | 6 lanes menores zeradas (lógica, analysis, infra-gw...) |
| Fase B | mar 2026   | 12 lanes médias zeradas (nerv, kernel, agent, core...)  |
| Fase C | 6 mar 2026 | 3 lanes grandes zeradas (driver, infra, legacy)         |
| Fase D | 7 mar 2026 | `strict: true` global, `typecheck:repo` → 0 total       |

### Fase E — em andamento (desde 7 mar 2026)

| Etapa | Descrição                                           | Status     |
| ----- | --------------------------------------------------- | ---------- |
| E.0   | @ts-check nos 18 arquivos em gap                    | 🔄 iniciada |
| E.1   | Migração `@typedef {import()}` → `@import` (4 arq.) | ⏳ pendente |
| E.2   | Typedefs para 52 funções options sem typedef        | 🔄 iniciada |
| E.3   | Redução unsafe_generic_tags: 511 → ≤ 300            | ⏳ pendente |
| E.4   | Expansão `isolatedDeclarations` para mais .d.ts     | ⏳ pendente |

### Fase F — futura

| Etapa | Descrição                                          | Pré-condição      |
| ----- | -------------------------------------------------- | ----------------- |
| F.1   | `noUncheckedIndexedAccess: true`                   | Fase E.3 completa |
| F.2   | Typedefs concretos para dicionários dinâmicos      | Fase F.1 ativa    |
| F.3   | Eliminação massiva de `/** @type {any} */` interno | Fase F.2 completa |

---

## 13. Guia prático — como trabalhar com tipagem

### 13.1 Ao criar um novo arquivo em `src/`

```js
// @ts-check
'use strict'; // ou ESM: não adicione 'use strict' em módulos ESM

/** @import { SomeDependency } from '#core/some.js' */

/**
 * @typedef {object} MyModuleOptions
 * @property {string} id - Identificador
 * @property {number} [timeout=30000] - Timeout em ms
 */

/**
 * Faz alguma coisa.
 *
 * @param {MyModuleOptions} options
 * @returns {Promise<void>}
 */
export async function doSomething(options) {
    // implementação
}
```

### 13.2 Ao adicionar um tipo a um parâmetro `catch`

```js
try {
    // ...
} catch (err) {
    // err é unknown (strict: true + useUnknownInCatchVariables)
    const e = /** @type {any} */ (err);
    logger.error('mensagem', { error: e.message ?? String(e) });
}
```

### 13.3 Ao referenciar a um tipo de módulo externo

```js
// Padrão moderno (@import — TS 5.5+)
/** @import { Page } from 'puppeteer-core' */

/**
 * @param {Page} page - Página do Puppeteer
 */
export function usePage(page) { ... }
```

### 13.4 Ao criar uma interface de retorno complexo

```js
/**
 * @typedef {object} TaskResult
 * @property {boolean} success - Se a tarefa completou com sucesso
 * @property {string} [error] - Mensagem de erro (quando success=false)
 * @property {number} duration - Duração em ms
 * @property {Record<string, unknown>} [metadata] - Dados extras
 */

/**
 * @returns {Promise<TaskResult>}
 */
export async function runTask() { ... }
```

### 13.5 Ao encontrar um erro de tipagem

1. **TS7006 (parâmetro implícito `any`)**: adicione `@param {Tipo}` ao JSDoc
2. **TS2339 (propriedade não existe)**: crie `@typedef` para o objeto ou use `/** @type {any} */`
3. **TS18046 (err é unknown)**: use `const e = /** @type {any} */ (err);`
4. **TS7030 (função não retorna em todos os caminhos)**: adicione `return` explícito
5. **TS2322 (tipo incompatível)**: verifique se o @typedef está correto ou use cast cirúrgico

### 13.6 Verificação antes de commit

```bash
# 1. Typecheck básico
npm run typecheck:node

# 2. Lane do domínio que você tocou
npm run typecheck:strict:src.kernel  # ou o domínio relevante

# 3. Se tocou tests/
npm run typecheck:tests

# 4. Verificação completa (CI)
npm run typecheck:repo && npm run typecheck:strict:all

# 5. JSDoc (opcional mas recomendado)
npm run jsdoc:coverage
```

---

*Documento criado em 7 de março de 2026 | GitHub Copilot (Claude Sonnet 4.6)*
*Próxima revisão recomendada: após conclusão da Fase E*
