// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActorRole } from '#shared/nerv/constants';
import { KernelLoop } from './kernel_loop/kernel_loop.js';
import { TaskRuntime } from './task_runtime/task_runtime.js';
import { ObservationStore } from './observation_store/observation_store.js';
import { PolicyEngine } from './policy_engine/policy_engine.js';
import { ExecutionEngine } from './execution_engine/execution_engine.js';
import { KernelTelemetry } from './telemetry/kernel_telemetry.js';
import { KernelNERVBridge } from './nerv_bridge/kernel_nerv_bridge.js';
import { OrchestratorEngine } from '#orchestrator/orchestrator_engine';
import { TaskExecutionOrchestrator } from './task_execution_orchestrator.js';
import { TaskState } from './task_runtime/task_runtime.js';

/* ===========================
   Fábrica do Kernel
=========================== */

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
 * Propriedades do objeto retornado:
 *   - start (Function): Inicia o Kernel
 *   - stop (Function): Para o Kernel graciosamente
 *   - telemetry (Object): Acesso à telemetria
 *
 * @throws {Error} Se NERV não for fornecido
 *
 * @example
 * const kernel = createKernel({
 *   nerv: nervInstance,
 *   policy: { maxConcurrentTasks: 5 },
 *   loop: { interval: 1000 }
 * });
 * await kernel.start();
 */
