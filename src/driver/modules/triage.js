import EventEmitter from 'node:events';
import * as stabilizer from '#shared/page_stability/stabilizer';
import { STATUS_VALUES } from '#core/constants/tasks';
import * as i18n from '#core/i18n';
import { log } from '#core/logger';

/**
 * Configuração do sistema de triage (timeouts, thresholds, limits).
 * 
 * @readonly
 * @enum {number}
 */
const TRIAGE_CONFIG = {
    /** Threshold de event loop lag (ms) - Default: 1500ms */
    LAG_THRESHOLD_MS: parseInt(process.env.TRIAGE_LAG_THRESHOLD || '1500'),
    
    /** Tentativas de retry para lag measurement - Default: 3 */
    LAG_RETRY_ATTEMPTS: parseInt(process.env.TRIAGE_LAG_RETRIES || '3'),
    
    /** Delay entre snapshots para detecção de entropia (ms) - Default: 600ms */
    SNAPSHOT_DELAY_MS: parseInt(process.env.TRIAGE_SNAPSHOT_DELAY || '600'),
    
    /** Máximo de text parts para coleta (limite de memória) - Default: 1000 */
    MAX_TEXT_PARTS: parseInt(process.env.TRIAGE_MAX_TEXT_PARTS || '1000'),
    
    /** Profundidade máxima de scan (Shadow DOM + IFrames) - Default: 15 */
    MAX_SCAN_DEPTH: parseInt(process.env.TRIAGE_MAX_DEPTH || '15'),
    
    /** Timeout total de diagnóstico (ms) - Default: 10s */
    DIAGNOSIS_TIMEOUT_MS: parseInt(process.env.TRIAGE_TIMEOUT || '10000'),
    
    /** Timeout de scan individual (ms) - Default: 5s */
    SCAN_TIMEOUT_MS: parseInt(process.env.TRIAGE_SCAN_TIMEOUT || '5000'),
    
    /** Threshold de cor vermelha (RGB.r) - Default: 180 */
    ERROR_COLOR_RED_THRESHOLD: parseInt(process.env.TRIAGE_RED_THRESHOLD || '180'),
    
    /** Threshold de cor laranja (RGB.r) - Default: 200 */
    ERROR_COLOR_ORANGE_THRESHOLD: parseInt(process.env.TRIAGE_ORANGE_THRESHOLD || '200'),
    
    /** Threshold de tamanho de iframe (% viewport) - Default: 0.4 (40%) */
    IFRAME_SIZE_THRESHOLD: parseFloat(process.env.TRIAGE_IFRAME_THRESHOLD || '0.4')
};

/**
 * Eventos emitidos pelo Triage.
 * 
 * @readonly
 * @enum {string}
 */
const TRIAGE_EVENTS = {
    /** Emitido quando diagnóstico inicia */
    DIAGNOSIS_STARTED: 'triage:diagnosis_started',
    
    /** Emitido quando diagnóstico completa com sucesso */
    DIAGNOSIS_COMPLETED: 'triage:diagnosis_completed',
    
    /** Emitido quando diagnóstico falha */
    DIAGNOSIS_FAILED: 'triage:diagnosis_failed',
    
    /** Emitido quando event loop lag detectado */
    LAG_DETECTED: 'triage:lag_detected',
    
    /** Emitido quando padrão detectado */
    PATTERN_DETECTED: 'triage:pattern_detected',
    
    /** Emitido quando scan inicia */
    SCAN_STARTED: 'triage:scan_started',
    
    /** Emitido quando scan completa */
    SCAN_COMPLETED: 'triage:scan_completed',
    
    /** Emitido quando timeout excedido */
    TIMEOUT_REACHED: 'triage:timeout_reached'
};

/**
 * Classe de erro customizada para diagnóstico de triage.
 * 
 * @extends Error
 */
