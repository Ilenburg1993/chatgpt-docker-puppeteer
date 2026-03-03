# src/logic/validation/rules

**Propósito**: Regras de validação organizadas por categoria — formato, restrições físicas e
semântica.  
**Status**: Canônico.  
**Público**: Mantenedores do motor de validação de lógica de negócio.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `format_rules.js`: regras de validação de formato de dados.
- `physical_rules.js`: regras baseadas em restrições físicas e estruturais.
- `semantic_rules.js`: regras de validação semântica e de significado.

## O que não deve ficar aqui

- Motor de aplicação de regras → `src/logic/validation/scan_engine.js`
- Schemas Zod → `src/core/schemas/`

## Entradas principais

| Arquivo             | Descrição                                  |
| ------------------- | ------------------------------------------ |
| `format_rules.js`   | Regras de validação de formato             |
| `physical_rules.js` | Regras de restrições físicas e estruturais |
| `semantic_rules.js` | Regras de validação semântica              |

## Regras de manutenção

- Cada arquivo de regras deve exportar um array de regras aplicáveis.
- Novas categorias de regras recebem arquivo dedicado.

## Links relacionados

- Módulo pai: `src/logic/validation/`
