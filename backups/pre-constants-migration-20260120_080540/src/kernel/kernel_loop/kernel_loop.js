/* ==========================================================================
   src/kernel/kernel_loop/kernel_loop.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: kernel_loop/
   Arquivo: kernel_loop.js

   Papel:
   - Manter o tempo soberano do Kernel
   - Executar ciclos lógicos periódicos
   - Chamar o ExecutionEngine para avaliação
   - Aplicar decisões produzidas pelo ExecutionEngine
   - Drenar buffers do NERV

   IMPORTANTE:
   - É o ÚNICO controlador de tempo do Kernel
   - NÃO decide semanticamente (delega ao ExecutionEngine)
   - NÃO interpreta EVENTs (delega ao ObservationStore via NERVBridge)
   - Executa decisões, mas não as produz

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Estados técnicos do KernelLoop
=========================== */

const KernelLoopState = Object.freeze({
    INACTIVE: 'INACTIVE',
    ACTIVE: 'ACTIVE',
    DEGRADED: 'DEGRADED',
    STOPPING: 'STOPPING'
});

/* ===========================
   Fábrica do KernelLoop
=========================== */

class KernelLoop {
    /**
     * @param {Object} params
     * @param {Object} params.executionEngine
     * Motor semântico que avalia e produz decisões.
     *
     * @param {Object} params.nervBridge
     * Ponte de integração com NERV (para drenagem de buffers).
     *
     * @param {Object} params.telemetry
     * Canal de telemetria do Kernel.
     *
     * @param {Object} [params.scheduler]
     * Scheduler técnico (padrão: global).
     *
     * @param {number} [params.baseIntervalMs]
     * Intervalo base entre ciclos (padrão: 50ms).
     */
    constructor({ executionEngine, nervBridge, telemetry, scheduler = global, baseIntervalMs = 50 }) {
        if (!executionEngine || typeof executionEngine.evaluate !== 'function') {
            throw new Error('KernelLoop requer executionEngine.evaluate()');
        }

        if (!nervBridge) {
            throw new Error('KernelLoop requer nervBridge');
        }

        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('KernelLoop requer telemetria válida');
        }

        this.executionEngine = executionEngine;
        this.nervBridge = nervBridge;
        this.telemetry = telemetry;
        this.scheduler = scheduler;
        this.baseIntervalMs = baseIntervalMs;