class TriageError extends Error {
    /**
     * Cria uma instância de TriageError.
     * 
     * @param {string} type - Tipo do erro (TIMEOUT, ABORTED, INVALID_PAGE, SCAN_FAILED, LAG_MEASUREMENT_FAILED)
     * @param {string} message - Mensagem de erro
     * @param {Object} context - Contexto adicional
     */
    constructor(type, message, context) {
        super(message);
        this.name = 'TriageError';
        this.type = type;
        this.context = context;
        this.timestamp = Date.now();
    }
}

/**
 * Triage v2.0 - Instrumented Diagnostic System
 * 
 * Sistema de diagnóstico em tempo real que detecta:
 * - Browser frozen (event loop lag)
 * - CAPTCHA/Cloudflare challenges
 * - Login walls
 * - CORS/CSP barriers
 * - Quota/limit reached
 * - Generic error text
 * - Visual errors (color-based)
 * - Finished abruptly (retry without stop)
 * - Logical loops (spinning without progress)
 * 
 * FEATURES v2.0:
 * - EventEmitter inheritance (8 eventos locais)
 * - TRIAGE_CONFIG (10 keys configuráveis via env vars)
 * - Timeout protection em operações críticas
 * - Metrics tracking (12 counters + 4 derived)
 * - Validação completa de parâmetros
 * - JSDoc 100%
 * - Retry logic para lag measurement
 * - AbortSignal support
 * - getStats() method para introspection
 * - Backward compatibility (diagnoseStall function preserved)
 * 
 * @extends EventEmitter
 * 
 * @example
 * const triage = new Triage(page, 'en');
 * 
 * // Listen to events
 * triage.on(TRIAGE_EVENTS.PATTERN_DETECTED, (data) => {
 *     console.log('Pattern:', data.pattern);
 * });
 * 
 * // Diagnose
 * const result = await triage.diagnose(signal);
 * console.log('Type:', result.type);
 * 
 * // Get metrics
 * const stats = triage.getStats();
 * console.log('Success rate:', stats.successRate);
 */
class Triage extends EventEmitter {
    /**
     * Cria uma instância do Triage.
     * 
     * @param {Object} page - Puppeteer Page instance
     * @param {Function} page.evaluate - Método para executar código no browser
     * @param {string} [langCode='en'] - Código de idioma para análise semântica
     * 
     * @throws {Error} Se page não for fornecido
     * @throws {Error} Se page.evaluate não for uma função
     * @throws {Error} Se langCode não for uma string não-vazia
     * 
     * @example
     * const triage = new Triage(page, 'en');
     */
    constructor(page, langCode = 'en') {
        super(); // EventEmitter constructor
        
        // ✅ Validação completa de parâmetros (BUG #4 fix)
        if (!page) {
            throw new Error('[Triage] Page is required');
        }
        
        if (typeof page.evaluate !== 'function') {
            throw new Error('[Triage] Page must have evaluate method');
        }
        
        if (typeof langCode !== 'string' || langCode.length === 0) {
            throw new Error('[Triage] langCode must be a non-empty string');
        }
        
        this.page = page;
        this.langCode = langCode;
        
        // ✅ Metrics tracking (BUG #3 fix)
        this.stats = {
            // Diagnosis
            totalDiagnoses: 0,
            successfulDiagnoses: 0,
            failedDiagnoses: 0,
            timeoutDiagnoses: 0,
            
            // Patterns (per-pattern counters)
            patternsDetected: {
                BROWSER_FROZEN: 0,
                CAPTCHA_CHALLENGE: 0,
                LOGIN_REQUIRED: 0,
                INFRA_BARRIER_DETECTED: 0,
                LIMIT_REACHED: 0,
                GENERIC_ERROR_TEXT: 0,
                VISUAL_ERROR_DETECTED: 0,
                FINISHED_ABRUPTLY: 0,
                LOGICAL_LOOP: 0
            },
            
            // Timing
            totalDiagnosisTime: 0,
            maxDiagnosisTime: 0,
            totalScanTime: 0,
            
            // Lag
            totalLagMeasurements: 0,
            totalLag: 0,
            maxLag: 0
        };
    }

