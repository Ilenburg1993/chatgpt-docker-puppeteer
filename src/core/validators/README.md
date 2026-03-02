# src/core/validators

**Propósito**: Validadores de pré-condições do sistema — verificam invariantes antes de operações críticas.  
**Status**: Canônico.  
**Público**: Módulos que precisam verificar pré-condições antes de executar operações.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `prerequisite_validator.js`: valida pré-condições necessárias para execução de tarefas e missões.

## O que não deve ficar aqui

- Schemas de dados → `src/core/schemas/`
- Regras de validação de lógica de negócio → `src/logic/validation/`
- Validação de entrada HTTP → `src/server/middleware/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `prerequisite_validator.js` | Valida pré-condições do sistema antes de operações críticas |

## Regras de manutenção

- Validadores devem lançar erros descritivos ao falhar.
- Não adicione lógica de negócio aqui; mantenha foco em invariantes estruturais.

## Links relacionados

- Módulo pai: `src/core/`
- Schemas: `src/core/schemas/`
- Validação de lógica: `src/logic/validation/`
