// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { OrchestratorEngine } from '#orchestrator/orchestrator_engine';
import { ActionCode, ActorRole } from '#shared/nerv/constants';
import { ExecutionEngine } from './execution_engine/execution_engine.js';
import { KernelLoop } from './kernel_loop/kernel_loop.js';
import { KernelNERVBridge } from './nerv_bridge/kernel_nerv_bridge.js';
import { ObservationStore } from './observation_store/observation_store.js';
import { PolicyEngine } from './policy_engine/policy_engine.js';
import { TaskExecutionOrchestrator } from './task_execution_orchestrator.js';
import { TaskRuntime, TaskState } from './task_runtime/task_runtime.js';
import { KernelTelemetry } from './telemetry/kernel_telemetry.js';

/**
 * Opções para createSsotGatewayKernel.
 * @typedef {Object} SsotGatewayKernelOptions
 * @property {Object} [nerv] - Instância do sistema NERV.
 * @property {Object} [telemetry] - Opções de telemetria.
 * @property {Object} [pump] - Opções do pump.
 * @property {number} [pump.baseIntervalMs] - Intervalo base em ms.
 * @property {Object} [browserPool] - Pool de browsers.
 * @property {Object} [scheduler] - Scheduler de tarefas.
 * @property {Function} [onActivateTask] - Callback para ativação de tarefa.
 * @property {Function} [onTerminateTask] - Callback para terminação de tarefa.
 * @property {Function} [onSuspendTask] - Callback para suspensão de tarefa.
 * @property {Object} [loop] - Opções do loop.
 * @property {string} [mode] - Modo do kernel.
 */

/**
 * Opções para createKernel.
 * @typedef {Object} KernelOptions
 * @property {string} [mode='ssot_gateway'] - Modo do kernel.
 * @property {Object} [nerv] - Instância do sistema NERV.
 * @property {Object} [contextManager] - Gerenciador de contexto.
 * @property {Object} [telemetry] - Opções de telemetria.
 * @property {Object} [policy] - Políticas de execução.
 * @property {Object} [loop] - Configuração do loop.
 */

/* ===========================
   Fábrica do Kernel
=========================== */

function _makeRetryableEmitError(err) {
    const message = err?.message || String(err);
    /** @type {Error & { retryable?: boolean, delayMs?: number, reason?: string, nextAction?: string }} */
    const error = new Error(`emitCommand failed: ${message}`);
    error.retryable = true;
    error.delayMs = 250;
    error.reason = 'EMIT_COMMAND_FAILED';
    error.nextAction = 'RETRY_LATER';
    return error;
}

/**
 * Cria um kernel SSOT-first com gateway de execução e pump NERV.
 * @param {SsotGatewayKernelOptions} [config={}] - Configuração do kernel.
 * @returns {Object} Instância do kernel com métodos start/stop/executeTask.
 * @throws {Error} Se nerv não for fornecido.
 */
