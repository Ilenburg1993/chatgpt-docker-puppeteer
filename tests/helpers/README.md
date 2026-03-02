# tests/helpers

**Propósito**: Utilitários e helpers compartilhados entre suítes de testes.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores de testes.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Funções auxiliares reutilizáveis (aguardar eventos, criar contextos de teste, etc.).

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_helpers.js` | Coleção de helpers genéricos para setup e assertions de testes |

## O que não deve ficar aqui

- Mocks de módulos específicos → `tests/mocks/`.
- Setup/teardown de suíte → `tests/support/`.

## Regras de manutenção

- Funções devem ser puras e sem efeitos colaterais persistentes.
- Documentar com JSDoc todo helper exportado.

## Links relacionados

- Hub de testes: `tests/README.md`
- Mocks: `tests/mocks/`
- Setup/teardown: `tests/support/`
