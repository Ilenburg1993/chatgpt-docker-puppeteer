import EventEmitter from 'node:events';
import * as stabilizer from '#shared/page_stability/stabilizer';
import { log } from '#core/logger';
import { createSharedTimeout } from '#infra/abort_controller_utils';

/* ==========================================================================
   RECOVERY_CONFIG v2.0 - Zero Magic Numbers
========================================================================== */
const RECOVERY_CONFIG = {
    /** Timeout para process kill (ms) - Default: 5s */
    KILL_TIMEOUT_MS: parseInt(process.env.RECOVERY_KILL_TIMEOUT || '5000'),

    /** Timeout para page reload (ms) - Default: 30s */
    RELOAD_TIMEOUT_MS: parseInt(process.env.RECOVERY_RELOAD_TIMEOUT || '30000'),

    /** Delay base para tier 0 backoff (ms) - Default: 1200ms */
    TIER0_BACKOFF_BASE_MS: parseInt(process.env.RECOVERY_TIER0_BACKOFF || '1200'),

    /** Delay incremental para tier 0 backoff (ms) - Default: 800ms */
    TIER0_BACKOFF_INCREMENT_MS: parseInt(process.env.RECOVERY_TIER0_INCREMENT || '800'),

    /** Timeout para focus recovery (ms) - Default: 2s */
    FOCUS_TIMEOUT_MS: parseInt(process.env.RECOVERY_FOCUS_TIMEOUT || '2000'),

    /** Máximo de retries por tier - Default: 2 */
    MAX_TIER_RETRIES: parseInt(process.env.RECOVERY_MAX_RETRIES || '2')
};

/* ==========================================================================
   RECOVERY_EVENTS v2.0 - Telemetria de Recovery
========================================================================== */
const RECOVERY_EVENTS = {
    TIER_STARTED: 'recovery:tier_started', // Tier iniciado
    TIER_COMPLETED: 'recovery:tier_completed', // Tier concluído com sucesso
    TIER_FAILED: 'recovery:tier_failed', // Tier falhou
    CACHE_CLEARED: 'recovery:cache_cleared', // Cache invalidado (tier 0)
    FOCUS_RESTORED: 'recovery:focus_restored', // Focus restaurado (tier 1)
    PAGE_RELOADED: 'recovery:page_reloaded', // Page recarregada (tier 2)
    BROWSER_DISCONNECTED: 'recovery:browser_disconnected', // Browser disconnected (tier 3 - external mode)
};

/* ==========================================================================
   RecoverySystem v2.0 - EventEmitter Class
========================================================================== */

/**
 * RecoverySystem v2.0 - Sistema de recuperação escalonada (4 tiers)
 *
 * Responsabilidades:
 * - Executar recovery tiers baseado em attempt count (0-3)
 * - Tier 0: Cache invalidation + tactical delay
 * - Tier 1: Focus recovery (mouse click + window.focus)
 * - Tier 2: Hard page reload + stabilizer wait (with retry)
 * - Tier 3: Nuclear process kill (with timeout)
 * - Telemetria completa via EventEmitter + IPC (_emitVital)
 * - Metrics tracking (tier usage, success/failure, timing)
 *
 * @class RecoverySystem
 * @extends EventEmitter
 */
class RecoverySystem extends EventEmitter {
    /**
     * Cria RecoverySystem instance v2.0
     *
     * @constructor
 * @param {Object} driver - Driver Puppeteer (BaseDriver instance)
 * @throws {Error} Se driver inválido ou missing methods
     *
     * @example
     * const recovery = new RecoverySystem(driver);
     * recovery.on(RECOVERY_EVENTS.TIER_STARTED, (data) => { ... });
     */
    constructor(driver) {
        super();

        // ✅ BUG #3 FIX: Validação completa de driver
        if (!driver) {
            throw new Error('[RecoverySystem] Driver is required');
        }

        if (typeof driver._emitVital !== 'function') {
            throw new Error('[RecoverySystem] Driver must have _emitVital method');
        }

        if (!driver.inputResolver) {
            throw new Error('[RecoverySystem] Driver must have inputResolver');
        }

        this.driver = driver;

        // ✅ BUG #5 FIX: Metrics persistentes
        this.stats = {
            tier0Applied: 0,
            tier1Applied: 0,
            tier2Applied: 0,
            tier3Applied: 0,
            totalRecoveries: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            totalRecoveryDuration: 0,
            maxRecoveryDuration: 0,
        };

        // ✅ Configurar max listeners (memory leak detection)
        this.setMaxListeners(20);

        log('DEBUG', '[RecoverySystem] v2.0 initialized (EventEmitter + metrics)');
    }

