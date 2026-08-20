// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import * as adaptive from '#logic/adaptive';
import EventEmitter from 'node:events';

/**
 * A Promise that also exposes a `.cancel()` method to clear its internal timer.
 *
 * @typedef {Promise<never> & { cancel: () => void }} CancelableTimeoutPromise
 */

/**
 * Configuração de timeouts e delays para submission.
 *
 * @readonly
 * @enum {number}
 */
const SUBMISSION_CONFIG = {
    /** Lock duration para anti-race condition (ms) - Default: 3s */
    LOCK_DURATION_MS: parseInt(process.env['SUBMISSION_LOCK_DURATION'] || '3000', 10),

    /** Delay pré-press biomecânico (ms) - Default: 300ms */
    PRE_PRESS_DELAY_MS: parseInt(process.env['SUBMISSION_PRE_PRESS'] || '300', 10),

    /** Debounce delay fallback (ms) - Default: 400ms */
    DEBOUNCE_FALLBACK_MS: parseInt(process.env['SUBMISSION_DEBOUNCE'] || '400', 10),

    /** Debounce delay máximo (ms) - Default: 600ms */
    DEBOUNCE_MAX_MS: parseInt(process.env['SUBMISSION_DEBOUNCE_MAX'] || '600', 10),

    /** Delay pós-envio (ms) - Default: 500ms */
    POST_SEND_DELAY_MS: parseInt(process.env['SUBMISSION_POST_SEND'] || '500', 10),

    /** Timeout para submit completo (ms) - Default: 10s */
    SUBMIT_TIMEOUT_MS: parseInt(process.env['SUBMISSION_TIMEOUT'] || '10000', 10),

    /** Máximo de retries em synthetic fallback - Default: 2 */
    MAX_SYNTHETIC_RETRIES: parseInt(process.env['SUBMISSION_MAX_RETRIES'] || '2', 10),
};

/**
 * Eventos emitidos pelo SubmissionController.
 *
 * @readonly
 * @enum {string}
 */
const SUBMISSION_EVENTS = {
    /** Emitido quando submission inicia */
    SUBMISSION_STARTED: 'submission:started',

    /** Emitido quando lock anti-race é adquirido */
    LOCK_ACQUIRED: 'submission:lock_acquired',

    /** Emitido quando Enter key é enviada (physical trigger) */
    ENTER_SENT: 'submission:enter_sent',

    /** Emitido quando campo limpo é confirmado (verificação) */
    CLEARED_CONFIRMED: 'submission:cleared_confirmed',

    /** Emitido quando fallback sintético é acionado */
    SYNTHETIC_TRIGGERED: 'submission:synthetic_triggered',

    /** Emitido quando submission é concluída com sucesso */
    SUBMISSION_COMPLETED: 'submission:completed',

    /** Emitido quando submission falha */
    SUBMISSION_FAILED: 'submission:failed',

    /** Emitido quando lock é liberado manualmente */
    LOCK_CLEARED: 'submission:lock_cleared',
};

/**
 * SubmissionController v2.0 - Controlador de Submissão Atômica
 *
 * Gerencia a submissão atômica de mensagens com proteção anti-race condition (lock temporal de 3s) e fallback sintético
 * se Enter key física falhar.
 *
 * FEATURES v2.0:
 *
 * - EventEmitter inheritance (8 eventos locais)
 * - SUBMISSION_CONFIG (7 keys configuráveis via env vars)
 * - Timeout protection em submit (SUBMIT_TIMEOUT_MS)
 * - Retry logic em synthetic fallback (MAX_SYNTHETIC_RETRIES)
 * - Metrics tracking (7 contadores + timing)
 * - Validação completa de parâmetros (ctx, selector, taskId)
 * - JSDoc 100% (class, constructor, methods, events)
 * - getStats() method para introspection
 *
 * @example
 *     const controller = new SubmissionController(driver);
 *
 *     // Listen to events
 *     controller.on(SUBMISSION_EVENTS.SUBMISSION_STARTED, (data) => {
 *         console.log('Submission started:', data);
 *     });
 *
 *     controller.on(SUBMISSION_EVENTS.SUBMISSION_COMPLETED, (data) => {
 *         console.log('Submission completed:', data);
 *     });
 *
 *     // Execute submission
 *     await controller.submit(page, '#prompt-textarea', 'task-123');
 *
 *     // Get metrics
 *     const stats = controller.getStats();
 *     console.log('Total submissions:', stats.totalSubmissions);
 *
 * @extends EventEmitter
 */
