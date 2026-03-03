# tests/nightly/audit

**Propósito**: Testes de chaos do sistema de auditoria — execução noturna para validar resiliência
do pipeline.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                       | Descrição                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `test_contract_chaos.spec.js` | Testa o sistema de contratos sob condições caóticas (falhas, timeouts, dados corrompidos) |

## Regras de manutenção

- Executar apenas no workflow noturno — não em PRs.
- Garantir cleanup completo após execução.

## Links relacionados

- Pasta pai: `tests/nightly/README.md`
- Testes de auditoria integração: `tests/integration/audit/`
