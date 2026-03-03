// @ts-check - Type checking rigoroso habilitado (arquivo core)
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

/** Constante/valor exportado: KernelLoopState. */
const KernelLoopState = Object.freeze({
    INACTIVE: 'INACTIVE',
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED', // ✅ Novo estado: Pausado por Circuit Breaker
    DEGRADED: 'DEGRADED',
    STOPPING: 'STOPPING',
});

import { DecisionKind } from '../execution_engine/execution_engine.js';

/**
 * @typedef {object} KernelLoopOptions
 * @property {object} executionEngine - Motor semântico que avalia e produz decisões
 * @property {object} nervBridge - Ponte de integração com NERV
 * @property {object} telemetry - Sistema de telemetria
 * @property {object} [browserPool=null] - Pool de browsers
 * @property {object} [scheduler=global] - Scheduler para setInterval
 * @property {number} [baseIntervalMs=50] - Intervalo base entre ciclos
 * @property {function|null} [onActivateTask=null] - Callback para ativação de tarefa
 * @property {function|null} [onTerminateTask=null] - Callback para terminação de tarefa
 * @property {function|null} [onSuspendTask=null] - Callback para suspensão de tarefa
 */

/* ===========================
   Fábrica do KernelLoop
=========================== */

class KernelLoop {
    /**
     * @param {object} params
     * @param {object} params.executionEngine
     * Motor semântico que avalia e produz decisões.
     *
     * @param {object} params.nervBridge
     * Ponte de integração com NERV (para drenagem de buffers).
     *
     * @param {object} params.telemetry
     * Canal de telemetria do Kernel.
     *
     * @param {object} [params.browserPool]
     * Browser Pool Manager (para checar Circuit Breaker).
     *
     * @param {object} [params.scheduler]
     * Scheduler técnico (padrão: global).
     *
     * @param {number} [params.baseIntervalMs]
     * Intervalo base entre ciclos (padrão: 50ms).
     *
     * @param {function|null} [params.onActivateTask]
     * Callback para ativação de tarefa.
     *
     * @param {function|null} [params.onTerminateTask]
     * Callback para terminação de tarefa.
     *
     * @param {function|null} [params.onSuspendTask]
     * Callback para suspensão de tarefa.
     */
    constructor({
        executionEngine,
        nervBridge,
        telemetry,
        browserPool = null,
        scheduler = global,
        baseIntervalMs = 50,
        onActivateTask = null,
        onTerminateTask = null,
        onSuspendTask = null,
    }) {
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
        this.browserPool = browserPool; // ✅ Opcional: para checar Circuit Breaker
        this.scheduler = scheduler;
        this.baseIntervalMs = baseIntervalMs;
        this.onActivateTask = onActivateTask;
        this.onTerminateTask = onTerminateTask;
        this.onSuspendTask = onSuspendTask;

        /** @type {string} */
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
    start({ autoSchedule = true } = {}) {
        if (this.state === KernelLoopState.ACTIVE) {
            this.telemetry.warning('kernel_loop_already_active', {
                at: Date.now(),
            });
            return;
        }

        this.state = KernelLoopState.ACTIVE;
        this._running = true;

        this.telemetry.info('kernel_loop_started', {
            at: Date.now(),
        });

        if (autoSchedule) {
            this._scheduleNextTick();
        }
    }

    /**
     * Para o ciclo executivo do Kernel.
     */
    stop() {
        if (this.state === KernelLoopState.INACTIVE) {
            this.telemetry.warning('kernel_loop_already_inactive', {
                at: Date.now(),
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
            at: Date.now(),
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
     * 0. Verifica Circuit Breaker (pausa se necessário)
     * 1. Drenagem de buffers do NERV (inbound)
     * 2. Avaliação semântica (ExecutionEngine)
     * 3. Aplicação de decisões
     * 4. Drenagem de buffers do NERV (outbound)
     */
    async step() {
        if (!this._running) {
            return;
        }

        const tickId = ++this._tickCounter;
        const startedAt = Date.now();
        this._lastTickAt = startedAt;

        this.telemetry.info('kernel_loop_tick_start', {
            tickId,
            state: this.state,
            at: startedAt,
        });

        try {
            // ✅ 0.5. VALIDAÇÃO DE PRÉ-REQUISITOS
            if (!this.executionEngine || typeof this.executionEngine.evaluate !== 'function') {
                throw new Error('CRITICAL: ExecutionEngine não está válido');
            }

            // 1. Drenagem de buffer inbound (EVENTs recebidos)
            this._drainInbound();

            // ✅ 1.5. Circuit Breaker gate (mas mantém drenagem de NERV)
            if (this._checkCircuitBreaker()) {
                // Sistema pausado - não avalia nem aplica decisões, mas continua permitindo
                // controle/observação via NERV (inbound/outbound).
                this.telemetry.info('kernel_loop_paused', {
                    tickId,
                    reason: 'Circuit Breaker OPEN',
                    at: startedAt,
                });

                this._drainOutbound();
                return;
            }

            // 2. Avaliação semântica (produz propostas de decisão)
            const proposals = this.executionEngine.evaluate({
                tickId,
                at: startedAt,
            });

            // 3. Aplicação de decisões
            // [P3.2 FIX] Agora async para suportar paralelização
            await this._applyDecisions(proposals, { tickId, at: startedAt });

            // 4. Drenagem de buffer outbound (COMMANDs/EVENTs a enviar)
            this._drainOutbound();
        } catch (error) {
            this.state = KernelLoopState.DEGRADED;

            this.telemetry.critical('kernel_loop_tick_error', {
                tickId,
                error: error.message || String(error),
                stack: error.stack,
                at: Date.now(),
            });
        } finally {
            const endedAt = Date.now();
            const durationMs = endedAt - startedAt;

            this.telemetry.info('kernel_loop_tick_end', {
                tickId,
                durationMs,
                at: endedAt,
            });
        }
    }

    /**
     * Verifica Circuit Breaker e pausa sistema se necessário.
     * @returns {boolean} - true se pausado, false se pode executar
     */
    _checkCircuitBreaker() {
        if (!this.browserPool || !this.browserPool.circuitBreaker) {
            return false; // Sem Browser Pool, não pausa
        }

        const shouldPause = this.browserPool.circuitBreaker.shouldPauseSystem();

        if (shouldPause && this.state !== KernelLoopState.PAUSED) {
            this.state = KernelLoopState.PAUSED;
            this.telemetry.warning('kernel_paused_by_circuit_breaker', {
                cause: this.browserPool.circuitBreaker.lastCause,
                at: Date.now(),
            });
        } else if (!shouldPause && this.state === KernelLoopState.PAUSED) {
            this.state = KernelLoopState.ACTIVE;
            this.telemetry.info('kernel_resumed_circuit_recovered', {
                at: Date.now(),
            });
        }

        return shouldPause;
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
                at: Date.now(),
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

            // Envia via transporte.
            // Em modo HYBRID (EventEmitter + Socket.io), o contrato é transport.send(envelope).
            // Em transportes legados/frame-based, pode ser necessário enviar Buffer.
            try {
                transport.send(envelope);
                drained++;
            } catch (error) {
                try {
                    const serialized = JSON.stringify(envelope);
                    const buffer = Buffer.from(serialized, 'utf8');
                    transport.send(buffer);
                    drained++;
                } catch (fallbackError) {
                    this.telemetry.critical('kernel_loop_outbound_send_failed', {
                        error: fallbackError?.message || error?.message || String(fallbackError || error),
                        at: Date.now(),
                    });
                }
            }
        }

        if (drained > 0) {
            this.telemetry.info('kernel_loop_outbound_drained', {
                count: drained,
                at: Date.now(),
            });
        }
    }

    /* ===========================
     APLICAÇÃO DE DECISÕES
  =========================== */

    /**
     * Aplica decisões produzidas pelo ExecutionEngine.
     * [P3.2 CORREÇÃO] Aplica propostas em paralelo quando possível
     * [P9.4 CORREÇÃO] Adiciona timeout de 5s para prevenir kernel loop blocking
     *
     * @param {Array<object>} proposals
     * Lista de propostas de decisão.
     *
     * @param {object} context
     * Contexto do ciclo atual.
     */
    async _applyDecisions(proposals, context) {
        if (!Array.isArray(proposals) || proposals.length === 0) {
            return;
        }

        this.telemetry.info('kernel_loop_applying_decisions', {
            count: proposals.length,
            tickId: context.tickId,
            at: context.at,
        });

        // P9.4: Timeout wrapper para prevenir blocking
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('Decision application timeout after 5s')), 5000);
        });

        const decisionsPromise = Promise.all(
            proposals.map(async proposal => {
                try {
                    await this._applyDecision(proposal, context);
                } catch (error) {
                    this.telemetry.critical('kernel_loop_decision_application_failed', {
                        proposal,
                        error: error.message,
                        at: Date.now(),
                    });
                }
            })
        );

        // Race entre decisions e timeout; sempre limpa o timer (A005)
        try {
            await Promise.race([decisionsPromise, timeoutPromise]);
        } catch (error) {
            if (error.message.includes('timeout')) {
                this.telemetry.critical('kernel_loop_decision_timeout', {
                    count: proposals.length,
                    tickId: context.tickId,
                    error: error.message,
                    at: Date.now(),
                });
            } else {
                throw error;
            }
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    /**
     * Aplica uma única decisão.
     */
    async _applyDecision(proposal, context) {
        const { kind, taskId, reason } = proposal;

        this.telemetry.info('kernel_loop_decision_applied', {
            kind,
            taskId,
            reason,
            tickId: context.tickId,
            at: context.at,
        });

        // Exemplo de decisão implementada
        switch (kind) {
            case DecisionKind.PROPOSE_ACTIVATE_TASK:
                if (typeof this.onActivateTask === 'function') {
                    await this.onActivateTask({ taskId, reason, proposal, context });
                } else {
                    this.telemetry.warning('kernel_loop_activate_handler_not_configured', {
                        taskId,
                        at: context.at,
                    });
                }
                break;

            case DecisionKind.PROPOSE_TERMINATE_TASK:
                if (typeof this.onTerminateTask === 'function') {
                    await this.onTerminateTask({ taskId, reason, proposal, context });
                } else {
                    this.telemetry.warning('kernel_loop_terminate_handler_not_configured', {
                        taskId,
                        at: context.at,
                    });
                }
                break;

            case DecisionKind.PROPOSE_SUSPEND_TASK:
                if (typeof this.onSuspendTask === 'function') {
                    await this.onSuspendTask({ taskId, reason, proposal, context });
                } else {
                    this.telemetry.warning('kernel_loop_task_suspension_proposed', { taskId, reason, at: context.at });
                }
                break;

            default:
                this.telemetry.warning('kernel_loop_unknown_decision_kind', {
                    kind,
                    at: context.at,
                });
        }
    }

    /* ===========================
     AGENDAMENTO (SCHEDULING)
  =========================== */

    /**
     * Agenda próximo ciclo lógico.
     *
     * Invariante de scheduling (A010):
     * - step() é awaited antes de _scheduleNextTick() ser chamado.
     *   Isso garante que apenas uma execução de step() ocorre por vez.
     * - Se stop() é chamado durante step(): this._running passa a false,
     *   _scheduleNextTick() retorna imediatamente (linha 1), e nenhum
     *   novo timer é criado. Race condition controlada.
     * - Se stop() é chamado DENTRO de step() (via circuit breaker):
     *   this._timer já foi limpo por stop(); a sequência
     *   "await step() → _scheduleNextTick() → return" termina sem agendar.
     */
    _scheduleNextTick() {
        if (!this._running) {
            return;
        }

        const delay = this._computeDelay();

        // A002: step() é async — aguarda conclusão antes de agendar próximo tick
        // para evitar execuções concorrentes de step() com estado compartilhado.
        this._timer = this.scheduler.setTimeout(async () => {
            await this.step();
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
            baseIntervalMs: this.baseIntervalMs,
        });
    }
}

export { KernelLoop, KernelLoopState };
