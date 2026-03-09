# Scripts e Automação — Tipagem e JSDoc

> **Status**: Operacional — referência dos scripts disponíveis para medir e auditar tipagem/JSDoc.
> **Última revisão**: 4 de março de 2026

---

## 1. Comandos npm canônicos

### Verificação de tipos

| Comando                           | O que faz                                                         |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run typecheck:node`          | TS check de `src/` com tsconfig.node.json (sem strict) — baseline |
| `npm run typecheck:tools`         | TS check de `tools/`                                              |
| `npm run typecheck:tests`         | TS check de `tests/`                                              |
| `npm run typecheck:strict:all`    | Roda todas as lanes strict em sequência                           |
| `npm run typecheck:strict:<LANE>` | Roda uma lane específica (ex: `typecheck:strict:src.logic`)       |
| `npm run typecheck:strict:public` | Lane pública — contratos exportados                               |
| `npm run typecheck:declarations`  | Valida emissão de `.d.ts` para APIs públicas                      |
| `npm run typecheck:dashboard`     | vue-tsc para `src/dashboard-ui` (SFCs Vue)                        |

### Cobertura JSDoc

| Comando                         | O que faz                                           |
| ------------------------------- | --------------------------------------------------- |
| `npm run jsdoc:coverage:json`   | Gera relatório JSON com métricas de cobertura JSDoc |
| `npm run jsdoc:coverage:public` | Relatório de cobertura apenas para APIs públicas    |

### Auditoria e análise

| Comando                             | O que faz                                                  |
| ----------------------------------- | ---------------------------------------------------------- |
| `npm run analyze:typing`            | Auditoria agregada de qualidade (todas as fontes)          |
| `npm run analyze:typing:public`     | Auditoria de qualidade — escopo público                    |
| `npm run analyze:tsserver-contract` | Detecta drift entre daemon LSP, schema e skill docs        |
| `npm run jsdoc:coverage:gaps`       | Lista símbolos sem cobertura bloqueantes                   |
| `npm run check:ts-expect-error`     | Conta e valida `@ts-expect-error` na allowlist             |
| `npm run check:base-strict`         | Verifica se tsconfig.base.json tem `strict: true` (Fase D) |
| `npm run check:schemas:typing`      | Valida schemas JSON de tipagem em `schemas/typing/`        |
| `npm run check:skills:strict`       | Verifica consistência das skills de tipagem                |

---

## 2. Scripts de análise (`scripts/analysis/`)

### `jsdoc_coverage_cli.mjs`

CLI principal para relatório de cobertura JSDoc.

```bash
# Relatório completo no console
node scripts/analysis/jsdoc_coverage_cli.mjs --scope full --format console

# Relatório em JSON (para CI)
npm run jsdoc:coverage:json

# Apenas funções exportadas de src/
node scripts/analysis/jsdoc_coverage_cli.mjs --roots src/ --format console
```

**Métricas geradas**:

- `js_files_missing_ts_check_total` — arquivos sem `@ts-check`
- `functions_missing_param_tags` — funções sem `@param`
- `functions_missing_returns` — funções sem `@returns`
- `unsafe_generic_tags_total` — uso de `{any}`, `{Object}`, `{*}`
- `public_any_tags_total` — APIs públicas com `any`
- `options_objects_without_typedef` — options sem typedef

**Alvo final (Fase D)**: todos os indicadores = 0.

### `jsdoc_coverage_engine.mjs`

Motor de análise usado internamente pelo CLI. Não usar diretamente — chamar via
`jsdoc_coverage_cli.mjs`.

### `scripts/analysis/typing/typing_hardening_audit.mjs`

Auditoria agregada de qualidade de tipagem (todas as fontes).

```bash
# Console (resumo)
node scripts/analysis/typing/typing_hardening_audit.mjs

# JSON (para processamento ou CI)
node scripts/analysis/typing/typing_hardening_audit.mjs --format json

