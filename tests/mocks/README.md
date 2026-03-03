# tests/mocks

**Propósito**: Mocks de módulos do sistema para uso em testes unitários e de integração — browser,
logger e NERV.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores de testes.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Implementações simuladas dos módulos centrais do sistema.

## Entradas principais

| Arquivo           | Descrição                                        |
| ----------------- | ------------------------------------------------ |
| `mock_browser.js` | Mock do browser Puppeteer (page, evaluate, etc.) |
| `mock_logger.js`  | Mock do logger com spy em métodos de log         |
| `mock_nerv.js`    | Mock do barramento NERV (emit, on, off)          |

## O que não deve ficar aqui

- Fixtures de dados → `tests/fixtures/`.
- Helpers de teste → `tests/helpers/`.

## Regras de manutenção

- Mocks devem implementar a mesma interface pública do módulo real.
- Documentar com JSDoc quais métodos são suportados.

## Links relacionados

- Hub de testes: `tests/README.md`
- Fixtures: `tests/fixtures/`
- Helpers: `tests/helpers/`
