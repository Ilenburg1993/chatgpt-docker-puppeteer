# src/validation

**Propósito**: Julgamento LLM para validação de qualidade — avalia respostas geradas com base em
critérios semânticos.  
**Status**: Especializado.  
**Público**: Módulos que precisam de validação por LLM de saídas geradas.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `llm_judge.js`: juiz LLM que avalia a qualidade de respostas e saídas geradas.

## O que não deve ficar aqui

- Validação de schema → `src/core/schemas/`
- Validação de lógica de negócio → `src/logic/validation/`
- Validação de entrada HTTP → `src/server/middleware/schema_guard.js`

## Entradas principais

| Arquivo        | Descrição                                      |
| -------------- | ---------------------------------------------- |
| `llm_judge.js` | Juiz LLM para avaliação de qualidade de saídas |

## Regras de manutenção

- Chamadas ao LLM devem passar pelo `src/inference_gateway/`.

## Links relacionados

- Gateway de inferência: `src/inference_gateway/`
- Validação de lógica: `src/logic/validation/`
- Tipos: `src/types/validation/`
