# KERNEL — Núcleo Soberano de Decisão

## Resumo

O `Kernel` é o núcleo lógico do agente: compõe subsistemas de execução, política, observação e
runtime de tarefas. Ele orquestra o ciclo executivo (kernel loop), delega avaliação ao
`ExecutionEngine` e aplica decisões, sem implementar lógica semântica por si só.

## Responsabilidades principais

- Compor subsistemas: `TaskRuntime`, `ObservationStore`, `PolicyEngine`, `ExecutionEngine`,
  `KernelLoop`, `KernelTelemetry`, `KernelNERVBridge`.
- Manter time-slicing determinístico (KernelLoop) e drenar buffers do `NERV` em cada ciclo.
- Expor API controlada para iniciar/parar, consultar status e gerenciar tarefas
  (criação/listagem/consulta).
- Emitir telemetria e registrar eventos técnicos para diagnóstico.

## Arquitetura e módulos internos

- Arquivo de composição: `src/kernel/kernel.js` (fábrica
  `createKernel({ nerv, policy, loop, telemetry })`).
- `kernel_loop` (`src/kernel/kernel_loop/kernel_loop.js`): ciclo executivo — step() realiza: 1)
  drenar inbound, 2) executar `ExecutionEngine.evaluate()`, 3) aplicar decisões, 4) drenar outbound.
- `task_runtime` (`src/kernel/task_runtime/task_runtime.js`): armazena o estado das tarefas,
  transições válidas, histórico e exposes eventos locais (`task_created`, `task_state_changed`).
- `policy_engine` (`src/kernel/policy_engine/policy_engine.js`): avalia alerts normativos
  consultivos (pressão, estagnação, gaps, duplicações) e produz `assessment` sem efeitos colaterais.
- `execution_engine` (`src/kernel/execution_engine/execution_engine.js`): motor que recebe
  observações/tarefas/policy e propõe decisões (PROPOSE\_\*). (Veja referência no código para
  detalhes.)
- `nerv_bridge` (`src/kernel/nerv_bridge/kernel_nerv_bridge.js`): interface com o `NERV` para
  receber eventos (observations) e publicar comandos/intentões.
- `telemetry` (`src/kernel/telemetry/kernel_telemetry.js`): canal de telemetria usado por todos os
  subsistemas.

## Fluxo canônico (ciclo do Kernel)

1. KernelLoop inicia um tick.
2. Drenagem de inbound: envelopes/eventos acumulados no `NERV` são processados (até limite técnico
   por tick).
3. `ExecutionEngine.evaluate()` analisa estado atual + observações e retorna propostas de decisão.
4. KernelLoop aplica decisões (paraleliza quando possível, com timeout de segurança — 5s por lote).
5. Drenagem outbound: comandos/outputs são serializados e enviados pelo transporte do `NERV`.

## APIs e uso (exemplos)

Criação do Kernel (exemplo):

```javascript
const { createKernel } = require('./src/kernel/kernel');
const kernel = createKernel({
  nerv: nervInstance,
  policy: { maxConcurrentTasks: 5 },
  loop: { interval: 50 },
});
await kernel.start();
```

Interface pública exposta por `createKernel` (resumo):

- `start()` — inicia ponte NERV e o `KernelLoop`.
- `stop()` — para `KernelLoop` e a ponte NERV.
- `getStatus()` — retorna status técnico: loop, tasks, observations, nerv, telemetry.
- `createTask({taskId, metadata})` — cria nova tarefa no `TaskRuntime`.
- `getTask(taskId)` / `listTasks()` — consultas read-only.
- `telemetry` — referência ao canal de telemetria do Kernel.

## Boas práticas operacionais

- Não faça mutações diretas no `TaskRuntime.tasks`; use `createTask()` e as transições via
  `ExecutionEngine`.
- Monitore `kernel.getStatus()` para detectar `KernelLoop` em estado `DEGRADED` ou contadores de
  ticks elevados.
- Use `PolicyEngine` para ajustar limites (`maxObservationsPerTask`, `maxStalledCycles`,
  `maxTaskAgeMs`) via `updateLimits()` quando necessário.
- Evite listeners permanentes sem unsubscribe no runtime — o Kernel usa eventos locais para
  sinalização.

## Runbook rápido — operações e troubleshooting

- Iniciar sistema completo (inclui Kernel):

  npm run start

- Iniciar em daemon (PM2):

  npm run daemon:start

- Verificar status técnico do Kernel (via API interna — se exposta) ou logs PM2:

  npm run daemon:status npm run daemon:logs

- Diagnóstico rápido:
  - `kernel.getStatus()` → checar `loop` e `tasks`.
  - Verificar telemetria: eventos `kernel_loop_tick_error`, `kernel_loop_decision_timeout`.
  - Checar `analysis/graph.svg` e `logs/crash_reports/` para anomalias recentes.

## Erros comuns e como agir

- KernelLoop entrando em `DEGRADED`: revisar exceções em `kernel_loop_tick_error` (stack trace em
  logs) e aumentar telemetria para capturar `proposals` problemáticos.
- Timeouts ao aplicar decisões: revisar propostas retornadas pelo `ExecutionEngine` e reduzir
  paralelismo ou aumentar timeout se as operações forem válidas mas longas.
- Tarefas estagnadas: ajustar `PolicyEngine` (`maxStalledCycles`) ou investigar observações ausentes
  no `ObservationStore`.

## Próximos passos recomendados

- Documentar fluxos típicos (ex.: `TASK_START` → `DRIVER_EXECUTE_TASK` → `DRIVER_TASK_COMPLETED`)
  com exemplos de envelopes e payloads.
- Criar testes de integração para o ciclo completo do Kernel (injetando `NERV` simulada e
  observações sintéticas).

## Referências no código

- `src/kernel/kernel.js`
- `src/kernel/kernel_loop/kernel_loop.js`
- `src/kernel/task_runtime/task_runtime.js`
- `src/kernel/policy_engine/policy_engine.js`
- `src/kernel/execution_engine/execution_engine.js`
- `src/kernel/nerv_bridge/kernel_nerv_bridge.js`
- `src/kernel/telemetry/kernel_telemetry.js`
