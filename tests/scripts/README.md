# tests/scripts

**Propósito**: Scripts auxiliares de suporte à manutenção dos testes — correção de imports e
automações de refatoração.  
**Status**: Canônico de apoio.  
**Público**: Mantenedores de testes.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo               | Descrição                                            |
| --------------------- | ---------------------------------------------------- |
| `corrigir_imports.js` | Corrige automaticamente caminhos de import nos specs |

## Regras de manutenção

- Scripts devem ser idempotentes.
- Documentar com JSDoc o que cada script modifica.

## Links relacionados

- Hub de testes: `tests/README.md`
- Codemods de produção: `scripts/codemods/`