function createKernel({
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
        nerv, // Passa NERV para telemetria
        source: ActorRole.KERNEL.toLowerCase(),
        retention: 1000,
        ...telemetryOptions
    });

    telemetry.info('kernel_initializing', {
        at: Date.now()
    });

    /* =========================================================
     2. TASK RUNTIME — Vida lógica das tarefas
  ========================================================= */

    const taskRuntime = new TaskRuntime({
        telemetry
    });

    /* =========================================================
     3. OBSERVATION STORE — Registro factual de EVENTs
  ========================================================= */

    const observationStore = new ObservationStore({
        telemetry
    });

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
        contextManager // V2.0: Compartilha ContextManager com MissionManager
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
        orchestrator  // V2.0: Injeta orchestrator para interceptar execuções
    });

    /* =========================================================
     8. TASK EXECUTION ORCHESTRATOR — Orquestração V5 (V2.0)
  ========================================================= */

    /** @type {Map<string, {task: Object, correlationId: string}>} */
    const pendingDispatch = new Map();
    /** @type {Map<string, number>} */
    const retryCounts = new Map();
    const MAX_KERNEL_RETRIES = Number(process.env.KERNEL_MAX_RETRIES || 3);

    let taskExecutor = null;

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

        if (taskExecutor) {
            await taskExecutor.executeTask(queued.task, queued.correlationId);
        }
    };

    const terminateRuntimeTask = async ({ taskId, reason }) => {
        const runtime = taskRuntime.getTask(taskId);
        if (!runtime || runtime.state === TaskState.TERMINATED) {
            pendingDispatch.delete(taskId);
            return;
        }

        taskRuntime.applyStateTransition({
            taskId,
            newState: TaskState.TERMINATED,
            reason: reason || 'Task terminated by kernel decision'
        });

        pendingDispatch.delete(taskId);
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

    const scheduleRetry = async ({ taskId, delayMs = 0, reason }) => {
        const queued = pendingDispatch.get(taskId);
        if (!queued) {
            return;
        }

        const retries = retryCounts.get(taskId) || 0;
        if (retries >= MAX_KERNEL_RETRIES) {
            await terminateRuntimeTask({ taskId, reason: `Retry budget exceeded: ${reason || 'driver failure'}` });
            return;
        }

        retryCounts.set(taskId, retries + 1);
        await suspendRuntimeTask({ taskId, reason: `Retry scheduled (${retries + 1}/${MAX_KERNEL_RETRIES})` });

        setTimeout(async () => {
            try {
                const current = taskRuntime.getTask(taskId);
                if (!current || current.state === TaskState.TERMINATED) {
                    return;
                }

                taskRuntime.applyStateTransition({
                    taskId,
                    newState: TaskState.ACTIVE,
                    reason: 'Retry execution resumed'
                });

                const currentQueued = pendingDispatch.get(taskId);
                if (currentQueued && taskExecutor) {
                    await taskExecutor.executeTask(currentQueued.task, currentQueued.correlationId);
                }
            } catch (error) {
                telemetry.warning('kernel_retry_schedule_failed', {
                    taskId,
                    error: error.message,
                    at: Date.now()
                });
            }
        }, Math.max(0, delayMs));
    };

    taskExecutor = new TaskExecutionOrchestrator({
        nerv,
        nervBridge,
        onTaskRetryRequested: async ({ taskId, delayMs, reason }) => {
            await scheduleRetry({ taskId, delayMs, reason });
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
            'OrchestratorEngine',          // V2.0: Estratégias de execução
            'ExecutionEngine',
            'KernelNERVBridge',
            'TaskExecutionOrchestrator',   // V2.0: Orquestração V5
            'KernelLoop'
        ],
        at: Date.now()
    });

    /* =========================================================
     INTERFACE PÚBLICA DO KERNEL
  ========================================================= */

    const kernelInterface = Object.freeze({
        /**
         * Inicia o ciclo executivo do Kernel.
         */
        start() {
            telemetry.info('kernel_start_requested', { at: Date.now() });

            // Inicia ponte NERV (registra handlers)
            nervBridge.start();

            // Inicia ciclo lógico
            kernelLoop.start();

            telemetry.info('kernel_started', { at: Date.now() });
        },

        /**
         * Para o ciclo executivo do Kernel.
         */
        stop() {
            telemetry.info('kernel_stop_requested', { at: Date.now() });

            // Para ciclo lógico
            kernelLoop.stop();

            // Para ponte NERV
            nervBridge.stop();

            retryCounts.clear();

            telemetry.info('kernel_stopped', { at: Date.now() });
        },

        /**
         * Retorna status técnico completo do Kernel.
         */
        getStatus() {
            return Object.freeze({
                loop: kernelLoop.getStatus(),
                tasks: taskRuntime.getStats(),
                observations: observationStore.getStats(),
                nerv: nervBridge.getStatus(),
                telemetry: telemetry.getStats()
            });
        },

        /**
         * Acesso à telemetria (somente leitura).
         */
        telemetry,

        /**
         * Referência ao NERV (somente leitura).
         */
        nerv,

        /**
         * Cria uma nova tarefa no Kernel.
         * Retorna snapshot imutável da tarefa criada.
         */
        createTask({ taskId, metadata = {} }) {
            return taskRuntime.createTask({ taskId, metadata });
        },

        /**
         * Retorna snapshot de uma tarefa específica.
         */
        getTask(taskId) {
            return taskRuntime.getTask(taskId);
        },

        /**
         * Lista todas as tarefas existentes.
         */
        listTasks() {
            return taskRuntime.listTasks();
        },

        /**
         * Executa uma task V5 (NOVO em V2.0).
         * Integra com OrchestratorEngine para suportar strategies (ITERATIVE, MULTI_STEP, etc).
         *
         * @param {Object} task - Task V5
         * @param {string} correlationId - ID de correlação NERV
         * @returns {Promise<void>}
         */
        async executeTask(task, correlationId) {
            if (!task || !task.meta || !task.meta.id) {
                throw new Error('executeTask requer task.meta.id válido');
            }

            const taskId = task.meta.id;

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

            // Fast path: ativa imediatamente, mantendo compatibilidade com integração atual
            await activateRuntimeTask({
                taskId,
                reason: 'Immediate activation on executeTask'
            });
        },

        /**
         * Shutdown gracioso do KERNEL.
         * Para o loop de execução e limpa recursos.
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
            retryCounts.clear();

            telemetry.info('kernel_shutdown_complete', { at: Date.now() });
        }
    });

    telemetry.info('kernel_ready', {
        at: Date.now()
    });

    return kernelInterface;
}

export { createKernel };