class SubmissionController extends EventEmitter {
    /**
     * Cria uma instância do SubmissionController.
     *
     * @example
     *     const controller = new SubmissionController(driver);
     *
     * @param {object} driver - Instância do driver (BaseDriver ou subclasses)
     * @param {function} driver._emitVital - Método IPC para telemetria vital
     * @param {string} driver.correlationId - ID de correlação para logs
     * @param {object} driver.page - Instância Puppeteer Page
     * @param {string} driver.currentDomain - Domain atual para adaptive timeout
     * @throws {Error} Se driver não for fornecido
     * @throws {Error} Se driver._emitVital não for uma função
     */
    constructor(driver) {
        super(); // EventEmitter constructor

        // ✅ Validação de driver (BUG #9 fix)
        if (!driver) {
            throw new Error('[SubmissionController] Driver is required');
        }

        if (typeof driver._emitVital !== 'function') {
            throw new Error('[SubmissionController] Driver must have _emitVital method');
        }

        this.driver = driver;
        this.submissionLock = null;

        // ✅ Metrics tracking (BUG #5 fix)
        this.stats = {
            totalSubmissions: 0,
            successfulSubmissions: 0,
            failedSubmissions: 0,
            syntheticSubmissions: 0,
            lockBlockedAttempts: 0,
            totalSubmissionDuration: 0,
            maxSubmissionDuration: 0,
        };
    }

    /**
     * Executa submissão atômica de mensagem.
     *
     * FLUXO DE EXECUÇÃO:
     *
     * 1. Gate de duplicidade (anti-race lock check)
     * 2. Lock acquisition (timestamp + evento)
     * 3. Biomechanical pause (PRE_PRESS_DELAY_MS)
     * 4. Physical trigger (Enter key press)
     * 5. Adaptive wait (debounce via adaptive.getAdjustedTimeout)
     * 6. Emptiness verification (campo limpo = confirmação)
     * 7. Synthetic fallback (se physical falhou, retry loop)
     * 8. Post-send stabilization (POST_SEND_DELAY_MS)
     *
     * @example
     *     await controller.submit(page, '#prompt-textarea', 'task-123');
     *
     * @fires SUBMISSION_EVENTS.SUBMISSION_STARTED
     * @fires SUBMISSION_EVENTS.LOCK_ACQUIRED
     * @fires SUBMISSION_EVENTS.ENTER_SENT
     * @fires SUBMISSION_EVENTS.CLEARED_CONFIRMED
     * @fires SUBMISSION_EVENTS.SYNTHETIC_TRIGGERED
     * @fires SUBMISSION_EVENTS.SUBMISSION_COMPLETED
     * @fires SUBMISSION_EVENTS.SUBMISSION_FAILED
     * @param {object} ctx - Context (Page ou Frame) para execução
     * @param {string} selector - Seletor CSS do campo de input
     * @param {string} taskId - ID da task para telemetria
     * @returns {Promise<void>}
     * @throws {Error} Se ctx for null/undefined
     * @throws {Error} Se selector for vazio/inválido
     * @throws {Error} Se taskId não for fornecido
     * @throws {Error} Se timeout exceder SUBMIT_TIMEOUT_MS
     */
    async submit(ctx, selector, taskId) {
        // ✅ Validação de parâmetros (BUG #3 fix)
        if (!ctx) {
            throw new Error('[SubmissionController] Context (Page/Frame) is required');
        }

        if (!selector || typeof selector !== 'string') {
            throw new Error('[SubmissionController] Selector must be a non-empty string');
        }

        if (!taskId) {
            throw new Error('[SubmissionController] TaskId is required');
        }

        const correlationId = this.driver.correlationId;

        // ✅ Timeout protection (BUG #4 fix)
        const timeoutP = this._timeout(SUBMISSION_CONFIG.SUBMIT_TIMEOUT_MS, 'submit');
        try {
            await Promise.race([this._executeSubmit(ctx, selector, taskId, correlationId), timeoutP]);
        } catch (/** @type {any} */ err) {
            this.stats.failedSubmissions++;

            // EventEmitter local
            this.emit(SUBMISSION_EVENTS.SUBMISSION_FAILED, {
                taskId,
                selector,
                error: /** @type {any} */ (err).message,
                timestamp: Date.now(),
            });

            // IPC telemetry
            this.driver._emitVital('TRIAGE_ALERT', {
                type: 'SUBMISSION_FAILED',
                severity: 'HIGH',
                evidence: { taskId, selector, error: /** @type {any} */ (err).message },
            });

            log('ERROR', `[SUBMISSION] Falha no processo de envio: ${/** @type {any} */ (err).message}`, correlationId);
            throw err;
        } finally {
            timeoutP.cancel();
            this.submissionLock = null;
        }
    }