# Apenas escopo público
node scripts/analysis/typing/typing_hardening_audit.mjs --scope public
```

### `scripts/analysis/typing/strict_lane_audit.mjs`

Auditoria do estado das lanes strict.

```bash
node scripts/analysis/typing/strict_lane_audit.mjs
```

### `scripts/analysis/typing/tsserver_contract_audit.mjs`

Detecta drift entre o daemon LSP local, schemas e skill docs.

```bash
npm run analyze:tsserver-contract
```

### `scripts/analysis/analyze-variables.mjs`

Análise de variáveis não tipadas.

---

## 3. Fluxo de trabalho recomendado por sessão

### Antes de começar (medir estado)

```bash
# 1. Contar erros totais da lane que vai trabalhar
npm run typecheck:strict: < LANE > 2 >&1 | grep -c "error TS"

# 2. Ver quais tipos de erros existem na lane
npm run typecheck:strict: < LANE > 2 >&1 | grep -oP "error TS\d+" | sort | uniq -c | sort -rn

# 3. Ver onde os TS2339 acontecem (falta de typedef)
npm run typecheck:strict: < LANE > 2 >&1 | grep "TS2339"

# 4. Ver TS8032 em todo o projeto (JSDoc malformado)
npm run typecheck:node 2>&1 | grep "TS8032"
```

### Durante o trabalho (validação rápida)

```bash
# Verificar apenas um arquivo específico
npx tsc --noEmit --checkJs --allowJs src/infra/db/task_repo.js 2>&1 | head -20

# Verificar uma lane específica
npm run typecheck:strict:src.logic 2>&1 | grep "error TS"
```

### Após corrigir (gate de lane)

```bash
# A lane deve zerar
npm run typecheck:strict:<LANE>
# Exit code 0 = passou

# Confirmar que lanes verdes não regrediram
npm run typecheck:strict:src.types
npm run typecheck:strict:agents
npm run typecheck:strict:scripts.ci
```

### Fim de sessão (medição completa)

```bash
# Total de erros strict
npm run typecheck:strict:all 2>&1 | grep -c "error TS"

# Distribuição por tipo
npm run typecheck:strict:all 2>&1 | grep -oP "error TS\d+" | sort | uniq -c | sort -rn | head -15

# Cobertura JSDoc
node scripts/analysis/jsdoc_coverage_cli.mjs --scope full --format console
```

---

## 4. Comandos utilitários

### Encontrar arquivos sem @ts-check

```bash
# Arquivos JS/MJS reais sem @ts-check
rg -l --type js "." src/ scripts/ tests/ tools/ | xargs rg -L "// @ts-check" | grep -v "node_modules\|dist\|.backup"
```

### Encontrar todos os erros de uma lane

```bash
npm run typecheck:strict:src.nerv 2>&1 | grep "error TS" | head -50
```

### Contar @ts-nocheck (deve ser sempre 0)

```bash
rg "// @ts-nocheck" src/ scripts/ tests/ tools/ --stats
# Esperado: 0 matches found
```

### Encontrar propriedades TS2339 mais comuns

```bash
npm run typecheck:strict:all 2>&1 | grep "TS2339" | grep -oP "Property '.*?' does not exist" | sort | uniq -c | sort -rn | head -20
```

---

## 5. CI — gate de tipagem

O workflow `.github/workflows/jsdoc-typing.yml` é bloqueante e executa na sequência canônica:

1. `npm run typecheck:node` (base)
2. `npm run typecheck:strict:public`
3. `npm run typecheck:strict:all`
4. `npm run typecheck:declarations`
5. `npm run jsdoc:coverage:json`
6. `npm run jsdoc:coverage:public`
7. `npm run check:schemas:typing`
8. `npm run analyze:typing`
9. `npm run analyze:typing:public`
10. `npm run check:skills:strict`

Qualquer falha impede merge.
