# src/logic/validation

**Propósito**: Motor de validação de lógica de negócio — verifica formato, regras físicas e semântica de dados e respostas.  
**Status**: Canônico.  
**Público**: Módulos que precisam validar respostas de LLM e dados de negócio.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `validation_core.js`: núcleo do motor de validação.
- `scan_engine.js`: motor de varredura e aplicação de regras.
- `rules/`: regras de validação por categoria (formato, física, semântica).

## O que não deve ficar aqui

- Validação de schema Zod → `src/core/schemas/`
- Validação de pré-condições estruturais → `src/core/validators/`
- Middleware de validação HTTP → `src/server/middleware/schema_guard.js`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `validation_core.js` | Núcleo do motor de validação |
| `scan_engine.js` | Motor de varredura e aplicação de regras |
| `rules/` | Regras de validação por categoria |

## Regras de manutenção

- Novas categorias de regras devem ter arquivo dedicado em `rules/`.
- O motor deve retornar resultados estruturados com lista de violações.

## Links relacionados

- Módulo pai: `src/logic/`
- Regras: `src/logic/validation/rules/`
