# src/kernel/task_runtime

**Propósito**: Runtime de tarefas do kernel — gerencia o ciclo de vida completo de uma tarefa em execução.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `task_runtime.js`: gerenciamento do ciclo de vida de tarefas em execução (tentativas, timeout, estado).

## O que não deve ficar aqui

- Worker de fila → `src/agent/queue_worker.js`
- Motor de execução individual → `src/kernel/execution_engine/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `task_runtime.js` | Ciclo de vida completo de tarefas em execução |

## Regras de manutenção

- Emita eventos de ciclo de vida (start, complete, fail) via NERV.

## Links relacionados

- Módulo pai: `src/kernel/`
- Motor de execução: `src/kernel/execution_engine/`
