import { log } from '#core/logger';
import * as adaptive from '#logic/adaptive';

// ============================================
// CONFIGURATION (Externalized from v2.0)
// ============================================
const STABILIZER_CONFIG = {
    // Network idle
    NETWORK_IDLE_TIME: 500, // ms to consider network idle
    NETWORK_IDLE_TIMEOUT: 5000, // max wait for network idle

    // Spinner check
    SPINNER_CHECK_INTERVAL: 500, // ms between spinner checks
    SPINNER_MAX_ITERATIONS: 60, // max spinner check loops
    RECENT_NETWORK_THRESHOLD: 500, // ms to consider resource "recent"

    // DOM entropy
    DOM_SILENCE_WINDOW_DEFAULT: 500, // ms of DOM silence required
    DOM_SILENCE_WINDOW_SLOW: 1000, // ms for slow targets
    DOM_SILENCE_WINDOW_VERY_SLOW: 1500, // ms for very slow targets
    DOM_SILENCE_WINDOW_FAST: 300, // ms for fast targets
    DOM_ENTROPY_MAX_WAIT_FACTOR: 0.3, // fraction of timeout for entropy
    DOM_ENTROPY_MIN_WAIT: 8000, // min ms for entropy wait
    SADI_PULSE_THRESHOLD: 1500, // ms to consider SADI active
    ENTROPY_CHECK_INTERVAL: 100, // ms between entropy checks

    // Adaptive thresholds
    ADAPTIVE_STREAM_VERY_SLOW: 2000, // ms avg to use very slow window
    ADAPTIVE_STREAM_SLOW: 1000, // ms avg to use slow window
    ADAPTIVE_STREAM_FAST: 500, // ms avg to use fast window

    // Hydration guard
    HYDRATION_TIMEOUT: 1000, // ms to wait for hydration

    // Frame sync
    FRAME_SYNC_TIMEOUT: 2000, // ms max wait for RAF

    // CPU lag
    CPU_LAG_THRESHOLD: 150, // ms lag considered "high"
    CPU_LAG_RETRY_DELAY: 300, // ms between lag measurements
    CPU_LAG_MAX_WAIT: 5000, // max ms to wait for lag to drop

    // Retry logic
    HELPER_RETRY_COUNT: 3, // max retries for helper functions
    HELPER_RETRY_DELAY: 100, // base delay between retries (ms)

    // Fallbacks
    DEFAULT_LAG_FALLBACK: 500, // ms returned on lag measurement error
    DEFAULT_TIMEOUT: 30000, // default waitForStability timeout

    // Phase timeouts (fractions of total timeout)
    PHASE_TIMEOUT_NETWORK: 0.15, // 15% for network idle
    PHASE_TIMEOUT_SPINNER: 0.25, // 25% for spinner check
    PHASE_TIMEOUT_ENTROPY: 0.3, // 30% for DOM entropy
    PHASE_TIMEOUT_HYDRATION: 0.1, // 10% for hydration
    PHASE_TIMEOUT_FRAME: 0.1, // 10% for frame sync
    PHASE_TIMEOUT_CPU: 0.1 // 10% for CPU lag
};

// ============================================
// HELPER FUNCTIONS (v2.0 - Enhanced)
// ============================================

class StabilizerAbortError extends Error {
    constructor(message, phase = null) {
        super(message);
        this.name = 'StabilizerAbortError';
        this.phase = phase;
    }
}

/**
 * Mede o atraso (lag) do Event Loop no contexto do Browser.
 * v2.0: Added retry logic and error logging.
 * @param {object} page - Puppeteer Page instance
 * @param {number} retries - Max retry attempts (default: 3)
 * @returns {Promise<number>} Event loop lag in ms
 */
