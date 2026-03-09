---
name: typing-node24-esm-tsserver
description:
  Full-Strict Roadmap orchestration skill for typing hardening in this repository. Covers strict
  multi-lane configs, declaration emit, JSDoc coverage, tsserver wrapper contracts, dashboard
  vue-tsc, and CI gates.
license: MIT
---

# Skill — Typing Node24 ESM TS Server (Full-Strict Roadmap Orchestrator)

## Overview

This is the orchestration skill for repository-wide typing hardening.

The normative repository canon lives in:

- [`../../../DOCUMENTAÇÃO/TIPAGEM E JSDOC/README.md`](../../../DOCUMENTAÇÃO/TIPAGEM%20E%20JSDOC/README.md):
  hub operacional
- [`../../../DOCUMENTAÇÃO/TIPAGEM E JSDOC/ROADMAP.md`](../../../DOCUMENTAÇÃO/TIPAGEM%20E%20JSDOC/ROADMAP.md):
  roadmap de execução
- [`../../../DOCUMENTAÇÃO/TIPAGEM E JSDOC/CONFIGURACOES-TSCONFIG.md`](../../../DOCUMENTAÇÃO/TIPAGEM%20E%20JSDOC/CONFIGURACOES-TSCONFIG.md):
  lanes e flags
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md):
  canon normativo de governança

It covers:

- `typecheck:repo`
- `typecheck:strict:*`
- `typecheck:declarations`
- `jsdoc:coverage:json`
- `analyze:typing`
- `check:skills:strict`
- tsserver wrapper contract drift

## When To Use

- Stabilizing or extending strict lanes
- Hardening public JS contracts
- Updating the tsserver wrapper, schemas, or LSP skills
- Enforcing typing/JSDoc CI gates

## When Not To Use

- A small local JSDoc-only edit is sufficient
- The task is purely MCP usage, without changing the local wrapper or contracts

## Inputs / Preconditions

- Treat `tsconfig*.json` as the source of truth for static checking.
- Treat `ts.server.protocol` in `node_modules/typescript/lib/typescript.d.ts` as the official
  semantic source for tsserver protocol names.
- Treat `schemas/typing/*.schema.json` as the contract layer for local JSON artifacts and wrapper
  envelopes.

## Workflow

1. Run `npm run typecheck:repo` (inclui `typecheck:dashboard` a partir da Fase 2 do roadmap).
2. Run `npm run typecheck:strict:all`.
3. Run `npm run typecheck:declarations`.
4. Run `npm run jsdoc:coverage:json -- --validate-schema`.
5. Run `npm run analyze:typing` + `npm run analyze:typing:gaps` para ver arquivos sem cobertura.
6. Run `npm run analyze:tsserver-contract`.
7. Run `npm run check:skills:strict`.
8. Run `npm run typecheck:dashboard` para validar SFCs Vue em `src/dashboard-ui`.
9. Run `npm run jsdoc:coverage:gaps` para listar símbolos bloqueadores por lote.
10. Run `npm run check:ts-expect-error` para garantir allowlist zerada.
11. Run `npm run check:base-strict` (passe com `continue-on-error: true` até a Fase 5).

## Protocolo de Execução por Lane (Full-Strict Roadmap)

Este protocolo cobre a execução sistemática do roadmap lane por lane, com foco em atingir 0 erros
por lane sem regressões nas lanes sempre-verdes.

### Sequência canônica por lane

```bash
# 1. Medir baseline do lane
npm run typecheck:strict:LANE 2>&1 | wc -l

# 2. Ver top arquivos com erros (priorize os com mais erros)
npm run typecheck:strict:LANE 2>&1 \
  | grep -oP '(?<=\/)[\w._-]+\.m?[jt]s' | sort | uniq -c | sort -rn | head -10

# 3. Para cada arquivo (do mais erros para o menos):
#    a) Ver erros daquele arquivo
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" | head -30
#    b) Ler o arquivo (seções relevantes com base nas linhas do erro)
#    c) Aplicar TODOS os patches num único multi_replace_string_in_file
#    d) Verificar o arquivo chegou a 0
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" | wc -l

# 4. Verificar o lane inteiro chegou a 0
npm run typecheck:strict:LANE 2>&1 | tail -5

# 5. Verificar lanes sempre-verdes não regrediram
npm run typecheck:strict:src.logic 2>&1 | tail -3
npm run typecheck:strict:agents 2>&1 | tail -3
```

### Triagem eficiente de erros por arquivo

