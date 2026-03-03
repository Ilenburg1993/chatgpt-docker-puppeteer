---
name: strict-lane-governance
description:
  Governa a criação, nomeação, manutenção e remoção de lanes strict (tsconfig.strict.*.json) no
  repositório. Use quando criar, expandir ou substituir âncoras simbólicas por lanes que cobram
  subtrees reais.
license: MIT
---

# Skill — Strict Lane Governance

## Overview

Este skill governa o ciclo de vida das **lanes strict** do repositório. Cada
`config/typing/strict/tsconfig.strict.<familia>.<modulo>.json` deve cobrir um **subtree inteiro**, não um arquivo-âncora
simbólico de um único arquivo.

O registro canônico do progresso por fase vive em:

- [`DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md`](../../../DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md)
  — Fase 3

## When To Use

- Criar uma nova lane strict para um módulo ainda não coberto por `strict: true`
- Substituir uma lane-âncora (1 arquivo) por lane de subtree real
- Remover lane obsoleta após o módulo ser absorvido pela base strict (Fase 5)
- Auditar se todos os arquivos elegíveis estão em alguma lane

## When Not To Use

- O task é corrigir erros de tipos dentro de um módulo → use `typing-node24-esm-tsserver`
- O task é apenas adicionar JSDoc → use `jsdoc-authoring`
- O task envolve tipagem do dashboard Vue → use `vue-tsc-dashboard`

## Inputs / Preconditions

- Conhecer a topologia de diretórios do módulo-alvo
- Saber qual config-família o módulo herda:
  - `tsconfig.node.json` para `src/**` (exceto dashboard)
  - `tsconfig.tools.json` para `scripts/**`, `agents/**`, `tools/**`
  - `tsconfig.tests.json` para `tests/**`
- Rodar `npm run analyze:typing:gaps` antes para ver `strict_uncovered_files[]` atual

## Workflow

1. Identificar o subtree do módulo (ex.: `src/infra/**/*`).
2. Determinar a família de herança (`tsconfig.node.json` para `src/**`).
3. Criar `config/typing/strict/tsconfig.strict.src.<modulo>.json`:
   ```jsonc
   {
     "extends": "./tsconfig.node.json",
     "compilerOptions": {
       "strict": true,
       "noImplicitAny": true,
       "noImplicitReturns": true,
       "useUnknownInCatchVariables": true,
       "composite": true,
       "noEmit": true,
     },
     "include": ["src/<modulo>/**/*"],
     "exclude": ["node_modules", "dist", "coverage", "tmp"],
   }
   ```
4. Adicionar referência no `tsconfig.strict.json` (solution file):
   ```jsonc
   {
     "references": [
       // ... lanes existentes ...
      { "path": "./config/typing/strict/tsconfig.strict.src.<modulo>.json" },
     ],
   }
   ```
5. Adicionar script no `package.json` (dentro do bloco `typecheck:strict:*`):
   ```jsonc
  "typecheck:strict:src.<modulo>": "tsc -p config/typing/strict/tsconfig.strict.src.<modulo>.json"
   ```
6. Atualizar `typecheck:strict:all` para incluir o novo script.
7. Adicionar target no Makefile:
   ```makefile
   typecheck-strict-src-<modulo>:
   	npm run typecheck:strict:src.<modulo>
   ```
8. Rodar a lane isolada: `tsc -p config/typing/strict/tsconfig.strict.src.<modulo>.json`.
9. Corrigir erros estáticos até a lane estar verde (sem `@ts-ignore` de silêncio).
10. Remover a eventual âncora simbólica antiga do mesmo módulo.
11. Rodar `npm run analyze:typing:gaps` e confirmar que `strict_uncovered_files_total` decrementou.

## Guardrails

- **Nenhuma lane pode cobrir um único arquivo** como substituto simbólico de um módulo inteiro.
- `include` deve apontar para o subtree completo (`src/<modulo>/**/*`), nunca
  `files: ["um_arquivo.js"]`.
- Não enfraquecer flags (`strict: false`, remoção de `noImplicitAny`, etc.) para silenciar erros.
- Exclusões permitidas apenas para artefatos gerados (`dist/`, `coverage/`, `tmp/`).
- Cada nova lane deve ser referenciada no `tsconfig.strict.json` **antes** de ser considerada ativa.
- Lanes não podem se sobrepor: um arquivo pertence a exatamente uma lane.

## Validation / Done Criteria

- [ ] `tsc -p config/typing/strict/tsconfig.strict.src.<modulo>.json` executa sem erros de tipo.
- [ ] `tsconfig.strict.json` referencia a nova lane.
- [ ] `npm run typecheck:strict:all` continua verde.
- [ ] `npm run analyze:typing:gaps` mostra `strict_uncovered_files_total` reduzido.
- [ ] Nenhuma lane-âncora do mesmo módulo permanece ativa no solution file.

## Related Skills

- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [TYPING_FULLSTRICT_ROADMAP.md — Fase 3](../../../DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md)