    /**
     * Executa lógica interna de submission (sem timeout wrapper).
     *
     * @private
     * @param {object} ctx - Context (Page/Frame)
     * @param {string} selector - Seletor CSS
     * @param {string} taskId - Task ID
     * @param {string} correlationId - Correlation ID para logs
     * @returns {Promise<void>}
     */
    async _executeSubmit(ctx, selector, taskId, correlationId) {
        const startTime = Date.now();
        this.stats.totalSubmissions++;

        // STEP 1: GATE DE DUPLICIDADE (Anti-Race Condition)
        if (this.submissionLock && Date.now() - this.submissionLock < SUBMISSION_CONFIG.LOCK_DURATION_MS) {
            this.stats.lockBlockedAttempts++;
            log('WARN', '[SUBMISSION] Bloqueio de duplicidade ativo. Ignorando comando.', correlationId);
            return;
        }

        // STEP 2: LOCK ACQUISITION
        this.submissionLock = Date.now();

        // EventEmitter local
        this.emit(SUBMISSION_EVENTS.SUBMISSION_STARTED, {
            taskId,
            selector,
            lockTimestamp: this.submissionLock,
            timestamp: Date.now(),
        });

        this.emit(SUBMISSION_EVENTS.LOCK_ACQUIRED, {
            taskId,
            lockDuration: SUBMISSION_CONFIG.LOCK_DURATION_MS,
            timestamp: Date.now(),
        });

        // IPC telemetry
        this.driver._emitVital('PROGRESS_UPDATE', {
            step: 'SUBMISSION_START',
            taskId,
            selector,
        });

        // STEP 3: BIOMECHANICAL PAUSE (pre-press delay)
        await new Promise((r) => setTimeout(r, SUBMISSION_CONFIG.PRE_PRESS_DELAY_MS));

        // STEP 4: PHYSICAL TRIGGER (Enter key)
        this.emit(SUBMISSION_EVENTS.ENTER_SENT, {
            taskId,
            selector,
            timestamp: Date.now(),
        });

        this.driver._emitVital('PROGRESS_UPDATE', {
            step: 'SENDING_ENTER_KEY',
            taskId,
        });

        await /** @type {any} */ (this.driver.page).keyboard.press('Enter');

        // STEP 5: ADAPTIVE WAIT (debounce calculation)
        let debounceDelay = SUBMISSION_CONFIG.DEBOUNCE_FALLBACK_MS;
        try {
            const timeoutData = await adaptive.getAdjustedTimeout(this.driver.currentDomain, 0, 'ECHO');
            debounceDelay = Math.min(Math.floor(timeoutData.timeout / 10), SUBMISSION_CONFIG.DEBOUNCE_MAX_MS);
        } catch (/** @type {any} */ _e) {
            // Fallback to default
        }

        await new Promise((r) => setTimeout(r, debounceDelay));

        // STEP 6: EMPTINESS VERIFICATION (confirmation)
        const wasCleared = await this._verifyClearing(ctx, selector);

        if (wasCleared) {
            // Physical submission succeeded
            this.emit(SUBMISSION_EVENTS.CLEARED_CONFIRMED, {
                taskId,
                selector,
                debounceDelay,
                timestamp: Date.now(),
            });

            this.driver._emitVital('PROGRESS_UPDATE', {
                step: 'SUBMISSION_CONFIRMED',
                taskId,
            });

            log('DEBUG', '[SUBMISSION] Envio confirmado (campo limpo).', correlationId);
        } else {
            // STEP 7: SYNTHETIC FALLBACK (retry loop) ✅ BUG #7 fix
            log('WARN', '[SUBMISSION] Tecla física falhou. Acionando fallback sintético...', correlationId);

            this.emit(SUBMISSION_EVENTS.SYNTHETIC_TRIGGERED, {
                taskId,
                selector,
                debounceDelay,
                maxRetries: SUBMISSION_CONFIG.MAX_SYNTHETIC_RETRIES,
                timestamp: Date.now(),
            });

            this.driver._emitVital('TRIAGE_ALERT', {
                type: 'SYNTHETIC_SUBMISSION_TRIGGERED',
                severity: 'MEDIUM',
                evidence: { selector, delay: debounceDelay },
            });

            await this._executeSyntheticSubmit(ctx, selector, correlationId);
        }

        // STEP 8: POST-SEND STABILIZATION
        await new Promise((r) => setTimeout(r, SUBMISSION_CONFIG.POST_SEND_DELAY_MS));

        // Success metrics
        this.stats.successfulSubmissions++;

        const duration = Date.now() - startTime;
        this.stats.totalSubmissionDuration += duration;
        this.stats.maxSubmissionDuration = Math.max(this.stats.maxSubmissionDuration, duration);

        // EventEmitter local
        this.emit(SUBMISSION_EVENTS.SUBMISSION_COMPLETED, {
            taskId,
            selector,
            duration,
            timestamp: Date.now(),
        });
    }

