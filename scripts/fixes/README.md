# scripts/fixes

**Propósito**: Scripts pontuais de correção automatizada de código — atualmente focused em variáveis não utilizadas.  
**Status**: Canônico de apoio.  
**Público**: Mantenedores realizando correções de lint em larga escala.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `fix-unused-vars.js` | Remove ou comenta variáveis não utilizadas detectadas pelo ESLint |

## Regras de manutenção

- Validar resultado com `npm run lint` após execução.
- Criar backup ou branch antes de aplicar.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Codemods: `scripts/codemods/`
