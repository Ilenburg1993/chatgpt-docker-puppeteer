// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/**
 * Opções de configuração para intervalos do AgentLoop.
 * @typedef {Object} AgentLoopIntervals
 * @property {number} [kernelMs=50] - Intervalo para kernel.step() em ms.
 * @property {number} [queueMs=250] - Intervalo para queueWorker.tick() em ms.
 * @property {number} [controlMs=500] - Intervalo para taskControlWatcher.tick() em ms.
 * @property {number} [missionMs=1000] - Intervalo para missionRunner.tick() em ms.
 * @property {number} [plannerMs=1500] - Intervalo para missionPlannerProcessor.tick() em ms.
 * @property {number} [watchdogMs=1500] - Intervalo para attemptWatchdog.tick() em ms.
 * @property {number} [orchestrationMs=1250] - Intervalo para taskOrchestrationWorker.tick() em ms.
 */

/**
 * Opções do construtor do AgentLoop.
 * @typedef {Object} AgentLoopOptions
 * @property {Object} kernel - Instância do kernel com método step() (obrigatório).
 * @property {Object} [browserPool=null] - Pool de browsers com circuit breaker.
 * @property {Object} [queueWorker=null] - Worker da fila com método tick().
 * @property {Object} [taskControlWatcher=null] - Watcher de controle de tarefas.
 * @property {Object} [missionRunner=null] - Runner de missões.
 * @property {Object} [missionPlannerProcessor=null] - Processador de planejamento.
 * @property {Object} [attemptWatchdog=null] - Watchdog de tentativas.
 * @property {Object} [taskOrchestrationWorker=null] - Worker de orquestração.
 * @property {AgentLoopIntervals} [intervals={}] - Configuração de intervalos.
 * @property {number} [baseTickMs=25] - Intervalo base do loop principal em ms.
 */

/**
 * Estado interno dos próximos ticks do AgentLoop.
 * @typedef {Object} AgentLoopNextTicks
 * @property {number} kernelAt - Timestamp do próximo tick do kernel.
 * @property {number} queueAt - Timestamp do próximo tick da fila.
 * @property {number} controlAt - Timestamp do próximo tick do controle.
 * @property {number} missionAt - Timestamp do próximo tick das missões.
 * @property {number} plannerAt - Timestamp do próximo tick do planner.
 * @property {number} watchdogAt - Timestamp do próximo tick do watchdog.
 * @property {number} orchestrationAt - Timestamp do próximo tick da orquestração.
 */

/**
 * Loop principal de execução do agente, coordenando múltiplos workers e watchers.
 * Implementa um sistema de ticks assíncronos com intervalos configuráveis.
 */
class AgentLoop {
    /**
     * Cria uma nova instância do AgentLoop.
     * @param {AgentLoopOptions} options - Opções de configuração.
     * @throws {Error} Se kernel.step() não estiver disponível.
     */
    constructor(options) {
        const {
            kernel,
            browserPool = null,
            queueWorker = null,
            taskControlWatcher = null,
            missionRunner = null,
            missionPlannerProcessor = null,
            attemptWatchdog = null,
            taskOrchestrationWorker = null,
            intervals = {},
            baseTickMs = 25,
        } = options || {};
        if (!kernel || typeof kernel.step !== 'function') {
            throw new Error('[AgentLoop] kernel.step() required');
        }

        this.kernel = kernel;
        this.browserPool = browserPool;
        this.queueWorker = queueWorker;
        this.taskControlWatcher = taskControlWatcher;
        this.missionRunner = missionRunner;
        this.missionPlannerProcessor = missionPlannerProcessor;
        this.attemptWatchdog = attemptWatchdog;
        this.taskOrchestrationWorker = taskOrchestrationWorker;

        this.intervals = {
            kernelMs: Math.max(10, Number(intervals.kernelMs ?? 50) || 50),
            queueMs: Math.max(50, Number(intervals.queueMs ?? 250) || 250),
            controlMs: Math.max(50, Number(intervals.controlMs ?? 500) || 500),
            missionMs: Math.max(200, Number(intervals.missionMs ?? 1000) || 1000),
            plannerMs: Math.max(250, Number(intervals.plannerMs ?? 1500) || 1500),
            watchdogMs: Math.max(250, Number(intervals.watchdogMs ?? 1500) || 1500),
            orchestrationMs: Math.max(250, Number(intervals.orchestrationMs ?? 1250) || 1250),
        };

        this.baseTickMs = Math.max(10, Number(baseTickMs) || 25);

        this._timer = null;
        this._running = false;
        this._stopped = false;

        const now = Date.now();
        this._next = {
            kernelAt: now,
            queueAt: now,
            controlAt: now,
            missionAt: now,
            plannerAt: now,
            watchdogAt: now,
            orchestrationAt: now,
        };
    }

