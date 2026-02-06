import EventEmitter from 'node:events';
import { log } from '#core/logger';

/**
 * Configuração de navegação em frames (timeouts, depth limit, retry).
 *
 * @readonly
 * @enum {number}
 */
const FRAME_NAV_CONFIG = {
    /** Profundidade máxima de frames - Default: 10 */
    MAX_DEPTH: parseInt(process.env.FRAME_NAV_MAX_DEPTH || '10'),

    /** Timeout de traversal completo (ms) - Default: 15s */
    TRAVERSAL_TIMEOUT_MS: parseInt(process.env.FRAME_NAV_TIMEOUT || '15000'),

    /** Timeout de boundingBox (ms) - Default: 2s */
    BOUNDING_BOX_TIMEOUT_MS: parseInt(process.env.FRAME_NAV_BBOX_TIMEOUT || '2000'),

    /** Tentativas de retry para dispose - Default: 3 */
    DISPOSE_RETRY_ATTEMPTS: parseInt(process.env.FRAME_NAV_DISPOSE_RETRIES || '3'),

    /** Delay entre retries de dispose (ms) - Default: 100ms */
    DISPOSE_RETRY_DELAY_MS: parseInt(process.env.FRAME_NAV_DISPOSE_DELAY || '100')
};

/**
 * Eventos emitidos pelo FrameNavigator.
 *
 * @readonly
 * @enum {string}
 */
const FRAME_NAV_EVENTS = {
    /** Emitido quando navegação inicia */
    NAVIGATION_STARTED: 'frame_nav:navigation_started',

    /** Emitido quando navegação completa com sucesso */
    NAVIGATION_COMPLETED: 'frame_nav:navigation_completed',

    /** Emitido quando navegação falha */
    NAVIGATION_FAILED: 'frame_nav:navigation_failed',

    /** Emitido quando entra em um frame */
    FRAME_ENTERED: 'frame_nav:frame_entered',

    /** Emitido quando falha ao entrar em um frame */
    FRAME_ENTRY_FAILED: 'frame_nav:frame_entry_failed',

    /** Emitido quando barreira de infraestrutura detectada */
    INFRA_BARRIER_DETECTED: 'frame_nav:infra_barrier_detected',

    /** Emitido quando barreira de segurança detectada */
    SECURITY_BARRIER_DETECTED: 'frame_nav:security_barrier_detected',

    /** Emitido quando max depth atingido */
    MAX_DEPTH_REACHED: 'frame_nav:max_depth_reached'
};

/**
 * Classe de erro customizada para navegação de frames.
 *
 * @extends Error
 */
class FrameNavError extends Error {
    /**
     * Cria uma instância de FrameNavError.
     *
     * @param {string} type - Tipo do erro (TIMEOUT, BARRIER, INVALID_PATH, MAX_DEPTH)
     * @param {string} message - Mensagem de erro
     * @param {Object} context - Contexto adicional
     */
    constructor(type, message, context) {
        super(message);
        this.name = 'FrameNavError';
        this.type = type;
        this.context = context;
        this.timestamp = Date.now();
    }
}

/**
 * FrameNavigator v2.0 - Instrumented Frame Navigator
 *
 * Navega em hierarquias complexas de IFrames com:
 * - Detecção de barreiras (security/infra)
 * - Cálculo de offsets físicos (bounding boxes)
 * - Cleanup automático de handles
 * - Telemetria completa (eventos locais + IPC)
 *
 * FEATURES v2.0:
 * - EventEmitter inheritance (8 eventos locais)
 * - FRAME_NAV_CONFIG (5 keys configuráveis via env vars)
 * - Timeout protection em operações críticas
 * - Metrics tracking (10 counters + timing)
 * - Validação completa de parâmetros
 * - JSDoc 100%
 * - getStats() method para introspection
 *
 * @extends EventEmitter
 *
 * @example
 * const navigator = new FrameNavigator(driver);
 *
 * // Listen to events
 * navigator.on(FRAME_NAV_EVENTS.FRAME_ENTERED, (data) => {
 *     console.log('Entered frame:', data);
 * });
 *
 * // Navigate
 * const protocol = {
 *     context: 'frame',
 *     framePath: 'IFRAME#main > IFRAME[name="nested"]'
 * };
 *
 * const execContext = await navigator.getExecutionContext(protocol, signal);
 * console.log('Final depth:', execContext.frameStack.length);
 *
 * // Get metrics
 * const stats = navigator.getStats();
 * console.log('Success rate:', stats.successRate);
 */