    /* ==========================================================================
       TIER EXECUTION
    ========================================================================== */

    /**
     * Aplica tier de recuperação baseado em attempt count.
     *
     * v2.0 Features:
     * - EventEmitter telemetry (tier_started, tier_completed, tier_failed)
     * - IPC telemetry via _emitVital (TRIAGE_ALERT, PROGRESS_UPDATE)
     * - Metrics tracking (tier usage, success/failure, timing)
     * - Retry logic em tier 2 (reload)
     * - Timeout protection em todas operações
     *
     * @async
     * @param {Error} recoveryErr - Erro original que triggered recovery
     * @param {number} attempt - Índice tier (0-3)
     * @param {string} taskId - ID da tarefa
     * @returns {Promise<void>}
     * @throws {Error} Se tier 3 falhar (fatal - escalates to ExecutionEngine)
     *
     * @emits RECOVERY_EVENTS.TIER_STARTED - Quando tier inicia
     * @emits RECOVERY_EVENTS.TIER_COMPLETED - Quando tier completa com sucesso
     * @emits RECOVERY_EVENTS.TIER_FAILED - Quando tier falha
     * @emits RECOVERY_EVENTS.CACHE_CLEARED - Quando cache é limpo (tier 0)
     * @emits RECOVERY_EVENTS.FOCUS_RESTORED - Quando focus restaurado (tier 1)
     * @emits RECOVERY_EVENTS.PAGE_RELOADED - Quando page recarregada (tier 2)
     * @emits RECOVERY_EVENTS.PROCESS_KILLED - Quando processo morto (tier 3)
     */
    async applyTier(recoveryErr, attempt, taskId) {
        const startTime = Date.now();
        const msg = String(recoveryErr?.message || '').toUpperCase();
        const correlationId = this.driver.correlationId;

        // ✅ Metrics
        this.stats.totalRecoveries++;

        log('WARN', `[RECOVERY] Acionando Tier ${attempt} | Causa: ${recoveryErr.message}`, correlationId);

        // ✅ EventEmitter telemetry (local)
        this.emit(RECOVERY_EVENTS.TIER_STARTED, {
            tier: attempt,
            cause: recoveryErr.message,
            taskId,
            timestamp: Date.now(),
        });

        // ✅ IPC telemetry (Mission Control)
        this.driver._emitVital('TRIAGE_ALERT', {
            type: 'RECOVERY_MANEUVER_START',
            severity: attempt > 1 ? 'HIGH' : 'MEDIUM',
            evidence: { tier: attempt, cause: recoveryErr.message, taskId },
        });

        try {
            switch (attempt) {
                case 0:
                    await this._executeTier0(correlationId);
                    break;

                case 1:
                    await this._executeTier1(correlationId);
                    break;

                case 2:
                    await this._executeTier2(correlationId);
                    break;

                default:
                    // Tier 3: Nuclear (Process Kill)
                    if (msg.includes('TIMEOUT') || msg.includes('CLOSED') || msg.includes('DETACHED') || attempt >= 3) {
                        await this._executeTier3(correlationId, taskId, recoveryErr);
                    }
            }

            // ✅ Success metrics
            this.stats.successfulRecoveries++;
            this.stats[`tier${attempt}Applied`]++;

            // ✅ Timing
            const duration = Date.now() - startTime;
            this.stats.totalRecoveryDuration += duration;
            this.stats.maxRecoveryDuration = Math.max(this.stats.maxRecoveryDuration, duration);

            // ✅ EventEmitter telemetry
            this.emit(RECOVERY_EVENTS.TIER_COMPLETED, {
                tier: attempt,
                duration,
                taskId,
                timestamp: Date.now(),
            });

            // ✅ IPC telemetry
            this.driver._emitVital('PROGRESS_UPDATE', {
                step: 'RECOVERY_MANEUVER_COMPLETE',
                tier: attempt,
                duration,
            });

            log('DEBUG', `[RECOVERY] Tier ${attempt} completed in ${duration}ms`, correlationId);
        } catch (tierError) {
            // ✅ Failure metrics
            this.stats.failedRecoveries++;

            // ✅ EventEmitter telemetry
            this.emit(RECOVERY_EVENTS.TIER_FAILED, {
                tier: attempt,
                error: tierError.message,
                taskId,
                timestamp: Date.now(),
            });

            log('ERROR', `[RECOVERY] Tier ${attempt} failed: ${tierError.message}`, correlationId);
            throw tierError;
        }
    }

