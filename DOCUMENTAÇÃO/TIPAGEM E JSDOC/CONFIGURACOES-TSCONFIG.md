# Configurações TypeScript — Lanes e Flags

> **Status**: Referência operacional — descreve cada arquivo tsconfig, as lanes strict e o
> significado das flags. **Última revisão**: 7 de março de 2026 — **Fases 0–D concluídas**.
> `strict: true` ativo globalmente em `tsconfig.base.json`.

---

## 1. Hierarquia de tsconfig

```
tsconfig.base.json                    ← base comum (strict: true, allowJs, checkJs, target, paths)
├── tsconfig.node.json                ← src/ (module: NodeNext)
├── tsconfig.browser.json             ← src/dashboard-ui/
├── tsconfig.tools.json               ← tools/
├── tsconfig.tests.json               ← tests/
├── tsconfig.isolated-declarations.json ← src/types/ (isolatedDeclarations: true)
└── tsconfig.strict.json              ← workspace de lanes strict
    └── config/typing/strict/tsconfig.strict.*.json  (41 lanes individuais)
```

---

## 2. tsconfig.base.json — base comum

**Flags atuais** (7 mar 2026 — **Fase D concluída**):

| Flag                         | Valor      | Nota                                             |
| ---------------------------- | ---------- | ------------------------------------------------ |
| `allowJs`                    | `true`     | Permite arquivos `.js` no projeto                |
| `checkJs`                    | `true`     | TS verifica JS via JSDoc                         |
| `noEmit`                     | `true`     | Não gera arquivos — só verifica                  |
| `strict`                     | **`true`** | ✅ **ATIVO** — ativa todo o strict suite          |
| `noImplicitAny`              | `true`     | ✅ Via `strict: true`                             |
| `strictNullChecks`           | `true`     | ✅ Via `strict: true`                             |
| `useUnknownInCatchVariables` | `true`     | ✅ `catch(err)` retorna `unknown`                 |
| `skipLibCheck`               | `true`     | Ignora tipos de node_modules                     |
| `target`                     | `ES2024`   | Node.js 24+                                      |
| `module`                     | herdado    | via tsconfig filho                               |
| `verbatimModuleSyntax`       | `true`     | ESM estrito — `import type` separado             |
| `resolvePackageJsonExports`  | `true`     | Respeita `exports` em package.json               |
| `resolvePackageJsonImports`  | `true`     | Respeita `imports` em package.json (aliases `#`) |
| `incremental`                | `true`     | Cache de verificação para builds incrementais    |

**Aliases de path configurados**:

- `#core/*` → `src/core/*`
- `#infra/*` → `src/infra/*`
- `#driver/*` → `src/driver/*`
- `#nerv/*` → `src/nerv/*`
- `#kernel/*` → `src/kernel/*`
- `#agent/*` → `src/agent/*`
- etc. — ver `tsconfig.base.json` para lista completa

---

## 3. Configs de superfície (não-strict)

### tsconfig.node.json

- **Escopo**: `src/**` (exceto `src/dashboard-ui/`)
- **Flags extras**: `module: NodeNext`, `moduleResolution: NodeNext`
- **Alias npm**: `npm run typecheck:node`
- **Uso**: verificação base do backend em Node.js 24+

### tsconfig.browser.json

- **Escopo**: `src/dashboard-ui/` (Vue 3, Vite)
- **Verificação Vue**: `npm run typecheck:dashboard` (via vue-tsc)

### tsconfig.tools.json

- **Escopo**: `tools/`
- **Alias npm**: `npm run typecheck:tools`

### tsconfig.tests.json

- **Escopo**: `tests/`
- **Alias npm**: `npm run typecheck:tests`

### tsconfig.declarations.json

- **Propósito**: emite `.d.ts` para APIs públicas JS-first
- **Saída**: `tmp/types-public/`
- **Alias npm**: `npm run typecheck:declarations`

---

## 4. Lanes strict (`config/typing/strict/`)

Cada lane tem seu `tsconfig.strict.*.json` com `strict: true` e escopo restrito a um subdiretório.

### Lanes com 0 erros (sempre-verde) ✅