    /**
     * Verifica se campo foi esvaziado (confirmação de submission).
     *
     * @private
     * @param {object} ctx - Context (Page/Frame)
     * @param {string} selector - Seletor CSS
     * @returns {Promise<boolean>} true se campo vazio, false caso contrário
     */
    async _verifyClearing(ctx, selector) {
        return await /** @type {any} */ (ctx).evaluate((/** @type {any} */ s) => {
            const el = document.querySelector(s);
            const content = el?.value || el?.innerText || '';
            return content.trim().length === 0;
        }, selector);
    }

    /**
     * Executa fallback sintético com retry logic.
     *
     * @private
     * @param {object} ctx - Context (Page/Frame)
     * @param {string} selector - Seletor CSS
     * @param {string} correlationId - Correlation ID para logs
     * @returns {Promise<void>}
     * @throws {Error} Se todas as tentativas falharem
     */
    async _executeSyntheticSubmit(ctx, selector, correlationId) {
        const maxRetries = SUBMISSION_CONFIG.MAX_SYNTHETIC_RETRIES;

        for (let retry = 0; retry < maxRetries; retry++) {
            try {
                await /** @type {any} */ (ctx).evaluate((/** @type {any} */ sel) => {
                    const el = document.querySelector(sel);
                    if (!el) {
                        throw new Error(`Element not found: ${sel}`);
                    }

                    const evParams = {
                        bubbles: true,
                        cancelable: true,
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                    };

                    ['keydown', 'keypress', 'keyup'].forEach((t) => {
                        el.dispatchEvent(new KeyboardEvent(t, evParams));
                    });
                }, selector);

                this.stats.syntheticSubmissions++;

                this.driver._emitVital('PROGRESS_UPDATE', {
                    step: 'SUBMISSION_SYNTHETIC_SENT',
                    retry: retry + 1,
                });

                // Verify clearing after synthetic
                await new Promise((r) => setTimeout(r, SUBMISSION_CONFIG.DEBOUNCE_FALLBACK_MS));
                const wasCleared = await this._verifyClearing(ctx, selector);

                if (wasCleared) {
                    log('DEBUG', `[SUBMISSION] Synthetic fallback succeeded (retry ${retry + 1})`, correlationId);
                    return; // Success
                }
            } catch (/** @type {any} */ syntheticErr) {
                if (retry < maxRetries - 1) {
                    log(
                        'WARN',
                        `[SUBMISSION] Synthetic fallback failed (retry ${retry + 1}/${maxRetries})`,
                        correlationId,
                    );
                    await new Promise((r) => setTimeout(r, 500 * (retry + 1))); // Backoff
                } else {
                    throw syntheticErr; // Max retries exceeded
                }
            }
        }

        throw new Error(`[SUBMISSION] Synthetic fallback failed after ${maxRetries} retries`);
    }