    /**
     * Executa Tier 0: Cache Invalidation + Tactical Delay
     *
     * @private
     * @param {string} correlationId - Correlation ID
     * @returns {Promise<void>}
     */
    async _executeTier0(correlationId) {
        this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_0_CACHE_INVALIDATION' });

        // Cache invalidation
        this.driver.inputResolver.clearCache();

        // ✅ EventEmitter telemetry
        this.emit(RECOVERY_EVENTS.CACHE_CLEARED, {
            timestamp: Date.now(),
        });

        // Tactical delay (backoff: 1200ms + attempt*800ms)
        const baseDelay = RECOVERY_CONFIG.TIER0_BACKOFF_BASE_MS;
        const increment = RECOVERY_CONFIG.TIER0_BACKOFF_INCREMENT_MS;
        const delay = baseDelay + this.stats.tier0Applied * increment;

        log('DEBUG', `[RECOVERY] Tier 0: Cache cleared, waiting ${delay}ms`, correlationId);
        await new Promise(r => setTimeout(r, delay));

        // Page alive check
        this.driver._assertPageAlive();
    }

    /**
     * Executa Tier 1: Focus Recovery (no bringToFront)
     *
     * v2.0 Features:
     * - Timeout protection em mouse.click e window.focus (P3 fix)
     * - Browser connection validation
     * - EventEmitter telemetry
     *
     * @private
     * @param {string} correlationId - Correlation ID
     * @returns {Promise<void>}
     */
    async _executeTier1(correlationId) {
        this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_1_FOCUS_RESTORE' });

        try {
            // Validate browser connected
            if (this.driver.page && !this.driver.page.isClosed()) {
                const browser = this.driver.page.browser();
                if (!browser || !browser.isConnected()) {
                    log('WARN', `[RECOVERY] Browser desconectado - pulando recovery de foco`, correlationId);
                    return;
                }

                // FIXED (P0-1.5): Usa createSharedTimeout para garantir cleanup do AbortController
                // Previne operações órfãs de foco quando timeout vence
                const focusTimeout = RECOVERY_CONFIG.FOCUS_TIMEOUT_MS;
                const { promise: timeoutPromise, cleanup } = createSharedTimeout(focusTimeout, 'FOCUS_TIMEOUT');

                try {
                    // Mouse click at (1,1)
                    await Promise.race([this.driver.page.mouse.click(1, 1), timeoutPromise]);

                    // Window focus
                    await Promise.race([
                        this.driver.page.evaluate(() => window.focus()),
                        timeoutPromise
                    ]);

                    log('DEBUG', '[RECOVERY] Tier 1: Focus restored successfully', correlationId);

                    // ✅ EventEmitter telemetry
                    this.emit(RECOVERY_EVENTS.FOCUS_RESTORED, {
                        timestamp: Date.now(),
                    });
                } finally {
                    cleanup(); // Garantir cleanup do timeout
                }
            } else {
                log('WARN', `[RECOVERY] Página não disponível - pulando recovery de foco`, correlationId);
            }
        } catch (focusErr) {
            log('DEBUG', `[RECOVERY] Tier 1: Focus recovery failed: ${focusErr.message}`, correlationId);

            // ✅ EventEmitter telemetry
            this.emit(RECOVERY_EVENTS.TIER_FAILED, {
                tier: 1,
                error: focusErr.message,
                isTimeout: focusErr.name === 'TimeoutError',
            });
        }

        // Cache invalidation
        this.driver.inputResolver.clearCache();
    }