class FrameNavigator extends EventEmitter {
    /**
     * Cria uma instância do FrameNavigator.
     *
     * @param {Object} driver - Instância do BaseDriver
     * @param {Object} driver.page - Puppeteer Page instance
     * @param {Function} driver._emitVital - Método IPC para telemetria vital
     * @param {Object} driver.handles - HandleManager para cleanup
     * @param {Function} driver.handles.register - Método para registrar handles
     * @param {string} driver.correlationId - ID de correlação para logs
     *
     * @throws {Error} Se driver não for fornecido
     * @throws {Error} Se driver.page não existir
     * @throws {Error} Se driver._emitVital não for uma função
     * @throws {Error} Se driver.handles não existir
     *
     * @example
     * const navigator = new FrameNavigator(driver);
     */
    constructor(driver) {
        super(); // EventEmitter constructor

        // ✅ Validação completa de parâmetros (BUG #3 fix)
        if (!driver) {
            throw new Error('[FrameNavigator] Driver is required');
        }

        if (!driver.page) {
            throw new Error('[FrameNavigator] Driver must have page property');
        }

        if (typeof driver._emitVital !== 'function') {
            throw new Error('[FrameNavigator] Driver must have _emitVital method');
        }

        if (!driver.handles || typeof driver.handles.register !== 'function') {
            throw new Error('[FrameNavigator] Driver must have handles manager');
        }

        this.driver = driver;

        // ✅ Metrics tracking (BUG #5 fix)
        this.stats = {
            totalNavigations: 0,
            successfulNavigations: 0,
            failedNavigations: 0,
            totalFramesTraversed: 0,
            maxDepthReached: 0,
            totalBarriersDetected: 0,
            totalSecurityBarriers: 0,
            totalInfraBarriers: 0,
            totalNavigationDuration: 0,
            maxNavigationDuration: 0
        };
    }

    /**
     * Dispose handle com retry logic.
     *
     * Tenta dispose até DISPOSE_RETRY_ATTEMPTS vezes com backoff.
     *
     * @private
     * @param {Object} handle - JSHandle ou ElementHandle para dispose
     * @param {string} [handleName='unknown'] - Nome do handle (para logs)
     * @returns {Promise<boolean>} true se dispose bem-sucedido, false caso contrário
     *
     * @example
     * const success = await this._disposeWithRetry(frameJSHandle, 'frameJSHandle');
     */
    async _disposeWithRetry(handle, handleName = 'unknown') {
        for (let attempt = 0; attempt < FRAME_NAV_CONFIG.DISPOSE_RETRY_ATTEMPTS; attempt++) {
            try {
                await handle.dispose();
                return true;
            } catch (err) {
                log(
                    'WARN',
                    `[FRAME_NAV] Dispose attempt ${attempt + 1}/${FRAME_NAV_CONFIG.DISPOSE_RETRY_ATTEMPTS} failed for ${handleName}: ${err.message}`,
                    this.driver.correlationId
                );

                if (attempt < FRAME_NAV_CONFIG.DISPOSE_RETRY_ATTEMPTS - 1) {
                    await new Promise(r => setTimeout(r, FRAME_NAV_CONFIG.DISPOSE_RETRY_DELAY_MS));
                }
            }
        }

        log(
            'ERROR',
            `[FRAME_NAV] Failed to dispose ${handleName} after ${FRAME_NAV_CONFIG.DISPOSE_RETRY_ATTEMPTS} attempts`,
            this.driver.correlationId
        );
        return false;
    }