    /**
     * Mede event loop lag com retry logic.
     * 
     * @private
     * @returns {Promise<number>} Event loop lag em ms
     * @throws {TriageError} Se todas as tentativas falharem
     * 
     * @example
     * const lag = await this._measureLagWithRetry();
     */
    async _measureLagWithRetry() {
        for (let attempt = 0; attempt < TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS; attempt++) {
            try {
                const lag = await stabilizer.measureEventLoopLag(this.page);
                
                this.stats.totalLagMeasurements++;
                this.stats.totalLag += lag;
                this.stats.maxLag = Math.max(this.stats.maxLag, lag);
                
                if (lag > TRIAGE_CONFIG.LAG_THRESHOLD_MS) {
                    this.emit(TRIAGE_EVENTS.LAG_DETECTED, { 
                        lag, 
                        threshold: TRIAGE_CONFIG.LAG_THRESHOLD_MS 
                    });
                }
                
                return lag;
            } catch (err) {
                log('WARN', `[TRIAGE] Lag measurement attempt ${attempt + 1}/${TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS} failed: ${err.message}`);
                
                if (attempt === TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS - 1) {
                    throw new TriageError('LAG_MEASUREMENT_FAILED', err.message, {
                        attempts: TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS,
                        langCode: this.langCode
                    });
                }
                
                // Backoff
                await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
            }
        }
    }

