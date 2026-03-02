# src/agent

**Propósito**: Workers internos do runtime responsáveis pelos loops de execução de missões — fila, watchdog, controle e pós-processamento.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel e do pipeline de execução de missões.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Loops de execução de agentes (fila, missão, controle).
- Watchdogs de tentativas e heartbeat.
- Projeção e orquestração de estado de tarefas.

## O que não deve ficar aqui

- Lógica de domínio de missões → `src/missions/`
- Estratégias de orquestração → `src/orchestrator/`
- Automação de browser → `src/driver/`
- Agente de auditoria autônomo → `src/audit_agent/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `agent_loop.js` | Loop principal do agente |
| `queue_worker.js` | Worker de consumo da fila de tarefas |
| `mission_runner.js` | Executa o ciclo de vida de uma missão |
| `mission_execution_service.js` | Serviço de execução de missões |
| `mission_planner_processor.js` | Processador do planejamento de missões |
| `attempt_watchdog.js` | Watchdog de tentativas de execução |
| `heartbeat_watchdog.js` | Monitoramento de heartbeat do agente |
| `task_control_watcher.js` | Observa mudanças no controle de tarefas |
| `task_orchestration_worker.js` | Worker de orquestração de tarefas |
| `task_attempt_invariants.js` | Invariantes de tentativa de tarefa |
| `task_state_projector.js` | Projeção de estado de tarefa |
| `workflow_next_step_builder.js` | Constrói o próximo passo do workflow |

## Regras de manutenção

- Workers comunicam-se via NERV (`src/nerv/`); evite chamadas diretas entre módulos.
- Novos workers devem emitir eventos de ciclo de vida via barramento NERV.
- Não adicione lógica de domínio aqui; delegue para `src/missions/` ou `src/orchestrator/`.

## Links relacionados

- Kernel (loop de controle): `src/kernel/`
- Domínio de missões: `src/missions/`
- Orquestrador: `src/orchestrator/`
- Barramento NERV: `src/nerv/`
