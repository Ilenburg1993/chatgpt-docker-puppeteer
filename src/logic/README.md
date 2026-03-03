# src/logic

**Propósito**: Lógica de negócio do sistema — validação adaptativa, regras e julgamento LLM.  
**Status**: Canônico.  
**Público**: Módulos que precisam de regras de negócio e validação semântica.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Validação adaptativa de respostas e dados (`validation/`).
- Validador principal de lógica (`validator.js`).
- Regras adaptativas de negócio (`adaptive.js`).

## O que não deve ficar aqui

- Schemas de dados → `src/core/schemas/`
- Validação de entrada HTTP → `src/server/middleware/`
- Validação de pré-condições estruturais → `src/core/validators/`

## Entradas principais

| Arquivo/Pasta  | Descrição                                                      |
| -------------- | -------------------------------------------------------------- |
| `validation/`  | Motor de validação com regras de formato, físicas e semânticas |
| `validator.js` | Validador principal de lógica de negócio                       |
| `adaptive.js`  | Regras adaptativas baseadas em histórico e contexto            |

## Regras de manutenção

- Lógica de negócio deve ser testada isoladamente de infra e driver.
- Regras novas devem ir para `validation/rules/` com arquivo dedicado.

## Links relacionados

- Validação: `src/logic/validation/`
- Schemas: `src/core/schemas/`
- Tipos: `src/types/logic/`
