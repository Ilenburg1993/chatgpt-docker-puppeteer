// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActorRole, ActionCode } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { KernelLoop } from './kernel_loop/kernel_loop.js';
import { TaskRuntime, TaskState } from './task_runtime/task_runtime.js';
import { ObservationStore } from './observation_store/observation_store.js';
import { PolicyEngine } from './policy_engine/policy_engine.js';
import { ExecutionEngine } from './execution_engine/execution_engine.js';
import { KernelTelemetry } from './telemetry/kernel_telemetry.js';
import { KernelNERVBridge } from './nerv_bridge/kernel_nerv_bridge.js';
import { OrchestratorEngine } from '#orchestrator/orchestrator_engine';
import { TaskExecutionOrchestrator } from './task_execution_orchestrator.js';

/* ===========================
   Fábrica do Kernel
=========================== */

function _makeRetryableEmitError(err) {
    const message = err?.message || String(err);
    const error = new Error(`emitCommand failed: ${message}`);
    // @ts-ignore - structured metadata for SSOT workers
    error.retryable = true;
    // @ts-ignore
    error.delayMs = 250;
    // @ts-ignore
    error.reason = 'EMIT_COMMAND_FAILED';
    // @ts-ignore
    error.nextAction = 'RETRY_LATER';
    return error;
}

