/* ==========================================================================
   src/kernel/kernel.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Arquivo: kernel.js

   Papel:
   - Compor todos os subsistemas do Kernel de forma explícita
   - Integrar o NERV como camada de comunicação IPC
   - Expor interface mínima e controlada
   - Estabelecer a topologia canônica do sistema

   IMPORTANTE:
   - NÃO executa lógica de negócio aqui
   - NÃO decide (delega ao ExecutionEngine)
   - NÃO controla tempo diretamente (delega ao KernelLoop)
   - NÃO interpreta EVENTs (delega ao ObservationStore)
   - Apenas COMPÕE e CONECTA subsistemas

   Linguagem: JavaScript (Node.js)
========================================================================== */

const { ActorRole } = require('@shared/nerv/constants');
const { KernelLoop } = require('./kernel_loop/kernel_loop');
const { TaskRuntime } = require('./task_runtime/task_runtime');
const { ObservationStore } = require('./observation_store/observation_store');
const { PolicyEngine } = require('./policy_engine/policy_engine');
const { ExecutionEngine } = require('./execution_engine/execution_engine');
const { KernelTelemetry } = require('./telemetry/kernel_telemetry');
const { KernelNERVBridge } = require('./nerv_bridge/kernel_nerv_bridge');

/* ===========================
   Fábrica do Kernel
=========================== */

/**
 * Cria e compõe o Kernel de forma explícita e determinística.
 *
 * @param {Object} config - Configurações estruturais do Kernel
 * @param {Object} config.nerv - Instância do NERV já configurada e conectada (obrigatório)
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
 * @returns {Function} returns.start - Inicia o Kernel
 * @returns {Function} returns.stop - Para o Kernel graciosamente
 * @returns {Object} returns.telemetry - Acesso à telemetria
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
     5. EXECUTION ENGINE — Motor semântico de decisão
  ========================================================= */

    const executionEngine = new ExecutionEngine({
        taskRuntime,
        observationStore,
        policyEngine,
        telemetry
    });

    /* =========================================================
     6. NERV BRIDGE — Ponte de integração KERNEL↔NERV
  ========================================================= */

    const nervBridge = new KernelNERVBridge({
        nerv,
        taskRuntime,
        observationStore,
        telemetry
    });

    /* =========================================================
     7. KERNEL LOOP — Tempo soberano e ciclo executivo
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
            'ExecutionEngine',
            'KernelNERVBridge',
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
         * Shutdown gracioso do KERNEL.
         * Para o loop de execução e limpa recursos.
         */
        async shutdown() {
            telemetry.info('kernel_shutting_down', { at: Date.now() });

            if (kernelLoop && typeof kernelLoop.stop === 'function') {
                kernelLoop.stop();
            }

            telemetry.info('kernel_shutdown_complete', { at: Date.now() });
        }
    });

    telemetry.info('kernel_ready', {
        at: Date.now()
    });

    return kernelInterface;
}

module.exports = {
    createKernel
};