        this.state = KernelLoopState.INACTIVE;
        this._timer = null;
        this._tickCounter = 0;
        this._lastTickAt = null;
        this._running = false;
    }

    /* ===========================
     LIFECYCLE
  =========================== */

    /**
     * Inicia o ciclo executivo do Kernel.
     */
    start() {
        if (this.state === KernelLoopState.ACTIVE) {
            this.telemetry.warning('kernel_loop_already_active', {
                at: Date.now()
            });
            return;
        }

        this.state = KernelLoopState.ACTIVE;
        this._running = true;

        this.telemetry.info('kernel_loop_started', {
            at: Date.now()
        });

        this._scheduleNextTick();
    }

    /**
     * Para o ciclo executivo do Kernel.
     */
    stop() {
        if (this.state === KernelLoopState.INACTIVE) {
            this.telemetry.warning('kernel_loop_already_inactive', {
                at: Date.now()
            });
            return;
        }

        this.state = KernelLoopState.STOPPING;
        this._running = false;

        if (this._timer) {
            this.scheduler.clearTimeout(this._timer);
            this._timer = null;
        }

        this.telemetry.info('kernel_loop_stopped', {
            ticks: this._tickCounter,
            at: Date.now()
        });

        this.state = KernelLoopState.INACTIVE;
    }

    /**
     * Verifica se o loop está executando.
     */
    isRunning() {
        return this._running;
    }

    /* ===========================
     CICLO LÓGICO (STEP)
  =========================== */

    /**
     * Executa um único ciclo lógico do Kernel.
     *
     * Sequência canônica:
     * 1. Drenagem de buffers do NERV (inbound)
     * 2. Avaliação semântica (ExecutionEngine)
     * 3. Aplicação de decisões
     * 4. Drenagem de buffers do NERV (outbound)
     */
    step() {
        if (!this._running) {
            return;
        }

        const tickId = ++this._tickCounter;
        const startedAt = Date.now();
        this._lastTickAt = startedAt;

        this.telemetry.info('kernel_loop_tick_start', {
            tickId,
            state: this.state,
            at: startedAt
        });

        try {
            // 1. Drenagem de buffer inbound (EVENTs recebidos)
            this._drainInbound();

            // 2. Avaliação semântica (produz propostas de decisão)
            const proposals = this.executionEngine.evaluate({
                tickId,
                at: startedAt
            });

            // 3. Aplicação de decisões
            this._applyDecisions(proposals, { tickId, at: startedAt });

            // 4. Drenagem de buffer outbound (COMMANDs/EVENTs a enviar)
            this._drainOutbound();
        } catch (error) {
            this.state = KernelLoopState.DEGRADED;

            this.telemetry.critical('kernel_loop_tick_error', {
                tickId,
                error: error.message || String(error),
                stack: error.stack,
                at: Date.now()
            });
        } finally {
            const endedAt = Date.now();
            const durationMs = endedAt - startedAt;

            this.telemetry.info('kernel_loop_tick_end', {
                tickId,
                durationMs,
                at: endedAt
            });
        }
    }

    /* ===========================
     DRENAGEM DE BUFFERS NERV
  =========================== */

    /**
     * Drena buffer inbound do NERV.
     * EVENTs recebidos são processados pela NERVBridge.
     */
    _drainInbound() {
        if (!this.nervBridge.nerv || !this.nervBridge.nerv.buffers) {
            return;
        }

        const buffers = this.nervBridge.nerv.buffers;
        let drained = 0;

        // Drena até 100 mensagens por ciclo (limite técnico)
        while (drained < 100) {
            const envelope = buffers.dequeueInbound();
            if (!envelope) {
                break;
            }

            // Processa via receive do NERV (que chama handlers registrados)
            this.nervBridge.nerv.receive(envelope);
            drained++;
        }

        if (drained > 0) {
            this.telemetry.info('kernel_loop_inbound_drained', {
                count: drained,
                at: Date.now()
            });
        }
    }

    /**
     * Drena buffer outbound do NERV.
     * Envia mensagens pendentes via transporte físico.
     */
    _drainOutbound() {
        if (!this.nervBridge.nerv || !this.nervBridge.nerv.buffers) {
            return;
        }

        const buffers = this.nervBridge.nerv.buffers;
        const transport = this.nervBridge.nerv.transport;

        if (!transport) {
            return;
        }

        let drained = 0;

        // Drena até 100 mensagens por ciclo
        while (drained < 100) {
            const envelope = buffers.dequeueOutbound();
            if (!envelope) {
                break;
            }

            // Serializa e envia via transporte
            try {
                const serialized = JSON.stringify(envelope);
                const buffer = Buffer.from(serialized, 'utf8');
                transport.send(buffer);
                drained++;
            } catch (error) {
                this.telemetry.critical('kernel_loop_outbound_send_failed', {
                    error: error.message,
                    at: Date.now()
                });
            }
        }

        if (drained > 0) {
            this.telemetry.info('kernel_loop_outbound_drained', {
                count: drained,
                at: Date.now()
            });
        }
    }

    /* ===========================
     APLICAÇÃO DE DECISÕES
  =========================== */

    /**
     * Aplica decisões produzidas pelo ExecutionEngine.
     *
     * @param {Array<Object>} proposals
     * Lista de propostas de decisão.
     *
     * @param {Object} context
     * Contexto do ciclo atual.
     */
    _applyDecisions(proposals, context) {
        if (!Array.isArray(proposals) || proposals.length === 0) {
            return;
        }

        this.telemetry.info('kernel_loop_applying_decisions', {
            count: proposals.length,
            tickId: context.tickId,
            at: context.at
        });

        for (const proposal of proposals) {
            try {
                this._applyDecision(proposal, context);
            } catch (error) {
                this.telemetry.critical('kernel_loop_decision_application_failed', {
                    proposal,
                    error: error.message,
                    at: Date.now()
                });
            }
        }
    }

    /**
     * Aplica uma única decisão.
     */
    _applyDecision(proposal, context) {
        const { kind, taskId, reason } = proposal;

        this.telemetry.info('kernel_loop_decision_applied', {
            kind,
            taskId,
            reason,
            tickId: context.tickId,
            at: context.at
        });

        // Exemplo de decisão implementada
        switch (kind) {
            case 'PROPOSE_SUSPEND_TASK':
                // Aqui seria implementada a suspensão da tarefa
                // Por ora, apenas registramos a intenção
                this.telemetry.warning('kernel_loop_task_suspension_proposed', {
                    taskId,
                    reason,
                    at: context.at
                });
                break;

            default:
                this.telemetry.warning('kernel_loop_unknown_decision_kind', {
                    kind,
                    at: context.at
                });
        }
    }

    /* ===========================
     AGENDAMENTO (SCHEDULING)
  =========================== */

    /**
     * Agenda próximo ciclo lógico.
     */
    _scheduleNextTick() {
        if (!this._running) {
            return;
        }

        const delay = this._computeDelay();

        this._timer = this.scheduler.setTimeout(() => {
            this.step();
            this._scheduleNextTick();
        }, delay);
    }

    /**
     * Calcula delay até próximo ciclo.
     * Pode ser adaptativo com base no estado.
     */
    _computeDelay() {
        if (this.state === KernelLoopState.DEGRADED) {
            return this.baseIntervalMs * 2;
        }

        return this.baseIntervalMs;
    }

    /* ===========================
     OBSERVABILIDADE
  =========================== */

    /**
     * Retorna status técnico do loop.
     */
    getStatus() {
        return Object.freeze({
            state: this.state,
            ticks: this._tickCounter,
            lastTickAt: this._lastTickAt,
            running: this._running,
            baseIntervalMs: this.baseIntervalMs
        });
    }
}

module.exports = {
    KernelLoop,
    KernelLoopState
};
