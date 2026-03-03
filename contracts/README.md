# contracts

**Propósito**: Registro e domínios de contratos arquiteturais — definem invariantes, allowlists e
regras de conformidade do sistema.  
**Status**: Canônico.  
**Público**: Mantenedores, Audit Agent e pipeline de auditoria.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Contratos formais que o pipeline de auditoria valida automaticamente.
- Organizados em domínios semânticos com allowlists de exceções.

## Entradas principais

| Arquivo/Pasta   | Descrição                                            |
| --------------- | ---------------------------------------------------- |
| `registry.json` | Registro central de todos os contratos do projeto    |
| `domains/`      | Contratos por domínio (api, security, runtime, etc.) |
| `allowlists/`   | Exceções permitidas para regras de contrato          |

## Regras de manutenção

- Novos contratos devem ser registrados em `registry.json`.
- Allowlists são exceções explícitas — documentar o motivo.
- Validar com `npm run audit:quick` após alterações.

## Links relacionados

- Pipeline de contratos: `scripts/audit/contracts/`
- Testes de contratos: `tests/unit/audit/test_contract_registry.spec.js`
- Documentação de auditoria: `DOCUMENTAÇÃO/`