    /**
     * Força a liberação do lock de submissão.
     *
     * Útil para testes ou recovery de estados travados.
     *
     * @example
     *     controller.clearLock();
     *
     * @fires SUBMISSION_EVENTS.LOCK_CLEARED
     * @returns {void}
     */
    clearLock() {
        this.submissionLock = null;

        // ✅ Event emission (BUG #8 fix)
        this.emit(SUBMISSION_EVENTS.LOCK_CLEARED, {
            timestamp: Date.now(),
        });

        log('DEBUG', '[SUBMISSION] Lock cleared manually', this.driver.correlationId);
    }

    /**
     * Verifica se o controlador está em período de cooldown.
     *
     * @example
     *     if (!controller.isLocked()) {
     *         await controller.submit(ctx, selector, taskId);
     *     }
     *
     * @returns {boolean} true se locked, false se disponível
     */
    isLocked() {
        return !!(this.submissionLock && Date.now() - this.submissionLock < SUBMISSION_CONFIG.LOCK_DURATION_MS);
    }

    /**
     * Retorna estatísticas de submission.
     *
     * @example
     *     const stats = controller.getStats();
     *     console.log('Total submissions:', stats.totalSubmissions);
     *     console.log(
     *         'Success rate:',
     *         ((stats.successfulSubmissions / stats.totalSubmissions) * 100).toFixed(2) + '%',
     *     );
     *
     * @returns {any} Objeto com métricas de submission Propriedades do objeto retornado:
     *
     *   - totalSubmissions (number): Total de submissions executadas
     *   - successfulSubmissions (number): Submissions bem-sucedidas
     *   - failedSubmissions (number): Submissions que falharam
     *   - syntheticSubmissions (number): Fallbacks sintéticos acionados
     *   - lockBlockedAttempts (number): Tentativas bloqueadas por lock
     *   - totalSubmissionDuration (number): Duração total acumulada (ms)
     *   - maxSubmissionDuration (number): Duração máxima individual (ms)
     *   - config (Object): Configuração atual (SUBMISSION_CONFIG)
     */
    getStats() {
        return {
            ...this.stats,
            config: { ...SUBMISSION_CONFIG },
        };
    }

    /**
     * Timeout wrapper para operações com limite de tempo.
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para error message)
     * @returns {CancelableTimeoutPromise} Promise que rejeita após timeout com método `.cancel()` para limpar o timer
     */
    _timeout(ms, operation) {
        let timerId = /** @type {any} */ (undefined);
        const p = /** @type {CancelableTimeoutPromise} */ (
            new Promise((_, reject) => {
                timerId = setTimeout(() => {
                    const error = new Error(`Timeout in ${operation} after ${ms}ms`);
                    error.name = 'TimeoutError';
                    reject(error);
                }, ms);
            })
        );
        p.cancel = () => clearTimeout(timerId);
        return p;
    }
}

/**
 * @typedef {object} CreateDriver
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Factory function para criar instância de SubmissionController.
 *
 * @example
 *     const { create } = require('./submission_controller');
 *     const controller = create(driver);
 *
 * @param {object} driver - Instância do driver
 * @returns {SubmissionController} Nova instância
 */
function create(driver) {
    return new SubmissionController(/** @type {any} */ (driver));
}

export { create, SUBMISSION_CONFIG, SUBMISSION_EVENTS, SubmissionController };
