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

    const taskExecutor = new TaskExecutionOrchestrator({
        nerv,
        nervBridge
    });

    /* =========================================================
     9. KERNEL LOOP — Tempo soberano e ciclo executivo
  ========================================================= */

    const kernelLoop = new KernelLoop({
        executionEngine,
        nervBridge,
        telemetry,
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
            return taskExecutor.executeTask(task, correlationId);
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

            telemetry.info('kernel_shutdown_complete', { at: Date.now() });
        }
    });

    telemetry.info('kernel_ready', {
        at: Date.now()
    });

    return kernelInterface;
}

export { createKernel };