    /**
     * Inicia o loop de execução do agente.
     * Side-effects: Inicia timer global, chama step() imediatamente e periodicamente.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;

        void this.step();
        this._timer = setInterval(() => {
            void this.step();
        }, this.baseTickMs);

        log('INFO', `[AgentLoop] started (tick=${this.baseTickMs}ms)`);
    }

    /**
     * Para o loop de execução do agente.
     * Side-effects: Limpa timer global, marca como parado.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[AgentLoop] stopped');
    }

    /**
     * Executa um passo do loop, verificando e executando workers conforme intervalos.
     * Side-effects: Executa múltiplos workers assincronamente, logs erros.
     * @returns {Promise<void>}
     */
    async step() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const now = Date.now();

            // 1) Kernel step is the only place that drains NERV buffers. Keep it frequent.
            if (now >= this._next.kernelAt) {
                this._next.kernelAt = now + this.intervals.kernelMs;
                try {
                    await this.kernel.step();
                } catch (err) {
                    log('ERROR', `[AgentLoop] kernel.step failed: ${err?.message || String(err)}`);
                }
            }

            const pausedByCircuitBreaker = Boolean(this.browserPool?.circuitBreaker?.shouldPauseSystem?.());
            const pausedByMissingBrowserPool = !this.browserPool;
            const dispatchAllowed = !pausedByMissingBrowserPool && !pausedByCircuitBreaker;

            // 2) Control watcher should run even if paused (so aborts can be delivered).
            if (this.taskControlWatcher && now >= this._next.controlAt) {
                this._next.controlAt = now + this.intervals.controlMs;
                try {
                    await this.taskControlWatcher.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] taskControlWatcher.tick failed: ${err?.message || String(err)}`);
                }
            }

            // 3) Watchdog can run even if paused (it is DB-only hygiene).
            if (this.attemptWatchdog && now >= this._next.watchdogAt) {
                this._next.watchdogAt = now + this.intervals.watchdogMs;
                try {
                    await this.attemptWatchdog.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] attemptWatchdog.tick failed: ${err?.message || String(err)}`);
                }
            }

            // 4) Dispatch is gated by browserPool circuit breaker + availability.
            if (dispatchAllowed && this.queueWorker && now >= this._next.queueAt) {
                this._next.queueAt = now + this.intervals.queueMs;
                try {
                    await this.queueWorker.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] queueWorker.tick failed: ${err?.message || String(err)}`);
                }
            }

            // 5) Mission loops are allowed even if paused (they only propose/create tasks).
            if (this.missionRunner && now >= this._next.missionAt) {
                this._next.missionAt = now + this.intervals.missionMs;
                try {
                    await this.missionRunner.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] missionRunner.tick failed: ${err?.message || String(err)}`);
                }
            }

            if (this.missionPlannerProcessor && now >= this._next.plannerAt) {
                this._next.plannerAt = now + this.intervals.plannerMs;
                try {
                    await this.missionPlannerProcessor.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] missionPlannerProcessor.tick failed: ${err?.message || String(err)}`);
                }
            }

            // 6) Orchestration is DB-only and can run even when dispatch is paused.
            if (this.taskOrchestrationWorker && now >= this._next.orchestrationAt) {
                this._next.orchestrationAt = now + this.intervals.orchestrationMs;
                try {
                    await this.taskOrchestrationWorker.tick();
                } catch (err) {
                    log('WARN', `[AgentLoop] taskOrchestrationWorker.tick failed: ${err?.message || String(err)}`);
                }
            }
        } finally {
            this._running = false;
        }
    }
}

export { AgentLoop };
