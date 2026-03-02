# src/kernel/policy_engine

**Propósito**: Motor de políticas do kernel — avalia regras e toma decisões sobre execução de tarefas.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `policy_engine.js`: implementação do motor de políticas com avaliação de regras.

## O que não deve ficar aqui

- Definições de políticas → `src/kernel/policies/`
- Store de observações (input do motor) → `src/kernel/observation_store/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `policy_engine.js` | Motor de avaliação e aplicação de políticas |

## Regras de manutenção

- O motor deve ser determinístico dado o mesmo conjunto de observações.
- Regras devem ser carregáveis dinamicamente de `dynamic_rules.json`.

## Links relacionados

- Módulo pai: `src/kernel/`
- Observações: `src/kernel/observation_store/`