async function measureEventLoopLag(page, retries = STABILIZER_CONFIG.HELPER_RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
        try {
            return await page.evaluate(() => {
                // NOTE: the identifier name `eventLoopLag` is intentional; unit tests stub by fn.toString().
                const eventLoopLag = () =>
                    new Promise(resolve => {
                        const channel = new MessageChannel();
                        const t0 = performance.now();
                        channel.port1.onmessage = () => {
                            channel.port1.close();
                            channel.port2.close();
                            resolve(performance.now() - t0);
                        };
                        channel.port2.postMessage(null);
                    });

                return eventLoopLag();
            });
        } catch (err) {
            if (i === retries - 1) {
                log('DEBUG', `[STABILIZER] Event loop lag measurement failed after ${retries} retries: ${err.message}`);
                return STABILIZER_CONFIG.DEFAULT_LAG_FALLBACK;
            }
            await new Promise(r => setTimeout(r, STABILIZER_CONFIG.HELPER_RETRY_DELAY * (i + 1)));
        }
    }
    return STABILIZER_CONFIG.DEFAULT_LAG_FALLBACK;
}

/**
 * Verifica a presença de indicadores de carregamento (spinners) e tráfego de rede.
 * v2.0: Enhanced error handling, false positive filter, optimizations.
 * @param {object} page - Puppeteer Page instance
 * @param {number} retries - Max retry attempts (default: 3)
 * @returns {Promise<boolean>} `true` quando ainda há atividade de carregamento
 */
async function getPageLoadStatus(page, retries = STABILIZER_CONFIG.HELPER_RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
        try {
            const busy = await page.evaluate(config => {
                // Returns true when the page still appears "busy" (spinner OR recent network).
                /** @param {Document | ShadowRoot} [root=document] */
                const checkSpinnersDeep = (root = document) => {
                    const selector =
                        '[role="progressbar"], .spinner, .loading, svg.animate-spin, [aria-busy="true"], [data-loading="true"]';
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                    /** @type {any} */
                    let node = walker.currentNode;

                    while (node) {
                        if (node.nodeType === 1) {
                            if (node.matches(selector)) {
                                // False positive filter: must be visible and have non-zero rects.
                                const rects = node.getClientRects();
                                if (rects.length > 0 && node.offsetParent !== null) {
                                    const st = window.getComputedStyle(node);
                                    if (st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.1) {
                                        const hasSize = Array.from(rects).some(r => r.width > 0 && r.height > 0);
                                        if (hasSize) return true;
                                    }
                                }
                            }
                            if (node.shadowRoot && checkSpinnersDeep(node.shadowRoot)) return true;
                            if (node.tagName === 'IFRAME') {
                                try {
                                    if (node.contentDocument && checkSpinnersDeep(node.contentDocument)) return true;
                                } catch (_err) {
                                    // Ignore cross-origin iframe access errors
                                }
                            }
                        }
                        node = walker.nextNode();
                    }
                    return false;
                };

                if (checkSpinnersDeep()) {
                    return true;
                }

                const entries = performance.getEntriesByType('resource');
                if (entries.length > 0) {
                    const latest = /** @type {PerformanceResourceTiming[]} */ (entries).reduce(
                        (a, b) => (b.responseEnd > a.responseEnd ? b : a),
                        /** @type {PerformanceResourceTiming} */ (entries[0])
                    );
                    if (performance.now() - Number(latest.responseEnd || 0) < config.RECENT_NETWORK_THRESHOLD) {
                        return true;
                    }
                }

                return false;
            }, STABILIZER_CONFIG);

            return busy === true;
        } catch (err) {
            if (i === retries - 1) {
                log('DEBUG', `[STABILIZER] Page load status check failed after ${retries} retries: ${err.message}`);
                return false;
            }
            await new Promise(r => setTimeout(r, STABILIZER_CONFIG.HELPER_RETRY_DELAY * (i + 1)));
        }
    }
    return false;
}


// ============================================
// MAIN STABILIZATION FUNCTION (v2.0 - Complete)
// ============================================

/**
 * Orquestra a estabilização multi-fase da página.
 * v2.0: Added validation, telemetry, abort support, enriched return value.
 * @param {object} driver - Instância do BaseDriver (required)
 * @param {number} timeoutMs - Tempo máximo de espera (default: 30000)
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Promise<object>} Result object with success, duration, phases, etc.
 * @throws {TypeError} If required parameters are invalid
 */
