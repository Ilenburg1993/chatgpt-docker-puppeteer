**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/kernel/task_runtime/`.  
**Quando consultar**: ao alterar FSM de tasks em memória, observação técnica, stalled-cycle tracking ou a ponte entre execução e telemetria do kernel.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# KERNEL TASK RUNTIME

**Propósito**: documentar `src/kernel/task_runtime/` como camada de estado técnico transitório do kernel.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/kernel/task_runtime/` não é o SSOT persistido. Ele é o runtime em memória que o kernel usa para
acompanhar o ciclo técnico de execução das tasks enquanto o processo está vivo.

Essa trilha existe para:

- modelar a FSM técnica das tasks no kernel;
- manter histórico técnico local;
- oferecer leitura rápida do estado em memória;
- registrar sinais de estagnação e referências operacionais.

## Arquivo principal

### `task_runtime.js`

É a implementação completa do subsistema.

Responsabilidades observáveis:

- definir `TaskState` (`CREATED`, `ACTIVE`, `SUSPENDED`, `TERMINATED`);
- impor transições válidas via `ALLOWED_TRANSITIONS`;
- manter um `Map` interno de tasks;
- emitir eventos locais e telemetria do kernel;
- expor snapshots imutáveis das tasks acompanhadas.

## Modelo de estado

Cada task mantida em memória carrega, no mínimo:

- `taskId`;
- `state`;
- `createdAt` / `updatedAt`;
- `history`;
- `stalledCycleCount`;
- `metadata`.

Esse estado é técnico. Ele não substitui a task persistida em `src/infra/db/task_repo.js`.

## API pública observável

### `createTask({ taskId, metadata })`

- cria a task no runtime;
- valida unicidade por `taskId`;
- registra `TASK_CREATED` no histórico;
- emite telemetria e `task_created`.

### `applyStateTransition({ taskId, newState, reason })`

- valida o estado alvo;
- protege contra transição inválida e race de mudança durante validação;
- atualiza estado e histórico;
- emite telemetria e `task_state_changed`.

### `recordIntentReference({ taskId, intent })`

- associa à task um snapshot da intenção operacional mais recente;
- ajuda o kernel a correlacionar decisão e execução.

### `recordObservationReference({ taskId, observation })`

- vincula observações técnicas recentes à task;
- permite rastrear o que levou a uma decisão posterior.

### `updateMetadata({ taskId, metadata })`

- mescla metadados operacionais sem substituir a task inteira;
- serve para anexar contexto técnico incremental.

### `getTask()`, `listTasks()`, `listTasksByState()`, `getStats()`

- oferecem introspecção do runtime em memória;
- são a base de observabilidade local do subsistema.

### `forgetTask(taskId)`

- remove totalmente a task do runtime;
- permite rearme futuro da mesma `taskId` quando o SSOT decidir.

## Fluxo técnico típico

1. O kernel cria ou registra a task quando ela entra no plano de execução.
2. A task nasce em `CREATED`.
3. O ciclo operacional a promove para `ACTIVE`.
4. Se necessário, a task pode entrar em `SUSPENDED`.
5. Ao final técnico, a task vai para `TERMINATED`.
6. O kernel pode esquecer a task em memória após consolidação persistida.

## Relação com outros subsistemas

### Kernel Task Runtime x Infra DB

- o estado em memória é transitório;
- o estado persistido continua soberano;
- divergência entre os dois é sintoma de bug ou reconciliação incompleta.

### Kernel Task Runtime x Policy Engine

- `stalledCycleCount` e histórico técnico alimentam decisões de política;
- a política usa esse estado como sinal, não como fonte única de verdade.

### Kernel Task Runtime x Task Execution Orchestrator

- a correlação entre tentativa, decisão e evento de driver depende de uma visão coerente da task
  ativa.

## Restrições e guardrails

- Não transformar essa trilha em nova fila soberana.
- Não adicionar semântica de missão aqui.
- Não persistir dados diretamente a partir deste módulo sem passar pela infra.
- Qualquer mudança de `TaskState` impacta policy, telemetria e orquestração de execução.

## Sinais operacionais a investigar

- tasks duplicadas em memória para a mesma `taskId`;
- `stalledCycleCount` crescendo sem resposta de policy;
- tasks em `TERMINATED` ainda recebendo transição;
- esquecimento prematuro de task ativa;
- divergência recorrente entre runtime local e status persistido.

## Referências no código

- `src/kernel/task_runtime/task_runtime.js`
- `src/kernel/task_execution_orchestrator.js`
- `src/kernel/policy_engine/policy_engine.js`
- `src/infra/db/task_repo.js`