| Lane                                                       | Alias npm                         |
| ---------------------------------------------------------- | --------------------------------- |
| `config/typing/strict/tsconfig.strict.src.types.json`      | `typecheck:strict:src.types`      |
| `config/typing/strict/tsconfig.strict.agents.json`         | `typecheck:strict:agents`         |
| `config/typing/strict/tsconfig.strict.scripts.ci.json`     | `typecheck:strict:scripts.ci`     |
| `config/typing/strict/tsconfig.strict.scripts.setup.json`  | `typecheck:strict:scripts.setup`  |
| `config/typing/strict/tsconfig.strict.tests.helpers.json`  | `typecheck:strict:tests.helpers`  |
| `config/typing/strict/tsconfig.strict.scripts.build.json`  | `typecheck:strict:scripts.build`  |
| `config/typing/strict/tsconfig.strict.scripts.env.json`    | `typecheck:strict:scripts.env`    |
| `config/typing/strict/tsconfig.strict.src.validation.json` | `typecheck:strict:src.validation` |
| `config/typing/strict/tsconfig.strict.tests.mocks.json`    | `typecheck:strict:tests.mocks`    |

### Todas as lanes — mapa completo (41 lanes — todas verdes ✅)

> **Estado**: 7 de março de 2026 — **todas as 41 lanes retornam 0 erros** (`typecheck:strict:all`
> passa em CI). O número entre parênteses indica os erros eliminados ao longo das fases.

| Lane                    | Alias npm                                | Estado              | Fase concluída |
| ----------------------- | ---------------------------------------- | ------------------- | -------------- |
| `src.types`             | `typecheck:strict:src.types`             | **0** ✅             | Grupo 0        |
| `agents`                | `typecheck:strict:agents`                | **0** ✅             | Grupo 0        |
| `scripts.ci`            | `typecheck:strict:scripts.ci`            | **0** ✅             | Grupo 0        |
| `scripts.setup`         | `typecheck:strict:scripts.setup`         | **0** ✅             | Grupo 0        |
| `tests.helpers`         | `typecheck:strict:tests.helpers`         | **0** ✅             | Grupo 0        |
| `scripts.build`         | `typecheck:strict:scripts.build`         | **0** ✅             | Grupo 0        |
| `scripts.env`           | `typecheck:strict:scripts.env`           | **0** ✅             | Grupo 0        |
| `src.validation`        | `typecheck:strict:src.validation`        | **0** ✅             | Grupo 0        |
| `tests.mocks`           | `typecheck:strict:tests.mocks`           | **0** ✅             | Grupo 0        |
| `src.logic`             | `typecheck:strict:src.logic`             | **0** ✅ (foi 2)     | Grupo 1        |
| `scripts.analysis`      | `typecheck:strict:scripts.analysis`      | **0** ✅ (foi 181)   | Grupo 1        |
| `src.inference_gateway` | `typecheck:strict:src.inference_gateway` | **0** ✅ (foi 191)   | Grupo 1        |
| `src.dashboard-ui`      | `typecheck:strict:src.dashboard-ui`      | **0** ✅ (foi 285)   | Grupo 1        |
| `tests.manual`          | `typecheck:strict:tests.manual`          | **0** ✅ (foi 300)   | Grupo 1        |
| `src.audit_agent`       | `typecheck:strict:src.audit_agent`       | **0** ✅ (foi 358)   | Grupo 1        |
| `src.nerv`              | `typecheck:strict:src.nerv`              | **0** ✅ (foi 439)   | Grupo 2        |
| `scripts.health`        | `typecheck:strict:scripts.health`        | **0** ✅ (foi 441)   | Grupo 2        |
| `src.missions`          | `typecheck:strict:src.missions`          | **0** ✅ (foi 608)   | Grupo 2        |
| `src.shared`            | `typecheck:strict:src.shared`            | **0** ✅ (foi 746)   | Grupo 2        |
| `src.orchestrator`      | `typecheck:strict:src.orchestrator`      | **0** ✅ (foi 773)   | Grupo 2        |
| `src.integration`       | `typecheck:strict:src.integration`       | **0** ✅ (foi 924)   | Grupo 2        |
| `scripts.audit`         | `typecheck:strict:scripts.audit`         | **0** ✅ (foi 928)   | Grupo 2        |
| `scripts.root`          | `typecheck:strict:scripts.root`          | **0** ✅ (foi 935)   | Grupo 2        |
| `tools.workspace`       | `typecheck:strict:tools.workspace`       | **0** ✅ (foi 1.013) | Grupo 2        |
| `src.core`              | `typecheck:strict:src.core`              | **0** ✅ (foi 1.053) | Grupo 2        |
| `src.agent`             | `typecheck:strict:src.agent`             | **0** ✅ (foi 1.190) | Grupo 2        |
| `tests.legacy`          | `typecheck:strict:tests.legacy`          | **0** ✅ (foi 1.403) | Grupo 2        |
| `src.kernel`            | `typecheck:strict:src.kernel`            | **0** ✅ (foi 1.530) | Grupo 2        |
| `src.driver`            | `typecheck:strict:src.driver`            | **0** ✅ (foi 1.558) | Grupo 2        |
| `src.infra`             | `typecheck:strict:src.infra`             | **0** ✅ (foi 2.232) | Grupo 2        |
| `tests.unit`            | `typecheck:strict:tests.unit`            | **0** ✅             | Fase D         |
| `tests.integration`     | `typecheck:strict:tests.integration`     | **0** ✅             | Fase D         |
| `tests.regression`      | `typecheck:strict:tests.regression`      | **0** ✅ (foi 215)   | Fase D         |

