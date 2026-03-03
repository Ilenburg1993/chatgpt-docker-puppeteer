# tests/integration/driver

**Propósito**: Testes de integração do driver de browser com o barramento NERV.  
**Status**: Canônico.  
**Público**: Desenvolvedores dos módulos `src/driver/` e `src/nerv/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                                        | Descrição                                                    |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `test_driver_nerv.spec.js`                     | Integração entre driver e NERV (emissão/recepção de eventos) |
| `test_wave13_hot_pool_reuse_integrity.spec.js` | Integridade de reuso do pool de browser                      |

## Regras de manutenção

- Usar mocks de browser de `tests/mocks/mock_browser.js` — nunca Puppeteer real.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários de driver: `tests/unit/driver/`
