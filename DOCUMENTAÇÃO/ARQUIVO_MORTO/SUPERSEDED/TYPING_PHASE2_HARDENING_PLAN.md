# Typing Phase 2 Hardening Plan

> Status de governanca: este plano permanece como registro de execucao da fase 2. As regras
> normativas atuais vivem em `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`.

## Objetivo

Consolidar a fase 2 de hardening com foco em:

- JSDoc robusto e verificável
- tipagem incremental JS-first
- strict por lanes
- declaration emit para contratos públicos
- schemas locais para artefatos e tooling
- CI bloqueante

## Metas Quantitativas

- `src/**`: 100% com `// @ts-check`
- `scripts/**` sem `scripts/legacy/**`: >= 95%
- `tests/**` sem `tests/legacy/**`: >= 90%
- repo agregado: >= 90%
- exports públicos: manter 100% documentados
- funções exportadas: manter 100% com `@returns`

## Lanes de Strict

- `tsconfig.strict.core.json`
- `tsconfig.strict.server.json`
- `tsconfig.strict.infra.json`
- `tsconfig.strict.integration.json`
- `tsconfig.strict.audit.json`
- `tsconfig.strict.tools.json`
- `tsconfig.strict.tests.json`

## Ondas de Execução

1. Contratos e schemas
2. Scripts de auditoria e governança
3. Skills canônicas e stubs de compatibilidade
4. Lanes de strict e declaration emit
5. Universalização de `@ts-check`
6. CI bloqueante e summaries

## Critérios de Bloqueio em CI

O gate deve falhar se ocorrer:

- falha em `typecheck:repo`
- falha em qualquer lane de `typecheck:strict:*`
- falha em `typecheck:declarations`
- schema inválido no relatório JSDoc
- cobertura de `@ts-check` abaixo do target
- drift entre daemon LSP, schema e skill
- falha de governança de skills

## Rollback Parcial por Lane

- Reverter apenas a lane afetada (`tsconfig.strict.*.json`) se um hardening pontual bloquear o
  resto.
- Manter schemas e scripts comuns em separado para não desfazer governança transversal.
- Não desfazer a cobertura de `@ts-check`; tratar a regressão no módulo causador.