> Lanes adicionais (`tests.e2e`, `tests.nightly`, `tests.scripts`, etc.) — ver lista completa em
> `config/typing/strict/`. O total é **41 configs** em 7 de março de 2026.

---

## 5. Flags TypeScript — referência de decisão

### Flags ativas em `tsconfig.base.json` (Fase D concluída ✅)

Todas as lanes `tsconfig.strict.*.json` e também o `tsconfig.base.json` têm `strict: true`, o que ativa:

| Flag incluída em `strict: true` | O que faz                                      |
| ------------------------------- | ---------------------------------------------- |
| `strictNullChecks`              | `null` e `undefined` são tipos distintos       |
| `strictFunctionTypes`           | Variância correta de tipos de função           |
| `strictBindCallApply`           | `.bind()`, `.call()`, `.apply()` verificados   |
| `strictPropertyInitialization`  | Propriedades de classe devem ser inicializadas |
| `noImplicitAny`                 | Parâmetros sem tipo são erro                   |
| `noImplicitThis`                | `this` sem tipo é erro                         |
| `useUnknownInCatchVariables`    | `catch(e)` → `e` é `unknown`, não `any`        |
| `alwaysStrict`                  | Emite `"use strict"` em todo módulo            |

### Flags NÃO recomendadas (Fase E — análise pendente)

| Flag                                 | Motivo                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `noUncheckedIndexedAccess`           | Inflaria erros em todo acesso a array/object — refatoração massiva pendente |
| `exactOptionalPropertyTypes`         | Incompatível com padrões de options-object atuais                           |
| `noPropertyAccessFromIndexSignature` | Pode quebrar padrões de acesso dinâmico legítimo em infra                   |

---

## 6. Como criar uma nova lane strict

1. Criar `config/typing/strict/tsconfig.strict.NOME.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["../../../src/meu-modulo/**/*.js"]
}
```

2. Adicionar script em `package.json`:

```json
"typecheck:strict:src.meu-modulo": "tsc -p config/typing/strict/tsconfig.strict.src.meu-modulo.json"
```

3. Adicionar ao `typecheck:strict:all` na cadeia de scripts.

4. Documentar em `CONFIGURACOES-TSCONFIG.md` (este arquivo) e em `ROADMAP.md`.

---

## 7. Verificação rápida de uma lane

```bash
# Rodar lane e contar erros
npm run typecheck:strict:src.nerv 2>&1 | grep -c "error TS"

# Ver erros por tipo
npm run typecheck:strict:src.nerv 2>&1 | grep -oP "error TS\d+" | sort | uniq -c | sort -rn

# Ver TS2339 específicos (falta de typedef)
npm run typecheck:strict:src.nerv 2>&1 | grep "TS2339" | head -20
```