function createSsotGatewayKernel(config = {}) {
    const { nerv, telemetry: telemetryOptions = {}, pump: pumpOptions = {} } = config;

    const telemetry = new KernelTelemetry({
        nerv,
        source: ActorRole.KERNEL.toLowerCase(),
        retention: 1000,
        ...telemetryOptions,
    });

    const baseIntervalMs = Math.max(10, Number(pumpOptions.baseIntervalMs ?? 50) || 50);

    let running = false;
    let timer = null;
    let tickCounter = 0;
    let lastTickAt = null;

    /**
     * Executa um passo do loop principal do kernel.
     * Processa buffers de entrada e saída do NERV e atualiza contadores internos.
     * Side-effects: Atualiza contadores de tick, processa envelopes do NERV.
     * @returns {Promise<void>}
     */
    async function step() {
        if (!running) return;

        tickCounter += 1;
        lastTickAt = Date.now();

        const buffers = nerv?.buffers;
        const transport = nerv?.transport;

        // Inbound drain (optional): processes raw frames/envelopes placed into NERV inbound buffer.
        if (buffers && typeof buffers.dequeueInbound === 'function' && typeof nerv.receive === 'function') {
            let drained = 0;
            while (drained < 100) {
                const raw = buffers.dequeueInbound();
                if (!raw) break;
                try {
                    nerv.receive(raw);
                } catch (err) {
                    telemetry.warning('kernel_ssot_gateway_inbound_receive_failed', {
                        error: err?.message || String(err),
                        at: Date.now(),
                    });
                }
                drained += 1;
            }
        }

        // Outbound drain: sends envelopes to transport. In HYBRID mode, transport.send(envelope) is the right contract.
        if (buffers && typeof buffers.dequeueOutbound === 'function') {
            let drained = 0;
            while (drained < 100) {
                const envelope = buffers.dequeueOutbound();
                if (!envelope) break;

                if (transport && typeof transport.send === 'function') {
                    try {
                        transport.send(envelope);
                    } catch (err) {
                        try {
                            const serialized = JSON.stringify(envelope);
                            const buffer = Buffer.from(serialized, 'utf8');
                            transport.send(buffer);
                        } catch (fallbackError) {
                            telemetry.critical('kernel_ssot_gateway_outbound_send_failed', {
                                error: fallbackError?.message || err?.message || String(fallbackError || err),
                                at: Date.now(),
                            });
                        }
                    }
                } else if (typeof nerv.receive === 'function') {
                    // Local fallback: deliver directly to NERV reception in-process.
                    try {
                        nerv.receive(envelope);
                    } catch (err) {
                        telemetry.warning('kernel_ssot_gateway_outbound_loopback_failed', {
                            error: err?.message || String(err),
                            at: Date.now(),
                        });
                    }
                }

                drained += 1;
            }
        }
    }

    /**
     * Inicia o kernel e seu loop automático se especificado.
     * Side-effects: Define a variável running como verdadeira, inicia timer se autoLoop for verdadeiro.
     * @param {Object} [options] - Opções de inicialização.
     * @param {boolean} [options.autoLoop=true] - Se deve iniciar o loop automático.
     */
    function start({ autoLoop = true } = {}) {
        telemetry.info('kernel_start_requested', { at: Date.now(), mode: 'ssot_gateway' });
        running = true;

        if (autoLoop) {
            // FIXED (P0-2.2): Adiciona error handling para prevenir silent failures
            // Circuit breaker para detectar falhas consecutivas do kernel pump
            let consecutiveStepFailures = 0;
            const MAX_CONSECUTIVE_FAILURES = 5;

            timer = setInterval(() => {
                step()
                    .then(() => {
                        // Reset contador apenas em caso de sucesso (A001: .then() deve vir antes de .catch())
                        consecutiveStepFailures = 0;
                    })
                    .catch(err => {
                        consecutiveStepFailures++;

                        telemetry.critical('kernel_step_unhandled_error', {
                            error: err?.message || String(err),
                            stack: err?.stack,
                            consecutiveFailures: consecutiveStepFailures,
                            at: Date.now(),
                        });

                        // Log to stderr para captura imediata
                        console.error('[KERNEL_STEP_FATAL]', err);

                        // Circuit breaker: parar kernel se muitas falhas consecutivas
                        if (consecutiveStepFailures >= MAX_CONSECUTIVE_FAILURES) {
                            telemetry.critical('kernel_circuit_breaker_triggered', {
                                failures: consecutiveStepFailures,
                            });
                            console.error(
                                `[KERNEL] Circuit breaker triggered after ${consecutiveStepFailures} consecutive failures`
                            );
                            stop(); // Parar kernel pump para evitar spam de erros
                        }
                    });
            }, baseIntervalMs);

            // Allow process to exit gracefully
            timer.unref();
        }

        telemetry.info('kernel_started', { at: Date.now(), mode: 'ssot_gateway' });
    }

    /**
     * Para o kernel e seu loop automático.
     * Side-effects: Define a variável running como falsa, limpa o timer se existir.
     */
    function stop() {
        telemetry.info('kernel_stop_requested', { at: Date.now(), mode: 'ssot_gateway' });
        running = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        telemetry.info('kernel_stopped', { at: Date.now(), mode: 'ssot_gateway' });
    }

    /**
     * Executa uma tarefa através do driver.
     * @param {Object} task - Tarefa a ser executada.
     * @param {string} [correlationId] - ID de correlação para rastreamento.
     * @returns {Promise<void>}
     * @throws {Error} Se task.meta.id não for válido ou se ocorrer erro na emissão do comando.
     * Side-effects: Envia comando para o driver via NERV.
     */
    /**
     * ✅ P1-4: Agora aguarda emissão para garantir que comando foi enviado.
     */
    async function executeTask(task, correlationId) {
        if (!task?.meta?.id) {
            throw new Error('executeTask requer task.meta.id válido');
        }

        try {
            await HighLevelNERV.sendCommand(
                // ✅ P1-4: Added await
                nerv,
                ActorRole.KERNEL,
                ActionCode.DRIVER_EXECUTE_TASK,
                {
                    actionCode: ActionCode.DRIVER_EXECUTE_TASK,
                    task,
                },
                correlationId || null,
                ActorRole.DRIVER
            );
        } catch (err) {
            throw _makeRetryableEmitError(err);
        }
    }

    const kernelInterface = Object.freeze({
        start,
        stop,
        step,
        executeTask,
        /**
         * Obtém o status atual do kernel.
         * @returns {Object} Status do kernel com informações sobre pump, nerv e telemetria.
         */
        getStatus() {
            const status = {
                mode: 'ssot_gateway',
                pump: {
                    running,
                    ticks: tickCounter,
                    lastTickAt,
                    baseIntervalMs,
                },
                nerv: {
                    hasBuffers: Boolean(nerv?.buffers),
                    hasTransport: Boolean(nerv?.transport),
                },
                telemetry: telemetry.getStats(),
            };
            return Object.freeze(status);
        },
        telemetry,
        nerv,
        async shutdown() {
            stop();
        },
    });

    telemetry.info('kernel_ready', { at: Date.now(), mode: 'ssot_gateway' });
    return kernelInterface;
}