    /**
     * Executa Tier 2: Hard Page Reload + Stabilizer Wait
     *
     * v2.0 Features:
     * - Timeout protection em reload (P2 fix)
     * - Retry logic (MAX_TIER_RETRIES - P3 fix)
     * - EventEmitter telemetry
     *
     * @private
     * @param {string} correlationId - Correlation ID
     * @returns {Promise<void>}
     */
    async _executeTier2(correlationId) {
        this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_2_PAGE_RELOAD' });

        if (!this.driver.page || this.driver.page.isClosed()) {
            log('WARN', `[RECOVERY] Tier 2: Página não disponível`, correlationId);
            return;
        }

        // ✅ BUG #4 FIX: Timeout protection + BUG #8 FIX: Retry logic
        const reloadTimeout = RECOVERY_CONFIG.RELOAD_TIMEOUT_MS;
        const maxRetries = RECOVERY_CONFIG.MAX_TIER_RETRIES;

        for (let retry = 0; retry < maxRetries; retry++) {
            try {
                log(
                    'WARN',
                    `[RECOVERY] Tier 2: Forçando reload da aba ativa (attempt ${retry + 1}/${maxRetries})...`,
                    correlationId
                );

                // ✅ Timeout wrapper
                await Promise.race([
                    this.driver.page.reload({
                        waitUntil: 'domcontentloaded',
                        timeout: reloadTimeout,
                    }),
                    this._timeout(reloadTimeout, 'page_reload'),
                ]);

                // Stabilizer wait
                await stabilizer.waitForStability(this.driver.page);

                log('DEBUG', `[RECOVERY] Tier 2: Page reloaded successfully`, correlationId);

                // ✅ Phase 2 Integration: Reset sessionTracker após reload
                if (this.driver.sessionTracker && typeof this.driver.sessionTracker.reset === 'function') {
                    this.driver.sessionTracker.reset();
                    log('DEBUG', '[RECOVERY] SessionTracker reset após page reload', correlationId);
                }

                // ✅ EventEmitter telemetry
                this.emit(RECOVERY_EVENTS.PAGE_RELOADED, {
                    attempt: retry + 1,
                    timestamp: Date.now(),
                });

                // ✅ Success - sair do loop
                return;
            } catch (reloadErr) {
                if (retry < maxRetries - 1) {
                    log(
                        'WARN',
                        `[RECOVERY] Tier 2: Reload failed (retry ${retry + 1}/${maxRetries}): ${reloadErr.message}`,
                        correlationId
                    );
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1))); // Backoff
                } else {
                    log(
                        'ERROR',
                        `[RECOVERY] Tier 2: Falha crítica no reload após ${maxRetries} tentativas: ${reloadErr.message}`,
                        correlationId
                    );
                    throw reloadErr; // Max retries
                }
            }
        }
    }

    /**
     * Executa Tier 3: Graceful Disconnect (External Browser Mode)
     *
     * v3.0 Features (External Connection):
     * - Disconnect Puppeteer connection gracefully
     * - Emit user notification (browser needs manual restart)
     * - Escalation to ExecutionEngine
     *
     * Note: Em modo EXTERNAL, browser.process() retorna null.
     * Chrome roda no Windows (user-managed), não pode ser killed remotamente.
     *
     * @private
     * @param {string} correlationId - Correlation ID
     * @param {string} taskId - Task ID
     * @param {Error} recoveryErr - Erro original
     * @returns {Promise<void>}
     * @throws {Error} Always (escalates to ExecutionEngine)
     */
    async _executeTier3(correlationId, taskId, recoveryErr) {
        // IPC telemetry (terminal failure)
        this.driver._emitVital('TRIAGE_ALERT', {
            type: 'TERMINAL_INFRA_FAILURE',
            severity: 'CRITICAL',
            evidence: {
                action: 'CONNECTION_LOST_CRITICAL',
                taskId,
                mode: 'EXTERNAL_BROWSER',
                userAction: 'MANUAL_BROWSER_RESTART_REQUIRED',
            },
        });

        log('FATAL', `[RECOVERY] Tier 3: Critical connection failure - browser may need manual restart`, correlationId);

        const browser = this.driver.page.browser();

        // ✅ v3.0: Internal mode (local/child process) -> try kill with timeout
        const KILL_TIMEOUT = RECOVERY_CONFIG.KILL_TIMEOUT_MS;
        const proc = browser && typeof browser.process === 'function' ? browser.process() : null;

        if (proc && typeof proc.kill === 'function') {
            try {
                log('DEBUG', `[RECOVERY] Tier 3: Killing browser process with timeout=${KILL_TIMEOUT}ms...`, correlationId);

                await Promise.race([
                    new Promise((resolve, reject) => {
                        try {
                            proc.kill('SIGKILL');
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    }),
                    this._timeout(KILL_TIMEOUT, 'browser_kill')
                ]);

                log('DEBUG', `[RECOVERY] Tier 3: Browser process kill issued`, correlationId);
            } catch (killErr) {
                // Importante: kill pode falhar/timeoutar, mas o recovery precisa seguir para escalar.
                log(
                    'WARN',
                    `[RECOVERY] Tier 3: Kill failed/timeout: ${killErr.message}. Continua o fluxo...`,
                    correlationId
                );
            }
        } else {
            // ✅ External/remote mode -> graceful disconnect (browser.process() == null)
            try {
                if (browser && browser.isConnected()) {
                    log('DEBUG', '[RECOVERY] Tier 3: Disconnecting Puppeteer gracefully...', correlationId);
                    await browser.disconnect(); // Graceful disconnect (não close)

                    // ✅ EventEmitter telemetry
                    this.emit(RECOVERY_EVENTS.BROWSER_DISCONNECTED, {
                        mode: 'EXTERNAL',
                        reason: 'TIER3_RECOVERY',
                        timestamp: Date.now(),
                    });

                    log('DEBUG', `[RECOVERY] Tier 3: Browser disconnected successfully`, correlationId);
                } else {
                    log('DEBUG', `[RECOVERY] Tier 3: Browser already disconnected`, correlationId);
                }
            } catch (disconnectErr) {
                log('WARN', `[RECOVERY] Tier 3: Disconnect error: ${disconnectErr.message}`, correlationId);
            }
        }

        // ✅ User notification via NERV
        this.driver._emitVital('USER_NOTIFICATION', {
            type: 'BROWSER_RESTART_REQUIRED',
            severity: 'CRITICAL',
            message: 'Browser connection lost. Please restart Chrome and reconnect.',
            taskId,
        });

        // ✅ Escalate to ExecutionEngine
        throw recoveryErr;
    }

    /* ==========================================================================
       HELPERS
    ========================================================================== */

    /**
     * Helper: Timeout promise wrapper
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para logs)
     * @returns {Promise<never>} Promise que rejeita após timeout
     */
    _timeout(ms, operation) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error(`Timeout in ${operation} after ${ms}ms`);
                error.name = 'TimeoutError';
                reject(error);
            }, ms);
        });
    }

    /* ==========================================================================
       INTROSPECTION
    ========================================================================== */

    /**
     * Obtém estatísticas de recovery.
     *
     * v2.0 Feature (BUG #5 fix)
     *
     * @returns {Object} Stats completas
     *
     * Propriedades do objeto retornado:
     *   - tier0Applied (number): Tier 0 aplicados
     *   - tier1Applied (number): Tier 1 aplicados
     *   - tier2Applied (number): Tier 2 aplicados
     *   - tier3Applied (number): Tier 3 aplicados
     *   - totalRecoveries (number): Total recoveries
     *   - successfulRecoveries (number): Recoveries com sucesso
     *   - failedRecoveries (number): Recoveries falhados
     *   - totalRecoveryDuration (number): Tempo total (ms)
     *   - maxRecoveryDuration (number): Tempo máximo (ms)
     *   - config (Object): Configuração atual (RECOVERY_CONFIG)
     *
     * @example
     * const stats = recovery.getStats();
     * console.log(`Tier 0 applied: ${stats.tier0Applied} times`);
     */
    getStats() {
        return {
            ...this.stats,
            config: { ...RECOVERY_CONFIG },
        };
    }
}

 /**
 * Factory function para criar instância do RecoverySystem
 *
 * **Side-effects:** N/A
 * **Semântica:** Cria nova instância do RecoverySystem associada ao driver fornecido.
 * **Unidades:** N/A
 *
 * @param {object} driver - Instância do driver para sistema de recuperação
 * @returns {RecoverySystem} Nova instância do RecoverySystem
 */
export const create = driver => new RecoverySystem(driver);

/**
 * Classe do sistema de recuperação escalonada
 *
 * **Side-effects:** N/A
 * **Semântica:** Classe principal para implementação de sistema de recuperação de falhas.
 * **Unidades:** N/A
 *
 * @type {Function}
 */
export { RecoverySystem };

/**
 * Configurações do sistema de recuperação
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de timeouts e limites para recuperação de falhas.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, number>}
 */
export { RECOVERY_CONFIG };

/**
 * Eventos emitidos pelo sistema de recuperação
 *
 * **Side-effects:** N/A
 * **Semântica:** Enumeração de eventos para comunicação com sistemas externos.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { RECOVERY_EVENTS };