async function waitForStability(driver, timeoutMs = STABILIZER_CONFIG.DEFAULT_TIMEOUT, signal = null) {
    // [v2.0] Parameter validation (Bug #1 fix)
    if (!driver || typeof driver !== 'object') {
        throw new TypeError('waitForStability: driver is required and must be a Driver object');
    }
    if (!driver.page || typeof driver.page !== 'object') {
        throw new TypeError('waitForStability: driver.page is required');
    }
    if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
        throw new TypeError('waitForStability: timeoutMs must be a positive number');
    }

    const page = driver.page;
    const start = Date.now();
    const deadline = start + timeoutMs;
    const correlationId = driver.correlationId;

    // Result object (v2.0 - Improvement #12)
    const result = {
        success: false,
        duration: 0,
        phasesCompleted: [],
        phasesFailed: [],
        phasesSkipped: [],
        finalLag: null,
        domain: 'unknown',
        timeout: false,
        lagMeasurements: []
    };

    // Make result coercible to boolean for backward compatibility
    result.valueOf = () => result.success;

    let abortVitalEmitted = false;

    const isPageClosed = () => (typeof page.isClosed === 'function' ? page.isClosed() : false);

    const assertPageOpen = () => {
        if (isPageClosed()) {
            throw new Error('page is closed');  
        }
    };

    const throwIfAborted = (phase = null) => {
        if (signal?.aborted) {
            throw new StabilizerAbortError('stabilization aborted', phase);
        }
    };

    // [v2.0] Abort check at start
    if (signal?.aborted) {
        driver._emitVital('STABILITY_ABORTED', { reason: 'signal_aborted_at_start' });
        abortVitalEmitted = true; // eslint-disable-line no-useless-assignment
        result.duration = Date.now() - start;
        return result;
    }

    // Extract domain (v2.0 - Bug #5 fix with logging)
    try {
        const url = page.url();
        if (url && url.startsWith('http')) {
            result.domain = new URL(url).hostname.replace('www.', '');
        }
    } catch (err) {
        log('DEBUG', `[STABILIZER] Failed to extract domain: ${err.message}`, correlationId);
    }

    // [v2.0] Telemetry: Stability start
    driver._emitVital('STABILITY_START', { timeout: timeoutMs, domain: result.domain });

    // FASE 0: Limpeza de métricas
    await page.evaluate(() => performance.clearResourceTimings()).catch(() => {});

    try {
        // ============================================
        // FASE 1: Network Idle
        // ============================================
        const phase1Start = Date.now();
        const phase1Deadline = start + timeoutMs * STABILIZER_CONFIG.PHASE_TIMEOUT_NETWORK;

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'NETWORK_IDLE', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('NETWORK_IDLE');
        } else {
            assertPageOpen();
            throwIfAborted('NETWORK_IDLE');
            driver._emitVital('PHASE_START', { phase: 'NETWORK_IDLE' });

            try {
                await page.waitForNetworkIdle({
                    idleTime: STABILIZER_CONFIG.NETWORK_IDLE_TIME,
                    timeout: Math.max(1000, phase1Deadline - Date.now())
                });

                throwIfAborted('NETWORK_IDLE');

                const phase1Duration = Date.now() - phase1Start;
                driver._emitVital('PHASE_SUCCESS', { phase: 'NETWORK_IDLE', duration: phase1Duration });
                result.phasesCompleted.push('NETWORK_IDLE');
            } catch (err) {
                if (isPageClosed()) {
                    throw new Error('page is closed'); // eslint-disable-line preserve-caught-error
                }
                log('DEBUG', `[STABILIZER] Network idle failed: ${err.message}`, correlationId);
                driver._emitVital('PHASE_FAILURE', {
                    phase: 'NETWORK_IDLE',
                    error: err.message,
                    recoverable: true
                });
                result.phasesFailed.push('NETWORK_IDLE');
            }
        }

        // ============================================
        // FASE 2: Spinner Check
        // ============================================
        const phase2Start = Date.now();

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'SPINNER_CHECK', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('SPINNER_CHECK');
        } else {
            assertPageOpen();
            throwIfAborted('SPINNER_CHECK');
            driver._emitVital('PHASE_START', { phase: 'SPINNER_CHECK' });

            let iterations = 0;
            let spinnerDetected = false;

            while (iterations < STABILIZER_CONFIG.SPINNER_MAX_ITERATIONS && Date.now() < deadline && !signal?.aborted) {
                const busy = await getPageLoadStatus(page);

                if (busy && !spinnerDetected) {
                    driver._emitVital('SPINNER_DETECTED', { iteration: iterations });
                    spinnerDetected = true;
                }

                if (!busy) {
                    if (spinnerDetected) {
                        driver._emitVital('SPINNER_CLEARED', { iterations });
                    }
                    break;
                }

                await new Promise(r => setTimeout(r, STABILIZER_CONFIG.SPINNER_CHECK_INTERVAL));
                iterations++;
            }

            const phase2Duration = Date.now() - phase2Start;
            driver._emitVital('PHASE_SUCCESS', { phase: 'SPINNER_CHECK', duration: phase2Duration, iterations });
            result.phasesCompleted.push('SPINNER_CHECK');
        }

        // ============================================
        // FASE 3: Estabilidade de Entropia (MutationObserver)
        // ============================================
        const phase3Start = Date.now();
        const phase3Deadline =
            start +
            timeoutMs *
                (STABILIZER_CONFIG.PHASE_TIMEOUT_NETWORK +
                    STABILIZER_CONFIG.PHASE_TIMEOUT_SPINNER +
                    STABILIZER_CONFIG.PHASE_TIMEOUT_ENTROPY);

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'DOM_ENTROPY', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('DOM_ENTROPY');
        } else {
            assertPageOpen();
            throwIfAborted('DOM_ENTROPY');
            driver._emitVital('PHASE_START', { phase: 'DOM_ENTROPY' });

            // [v2.0] Adaptive silence window (Improvement #9)
            let silenceWindow = STABILIZER_CONFIG.DOM_SILENCE_WINDOW_DEFAULT;
            try {
                const metrics = await adaptive.getSnapshot();
                const targetStats = metrics.targets[result.domain];

                if (targetStats) {
                    const avgStreamTime = targetStats.stream.avg;

                    if (avgStreamTime > STABILIZER_CONFIG.ADAPTIVE_STREAM_VERY_SLOW) {
                        silenceWindow = STABILIZER_CONFIG.DOM_SILENCE_WINDOW_VERY_SLOW;
                    } else if (avgStreamTime > STABILIZER_CONFIG.ADAPTIVE_STREAM_SLOW) {
                        silenceWindow = STABILIZER_CONFIG.DOM_SILENCE_WINDOW_SLOW;
                    } else if (avgStreamTime < STABILIZER_CONFIG.ADAPTIVE_STREAM_FAST) {
                        silenceWindow = STABILIZER_CONFIG.DOM_SILENCE_WINDOW_FAST;
                    }
                }
            } catch (err) {
                log('DEBUG', `[STABILIZER] Adaptive snapshot failed: ${err.message}`, correlationId);
            }

            try {
                await page.evaluate(
                    async (windowMs, taskDomain, maxWaitMs, config) => {
                        const observers = [];
                        if (!window.__STABILIZER_OBSERVERS) {
                            window.__STABILIZER_OBSERVERS = [];
                        }

                        try {
                            return new Promise(resolve => {
                                let lastActivity = Date.now();
                                const startTime = Date.now();

                                const onMutation = mutations => {
                                    const isRelevant = mutations.some(
                                        m =>
                                            m.type === 'childList' ||
                                            m.type === 'characterData' ||
                                            (m.type === 'attributes' &&
                                                (m.attributeName.startsWith('data-') ||
                                                    ['class', 'aria-busy'].includes(m.attributeName)))
                                    );
                                    if (isRelevant) {
                                        lastActivity = Date.now();
                                    }
                                };

                                /** @type {(Document | ShadowRoot)[]} */
                                const roots = [document];
                                /** @type {(Document | ShadowRoot)[]} */
                                const queue = [document];
                                while (queue.length > 0) {
                                    const curr = queue.shift();
                                    if (!curr) break;
                                    const walker = document.createTreeWalker(curr, NodeFilter.SHOW_ELEMENT);
                                    /** @type {any} */
                                    let node = walker.nextNode();
                                    while (node) {
                                        if (node.nodeType === 1) {
                                            if (node.shadowRoot) {
                                                roots.push(node.shadowRoot);
                                                queue.push(node.shadowRoot);
                                            }
                                            if (node.tagName === 'IFRAME') {
                                                try {
                                                    if (node.contentDocument) {
                                                        roots.push(node.contentDocument);
                                                        queue.push(node.contentDocument);
                                                    }
                                                } catch (_err) {
                                                    // Ignore cross-origin iframe access errors
                                                }
                                            }
                                        }
                                        node = walker.nextNode();
                                    }
                                }

                                roots.forEach(r => {
                                    const obs = new MutationObserver(onMutation);
                                    const target = r instanceof ShadowRoot ? r : r.documentElement || r;
                                    try {
                                        // [v2.0] Optimized observer (Improvement #7)
                                        obs.observe(target, {
                                            childList: true,
                                            subtree: true,
                                            characterData: true,
                                            attributes: true,
                                            attributeFilter: ['class', 'aria-busy', 'data-loading', 'data-testid'],
                                            attributeOldValue: false
                                        });
                                        observers.push(obs);
                                        window.__STABILIZER_OBSERVERS.push(obs);
                                    } catch (_err) {
                                        // Ignore observer errors
                                    }
                                });

                                const check = setInterval(() => {
                                    const now = Date.now();
                                    if (!window.__SADI_PULSE) {
                                        window.__SADI_PULSE = {};
                                    }
                                    const lastPulse = window.__SADI_PULSE[taskDomain] || 0;
                                    const isPulsing = now - lastPulse < config.SADI_PULSE_THRESHOLD;

                                    if ((!isPulsing && now - lastActivity > windowMs) || now - startTime > maxWaitMs) {
                                        clearInterval(check);
                                        resolve();
                                    }
                                }, config.ENTROPY_CHECK_INTERVAL);
                            });
                        } finally {
                            observers.forEach(o => o.disconnect());
                        }
                    },
                    silenceWindow,
                    result.domain,
                    Math.max(STABILIZER_CONFIG.DOM_ENTROPY_MIN_WAIT, phase3Deadline - Date.now()),
                    STABILIZER_CONFIG
                );

                throwIfAborted('DOM_ENTROPY');

                const phase3Duration = Date.now() - phase3Start;
                driver._emitVital('DOM_STABLE', { silenceWindow, duration: phase3Duration });
                driver._emitVital('PHASE_SUCCESS', { phase: 'DOM_ENTROPY', duration: phase3Duration });
                result.phasesCompleted.push('DOM_ENTROPY');
            } catch (evaluateErr) {
                if (isPageClosed()) {
                    throw new Error('page is closed'); // eslint-disable-line preserve-caught-error
                }
                log('WARN', `[STABILIZER] DOM entropy failed: ${evaluateErr.message}`, correlationId);
                driver._emitVital('PHASE_FAILURE', {
                    phase: 'DOM_ENTROPY',
                    error: evaluateErr.message,
                    recoverable: true
                });
                result.phasesFailed.push('DOM_ENTROPY');
            } finally {
                // [v2.0] Force cleanup (Bug #6 fix)
                await page
                    .evaluate(() => {
                        if (window.__STABILIZER_OBSERVERS) {
                            window.__STABILIZER_OBSERVERS.forEach(obs => {
                                try {
                                    obs.disconnect();
                                } catch (_err) {
                                    // Ignore observer cleanup errors
                                }
                            });
                            window.__STABILIZER_OBSERVERS = [];
                        }
                    })
                    .catch(() => {});
            }
        }

        // ============================================
        // FASE 4: Hydration Guard
        // ============================================
        const phase4Start = Date.now();

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'HYDRATION', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('HYDRATION');
        } else {
            assertPageOpen();
            throwIfAborted('HYDRATION');
            driver._emitVital('PHASE_START', { phase: 'HYDRATION' });

            try {
                await page.evaluate(config => {
                    return new Promise(resolve => {
                        const controller = new AbortController();
                        let done = false;

                        const finish = () => {
                            if (done) {
                                return;
                            }
                            done = true;
                            clearTimeout(timeout);
                            try {
                                document.removeEventListener('mousemove', onMouseMove);
                            } catch (_err) {
                                // Ignore remove listener errors
                            }
                            try {
                                controller.abort();
                            } catch (_err) {
                                // Ignore abort errors
                            }
                            resolve();
                        };

                        const onMouseMove = () => {
                            finish();
                        };
                        const addMouseMoveListener = options => {
                            document.addEventListener('mousemove', onMouseMove, options);
                        };

                        const timeout = setTimeout(() => {
                            finish();
                        }, config.HYDRATION_TIMEOUT);

                        try {
                            addMouseMoveListener({
                                once: true,
                                signal: controller.signal,
                            });
                        } catch (_err) {
                            // Fallback for contexts that do not support AbortSignal in addEventListener options
                            addMouseMoveListener({ once: true });
                        }

                        // Trigger one synthetic interaction tick to unblock hydration listeners when possible.
                        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                    });
                }, STABILIZER_CONFIG);

                throwIfAborted('HYDRATION');

                const phase4Duration = Date.now() - phase4Start;
                driver._emitVital('HYDRATION_COMPLETE', { duration: phase4Duration });
                driver._emitVital('PHASE_SUCCESS', { phase: 'HYDRATION', duration: phase4Duration });
                result.phasesCompleted.push('HYDRATION');
            } catch (err) {
                log('DEBUG', `[STABILIZER] Hydration guard failed: ${err.message}`, correlationId);
                driver._emitVital('PHASE_FAILURE', { phase: 'HYDRATION', error: err.message, recoverable: true });
                result.phasesFailed.push('HYDRATION');
            }
        }

        // ============================================
        // FASE 5: Visual Frame Sync
        // ============================================
        const phase5Start = Date.now();

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'FRAME_SYNC', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('FRAME_SYNC');
        } else {
            assertPageOpen();
            throwIfAborted('FRAME_SYNC');
            driver._emitVital('PHASE_START', { phase: 'FRAME_SYNC' });

            try {
                await Promise.race([
                    page.evaluate(
                        () =>
                            new Promise(r => {
                                requestAnimationFrame(() => requestAnimationFrame(r));
                            })
                    ),
                    new Promise(r => setTimeout(r, STABILIZER_CONFIG.FRAME_SYNC_TIMEOUT))
                ]);

                throwIfAborted('FRAME_SYNC');

                const phase5Duration = Date.now() - phase5Start;
                driver._emitVital('FRAME_SYNC_COMPLETE', { duration: phase5Duration });
                driver._emitVital('PHASE_SUCCESS', { phase: 'FRAME_SYNC', duration: phase5Duration });
                result.phasesCompleted.push('FRAME_SYNC');
            } catch (err) {
                log('DEBUG', `[STABILIZER] Frame sync failed: ${err.message}`, correlationId);
                driver._emitVital('PHASE_FAILURE', { phase: 'FRAME_SYNC', error: err.message, recoverable: true });
                result.phasesFailed.push('FRAME_SYNC');
            }
        }

        // ============================================
        // FASE 6: CPU Lag Check
        // ============================================
        const phase6Start = Date.now();
        const cpuDeadline = Math.min(Date.now() + STABILIZER_CONFIG.CPU_LAG_MAX_WAIT, deadline);

        if (Date.now() >= deadline || signal?.aborted) {
            driver._emitVital('PHASE_SKIP', { phase: 'CPU_LAG', reason: 'global_timeout_or_abort' });
            result.phasesSkipped.push('CPU_LAG');
        } else {
            assertPageOpen();
            throwIfAborted('CPU_LAG');
            driver._emitVital('PHASE_START', { phase: 'CPU_LAG' });

            let lag = 999;

            // [v2.0] Histogram tracking (Improvement #10)
            while (lag > STABILIZER_CONFIG.CPU_LAG_THRESHOLD && Date.now() < cpuDeadline && !signal?.aborted) {
                lag = await measureEventLoopLag(page);
                result.lagMeasurements.push({ timestamp: Date.now(), lag });

                if (lag > STABILIZER_CONFIG.CPU_LAG_THRESHOLD) {
                    driver._emitVital('CPU_LAG_HIGH', {
                        lag,
                        measurements: result.lagMeasurements.length
                    });
                    await new Promise(r => setTimeout(r, STABILIZER_CONFIG.CPU_LAG_RETRY_DELAY));
                }
            }

            throwIfAborted('CPU_LAG');

            lag = Number(lag);
            if (!Number.isFinite(lag)) lag = STABILIZER_CONFIG.DEFAULT_LAG_FALLBACK;

            result.finalLag = lag;

            if (lag <= STABILIZER_CONFIG.CPU_LAG_THRESHOLD) {
                driver._emitVital('CPU_LAG_NORMAL', { finalLag: lag });
            }

            const phase6Duration = Date.now() - phase6Start;
            driver._emitVital('PHASE_SUCCESS', {
                phase: 'CPU_LAG',
                duration: phase6Duration,
                finalLag: lag,
                measurements: result.lagMeasurements.length
            });
            result.phasesCompleted.push('CPU_LAG');
        }

        // Success!
        throwIfAborted('FINALIZE');

        result.success = true;
        result.duration = Date.now() - start;
        driver._emitVital('STABILITY_COMPLETE', {
            duration: result.duration,
            phasesCompleted: result.phasesCompleted.length,
            phasesFailed: result.phasesFailed.length,
            phasesSkipped: result.phasesSkipped.length
        });

        return result;
    } catch (e) {
        // [v2.0] Consistent error propagation (Improvement #14)
        result.duration = Date.now() - start;

        // Abort is not an error: return a failure result and emit STABILITY_ABORTED.
        if (e?.name === 'StabilizerAbortError') {
            result.success = false;

            const phase = e.phase || null;
            if (phase && !result.phasesCompleted.includes(phase) && !result.phasesFailed.includes(phase)) {
                result.phasesFailed.push(phase);
            }

            if (!abortVitalEmitted) {
                driver._emitVital('STABILITY_ABORTED', { reason: 'signal_aborted', phase });
                abortVitalEmitted = true; // eslint-disable-line no-useless-assignment
            }

            return result;
        }

        // Critical: page closed. Must propagate and emit STABILITY_ERROR.
        if (isPageClosed()) {
            const message = 'page is closed';
            log('ERROR', `[STABILIZER] Page closed during stabilization: ${e?.message || message}`, correlationId);
            driver._emitVital('STABILITY_ERROR', {
                error: message,
                critical: true,
                duration: result.duration
            });

            if (e?.message && /page is closed/i.test(e.message)) {
                throw e;
            }
            throw new Error(message); // eslint-disable-line preserve-caught-error
        }

        const msg = e?.message || String(e);

        if (Date.now() >= deadline) {
            log('WARN', `[STABILIZER] Stabilization timeout (${result.duration}ms): ${msg}`, correlationId);
            result.timeout = true;
            driver._emitVital('STABILITY_TIMEOUT', {
                duration: result.duration,
                error: msg
            });
        } else {
            log('WARN', `[STABILIZER] Stabilization error (${result.duration}ms): ${msg}`, correlationId);
            driver._emitVital('STABILITY_ERROR', {
                error: msg,
                critical: false,
                duration: result.duration
            });
        }

        return result;
    }
}

export { getPageLoadStatus, measureEventLoopLag, STABILIZER_CONFIG, waitForStability };
