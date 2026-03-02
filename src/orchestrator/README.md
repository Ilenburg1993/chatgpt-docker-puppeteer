# src/orchestrator

**Propósito**: Orquestrador de missões — implementa estratégias de execução (`SINGLE_SHOT`, `ITERATIVE`, `MULTI_STEP`) e gerencia contexto e memória de missões.  
**Status**: Canônico.  
**Público**: Mantenedores do pipeline de missões.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Motor de orquestração principal (`orchestrator_engine.js`).
- Gerenciador de contexto de missão (`context_manager.js`).
- Gerenciador de checkpoints (`checkpoint_manager.js`).
- Store de memória de missão (`memory_store.js`).
- Ponto de entrada unificado (`index.js`).
- Validação de missões (`validation/`).

## O que não deve ficar aqui

- Workers de execução → `src/agent/`
- Domínio de missões → `src/missions/`
- Kernel de decisão → `src/kernel/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `orchestrator_engine.js` | Motor principal de orquestração de missões |
| `context_manager.js` | Gerencia o contexto acumulado de uma missão |
| `checkpoint_manager.js` | Persistência de checkpoints de progresso |
| `memory_store.js` | Store de memória de curto prazo da missão |
| `validation/` | Validação de entradas do orquestrador |
| `index.js` | Ponto de entrada público do módulo |

## Regras de manutenção

- Estratégias de execução devem ser configuráveis por tipo de missão.
- Checkpoints devem ser persistidos via `src/infra/db/`.

## Links relacionados

- Agente executor: `src/agent/`
- Missões: `src/missions/`
- Tipos: `src/types/orchestrator/`
