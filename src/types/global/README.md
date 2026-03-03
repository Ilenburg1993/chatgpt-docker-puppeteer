# src/types/global

**Propósito**: Tipos globais e ambient declarations do sistema — disponíveis em todos os módulos sem
importação explícita.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores do projeto.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `ambient.d.ts`: declarações de tipos globais e ambient (variáveis, módulos, extensões de tipos
  nativos).

## O que não deve ficar aqui

- Tipos específicos de domínio → subpastas de `src/types/`
- Schemas Zod → `src/core/schemas/`

## Entradas principais

| Arquivo        | Descrição                                   |
| -------------- | ------------------------------------------- |
| `ambient.d.ts` | Declarações ambient disponíveis globalmente |

## Regras de manutenção

- Adicione tipos aqui apenas se forem genuinamente globais (sem domínio específico).
- Tipos globais afetam todo o projeto; valide com `npm run typecheck:full`.

## Links relacionados

- Módulo pai: `src/types/`
- Typecheck: `tsconfig.base.json`