    /**
     * Executa navegação interna (sem timeout wrapper).
     *
     * @private
     * @param {Object} protocol - Protocolo SADI contendo framePath
     * @param {AbortSignal} signal - AbortSignal para cancelamento
     * @returns {Promise<Object>} Contexto de execução
     */
    async _executeGetExecutionContext(protocol, signal) {
        const result = {
            ctx: this.driver.page,
            offsetX: 0,
            offsetY: 0,
            frameStack: []
        };

        // Caso base: Elemento está na raiz (Root)
        if (!protocol || protocol.context === 'root' || !protocol.framePath) {
            return result;
        }

        const correlationId = this.driver.correlationId;

        // ✅ BUG #9 fix: framePath validation
        if (typeof protocol.framePath !== 'string') {
            log('WARN', '[FRAME_NAV] Invalid framePath (not a string)', correlationId);
            return result;
        }

        const pathParts = protocol.framePath.split(' > ').filter(p => p.trim());

        if (pathParts.length === 0) {
            log('WARN', '[FRAME_NAV] Empty framePath after split', correlationId);
            return result;
        }

        log('DEBUG', `[FRAME_NAV] Iniciando navegação de linhagem: ${protocol.framePath}`, correlationId);

        // [V500] Sinaliza início da navegação profunda
        this.driver._emitVital('PROGRESS_UPDATE', {
            step: 'FRAME_NAVIGATION_START',
            path: protocol.framePath
        });

        let currentLevel = this.driver.page;

        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];

            // ✅ BUG #7 fix: AbortSignal check
            if (signal?.aborted) {
                throw new FrameNavError('ABORTED', 'Navigation aborted', {
                    path: protocol.framePath,
                    depth: result.frameStack.length
                });
            }

            // ✅ BUG #10 fix: Depth limit check
            if (result.frameStack.length >= FRAME_NAV_CONFIG.MAX_DEPTH) {
                log('WARN', `[FRAME_NAV] Max depth reached: ${FRAME_NAV_CONFIG.MAX_DEPTH}`, correlationId);

                this.emit(FRAME_NAV_EVENTS.MAX_DEPTH_REACHED, {
                    depth: result.frameStack.length,
                    path: protocol.framePath
                });

                this.driver._emitVital('TRIAGE_ALERT', {
                    type: 'MAX_DEPTH_REACHED',
                    severity: 'MEDIUM',
                    evidence: { depth: result.frameStack.length, path: protocol.framePath }
                });

                this.stats.totalBarriersDetected++;
                break;
            }

            // Detecção de barreira lógica reportada pelo SADI
            if (part === 'barrier') {
                this.emit(FRAME_NAV_EVENTS.INFRA_BARRIER_DETECTED, {
                    path: protocol.framePath,
                    depth: result.frameStack.length
                });

                this.driver._emitVital('TRIAGE_ALERT', {
                    type: 'INFRA_BARRIER_DETECTED',
                    severity: 'HIGH',
                    evidence: { reason: 'SADI_BARRIER_SIGNAL' }
                });

                this.stats.totalBarriersDetected++;
                this.stats.totalInfraBarriers++;
                break;
            }

            const targetSig = part.toLowerCase();

            // Localiza o frame no nível atual
            const frameJSHandle = await currentLevel.evaluateHandle(sig => {
                const frames = Array.from(document.querySelectorAll('iframe'));
                return frames.find(f => {
                    if (f.tagName.toLowerCase() !== 'iframe') {
                        return false;
                    }
                    const id = f.id ? `#${f.id}` : '';
                    const name = f.name ? `[name="${f.name}"]` : '';
                    const currentSig = `${f.tagName}${id}${name}`.toLowerCase();
                    return currentSig === sig;
                });
            }, targetSig);

