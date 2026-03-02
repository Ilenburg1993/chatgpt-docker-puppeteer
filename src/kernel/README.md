# src/kernel

**Propósito**: Motor de decisão e orquestração central — executa o loop de controle a 20Hz, aplica políticas, mantém observações e gerencia o ciclo de vida de tarefas.  
**Status**: Canônico.  
**Público**: Mantenedores do runtime; é o coração do sistema.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Orquestrador principal (`kernel.js`).
- Motor de execução de tarefas (`execution_engine/`).
- Loop de controle a 20Hz (`kernel_loop/`).
- Bridge com NERV (`nerv_bridge/`).
- Store de observações/fatos (`observation_store/`).
- Políticas de execução (`policies/`).
- Motor de políticas (`policy_engine/`).
- Runtime de tarefas (`task_runtime/`).
- Telemetria do kernel (`telemetry/`).
- Orquestrador de execução de tarefas (`task_execution_orchestrator.js`).

## O que não deve ficar aqui

- Workers de agente → `src/agent/`
- Automação de browser → `src/driver/`
- Estratégias de missão → `src/orchestrator/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `kernel.js` | Orquestrador principal do kernel |
| `kernel_loop/` | Loop de controle a 20Hz (50ms) |
| `execution_engine/` | Motor de execução de tarefas |
| `policy_engine/` | Avaliação e aplicação de políticas |
| `observation_store/` | Registro de fatos e observações do sistema |
| `task_runtime/` | Gerenciamento do runtime de tarefas |
| `nerv_bridge/` | Bridge kernel ↔ NERV |
| `telemetry/` | Métricas e telemetria do kernel |
| `task_execution_orchestrator.js` | Orquestra a execução de tarefas |

## Regras de manutenção

- O loop do kernel é crítico para o SLA; não adicione I/O bloqueante nele.
- Toda comunicação com outros módulos deve ser via NERV ou eventos.
- Políticas devem ser configuráveis via `dynamic_rules.json`.

## Links relacionados

- Loop: `src/kernel/kernel_loop/`
- Políticas: `src/kernel/policy_engine/`
- Workers: `src/agent/`
- Tipos: `src/types/kernel/`