```bash
# Erros de um arquivo, ordenados por linha, sem duplicatas
npm run typecheck:strict:LANE 2>&1 \
  | grep "nome-do-arquivo" \
  | sed 's/.*nome-do-arquivo//' \
  | sort -t: -k1,1n | uniq

# Distribuição de TS codes no lane (para priorizar tipo de fix)
npm run typecheck:strict:LANE 2>&1 | grep -oP 'TS\d+' | sort | uniq -c | sort -rn

# Total de erros por arquivo no lane
npm run typecheck:strict:LANE 2>&1 \
  | grep -oP '[^/]+(?=\([\d]+,[\d]+\))' | sort | uniq -c | sort -rn | head -20
```

### Regras de regressão

- **Nunca** commite com uma lane sempre-verde em vermelho
- Após corrigir um arquivo, execute todos os lanes sempre-verdes antes de avançar
- Se uma lane sempre-verde regredir: leia o arquivo afetado, entenda a causa, corrija imediatamente
- Lanes sempre-verdes: `src.types`, `agents`, `scripts.ci`, `scripts.setup`, `tests.helpers`,
  `scripts.build`, `scripts.env`, `src.validation`, `tests.mocks`, `src.logic`, `scripts.analysis`

### Prioridade de arquivos dentro de um lane

1. **Tipedefs compartilhados** (ex: `*_repo.js`, `types.js`) — corrigir primeiro; fixes cascateiam
2. **Classes com muitos membros `this.x = []`** — uma anotação de construtor elimina dezenas de
   TS2345
3. **Funções exportadas** — fixes em `@param`/`@returns` eliminam TS7006 em múltiplos call sites
4. **Funções internas com callbacks** — corrija por último (menor cascata)

### Padrão de fix por TS code (referência rápida)

| Código  | Fix em 1 linha                                                 |
| ------- | -------------------------------------------------------------- |
| TS7006  | Adicionar `@param {tipo}` ao JSDoc do método                   |
| TS7008  | `/** @type {any[]} */` antes de `this.x = []`                  |
| TS7034  | `/** @type {any[]} */` antes de `const arr = []`               |
| TS7053  | `/** @type {Record<string, any>} */` antes de `const obj = {}` |
| TS18046 | `const _e = /** @type {any} */ (err);` no topo do catch        |
| TS2339  | Cast `/** @type {any} */ (obj)` ou fix no typedef              |
| TS2345  | Corrigir **o array upstream** (TS7034/TS7008), não o push      |
| TS2488  | `@returns {object}` → `@returns {any[]}`                       |
| TS2552  | Bug real: `object.X` → `Object.X`                              |
| TS8032  | Remover sub-@param ou adicionar @param pai faltante            |

---

## Protocolo de Leitura Eficiente de Arquivos

Para arquivos com erros em linhas espalhadas, leia em blocos paralelos:

```
# Erros em linhas 47, 107, 152, 236, 311, 434, 492, 631, 687, 944, 977
# → Leituras paralelas:
read_file(40-130)   + read_file(140-260)   → batch 1
read_file(300-470)  + read_file(480-650)   → batch 2
read_file(680-750)  + read_file(930-1010)  → batch 3
```

Após ler tudo, escreva todos os patches em UM multi_replace_string_in_file.

---

## Guardrails

- Keep runtime JS-first unless a `.d.ts` or tiny auxiliary TS artifact is clearly justified.
- Do not weaken strict lanes just to hide errors.
- Do not invent a parallel tsserver protocol; map local operations to the wrapper only.
- Do not treat SchemaStore as the semantic authority for TypeScript behavior.

## Validation / Done Criteria

As três condições de encerramento do programa full-strict (todas devem ser `true` simultaneamente):

- [ ] **100 % de cobertura** — `js_files_missing_ts_check_total = 0` (incluindo legacy).
- [ ] **Zero backlog JSDoc** — `functions_missing_param_tags = 0`, `unsafe_generic_tags_total = 0`,
      `public_any_tags_total = 0`.
- [ ] **Base strict** — `tsconfig.base.json` tem `strict: true`; `check:base-strict` verde.

Critérios contínuos (devem ser verdes em toda PR):

- [ ] Todas as lanes strict são verdes (`typecheck:strict:all`).
- [ ] Declaration emit verde (`typecheck:declarations`).
- [ ] Relatório JSDoc valida contra schema (`jsdoc:coverage:json -- --validate-schema`).
- [ ] `typecheck:dashboard` verde (vue-tsc --noEmit em `src/dashboard-ui`).
- [ ] `check:ts-expect-error` verde (sem ocorrências não-allowlistadas).
- [ ] Daemon, schema e `lsp-ops` sincronizados.

## Related Skills

- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../strict-lane-governance/SKILL.md`](../strict-lane-governance/SKILL.md)
- [`../vue-tsc-dashboard/SKILL.md`](../vue-tsc-dashboard/SKILL.md)
- [`../lsp-ops/SKILL.md`](../lsp-ops/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [TYPING_FULLSTRICT_ROADMAP.md](../../../DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md)
