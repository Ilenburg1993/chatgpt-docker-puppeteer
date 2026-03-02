# src/orchestrator/validation

**Propósito**: Validação de entradas e estado do orquestrador de missões.  
**Status**: Canônico.  
**Público**: Mantenedores do orquestrador.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `validation_service.js`: serviço de validação de entradas e estado do orquestrador.

## O que não deve ficar aqui

- Schemas de dados → `src/core/schemas/`
- Validação de lógica de negócio → `src/logic/validation/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `validation_service.js` | Valida entradas e estado do orquestrador |

## Regras de manutenção

- Use schemas de `src/core/schemas/` como base para validação.

## Links relacionados

- Módulo pai: `src/orchestrator/`
