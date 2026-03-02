# tests/support

**Propósito**: Setup e teardown globais da suíte de testes — executados antes e após todas as suítes.  
**Status**: Canônico.  
**Público**: Mantenedores de infraestrutura de testes.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `setup.js` | Setup global: variáveis de ambiente, mocks globais, listeners |
| `teardown.js` | Teardown global: limpeza de recursos, encerramento de processos |

## Regras de manutenção

- Referenciar em `vitest.config.js` ou na configuração do runner nativo.
- Não incluir lógica de teste — apenas setup/teardown de infraestrutura.

## Links relacionados

- Hub de testes: `tests/README.md`
- Helpers de teste: `tests/helpers/`