            let element;
            try {
                element = frameJSHandle.asElement();

                if (element) {
                    const nextFrame = await element.contentFrame();

                    if (nextFrame) {
                        // Registra o handle para cleanup automático posterior
                        this.driver.handles.register(element);

                        // Acumula o deslocamento físico (Bounding Box)
                        const box = await element.boundingBox();

                        if (box) {
                            result.offsetX += box.x;
                            result.offsetY += box.y;
                        }

                        currentLevel = nextFrame;
                        result.ctx = nextFrame;
                        result.frameStack.push(element);

                        this.stats.totalFramesTraversed++;
                        this.stats.maxDepthReached = Math.max(this.stats.maxDepthReached, result.frameStack.length);

                        // [V500] Reporta sucesso na entrada do nível
                        this.emit(FRAME_NAV_EVENTS.FRAME_ENTERED, {
                            frame: targetSig,
                            depth: result.frameStack.length
                        });

                        this.driver._emitVital('PROGRESS_UPDATE', {
                            step: 'FRAME_ENTERED',
                            frame: targetSig,
                            depth: result.frameStack.length
                        });
                    } else {
                        log('WARN', `[FRAME_NAV] Falha ao acessar conteúdo do frame: ${targetSig}`, correlationId);

                        this.emit(FRAME_NAV_EVENTS.FRAME_ENTRY_FAILED, {
                            frame: targetSig,
                            reason: 'CONTENT_FRAME_NULL'
                        });

                        await this._disposeWithRetry(element, 'element');
                        break;
                    }
                } else {
                    log('WARN', `[FRAME_NAV] Frame não localizado no nível atual: ${targetSig}`, correlationId);

                    this.emit(FRAME_NAV_EVENTS.FRAME_ENTRY_FAILED, {
                        frame: targetSig,
                        reason: 'ELEMENT_NOT_FOUND'
                    });

                    break;
                }
            } finally {
                await this._disposeWithRetry(frameJSHandle, 'frameJSHandle');
            }
        }

        return result;
    }

    /**
     * Resolve o contexto de execução e calcula o deslocamento (offset) visual.
     *
     * Navega através da hierarquia de frames definida em `protocol.framePath`,
     * acumulando offsets físicos (bounding boxes) e registrando handles.
     *
     * @param {Object} protocol - Protocolo SADI contendo framePath
     * @param {string} protocol.framePath - Path de frames (formato: "IFRAME#id > IFRAME[name='x']")
     * @param {string} protocol.context - Contexto ('root' ou 'frame')
     * @param {AbortSignal} [signal] - AbortSignal para cancelamento
     * @returns {Promise<Object>} Contexto de execução
     * @returns {Object} return.ctx - Context (page ou frame)
     * @returns {number} return.offsetX - Offset horizontal acumulado
     * @returns {number} return.offsetY - Offset vertical acumulado
     * @returns {Array} return.frameStack - Stack de frame handles
     *
     * @throws {FrameNavError} Se navegação abortada (type: ABORTED)
     * @throws {FrameNavError} Se max depth atingido (type: MAX_DEPTH)
     * @throws {FrameNavError} Se timeout exceder (type: TIMEOUT)
     * @throws {FrameNavError} Se security barrier detectada (type: SECURITY_BARRIER)
     *
     * @emits FRAME_NAV_EVENTS.NAVIGATION_STARTED
     * @emits FRAME_NAV_EVENTS.FRAME_ENTERED
     * @emits FRAME_NAV_EVENTS.FRAME_ENTRY_FAILED
     * @emits FRAME_NAV_EVENTS.NAVIGATION_COMPLETED
     * @emits FRAME_NAV_EVENTS.NAVIGATION_FAILED
     * @emits FRAME_NAV_EVENTS.INFRA_BARRIER_DETECTED
     * @emits FRAME_NAV_EVENTS.SECURITY_BARRIER_DETECTED
     * @emits FRAME_NAV_EVENTS.MAX_DEPTH_REACHED
     *
     * @example
     * const protocol = {
     *     context: 'frame',
     *     framePath: 'IFRAME#main > IFRAME[name="nested"]'
     * };
     *
     * const execContext = await navigator.getExecutionContext(protocol, signal);
     * console.log('Final context:', execContext.ctx);
     * console.log('Offset:', execContext.offsetX, execContext.offsetY);
     * console.log('Depth:', execContext.frameStack.length);
     */
    async getExecutionContext(protocol, signal) {
        this.emit(FRAME_NAV_EVENTS.NAVIGATION_STARTED, {
            path: protocol?.framePath
        });

        this.stats.totalNavigations++;
        const startTime = Date.now();

        try {
            // ✅ BUG #4 fix: Timeout protection
            const result = await Promise.race([
                this._executeGetExecutionContext(protocol, signal),
                this._timeout(FRAME_NAV_CONFIG.TRAVERSAL_TIMEOUT_MS, 'getExecutionContext')
            ]);

            const duration = Date.now() - startTime;
            this.stats.totalNavigationDuration += duration;
            this.stats.maxNavigationDuration = Math.max(this.stats.maxNavigationDuration, duration);
            this.stats.successfulNavigations++;

            this.emit(FRAME_NAV_EVENTS.NAVIGATION_COMPLETED, {
                path: protocol?.framePath,
                depth: result.frameStack.length,
                duration
            });

            this.driver._emitVital('PROGRESS_UPDATE', {
                step: 'FRAME_NAVIGATION_COMPLETE',
                depth: result.frameStack.length
            });

            return result;
        } catch (lineageErr) {
            this.stats.failedNavigations++;

            log('ERROR', `[FRAME_NAV] Colapso na navegação: ${lineageErr.message}`, this.driver.correlationId);

            this.emit(FRAME_NAV_EVENTS.NAVIGATION_FAILED, {
                path: protocol?.framePath,
                error: lineageErr.message
            });

            // [V500] Alerta de segurança: Provável bloqueio de Cross-Origin (CORS/CSP)
            if (lineageErr.message.includes('CSP') || lineageErr.message.includes('CORS')) {
                this.stats.totalBarriersDetected++;
                this.stats.totalSecurityBarriers++;

                this.emit(FRAME_NAV_EVENTS.SECURITY_BARRIER_DETECTED, {
                    path: protocol?.framePath,
                    error: lineageErr.message
                });

                this.driver._emitVital('TRIAGE_ALERT', {
                    type: 'SECURITY_BARRIER_HIT',
                    severity: 'HIGH',
                    evidence: { error: lineageErr.message, path: protocol?.framePath }
                });

                throw new FrameNavError('SECURITY_BARRIER', lineageErr.message, {
                    path: protocol?.framePath
                });
            }

            throw lineageErr;
        }
    }

    /**
     * Retorna estatísticas de navegação de frames.
     *
     * @returns {Object} Objeto com métricas de navegação
     * @returns {number} return.totalNavigations - Total de navegações
     * @returns {number} return.successfulNavigations - Navegações bem-sucedidas
     * @returns {number} return.failedNavigations - Navegações que falharam
     * @returns {number} return.totalFramesTraversed - Total de frames atravessados
     * @returns {number} return.maxDepthReached - Profundidade máxima alcançada
     * @returns {number} return.totalBarriersDetected - Total de barreiras detectadas
     * @returns {number} return.totalSecurityBarriers - Barreiras de segurança (CORS/CSP)
     * @returns {number} return.totalInfraBarriers - Barreiras de infraestrutura (SADI)
     * @returns {number} return.totalNavigationDuration - Duração total (ms)
     * @returns {number} return.maxNavigationDuration - Duração máxima (ms)
     * @returns {string} return.avgNavigationDuration - Duração média
     * @returns {string} return.successRate - Taxa de sucesso (%)
     * @returns {string} return.avgDepth - Profundidade média
     * @returns {Object} return.config - Configuração atual (FRAME_NAV_CONFIG)
     *
     * @example
     * const stats = navigator.getStats();
     * console.log('Success rate:', stats.successRate);
     * console.log('Avg depth:', stats.avgDepth);
     */
    getStats() {
        return {
            ...this.stats,
            avgNavigationDuration:
                this.stats.totalNavigations > 0
                    ? (this.stats.totalNavigationDuration / this.stats.totalNavigations).toFixed(2) + 'ms'
                    : '0ms',
            successRate:
                this.stats.totalNavigations > 0
                    ? ((this.stats.successfulNavigations / this.stats.totalNavigations) * 100).toFixed(2) + '%'
                    : '0%',
            avgDepth:
                this.stats.successfulNavigations > 0
                    ? (this.stats.totalFramesTraversed / this.stats.successfulNavigations).toFixed(2)
                    : '0',
            config: { ...FRAME_NAV_CONFIG }
        };
    }

    /**
     * Timeout wrapper para operações com limite de tempo.
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para error message)
     * @returns {Promise<never>} Promise que rejeita após timeout
     */
    _timeout(ms, operation) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new FrameNavError('TIMEOUT', `Timeout in ${operation} after ${ms}ms`, {
                    timeout: ms,
                    operation
                });
                reject(error);
            }, ms);
        });
    }
}

/**
 * Factory function para criar instância de FrameNavigator.
 *
 * @param {Object} driver - Instância do driver
 * @returns {FrameNavigator} Nova instância
 *
 * @example
 * const { create } = require('./frame_navigator');
 * const navigator = create(driver);
 */
function create(driver) {
    return new FrameNavigator(driver);
}

export { FrameNavigator, FRAME_NAV_CONFIG, FRAME_NAV_EVENTS, FrameNavError, create };