/**
 * Cria e compõe o Kernel de forma explícita e determinística.
 *
 * @param {Object} [config] - Configurações estruturais do Kernel
 * @param {Object} [config.nerv] - Instância do NERV já configurada e conectada (obrigatório)
 * @param {Object} [config.contextManager] - Context manager opcional (injeção externa)
 * @param {Object} [config.telemetry] - Opções da telemetria do Kernel
 * @param {string} [config.telemetry.source='kernel'] - Identificador da fonte de telemetria
 * @param {number} [config.telemetry.retention=1000] - Número de eventos a reter em memória
 * @param {Object} [config.policy] - Limites e políticas normativas
 * @param {number} [config.policy.maxConcurrentTasks] - Número máximo de tarefas concorrentes
 * @param {number} [config.policy.taskTimeout] - Timeout padrão para tarefas em ms
 * @param {Object} [config.loop] - Opções do kernel_loop (intervalo, scheduler)
 * @param {number} [config.loop.interval] - Intervalo do loop em ms
 *
 * @returns {Object} Interface pública do Kernel
 *
 * @throws {Error} Se NERV não for fornecido
 */
function createLegacyKernel({
    nerv,
    contextManager = null,
    telemetry: telemetryOptions = {},
    policy: policyLimits = {},
    loop: loopOptions = {},
} = {}) {
    if (!nerv) {
        throw new Error('Kernel requer instância do NERV configurada');
    }

    /* =========================================================
     1. TELEMETRIA — Base observacional transversal
  ========================================================= */

    const telemetry = new KernelTelemetry({
        nerv,
        source: ActorRole.KERNEL.toLowerCase(),
        retention: 1000,
        ...telemetryOptions,
    });

    telemetry.info('kernel_initializing', { at: Date.now() });

    /* =========================================================
     2. TASK RUNTIME — Vida lógica das tarefas
  ========================================================= */

    const taskRuntime = new TaskRuntime({ telemetry });

    /* =========================================================
     3. OBSERVATION STORE — Registro factual de EVENTs
  ========================================================= */

    const observationStore = new ObservationStore({ telemetry });

    /* =========================================================
     4. POLICY ENGINE — Normatividade consultiva
  ========================================================= */

    const policyEngine = new PolicyEngine({
        telemetry,
        limits: {
            maxObservationsPerTask: 1000,
            maxTaskAgeMs: 300000, // 5 minutos
            maxStalledCycles: 10,
            ...policyLimits,
        },
    });

    /* =========================================================
     5. ORCHESTRATOR ENGINE — Estratégias de execução (V2.0)
  ========================================================= */

    const orchestrator = new OrchestratorEngine({
        nerv,
        contextManager,
    });

    /* =========================================================
     6. EXECUTION ENGINE — Motor semântico de decisão
  ========================================================= */

    const executionEngine = new ExecutionEngine({
        taskRuntime,
        observationStore,
        policyEngine,
        telemetry,
    });

    /* =========================================================
     7. NERV BRIDGE — Ponte de integração KERNEL↔NERV
  ========================================================= */

    const nervBridge = new KernelNERVBridge({
        nerv,
        taskRuntime,
        observationStore,
        telemetry,
        orchestrator,
    });

    /* =========================================================
     8. TASK EXECUTION ORCHESTRATOR — Orquestração V5 (V2.0)
  ========================================================= */

    /** @type {Map<string, {task: Object, correlationId: string}>} */
    const pendingDispatch = new Map();

    /** @type {TaskExecutionOrchestrator|null} */
    let taskExecutor = null;

    /**
     * Limpa o estado de despacho pendente para uma tarefa específica.
     * Side-effects: Remove a tarefa do mapa de despachos pendentes.
     * @param {string} taskId - ID da tarefa a ser limpa.
     */
    const cleanupTaskDispatchState = taskId => {
        pendingDispatch.delete(taskId);
    };

    /**
     * Termina uma tarefa em execução no runtime.
     * Side-effects: Aplica transição de estado para TERMINATED, remove tarefa do runtime.
     * @param {Object} params - Parâmetros da operação.
     * @param {string} params.taskId - ID da tarefa a ser terminada.
     * @param {string} [params.reason] - Razão para a terminação.
     * @returns {Promise<void>}
     */
    const terminateRuntimeTask = async ({ taskId, reason }) => {
        const runtime = taskRuntime.getTask(taskId);

        if (!runtime || runtime.state === TaskState.TERMINATED) {
            cleanupTaskDispatchState(taskId);
            try {
                taskRuntime.forgetTask(taskId);
            } catch (_) {
                /* ignore */
            }
            return;
        }

        taskRuntime.applyStateTransition({
            taskId,
            newState: TaskState.TERMINATED,
            reason: reason || 'Task terminated by kernel decision',
        });

        cleanupTaskDispatchState(taskId);
        try {
            taskRuntime.forgetTask(taskId);
        } catch (_) {
            /* ignore */
        }
    };

    /**
     * Suspende uma tarefa em execução no runtime.
     * Side-effects: Aplica transição de estado para SUSPENDED se aplicável.
     * @param {Object} params - Parâmetros da operação.
     * @param {string} params.taskId - ID da tarefa a ser suspensa.
     * @param {string} [params.reason] - Razão para a suspensão.
     * @returns {Promise<void>}
     */
    const suspendRuntimeTask = async ({ taskId, reason }) => {
        const runtime = taskRuntime.getTask(taskId);
        if (!runtime || runtime.state === TaskState.TERMINATED || runtime.state === TaskState.SUSPENDED) {
            return;
        }

        taskRuntime.applyStateTransition({
            taskId,
            newState: TaskState.SUSPENDED,
            reason: reason || 'Task suspended by kernel decision',
        });
    };

    /**
     * Ativa uma tarefa no runtime do kernel.
     * Side-effects: Aplica transição de estado para ACTIVE, despacha tarefa para executor.
     * @param {Object} params - Parâmetros da operação.
     * @param {string} params.taskId - ID da tarefa a ser ativada.
     * @param {string} [params.reason] - Razão para a ativação.
     * @returns {Promise<void>}
     * @throws {Error} Se o despacho da tarefa falhar.
     */
    const activateRuntimeTask = async ({ taskId, reason }) => {
        const runtime = taskRuntime.getTask(taskId);
        if (!runtime) {
            telemetry.warning('kernel_activate_missing_runtime_task', { taskId, at: Date.now() });
            return;
        }

        if (runtime.state === TaskState.ACTIVE || runtime.state === TaskState.TERMINATED) {
            return;
        }

        taskRuntime.applyStateTransition({
            taskId,
            newState: TaskState.ACTIVE,
            reason: reason || 'Task activated by kernel policy',
        });

        const queued = pendingDispatch.get(taskId);
        if (!queued) {
            return;
        }

        if (!taskExecutor) {
            telemetry.warning('kernel_activate_missing_task_executor', { taskId, at: Date.now() });
            // mantém pendingDispatch para execução futura
            return;
        }

        // CRÍTICO: NÃO apagar pendingDispatch aqui.
        // A limpeza deve ocorrer em "terminate"/"completed".
        try {
            await taskExecutor.executeTask(queued.task, queued.correlationId);
        } catch (error) {
            telemetry.warning('kernel_activate_dispatch_failed', {
                taskId,
                error: error?.message || String(error),
                at: Date.now(),
            });

            // SSOT (SQLite) é o único dono de retry/scheduling.
            // O Kernel encerra o runtime e deixa o worker decidir reschedule.
            await terminateRuntimeTask({
                taskId,
                reason: `Dispatch failed (SSOT will reschedule): ${error?.message || String(error)}`,
            });
            throw error;
        }
    };

    taskExecutor = new TaskExecutionOrchestrator({
        nerv,
        nervBridge,
        onTaskRetryRequested: async ({ taskId, delayMs, reason }) => {
            // SSOT handles retry scheduling (execute_after_ms). Kernel only terminates runtime.
            await terminateRuntimeTask({
                taskId,
                reason: `Retry requested (SSOT will reschedule, delayMs=${Number(delayMs) || 0}): ${reason || 'driver retry'}`,
            });
        },
        onTaskPermanentFailure: async ({ taskId, reason }) => {
            await terminateRuntimeTask({ taskId, reason: reason || 'Permanent driver failure' });
        },
        onTaskCompleted: async ({ taskId }) => {
            await terminateRuntimeTask({ taskId, reason: 'Task completed successfully' });
        },
    });

    /* =========================================================
     9. KERNEL LOOP — Tempo soberano e ciclo executivo
  ========================================================= */

    const kernelLoopOptions = /** @type {any} */ ({
        executionEngine,
        nervBridge,
        telemetry,
        onActivateTask: activateRuntimeTask,
        onTerminateTask: terminateRuntimeTask,
        onSuspendTask: suspendRuntimeTask,
        baseIntervalMs: 50,
        ...loopOptions,
    });
    const kernelLoop = new KernelLoop(kernelLoopOptions);

    telemetry.info('kernel_composed', {
        subsystems: [
            'KernelTelemetry',
            'TaskRuntime',
            'ObservationStore',
            'PolicyEngine',
            'OrchestratorEngine',
            'ExecutionEngine',
            'KernelNERVBridge',
            'TaskExecutionOrchestrator',
            'KernelLoop',
        ],
        at: Date.now(),
    });

    /* =========================================================
     INTERFACE PÚBLICA DO KERNEL
  ========================================================= */

    const kernelInterface = Object.freeze({
        /**
         * Inicia o kernel e seus componentes.
         * Side-effects: Inicia nervBridge e kernelLoop.
         * @param {Object} [options] - Opções de inicialização.
         * @param {boolean} [options.autoLoop=true] - Se deve iniciar o loop automático.
         */
        start({ autoLoop = true } = {}) {
            telemetry.info('kernel_start_requested', { at: Date.now() });

            nervBridge.start();
            kernelLoop.start({ autoSchedule: Boolean(autoLoop) });

            telemetry.info('kernel_started', { at: Date.now() });
        },

        /**
         * Para o kernel e seus componentes.
         * Side-effects: Para kernelLoop e nervBridge, limpa buffers de dispatch.
         */
        stop() {
            telemetry.info('kernel_stop_requested', { at: Date.now() });

            kernelLoop.stop();
            nervBridge.stop();

            // Limpa buffers de dispatch/retry para evitar reexecução “fantasma”
            pendingDispatch.clear();

            telemetry.info('kernel_stopped', { at: Date.now() });
        },

        /**
         * Obtém o status atual do kernel.
         * @returns {Object} Status do kernel com informações sobre loop, tarefas, observações, nerv e telemetria.
         */
        getStatus() {
            return Object.freeze({
                loop: kernelLoop.getStatus(),
                tasks: taskRuntime.getStats(),
                observations: observationStore.getStats(),
                nerv: nervBridge.getStatus(),
                telemetry: telemetry.getStats(),
            });
        },

        /**
         * Executa um passo do loop do kernel.
         * @returns {Promise<void>}
         */
        async step() {
            await kernelLoop.step();
        },

        telemetry,
        nerv,

        /**
         * Cria uma nova tarefa no runtime.
         * @param {Object} params - Parâmetros da tarefa.
         * @param {string} params.taskId - ID da tarefa.
         * @param {Object} [params.metadata={}] - Metadados adicionais.
         * @returns {Object} Tarefa criada.
         */
        createTask({ taskId, metadata = {} }) {
            return taskRuntime.createTask({ taskId, metadata });
        },

        /**
         * Obtém uma tarefa específica do runtime.
         * @param {string} taskId - ID da tarefa.
         * @returns {Object|null} Tarefa correspondente ou null se não encontrada.
         */
        getTask(taskId) {
            return taskRuntime.getTask(taskId);
        },

        /**
         * Lista todas as tarefas no runtime.
         * @returns {Array<Object>} Lista de tarefas.
         */
        listTasks() {
            return taskRuntime.listTasks();
        },

        /**
         * Executa uma tarefa no kernel.
         * Side-effects: Cria ou atualiza runtime da tarefa, adiciona à fila de despacho pendente.
         * @param {Object} task - Tarefa a ser executada.
         * @param {string} [correlationId] - ID de correlação para rastreamento.
         * @returns {Promise<void>}
         * @throws {Error} Se task.meta.id não for válido.
         */
        async executeTask(task, correlationId) {
            if (!task?.meta?.id) {
                throw new Error('executeTask requer task.meta.id válido');
            }

            const taskId = task.meta.id;

            const existingRuntime = taskRuntime.getTask(taskId);
            if (existingRuntime && existingRuntime.state === TaskState.TERMINATED) {
                // Allow SSOT to re-dispatch the same taskId after terminal by forgetting runtime state.
                try {
                    taskRuntime.forgetTask(taskId);
                } catch (_) {
                    /* ignore */
                }
            }

            if (!taskRuntime.getTask(taskId)) {
                taskRuntime.createTask({
                    taskId,
                    metadata: {
                        correlationId,
                        source: task.meta.source || 'kernel.executeTask',
                        target: task.spec?.target || null,
                    },
                });
            }

            pendingDispatch.set(taskId, { task, correlationId });

            await activateRuntimeTask({
                taskId,
                reason: 'Immediate activation on executeTask',
            });
        },

        /**
         * Desliga o kernel e libera recursos.
         * Side-effects: Para kernelLoop, executa limpeza do taskExecutor, limpa buffers de dispatch.
         * @returns {Promise<void>}
         */
        async shutdown() {
            telemetry.info('kernel_shutting_down', { at: Date.now() });

            if (kernelLoop && typeof kernelLoop.stop === 'function') {
                kernelLoop.stop();
            }

            if (taskExecutor && typeof taskExecutor.cleanup === 'function') {
                taskExecutor.cleanup();
            }

            pendingDispatch.clear();

            telemetry.info('kernel_shutdown_complete', { at: Date.now() });
        },
    });

    telemetry.info('kernel_ready', { at: Date.now() });

    return kernelInterface;
}

/**
 * Cria uma instância do kernel com base na configuração fornecida.
 * - Padrão: Gateway de execução SSOT-first + pump NERV
 * - Opcional: Kernel legado "decisor soberano" (mode='legacy')
 *
 * @param {KernelOptions|SsotGatewayKernelOptions} [config={}] - Configuração do kernel.
 * @returns {Object} Instância do kernel configurado.
 * Side-effects: Cria e inicializa os componentes do kernel conforme a configuração.
 */
function createKernel(config = {}) {
    const mode = config?.mode || 'ssot_gateway';
    if (mode === 'legacy') {
        return createLegacyKernel(config);
    }
    return createSsotGatewayKernel(config);
}

export { createKernel };
