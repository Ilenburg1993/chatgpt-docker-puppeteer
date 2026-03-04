# Configurações TypeScript — Lanes e Flags

> **Status**: Referência operacional — descreve cada arquivo tsconfig, as lanes strict e o
> significado das flags. **Última revisão**: 4 de março de 2026

---

## 1. Hierarquia de tsconfig

```
tsconfig.base.json          ← base comum (allowJs, checkJs, target, paths)
├── tsconfig.node.json      ← src/ (module: NodeNext)
├── tsconfig.browser.json   ← src/dashboard-ui/
├── tsconfig.tools.json     ← tools/
├── tsconfig.tests.json     ← tests/
└── tsconfig.strict.json    ← workspace de lanes strict
    └── config/typing/strict/tsconfig.strict.*.json  (lanes individuais)
```

---

## 2. tsconfig.base.json — base comum

**Flags atuais** (4 mar 2026):

| Flag                   | Valor    | Nota                                           |
| ---------------------- | -------- | ---------------------------------------------- |
| `allowJs`              | `true`   | Permite arhivos `.js` no projeto               |
| `checkJs`              | `true`   | TS verifica JS via JSDoc                       |
| `noEmit`               | `true`   | Não gera arquivos — só verifica                |
| `strict`               | `false`  | **Objetivo final**: mudar para `true` (Fase D) |
| `noImplicitAny`        | `false`  | Ativar em Fase D.2                             |
| `skipLibCheck`         | `true`   | Ignora tipos de node_modules                   |
| `target`               | `ES2024` | Node.js 24+                                    |
| `module`               | herdado  | via tsconfig filho                             |
| `verbatimModuleSyntax` | `true`   | ESM estrito — `import type` separado           |

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

### Todas as lanes — mapa completo

| Lane                    | Alias npm                                | Erros (mar 2026) | Fase |
| ----------------------- | ---------------------------------------- | ---------------: | ---- |
| `src.logic`             | `typecheck:strict:src.logic`             |                2 | A    |
| `scripts.analysis`      | `typecheck:strict:scripts.analysis`      |              181 | A    |
| `src.inference_gateway` | `typecheck:strict:src.inference_gateway` |              191 | A    |
| `src.dashboard-ui`      | `typecheck:strict:src.dashboard-ui`      |              285 | A    |
| `tests.manual`          | `typecheck:strict:tests.manual`          |              300 | A    |
| `src.audit_agent`       | `typecheck:strict:src.audit_agent`       |              358 | A    |
| `src.nerv`              | `typecheck:strict:src.nerv`              |              439 | B    |
| `scripts.health`        | `typecheck:strict:scripts.health`        |              441 | B    |
| `src.missions`          | `typecheck:strict:src.missions`          |              608 | B    |
| `src.shared`            | `typecheck:strict:src.shared`            |              746 | B    |
| `src.orchestrator`      | `typecheck:strict:src.orchestrator`      |              773 | B    |
| `src.integration`       | `typecheck:strict:src.integration`       |              924 | B    |
| `scripts.audit`         | `typecheck:strict:scripts.audit`         |              928 | B    |
| `scripts.root`          | `typecheck:strict:scripts.root`          |              935 | B    |
| `tools.workspace`       | `typecheck:strict:tools.workspace`       |            1.013 | B    |
| `src.core`              | `typecheck:strict:src.core`              |            1.053 | B    |
| `src.agent`             | `typecheck:strict:src.agent`             |            1.190 | B    |
| `tests.legacy`          | `typecheck:strict:tests.legacy`          |            1.403 | C    |
| `src.kernel`            | `typecheck:strict:src.kernel`            |            1.530 | C    |
| `src.driver`            | `typecheck:strict:src.driver`            |            1.558 | C    |
| `src.infra`             | `typecheck:strict:src.infra`             |            2.232 | C    |

---

## 5. Flags TypeScript — referência de decisão

### Flags já ativas (via lanes strict)

Todas as lanes `tsconfig.strict.*.json` têm `strict: true`, o que ativa:

| Flag incluída em `strict: true` | O que faz                                      |
| ------------------------------- | ---------------------------------------------- |
| `strictNullChecks`              | `null` e `undefined` são tipos distintos       |
| `strictFunctionTypes`           | Variância correta de tipos de função           |
| `strictBindCallApply`           | `.bind()`, `.call()`, `.apply()` verificados   |
| `strictPropertyInitialization`  | Propriedades de classe devem ser inicializadas |
| `noImplicitAny`                 | Parâmetros sem tipo são erro                   |
| `noImplicitThis`                | `this` sem tipo é erro                         |
| `useUnknownInCatchVariables`    | `catch(e)` → `e` é `unknown` nao `any`         |
| `alwaysStrict`                  | Emite `"use strict"` em todo módulo            |

### Flags ainda desativadas na base

| Flag                         | Estado  | Ativar em | Erros esperados |
| ---------------------------- | ------- | --------- | --------------- |
| `strict`                     | `false` | Fase D.4  | consolidação    |
| `noImplicitAny`              | `false` | Fase D.2  | ~1.675          |
| `useUnknownInCatchVariables` | `false` | Fase D.1  | 602             |
| `strictNullChecks`           | `false` | Fase D.3  | ~245            |

### Flags NÃO recomendadas

| Flag                         | Motivo                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| `noUncheckedIndexedAccess`   | Inflaria erros em todo acesso a array/object — refatoração massiva |
| `exactOptionalPropertyTypes` | Incompatível com padrões de options-object atuais                  |

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
