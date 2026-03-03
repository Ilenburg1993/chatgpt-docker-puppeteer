**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da camada de workers operacionais do runtime (`src/agent/`).  
**Quando consultar**: ao alterar loops periódicos, workers SSOT, watchdogs, controle de task ou
progressão operacional de missões.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# AGENT RUNTIME

**Propósito**: documentar `src/agent/` como a camada operacional contínua do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/agent/` é a malha de workers que mantém o sistema andando entre um tick e outro. Essa camada:

- lê e reage ao SSOT persistido;
- coordena filas, missões, controle, watchdogs e pós-processamento;
- opera acima de `infra` e ao lado de `kernel`.

Ela não é um “agente” no sentido externo do termo. É a camada operacional interna do runtime.

No baseline atual, essa trilha é plana: os workers vivem diretamente em `src/agent/`. Não existe uma
subárvore `src/agent/workers/` versionada nesta revisão.

## Componentes principais

### `agent_loop.js`

- scheduler multiperiódico do runtime;
- coordena `kernel.step()` e os demais workers com cadências independentes;
- é o maestro dos loops internos.

### `queue_worker.js`

- reivindica tasks elegíveis no banco;
- compõe contexto a partir de inputs e artifacts;
- despacha a execução real para o kernel.

### `task_control_watcher.js`

- observa tasks em `PAUSED`/`CANCELLED` com lock ativo;
- emite `DRIVER_ABORT` via NERV;
- libera lock e fecha o ciclo de controle operacional.

### `attempt_watchdog.js`

- detecta attempts travadas (`DISPATCHED`, `RUNNING`, heartbeat ausente);
- faz reschedule, falha técnica ou escalonamento;
- protege o runtime contra execuções zumbis.

### `heartbeat_watchdog.js`

- força falha sintética quando uma task em `RUNNING` fica sem heartbeat;
- complementa o `attempt_watchdog` em uma trilha específica de stale heartbeat.

### `mission_runner.js`

- acompanha missões em `RUNNING`;
- cria tarefas concretas para os steps do workflow;
- avança ou finaliza a missão conforme o estado das tasks.

### `mission_planner_processor.js`

- consome saídas de planning;
- transforma propostas em novas tasks;
- faz a ponte entre planner e fila.

### `task_orchestration_worker.js`

- pós-processa tasks `ITERATIVE` e `MULTI_STEP`;
- lê saída de attempt;
- valida resultado;
- cria step seguinte quando necessário.

### `mission_execution_service.js`

- aplica transições consistentes de missão;
- registra eventos e protege precondições de progresso.

### `workflow_next_step_builder.js`

- compõe a próxima task derivada de uma execução de workflow.

### `task_state_projector.js`

- projeta estado derivado e consolidado de task.

### `task_attempt_invariants.js`

- centraliza invariantes e higiene de lock/tentativa.

## Relação com outros subsistemas

### Agent x Kernel

- o agent alimenta o kernel;
- o kernel executa o trabalho propriamente dito.

### Agent x Infra

- o agent depende fortemente de DB, locks, queue e storage.

### Agent x Missions

- `src/missions/` define o domínio;
- `src/agent/` mantém a execução contínua desse domínio.

## Restrições

- Não mover lógica de decisão estratégica do orchestrator para os workers por conveniência.
- Não duplicar no agent o que já é responsabilidade do kernel.
- Novos workers estruturais devem ser explicitamente documentados.

## Referências no código

- `src/agent/agent_loop.js`
- `src/agent/queue_worker.js`
- `src/agent/task_control_watcher.js`
- `src/agent/attempt_watchdog.js`
- `src/agent/heartbeat_watchdog.js`
- `src/agent/mission_runner.js`
- `src/agent/mission_planner_processor.js`
- `src/agent/task_orchestration_worker.js`
- `src/agent/mission_execution_service.js`
- `src/agent/workflow_next_step_builder.js`
- `src/agent/task_state_projector.js`
