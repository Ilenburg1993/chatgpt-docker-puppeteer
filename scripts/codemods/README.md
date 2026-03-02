# scripts/codemods

**Propósito**: Transformações automatizadas de código-fonte (codemods) — migração de constantes, status e categorias de log.  
**Status**: Canônico de apoio.  
**Público**: Mantenedores realizando refatorações em larga escala.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `transform-connection-modes.js` | Substitui strings de modo de conexão por constantes |
| `transform-log-categories.js` | Migra categorias de log para constantes centralizadas |
| `transform-status-values.js` | Substitui valores de status por constantes |

## Regras de manutenção

- Sempre criar branch antes de executar um codemod.
- Validar com `npm run lint` e `npm test` após aplicação.
- Codemods são idempotentes — podem ser re-executados sem dano.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Constantes: `src/core/constants/`
