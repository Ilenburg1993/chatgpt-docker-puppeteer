**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do subsistema de decisão e execução do runtime.  
**Quando consultar**: ao alterar pump, execução de tarefas, políticas ou a ponte entre NERV e driver.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# KERNEL

**Propósito**: documentar o subsistema `src/kernel/` como motor soberano de execução do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

O kernel é o motor executivo do sistema. Ele recebe o estado já persistido e os sinais vindos do
NERV, processa esse contexto em ciclos curtos e transforma isso em decisões e comandos de execução.

Ele não é:

- a camada de estratégia de workflow;
- a fila de despacho;
- o domínio de missão;
- o atuador browser.

Ele é:

- o pump principal do runtime;
- a camada que drena buffers e observa envelopes;
- a ponte entre política, runtime de tarefas, NERV e execução concreta.

## Responsabilidades principais

- manter o loop soberano de execução do runtime;
- drenar inbound e outbound do NERV;
- coordenar o ciclo de vida técnico das tarefas;
- aplicar política e observação sobre o estado corrente;
- acionar a ponte que envia comandos ao driver;
- consolidar telemetria e status operacional do kernel.

## Estrutura interna de `src/kernel/`

### `kernel.js`

É a fábrica principal do subsistema.

Responsabilidades:

- criar a instância do kernel;
- resolver o modo de operação (o baseline atual usa foco em `ssot_gateway`);
- compor telemetria, loop, NERV bridge e execução;
- expor métodos públicos como `start()`, `stop()`, `step()` e `executeTask()`.

### `kernel_loop/kernel_loop.js`

É o loop soberano do kernel.

Responsabilidades:

- definir o ritmo do tick;
- executar a ordem canônica do ciclo;
- drenar buffers do NERV;
- chamar o motor de execução;
- aplicar decisões com guardrails de tempo e ordem.

### `execution_engine/execution_engine.js`

É o motor que decide o que fazer com base no estado corrente.

Responsabilidades:

- consumir observações, tasks, policy e contexto;
- produzir propostas de ação;
- separar avaliação de execução concreta.

### `task_runtime/task_runtime.js`

É a camada de estado técnico das tarefas dentro do kernel.

Responsabilidades:

- manter o estado em memória necessário para execução;
- aplicar transições técnicas;
- expor visão das tarefas ativas para o subsistema.

Aprofundamento específico: [KERNEL_TASK_RUNTIME.md](./KERNEL_TASK_RUNTIME.md).

### `task_execution_orchestrator.js`

É a ponte entre decisão do kernel e eventos concretos do driver.

Responsabilidades:

- emitir `DRIVER_EXECUTE_TASK`;
- rastrear correlação por task/correlationId;
- reagir a `DRIVER_TASK_COMPLETED`, `DRIVER_TASK_FAILED` e `DRIVER_TASK_ABORTED`;
- aplicar idempotência por execução;
- encaminhar retry, falha permanente ou conclusão.

Esse arquivo é central para entender como o kernel conversa com o driver sem acoplamento direto.

### `nerv_bridge/kernel_nerv_bridge.js`

É a integração estrutural entre kernel e barramento NERV.

Responsabilidades:

- encapsular emissão de comandos;
- fazer hooks de preparação antes da execução;
- manter o contrato de mensagens entre kernel e restante do runtime.

### `observation_store/observation_store.js`

Armazena observações e sinais usados pelo kernel para decidir.

### `policy_engine/policy_engine.js`

É a implementação principal da política do kernel.

Responsabilidades:

- avaliar limites e condições de execução;
- produzir avaliações normativas sem executar side effects por si só.

### `policies/`

É uma trilha paralela/legada de policy dentro do diretório. Ela existe na árvore atual, mas o
contrato arquitetural principal deve continuar apontando para `policy_engine/` como a fonte
operacional primária até consolidação definitiva.

### `telemetry/kernel_telemetry.js`

Centraliza a telemetria do subsistema.

## Fluxo canônico do kernel

1. O kernel recebe ou já possui estado técnico das tarefas.
2. O tick drena inbound do NERV.
3. O motor de execução avalia observações e estado.
4. O kernel consolida a decisão resultante.
5. A decisão vira comando, retry, transição ou telemetria.
6. O outbound do NERV é drenado.

No modo vigente, esse ciclo pode ser dirigido por `AgentLoop`, em vez de um loop isolado de
processo.

## Interface pública e contratos

O contrato público relevante do kernel gira em torno de:

- `start()` e `stop()`: lifecycle técnico;
- `step()`: tick manual/dirigido pelo loop superior;
- `executeTask(task, correlationId)`: entrada principal para execução de uma task;
- `getStatus()` e telemetria associada: observabilidade do subsistema.

O restante da arquitetura deve tratar o kernel como motor de execução, não como dono do domínio de
missão ou da fila.

## Relação com outros subsistemas

### Kernel x Orchestrator

- O kernel executa.
- O orchestrator define estratégia, contexto, iteração e validação.

### Kernel x Agent

- `src/agent/` aciona e alimenta o kernel.
- `AgentLoop` define a cadência operacional.
- `QueueWorker` usa o kernel como ponto de despacho real.

### Kernel x Driver

- O kernel não chama o browser diretamente.
- A integração passa por ponte NERV + orchestration de execução.

### Kernel x NERV

- O NERV é a malha de comunicação.
- O kernel depende dele para receber e publicar envelopes.

## Limites e restrições

- O kernel não deve assumir ownership do browser.
- O kernel não deve concentrar lógica de domínio de missão.
- O kernel não deve substituir a fila nem os workers de `src/agent/`.
- Qualquer mudança em contratos de `ActionCode` e correlação precisa considerar
  `task_execution_orchestrator.js`.

## Sinais operacionais importantes

Ao investigar problemas no kernel, observar:

- falhas no dreno de inbound/outbound;
- erros recorrentes em `emitCommand`;
- correlação antiga ou stale sendo rejeitada;
- loops degradados ou tick preso;
- divergências entre task ativa e eventos de driver.

## Lacunas e dívida técnica observável

- Há coexistência de `policy_engine/` e `policies/`, o que sugere trilha de consolidação ainda
  aberta.
- Há diretórios de exemplo e um `DOC.docx` dentro de `src/kernel/` que não compõem o contrato
  arquitetural principal.

## Referências no código

- `src/kernel/kernel.js`
- `src/kernel/kernel_loop/kernel_loop.js`
- `src/kernel/execution_engine/execution_engine.js`
- `src/kernel/task_execution_orchestrator.js`
- `src/kernel/task_runtime/task_runtime.js`
- `src/kernel/policy_engine/policy_engine.js`
- `src/kernel/nerv_bridge/kernel_nerv_bridge.js`
- `src/kernel/observation_store/observation_store.js`
- `src/kernel/telemetry/kernel_telemetry.js`
