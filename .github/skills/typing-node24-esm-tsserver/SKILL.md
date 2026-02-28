---
name: typing-node24-esm-tsserver
description:
  'Use when the task is TypeScript/JSDoc typing hardening for this repository (Node 24 + ESM +
  NodeNext), including TS Server compatibility, error triage, and robust typecheck stabilization.'
license: MIT
---

# Typing Node24 ESM TS Server

## Objetivo

Padronizar tipagem robusta no projeto com foco em `Node 24 + ESM + NodeNext`, mantendo
compatibilidade estrita com TS Server e reduzindo ruído em `typecheck:node`.

## Quando usar

- Estabilizar `npm run typecheck:node`.
- Manter `npm run typecheck:full` verde (Node + Browser).
- Corrigir pacotes de erros TS/JS com `allowJs + checkJs`.
- Definir padrão de JSDoc e `.d.ts` para módulos JS.
- Revisar compatibilidade entre `tsconfig.json` (canônico) e `jsconfig.json` (shim).
- Preparar terreno para endurecer `strict` progressivamente sem quebrar runtime.

## Contrato canônico de tipagem (este repositório)

1. `tsconfig.json` é a fonte de verdade.
2. `jsconfig.json` existe por compatibilidade de tooling/editor e deve herdar `tsconfig.json`.
3. Runtime alvo: Node 24 ESM.
4. Resolução de módulos: `module=NodeNext` e `moduleResolution=NodeNext`.
5. Import ESM relativo deve usar extensão explícita `.js`.
6. Não misturar `require/module.exports` em arquivo ESM.
7. Tipagem em JS é via JSDoc e augmentations em `src/types/**`.

## Workflow operacional

1. Preflight semântico de tooling.

- `npm run -s lsp:health`
- `npm run -s mcp:diagnose`

2. Baseline de tipagem (Node/Audit).

- `npm run -s typecheck:node`
- `npm run -s typecheck:browser` (quando tocar `src/dashboard-ui`, `src/shared`, `src/driver`,
  `src/types`)
- `npm run -s typecheck:full` (gate final)
- Se necessário, coletar saída detalhada:
  `npx tsc -p tsconfig.json --pretty false --extendedDiagnostics`

3. Baseline de JSDoc/qualidade de tipagem (quando a mudança for estrutural).

- `npm run -s jsdoc:delta` (delta local)
- `npm run -s jsdoc:coverage:json` (baseline full)
- `rg -n "@ts-ignore" src scripts tests --glob '!**/dist/**'`

4. Triage por classes de erro (ordem obrigatória).

- `TS2307/TS2835`: resolução/import ESM (`.js`, aliases `#*`, paths).
- `TS2339/TS2322`: contrato de objeto e narrowing.
- `TS7006/TS7031`: parâmetros implícitos `any` (JSDoc `@param`).
- `TS2554/TS2345`: assinaturas inconsistentes entre chamada e definição.
- `TS2688/TS7016`: tipos ausentes para pacote externo ou módulo interno.

5. Correção padronizada.

- Preferir corrigir em origem (assinatura/fonte) antes de cast local.
- Em JS, usar `@typedef`, `@param`, `@returns`, `@template`, `@satisfies`.
- Para globais/augmentações, concentrar em `src/types/**/*.d.ts`.
- Evitar `@ts-ignore`; quando inevitável, usar `@ts-expect-error` com justificativa curta.

6. Validação de fechamento.

- `npm run -s lint`
- `npm run -s typecheck:full`
- `npm run -s jsdoc:delta` (ou `jsdoc:coverage:json` em ondas de documentação estrutural)
- `npm run -s test:unit`

## Padrões de implementação recomendados

- Tipos de payload/evento: declarar typedef local e reutilizar em callbacks.
- Objetos de config: validar shape com `@satisfies {import('...').Type}` quando aplicável.
- APIs assíncronas: sempre retornar `Promise<T>` coerente com consumidor.
- Adapters/bridges: tipar contratos de entrada/saída antes da lógica.

## Guardrails

- Não alterar `module`/`moduleResolution` fora de `NodeNext`.
- Não introduzir CommonJS em caminhos ESM.
- Não mascarar lote de erros com disable global (`checkJs=false`, `skipProject` etc.).
- Não tratar warning de editor como exceção sem reproduzir em `tsc -p tsconfig.json`.
- `@ts-ignore` é proibido em `src/`, `scripts/`, `tests/`; usar correção estrutural ou
  `@ts-expect-error` justificado.

## Estratégia de endurecimento progressivo

1. Manter `typecheck` padrão focado em Node/Audit.
2. Corrigir pacotes por domínio (`src/core`, `src/server`, `src/driver`, `scripts/audit`).
3. Após estabilidade, subir rigor seletivo:

- ativar flags mais restritivas por pacote/arquivo;
- reduzir uso de casts frágeis;
- migrar typedefs repetidos para módulos de tipos compartilhados.

## Referências locais desta skill

- `references/tsserver-contract.md`
- `references/jsdoc-node24-patterns.md`
- `references/error-triage-playbook.md`

## Done criteria

- `npm run -s typecheck:node` com exit `0`.
- Sem regressão em `lint` e `test:unit`.
- Imports ESM e contratos JSDoc coerentes com NodeNext.
- Novos tipos centralizados e reutilizáveis (sem duplicação desnecessária).
