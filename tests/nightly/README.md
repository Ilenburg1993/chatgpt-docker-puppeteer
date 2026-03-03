# tests/nightly

**Propósito**: Testes de execução noturna — cenários de chaos, stress e auditoria profunda que não
cabem no CI rápido.  
**Status**: Canônico.  
**Público**: Mantenedores e operações.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Specs de chaos testing para o sistema de contratos de auditoria.

## Entradas principais

| Pasta    | Descrição                                |
| -------- | ---------------------------------------- |
| `audit/` | Testes de chaos do pipeline de auditoria |

## Regras de manutenção

- Executar via `npm run audit:nightly` ou workflow `audit-nightly.yml`.
- Não incluir no `npm test` padrão — são lentos e podem falhar por recursos.

## Links relacionados

- Hub de testes: `tests/README.md`
- Workflow noturno: `.github/workflows/audit-nightly.yml`
- Pipeline de auditoria: `scripts/audit/`
