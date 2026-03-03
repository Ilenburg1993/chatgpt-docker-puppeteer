# tests/integration/api

**Propósito**: Testes de integração da camada de API REST do servidor.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/server/api/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                        | Descrição                                                |
| ------------------------------ | -------------------------------------------------------- |
| `test_health_endpoint.spec.js` | Valida o endpoint `/health` e seus contratos de resposta |

## Regras de manutenção

- Não subir server real — usar instâncias de teste com portas efêmeras.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários de server: `tests/unit/server/`