    /**
     * Executa diagnóstico interno (sem timeout wrapper).
     * 
     * @private
     * @param {AbortSignal} signal - AbortSignal para cancelamento
     * @returns {Promise<Object>} Resultado do diagnóstico
     */
    async _executeDiagnosis(signal) {
        // ✅ BUG #7 fix: AbortSignal check
        if (signal?.aborted) {
            throw new TriageError('ABORTED', 'Diagnosis aborted', {
                langCode: this.langCode
            });
        }

        // 1. Verificação de Pulso de CPU (Event Loop Lag)
        const lag = await this._measureLagWithRetry();
        
        // ✅ BUG #9 fix: Config-based threshold
        if (lag > TRIAGE_CONFIG.LAG_THRESHOLD_MS) {
            const result = {
                type: 'BROWSER_FROZEN',
                severity: 'CRITICAL',
                evidence: { lag_ms: lag },
                ts: Date.now()
            };
            
            this.stats.patternsDetected.BROWSER_FROZEN++;
            this.emit(TRIAGE_EVENTS.PATTERN_DETECTED, { 
                pattern: 'BROWSER_FROZEN', 
                result 
            });
            
            return result;
        }

        const errorTerms = await i18n.getTerms('error_indicators', this.langCode);
        const closeTerms = await i18n.getTerms('close_actions', this.langCode);

        this.emit(TRIAGE_EVENTS.SCAN_STARTED, { langCode: this.langCode });
        const scanStartTime = Date.now();

        try {
            const diagnosis = await this.page.evaluate(
                async (errors, closers, config) => {
                    const Probe = {
                        /**
                         * Varredura Consolidada em passagem única (Single-Pass Scan).
                         */
                        scan: (
                            /** @type {Document|ShadowRoot} */ root = document,
                            acc = { textParts: [], nodeCount: 0, hasPassword: false, spinners: [], buttons: [] },
                            depth = 0
                        ) => {
                            if (depth > config.maxScanDepth) {
                                return acc;
                            }
                            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                            let node = walker.currentNode;

                            while (node) {
                                if (node.nodeType === 1) {
                                    acc.nodeCount++;
                                    const tag = node.tagName;

                                    if (tag === 'INPUT' && node.type === 'password') {
                                        acc.hasPassword = true;
                                    }
                                    if (node.matches('.spinner, .loading, [aria-busy="true"]')) {
                                        acc.spinners.push(node);
                                    }
                                    if (tag === 'BUTTON' || node.getAttribute('role') === 'button') {
                                        acc.buttons.push(node);
                                    }

                                    if (acc.textParts.length < config.maxTextParts) {
                                        const text = (node.innerText || '').slice(0, 100);
                                        const attrs =
                                            (node.getAttribute('title') || '') + (node.getAttribute('aria-label') || '');
                                        if (text.length > 2 || attrs.length > 2) {
                                            acc.textParts.push(`${text}:${attrs}`);
                                        }
                                    }

                                    if (node.shadowRoot) {
                                        Probe.scan(node.shadowRoot, acc, depth + 1);
                                    }
                                    if (tag === 'IFRAME') {
                                        try {
                                            if (node.contentDocument) {
                                                Probe.scan(node.contentDocument, acc, depth + 1);
                                            }
                                        } catch {
                                            // Ignore cross-origin iframe access errors
                                        }
                                    }
                                }
                                node = walker.nextNode();
                            }
                            return acc;
                        },

                        /**
                         * Detecta erros visuais (vermelho/laranja) em botões e alertas.
                         */
                        checkVisualError: (buttons, config) => {
                            const candidates = buttons.filter(b =>
                                b.matches('[role="alert"], .error, .warning, [class*="error"]')
                            );
                            for (const el of candidates) {
                                if (!el.isConnected || el.innerText.length < 3) {
                                    continue;
                                }
                                const style = window.getComputedStyle(el);
                                if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
                                    continue;
                                }

                                const parseRGB = str => {
                                    const m = str.match(/\d+/g);
                                    return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
                                };

                                const fg = parseRGB(style.color);
                                const bg = parseRGB(style.backgroundColor);

                                const isAlert = c =>
                                    c &&
                                    ((c.r > config.redThreshold && c.g < 100 && c.b < 100) || // Vermelho
                                        (c.r > config.orangeThreshold && c.g > 100 && c.g < 200 && c.b < 80)); // Laranja

                                if (isAlert(fg) || isAlert(bg)) {
                                    return el.innerText;
                                }
                            }
                            return null;
                        }
                    };

                    // Captura Snapshot 1
                    const snap1 = Probe.scan();
                    const startTime = performance.now();

                    // Intervalo para detecção de entropia (movimento do DOM)
                    await new Promise(r => {
                        setTimeout(r, config.snapshotDelay);
                    });

                    // Captura Snapshot 2
                    const snap2 = Probe.scan();

                    const fullText = snap2.textParts.join('|').toLowerCase();

                    // 2. BLOQUEIOS DE INFRAESTRUTURA / SEGURANÇA
                    if (
                        fullText.includes('cloudflare') ||
                        fullText.includes('captcha') ||
                        document.querySelector('[id*="challenge"]')
                    ) {
                        return { type: 'CAPTCHA_CHALLENGE', severity: 'CRITICAL', evidence: { detector: 'semantic_html' } };
                    }
                    if (snap2.hasPassword) {
                        return { type: 'LOGIN_REQUIRED', severity: 'HIGH', evidence: { detector: 'input_type_password' } };
                    }

                    // 3. BARREIRAS DE RENDERIZAÇÃO
                    const hasMajorBarrier = Array.from(document.querySelectorAll('iframe')).some(f => {
                        try {
                            if (f.contentDocument) {
                                return false;
                            }
                        } catch {
                            const r = f.getBoundingClientRect();
                            return r.width > window.innerWidth * config.iframeSizeThreshold && 
                                   r.height > window.innerHeight * config.iframeSizeThreshold;
                        }
                        return false;
                    });
                    if (hasMajorBarrier && snap2.nodeCount < 50) {
                        return {
                            type: 'INFRA_BARRIER_DETECTED',
                            severity: 'HIGH',
                            evidence: { type: 'cross_origin_iframe' }
                        };
                    }

                    // 4. LIMITES E ERROS SEMÂNTICOS
                    if (['limit', 'limite', 'quota', 'too many'].some(p => fullText.includes(p))) {
                        return { type: 'LIMIT_REACHED', severity: 'HIGH', evidence: { text: 'quota_exhausted' } };
                    }

                    const foundError = errors.find(term => fullText.includes(term.toLowerCase()));
                    if (foundError) {
                        return { type: 'GENERIC_ERROR_TEXT', severity: 'MEDIUM', evidence: { term: foundError } };
                    }

                    // 5. ERRO VISUAL (Cores de Alerta)
                    const visualErrorText = Probe.checkVisualError(snap2.buttons, config);
                    if (visualErrorText) {
                        return {
                            type: 'VISUAL_ERROR_DETECTED',
                            severity: 'MEDIUM',
                            evidence: { text: visualErrorText.slice(0, 100) }
                        };
                    }

                    // 6. FIM ABRUPTO (Botão de Retry sem botão de Stop)
                    const retryBtn = snap2.buttons.find(
                        b => closers.some(c => (b.innerText || '').toLowerCase().includes(c)) && b.offsetParent !== null
                    );
                    const stopBtn = snap2.buttons.find(
                        b =>
                            (b.querySelector('svg rect') || (b.innerText || '').toLowerCase().includes('stop')) &&
                            b.offsetParent !== null
                    );
                    if (retryBtn && !stopBtn) {
                        return { type: 'FINISHED_ABRUPTLY', severity: 'MEDIUM', evidence: { has_retry: true } };
                    }

                    // 7. LOOP LÓGICO (Spinning sem alteração de conteúdo)
                    const semanticChanged = snap1.textParts.join('') !== snap2.textParts.join('');
                    const domMutated = snap1.nodeCount !== snap2.nodeCount;
                    const isSpinning = snap2.spinners.some(s => s.offsetParent !== null);

                    if (!semanticChanged && !domMutated && isSpinning) {
                        return {
                            type: 'LOGICAL_LOOP',
                            severity: 'MEDIUM',
                            evidence: { duration_ms: performance.now() - startTime, is_spinning: true }
                        };
                    }

                    return null;
                },
                errorTerms,
                closeTerms,
                {
                    snapshotDelay: TRIAGE_CONFIG.SNAPSHOT_DELAY_MS,
                    maxTextParts: TRIAGE_CONFIG.MAX_TEXT_PARTS,
                    maxScanDepth: TRIAGE_CONFIG.MAX_SCAN_DEPTH,
                    redThreshold: TRIAGE_CONFIG.ERROR_COLOR_RED_THRESHOLD,
                    orangeThreshold: TRIAGE_CONFIG.ERROR_COLOR_ORANGE_THRESHOLD,
                    iframeSizeThreshold: TRIAGE_CONFIG.IFRAME_SIZE_THRESHOLD
                }
            );

            const scanDuration = Date.now() - scanStartTime;
            this.stats.totalScanTime += scanDuration;
            
            this.emit(TRIAGE_EVENTS.SCAN_COMPLETED, { 
                duration: scanDuration,
                langCode: this.langCode 
            });

            // Retorna o diagnóstico encontrado ou um objeto de "Saúde OK"
            const result = diagnosis || { type: STATUS_VALUES.HEALTHY, severity: 'NONE', ts: Date.now() };
            
            // Track pattern detection
            if (diagnosis && Object.hasOwn(this.stats.patternsDetected, diagnosis.type)) {
                this.stats.patternsDetected[diagnosis.type]++;
                this.emit(TRIAGE_EVENTS.PATTERN_DETECTED, { 
                    pattern: diagnosis.type, 
                    result 
                });
            }
            
            return result;
        } catch (e) {
            log('ERROR', `[TRIAGE] Falha na autópsia V2: ${e.message}`);

            throw new TriageError('SCAN_FAILED', e.message, {
                langCode: this.langCode,
                originalError: e.message
            });
        }
    }

    /**
     * Realiza diagnóstico profundo de travamento/anomalias na página.
     * 
     * Detecta 9 padrões de falhas:
     * 1. BROWSER_FROZEN (event loop lag > threshold)
     * 2. CAPTCHA_CHALLENGE (Cloudflare/captcha)
     * 3. LOGIN_REQUIRED (password input)
     * 4. INFRA_BARRIER_DETECTED (CORS/CSP iframe)
     * 5. LIMIT_REACHED (quota exceeded)
     * 6. GENERIC_ERROR_TEXT (error terms)
     * 7. VISUAL_ERROR_DETECTED (red/orange colors)
     * 8. FINISHED_ABRUPTLY (retry without stop)
     * 9. LOGICAL_LOOP (spinning without progress)
     * 
     * @param {AbortSignal} [signal] - AbortSignal para cancelamento
     * @returns {Promise<Object>} Diagnóstico estruturado
     * Propriedades do objeto retornado:
     *   - type (string): Tipo de diagnóstico
     *   - severity (string): Severidade (CRITICAL, HIGH, MEDIUM, NONE)
     *   - evidence (Object): Evidências coletadas
     *   - ts (number): Timestamp
     * 
     * @throws {TriageError} Se diagnóstico abortado (type: ABORTED)
     * @throws {TriageError} Se timeout exceder (type: TIMEOUT)
     * @throws {TriageError} Se scan falhar (type: SCAN_FAILED)
     * @throws {TriageError} Se lag measurement falhar (type: LAG_MEASUREMENT_FAILED)
     * 
     * @emits TRIAGE_EVENTS.DIAGNOSIS_STARTED
     * @emits TRIAGE_EVENTS.LAG_DETECTED
     * @emits TRIAGE_EVENTS.PATTERN_DETECTED
     * @emits TRIAGE_EVENTS.SCAN_STARTED
     * @emits TRIAGE_EVENTS.SCAN_COMPLETED
     * @emits TRIAGE_EVENTS.DIAGNOSIS_COMPLETED
     * @emits TRIAGE_EVENTS.DIAGNOSIS_FAILED
     * @emits TRIAGE_EVENTS.TIMEOUT_REACHED
     * 
     * @example
     * const triage = new Triage(page, 'en');
     * 
     * // Listen to events
     * triage.on('triage:pattern_detected', (data) => {
     *     console.log('Pattern:', data.pattern);
     * });
     * 
     * // Diagnose with AbortSignal
     * const controller = new AbortController();
     * const result = await triage.diagnose(controller.signal);
     * 
     * if (result.type === 'BROWSER_FROZEN') {
     *     console.log('Browser frozen with lag:', result.evidence.lag_ms);
     * }
     */
    async diagnose(signal) {
        this.emit(TRIAGE_EVENTS.DIAGNOSIS_STARTED, { 
            langCode: this.langCode 
        });
        
        this.stats.totalDiagnoses++;
        const startTime = Date.now();
        
        try {
            // ✅ BUG #5 fix: Timeout protection
            const result = await Promise.race([
                this._executeDiagnosis(signal),
                this._timeout(TRIAGE_CONFIG.DIAGNOSIS_TIMEOUT_MS, 'diagnose')
            ]);
            
            const duration = Date.now() - startTime;
            this.stats.totalDiagnosisTime += duration;
            this.stats.maxDiagnosisTime = Math.max(this.stats.maxDiagnosisTime, duration);
            this.stats.successfulDiagnoses++;
            
            this.emit(TRIAGE_EVENTS.DIAGNOSIS_COMPLETED, {
                result,
                duration,
                langCode: this.langCode
            });
            
            return result;
        } catch (err) {
            this.stats.failedDiagnoses++;
            
            if (err.type === 'TIMEOUT') {
                this.stats.timeoutDiagnoses++;
                this.emit(TRIAGE_EVENTS.TIMEOUT_REACHED, { 
                    timeout: err.context.timeout 
                });
            }
            
            this.emit(TRIAGE_EVENTS.DIAGNOSIS_FAILED, { 
                error: err.message,
                type: err.type || 'UNKNOWN',
                langCode: this.langCode
            });
            
            throw err;
        }
    }
    
    /**
     * Retorna estatísticas de diagnóstico.
     * 
     * @returns {Object} Objeto com métricas de diagnóstico
     * Propriedades do objeto retornado:
     *   - totalDiagnoses (number): Total de diagnósticos
     *   - successfulDiagnoses (number): Diagnósticos bem-sucedidos
     *   - failedDiagnoses (number): Diagnósticos que falharam
     *   - timeoutDiagnoses (number): Diagnósticos com timeout
     *   - patternsDetected (Object): Contadores por padrão
     *   - totalDiagnosisTime (number): Tempo total (ms)
     *   - maxDiagnosisTime (number): Tempo máximo (ms)
     *   - totalScanTime (number): Tempo total de scan (ms)
     *   - totalLagMeasurements (number): Total de medições de lag
     *   - totalLag (number): Lag total acumulado (ms)
     *   - maxLag (number): Lag máximo (ms)
     *   - avgDiagnosisTime (string): Tempo médio de diagnóstico
     *   - successRate (string): Taxa de sucesso (%)
     *   - avgLag (string): Lag médio
     *   - mostCommonPattern (string): Padrão mais comum
     *   - config (Object): Configuração atual (TRIAGE_CONFIG)
     * 
     * @example
     * const stats = triage.getStats();
     * console.log('Success rate:', stats.successRate);
     * console.log('Most common pattern:', stats.mostCommonPattern);
     * console.log('Avg lag:', stats.avgLag);
     */
    getStats() {
        // Find most common pattern
        let mostCommonPattern = 'NONE';
        let maxCount = 0;
        
        for (const [pattern, count] of Object.entries(this.stats.patternsDetected)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommonPattern = pattern;
            }
        }
        
        return {
            ...this.stats,
            avgDiagnosisTime: this.stats.totalDiagnoses > 0
                ? (this.stats.totalDiagnosisTime / this.stats.totalDiagnoses).toFixed(2) + 'ms'
                : '0ms',
            successRate: this.stats.totalDiagnoses > 0
                ? ((this.stats.successfulDiagnoses / this.stats.totalDiagnoses) * 100).toFixed(2) + '%'
                : '0%',
            avgLag: this.stats.totalLagMeasurements > 0
                ? (this.stats.totalLag / this.stats.totalLagMeasurements).toFixed(2) + 'ms'
                : '0ms',
            mostCommonPattern,
            config: { ...TRIAGE_CONFIG }
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
                const error = new TriageError('TIMEOUT', `Timeout in ${operation} after ${ms}ms`, {
                    timeout: ms,
                    operation
                });
                reject(error);
            }, ms);
        });
    }
}

/**
 * Factory function para criar instância de Triage.
 * 
 * @param {Object} page - Puppeteer page instance
 * @param {string} [langCode='en'] - Código de idioma
 * @returns {Triage} Nova instância
 * 
 * @example
 * const { create } = require('./triage');
 * const triage = create(page, 'en');
 */
function create(page, langCode = 'en') {
    return new Triage(page, langCode);
}

/**
 * Legacy function para backward compatibility.
 * 
 * Preserva a API original v1.x (function export).
 * 
 * @param {Object} page - Puppeteer Page instance
 * @param {string} [langCode='en'] - Código de idioma
 * @returns {Promise<Object>} Resultado do diagnóstico
 * 
 * @deprecated Use new Triage(page, langCode).diagnose() instead
 * 
 * @example
 * // Legacy API (v1.x)
 * const { diagnoseStall } = require('./triage');
 * const result = await diagnoseStall(page, 'en');
 */
async function diagnoseStall(page, langCode = 'en') {
    const triage = new Triage(page, langCode);
    return await triage.diagnose();
}

export { Triage, TRIAGE_CONFIG, TRIAGE_EVENTS, TriageError, create, diagnoseStall };
