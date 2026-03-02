# src/types

**Propósito**: Definições de tipos TypeScript/JSDoc para todos os domínios do sistema — augmentações, contratos e tipos globais.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores; consumido pelo tsserver para IntelliSense e typecheck.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Augmentações de tipos por domínio (`core/`, `driver/`, `infra/`, `kernel/`, `logic/`, `missions/`, `nerv/`, `orchestrator/`, `server/`, `shared/`, `validation/`).
- Tipos globais e ambient declarations (`global/`).
- Contratos de tipos do `core` (`core.js`, `core.d.ts`).
- Ponto de entrada de tipos globais (`index.d.ts`, `global.d.ts`).
- Guards de tipos (`guards.js`).

## O que não deve ficar aqui

- Schemas de validação Zod → `src/core/schemas/`
- Lógica de runtime → qualquer outro módulo

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `core/` | Augmentações de tipos do core |
| `driver/` | Tipos do driver de browser |
| `infra/` | Tipos de infraestrutura |
| `kernel/` | Tipos do kernel |
| `nerv/` | Tipos do barramento NERV |
| `server/` | Tipos do servidor (inclui extensões Socket.io) |
| `global/` | Tipos globais e ambient declarations |
| `guards.js` | Type guards compartilhados |
| `core.d.ts` | Declarações TypeScript do core |
| `index.d.ts` | Ponto de entrada de tipos globais |

## Regras de manutenção

- Augmentações devem ficar em `augmentations.d.ts` dentro de cada subpasta de domínio.
- Não adicione lógica de runtime nos arquivos `.d.ts`.
- Execute `npm run typecheck:node` para validar após alterações.

## Links relacionados

- Typecheck: `tsconfig.node.json`
- Schemas Zod: `src/core/schemas/`
- Tipos globais: `src/types/global/`
