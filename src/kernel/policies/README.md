# src/kernel/policies

**Propósito**: Definições de políticas de execução do kernel — regras de priorização, limites e comportamento.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel e operadores do sistema.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `policy_engine.js`: motor de avaliação de políticas (versão nesta subpasta).

## O que não deve ficar aqui

- Motor de políticas canônico → `src/kernel/policy_engine/`
- Regras dinâmicas em runtime → `dynamic_rules.json` (raiz do projeto)

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `policy_engine.js` | Avaliação de políticas do kernel |

## Regras de manutenção

- Políticas configuráveis devem ser carregadas de `dynamic_rules.json`.

## Links relacionados

- Módulo pai: `src/kernel/`
- Motor canônico: `src/kernel/policy_engine/`