function createSsotGatewayKernel({
    nerv,
    telemetry: telemetryOptions = {},
    pump: pumpOptions = {}
} = {}) {
    if (!nerv) {
        throw new Error('Kernel requer instância do NERV configurada');
    }

    const telemetry = new KernelTelemetry({
        nerv,
        source: ActorRole.KERNEL.toLowerCase(),
        retention: 1000,
        ...telemetryOptions
    });

    const baseIntervalMs = Math.max(10, Number(pumpOptions.baseIntervalMs ?? 50) || 50);

    let running = false;
    let timer = null;
    let tickCounter = 0;
    let lastTickAt = null;

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
                        at: Date.now()
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
                                at: Date.now()
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
                            at: Date.now()
                        });
                    }
                }

                drained += 1;
            }
        }
    }

    function start({ autoLoop = true } = {}) {
        telemetry.info('kernel_start_requested', { at: Date.now(), mode: 'ssot_gateway' });
        running = true;

        if (autoLoop) {
            timer = setInterval(() => {
                void step();
            }, baseIntervalMs);
        }

        telemetry.info('kernel_started', { at: Date.now(), mode: 'ssot_gateway' });
    }

    function stop() {
        telemetry.info('kernel_stop_requested', { at: Date.now(), mode: 'ssot_gateway' });
        running = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        telemetry.info('kernel_stopped', { at: Date.now(), mode: 'ssot_gateway' });
    }

    async function executeTask(task, correlationId) {
        if (!task?.meta?.id) {
            throw new Error('executeTask requer task.meta.id válido');
        }

        try {
            HighLevelNERV.sendCommand(
                nerv,
                ActorRole.KERNEL,
                ActionCode.DRIVER_EXECUTE_TASK,
                {
                    actionCode: ActionCode.DRIVER_EXECUTE_TASK,
                    task
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
        getStatus() {
            const status = {
                mode: 'ssot_gateway',
                pump: {
                    running,
                    ticks: tickCounter,
                    lastTickAt,
                    baseIntervalMs
                },
                nerv: {
                    hasBuffers: Boolean(nerv?.buffers),
                    hasTransport: Boolean(nerv?.transport)
                },
                telemetry: telemetry.getStats()
            };
            return Object.freeze(status);
        },
        telemetry,
        nerv,
        async shutdown() {
            stop();
        }
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
    loop: loopOptions = {}
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
        ...telemetryOptions
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
            ...policyLimits
        }
    });

    /* =========================================================
     5. ORCHESTRATOR ENGINE — Estratégias de execução (V2.0)
  ========================================================= */

    const orchestrator = new OrchestratorEngine({
        nerv,
        contextManager
    });

    /* =========================================================
     6. EXECUTION ENGINE — Motor semântico de decisão
  ========================================================= */

    const executionEngine = new ExecutionEngine({
        taskRuntime,
        observationStore,
        policyEngine,
        telemetry
    });

    /* =========================================================
     7. NERV BRIDGE — Ponte de integração KERNEL↔NERV
  ========================================================= */

    const nervBridge = new KernelNERVBridge({
        nerv,
        taskRuntime,
        observationStore,
        telemetry,
        orchestrator
    });

    /* =========================================================
     8. TASK EXECUTION ORCHESTRATOR — Orquestração V5 (V2.0)
  ========================================================= */

    /** @type {Map<string, {task: Object, correlationId: string}>} */
    const pendingDispatch = new Map();

    /** @type {TaskExecutionOrchestrator|null} */
    let taskExecutor = null;

    const cleanupTaskDispatchState = taskId => {
        pendingDispatch.delete(taskId);
    };

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
            reason: reason || 'Task terminated by kernel decision'
        });

        cleanupTaskDispatchState(taskId);
        try {
            taskRuntime.forgetTask(taskId);
        } catch (_) {
            /* ignore */
        }
    };

    const suspendRuntimeTask = async ({ taskId, reason }) => {
        const runtime = taskRuntime.getTask(taskId);
        if (!runtime || runtime.state === TaskState.TERMINATED || runtime.state === TaskState.SUSPENDED) {
            return;
        }

        taskRuntime.applyStateTransition({
            taskId,
            newState: TaskState.SUSPENDED,
            reason: reason || 'Task suspended by kernel decision'
        });
    };

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
            reason: reason || 'Task activated by kernel policy'
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
                at: Date.now()
            });

            // SSOT (SQLite) é o único dono de retry/scheduling.
            // O Kernel encerra o runtime e deixa o worker decidir reschedule.
            await terminateRuntimeTask({
                taskId,
                reason: `Dispatch failed (SSOT will reschedule): ${error?.message || String(error)}`
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
                reason: `Retry requested (SSOT will reschedule, delayMs=${Number(delayMs) || 0}): ${reason || 'driver retry'}`
            });
        },
        onTaskPermanentFailure: async ({ taskId, reason }) => {
            await terminateRuntimeTask({ taskId, reason: reason || 'Permanent driver failure' });
        },
        onTaskCompleted: async ({ taskId }) => {
            await terminateRuntimeTask({ taskId, reason: 'Task completed successfully' });
        }
    });

    /* =========================================================
     9. KERNEL LOOP — Tempo soberano e ciclo executivo
  ========================================================= */

    const kernelLoop = new KernelLoop({
        executionEngine,
        nervBridge,
        telemetry,
        onActivateTask: activateRuntimeTask,
        onTerminateTask: terminateRuntimeTask,
        onSuspendTask: suspendRuntimeTask,
        baseIntervalMs: 50,
        ...loopOptions
    });

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
            'KernelLoop'
        ],
        at: Date.now()
    });

    /* =========================================================
     INTERFACE PÚBLICA DO KERNEL
  ========================================================= */

    const kernelInterface = Object.freeze({
        start({ autoLoop = true } = {}) {
            telemetry.info('kernel_start_requested', { at: Date.now() });

            nervBridge.start();
            kernelLoop.start({ autoSchedule: Boolean(autoLoop) });

            telemetry.info('kernel_started', { at: Date.now() });
        },

        stop() {
            telemetry.info('kernel_stop_requested', { at: Date.now() });

            kernelLoop.stop();
            nervBridge.stop();

            // Limpa buffers de dispatch/retry para evitar reexecução “fantasma”
            pendingDispatch.clear();

            telemetry.info('kernel_stopped', { at: Date.now() });
        },

        getStatus() {
            return Object.freeze({
                loop: kernelLoop.getStatus(),
                tasks: taskRuntime.getStats(),
                observations: observationStore.getStats(),
                nerv: nervBridge.getStatus(),
                telemetry: telemetry.getStats()
            });
        },

        async step() {
            await kernelLoop.step();
        },

        telemetry,
        nerv,

        createTask({ taskId, metadata = {} }) {
            return taskRuntime.createTask({ taskId, metadata });
        },

        getTask(taskId) {
            return taskRuntime.getTask(taskId);
        },

        listTasks() {
            return taskRuntime.listTasks();
        },

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
                        target: task.spec?.target || null
                    }
                });
            }

            pendingDispatch.set(taskId, { task, correlationId });

            await activateRuntimeTask({
                taskId,
                reason: 'Immediate activation on executeTask'
            });
        },

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
        }
    });

    telemetry.info('kernel_ready', { at: Date.now() });

    return kernelInterface;
}

/**
 * createKernel (vNext)
 * - default: SSOT-first execution gateway + NERV pump
 * - optional: legacy "decisor soberano" kernel (mode='legacy')
 */
function createKernel(config = {}) {
    const mode = config?.mode || 'ssot_gateway';
    if (mode === 'legacy') {
        return createLegacyKernel(config);
    }
    return createSsotGatewayKernel(config);
}

export { createKernel };
