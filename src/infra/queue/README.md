# src/infra/queue

**Propósito**: Fila de tarefas com scheduler, cache, motor de consultas e carregador — coordena o
fluxo de trabalho do agente.  
**Status**: Canônico.  
**Público**: Kernel e workers que consomem e produzem tarefas.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `scheduler.js`: agendamento e priorização de tarefas na fila.
- `task_loader.js`: carregamento de tarefas a partir de arquivos `fila/*.json`.
- `query_engine.js`: consultas e filtros sobre o estado da fila.
- `cache.js`: cache em memória para aceleração de acesso à fila.

## O que não deve ficar aqui

- Persistência de tarefas no banco → `src/infra/db/task_repo.js`
- Workers de consumo → `src/agent/queue_worker.js`

## Entradas principais

| Arquivo           | Descrição                            |
| ----------------- | ------------------------------------ |
| `scheduler.js`    | Agendamento e priorização de tarefas |
| `task_loader.js`  | Carrega tarefas de `fila/*.json`     |
| `query_engine.js` | Consultas sobre o estado da fila     |
| `cache.js`        | Cache em memória da fila             |

## Regras de manutenção

- O formato de tarefas na fila deve seguir o schema em `src/core/schemas/task_schema.js`.
- Alterações no scheduler devem ser refletidas nos testes de integração.

## Links relacionados

- Módulo pai: `src/infra/`
- Schema de tarefas: `src/core/schemas/`
- Worker de fila: `src/agent/queue_worker.js`
