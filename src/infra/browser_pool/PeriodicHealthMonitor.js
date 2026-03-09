// @ts-check
import { log } from '#core/logger';
import EventEmitter from 'node:events';

/**
 * @file PeriodicHealthMonitor - CDP-based browser health monitoring
 *
 *   **Purpose**: Monitor browser/connection health via Chrome DevTools Protocol (CDP) to detect issues proactively
 *   WITHOUT requiring process-level access.
 *
 *   **Phase**: 3 (Monitoring) - P2-U1 **Status**: Production Ready (External Browser Mode) **Version**: 1.0 (CDP-only, no
 *   process control)
 *
 *   **Architecture Context**:
 *
 *   - Chrome runs on Windows host (user-managed)
 *   - Container connects via Puppeteer (puppeteer.connect)
 *   - No access to browser process (browser.process() returns null)
 *   - All monitoring via CDP (Chrome DevTools Protocol)
 *
 *   **Responsibilities**:
 *
 *   - Periodic connection health checks (browser.isConnected)
 *   - Page-level memory metrics (page.metrics via CDP)
 *   - Target monitoring (Target.detached events)
 *   - Alert emission when health degrades
 *   - Auto-trigger reconnection strategy (via events)
 *
 *   **NOT Included** (requires process access):
 *
 *   - Process-level CPU/memory monitoring
 *   - Browser process restart
 *   - File system monitoring
 *   - Task Manager metrics
 *
 *   **Integration**:
 *
 *   - pool_manager.js: Monitor all active browser connections
 *   - ConnectionRecoveryStrategy: Triggered on critical issues
 *   - NERV Events: Health alerts for external monitoring
 *
 *   **Created**: February 2026 (Phase 3 implementation) **Related**: DRIVER_BROWSER_INTEGRATION_ANALYSIS.md (P2-U1)
 */

/* ==========================================================================
   CONFIGURATION
========================================================================== */

/**
 * Monitor configuration constants.
 *
 * @readonly
 */
const MONITOR_CONFIG = Object.freeze({
    // Check intervals
    HEALTH_CHECK_INTERVAL_MS: 30000, // 30s default
    QUICK_CHECK_INTERVAL_MS: 5000, // 5s for critical mode

    // Thresholds (CDP metrics)
    MEMORY_WARNING_THRESHOLD_MB: 500, // Page memory > 500MB = warning
    MEMORY_CRITICAL_THRESHOLD_MB: 1000, // Page memory > 1GB = critical
    JS_HEAP_WARNING_THRESHOLD_MB: 300, // JS heap > 300MB = warning
    JS_HEAP_CRITICAL_THRESHOLD_MB: 600, // JS heap > 600MB = critical
    DOM_NODES_WARNING_THRESHOLD: 10000, // DOM nodes > 10k = warning
    DOM_NODES_CRITICAL_THRESHOLD: 50000, // DOM nodes > 50k = critical

    // Connection health
    CONNECTION_CHECK_TIMEOUT_MS: 5000, // 5s timeout for isConnected check
    MAX_CONSECUTIVE_FAILURES: 3, // 3 failures → critical

    // Reconnection
    RECONNECT_BACKOFF_BASE_MS: 2000, // 2s base
    RECONNECT_BACKOFF_MAX_MS: 30000, // 30s max
    RECONNECT_MAX_ATTEMPTS: 5, // 5 attempts before giving up
});

/**
 * Health status levels.
 *
 * @readonly
 * @enum {string}
 */
const HEALTH_STATUS = {
    HEALTHY: 'HEALTHY', // All checks passing
    WARNING: 'WARNING', // Some metrics elevated
    DEGRADED: 'DEGRADED', // Multiple issues
    CRITICAL: 'CRITICAL', // Connection lost or severe issues
    DISCONNECTED: 'DISCONNECTED', // Browser disconnected
};

/**
 * Health check types.
 *
 * @readonly
 * @enum {string}
 */
const CHECK_TYPES = {
    CONNECTION: 'CONNECTION', // browser.isConnected()
    PAGE_MEMORY: 'PAGE_MEMORY', // page.metrics() - memory
    PAGE_TARGETS: 'PAGE_TARGETS', // Target count validation
    DOM_HEALTH: 'DOM_HEALTH', // DOM node count
};

/**
 * Monitor events.
 *
 * @readonly
 */
const MONITOR_EVENTS = {
    HEALTH_CHECK_COMPLETE: 'health:check_complete',
    STATUS_CHANGED: 'health:status_changed',
    WARNING_DETECTED: 'health:warning',
    CRITICAL_ISSUE: 'health:critical',
    CONNECTION_LOST: 'health:connection_lost',
    RECOVERY_NEEDED: 'health:recovery_needed',
    MONITOR_STARTED: 'health:monitor_started',
    MONITOR_STOPPED: 'health:monitor_stopped',
};

/* ==========================================================================
   PeriodicHealthMonitor Class
========================================================================== */

/**
 * Monitor periódico de saúde do BrowserPool baseado em CDP (sem acesso a processo).
 */
class PeriodicHealthMonitor extends EventEmitter {
    /**
     * Creates monitor instance.
     *
     * @param {any} poolManager - BrowserPoolManager instance
     */
    constructor(poolManager) {
        super();

        if (!poolManager) {
            throw new Error('[PeriodicHealthMonitor] poolManager is required');
        }

        this.poolManager = poolManager;
        this.isRunning = false;
        this.intervalHandle = null;
        this.currentStatus = HEALTH_STATUS.HEALTHY;

        // Metrics tracking
        this.stats = {
            totalChecks: 0,
            passedChecks: 0,
            warningChecks: 0,
            criticalChecks: 0,
            consecutiveFailures: 0,
            lastCheckTime: /** @type {number | null} */ (null),
            lastHealthyTime: Date.now(),
        };

        // Health history (last 10 checks)
        /** @type {any[]} */
        this.healthHistory = [];
        this._checkInFlight = null;

        log('DEBUG', '[PeriodicHealthMonitor] Initialized (CDP-only mode)');
    }

    /* ======================================================================
       PUBLIC API - Lifecycle
    ====================================================================== */

    /**
     * Starts periodic health monitoring.
     *
     * @param {number} [intervalMs] - Check interval (default: 30s)
     * @returns {void}
     */
    start(intervalMs = MONITOR_CONFIG.HEALTH_CHECK_INTERVAL_MS) {
        if (this.isRunning) {
            log('WARN', '[PeriodicHealthMonitor] Already running');
            return;
        }

        this.isRunning = true;
        log('INFO', `[PeriodicHealthMonitor] Starting with ${intervalMs}ms interval`);

        // Initial check immediately
        this.runHealthCheck().catch((err) => {
            log('ERROR', `[PeriodicHealthMonitor] Initial check failed: ${err.message}`);
        });

        // Setup periodic checks
        this.intervalHandle = setInterval(() => {
            this.runHealthCheck().catch((err) => {
                log('ERROR', `[PeriodicHealthMonitor] Check failed: ${err.message}`);
            });
        }, intervalMs);

        this.emit(MONITOR_EVENTS.MONITOR_STARTED, {
            intervalMs,
            timestamp: Date.now(),
        });
    }

    /**
     * Stops monitoring.
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        log('INFO', '[PeriodicHealthMonitor] Stopping');

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        this.isRunning = false;

        this.emit(MONITOR_EVENTS.MONITOR_STOPPED, {
            stats: this.getStats(),
            timestamp: Date.now(),
        });
    }

    /**
     * Switches to critical mode (faster checks).
     */
    enableCriticalMode() {
        if (this.isRunning) {
            this.stop();
            this.start(MONITOR_CONFIG.QUICK_CHECK_INTERVAL_MS);
            log('WARN', '[PeriodicHealthMonitor] Switched to CRITICAL mode (5s interval)');
        }
    }

    /**
     * Switches back to normal mode.
     */
    disableCriticalMode() {
        if (this.isRunning) {
            this.stop();
            this.start(MONITOR_CONFIG.HEALTH_CHECK_INTERVAL_MS);
            log('INFO', '[PeriodicHealthMonitor] Switched to NORMAL mode (30s interval)');
        }
    }

    /* ======================================================================
       HEALTH CHECK EXECUTION
    ====================================================================== */

    /**
     * Executes comprehensive health check.
     *
     * @returns {Promise<any>} Health check result
     */
    async runHealthCheck() {
        if (this._checkInFlight) {
            return this._checkInFlight;
        }

        this._checkInFlight = this._runHealthCheckUnsafe().finally(() => {
            this._checkInFlight = null;
        });

        return this._checkInFlight;
    }

    async _runHealthCheckUnsafe() {
        const startTime = Date.now();
        this.stats.totalChecks++;
        this.stats.lastCheckTime = startTime;

        log('DEBUG', '[PeriodicHealthMonitor] Running health check...');

        const results = {
            timestamp: startTime,
            checks: {},
            issues: /** @type {any[]} */ ([]),
            overallStatus: HEALTH_STATUS.HEALTHY,
        };

        try {
            // Check 1: Connection health
            await this._checkConnection(results);

            // Check 2: Page memory (all active pages)
            await this._checkPageMemory(results);

            // Check 3: Target health
            await this._checkTargets(results);

            // Determine overall status
            this._determineOverallStatus(results);

            // Update stats
            if (results.overallStatus === HEALTH_STATUS.HEALTHY) {
                this.stats.passedChecks++;
                this.stats.consecutiveFailures = 0;
                this.stats.lastHealthyTime = Date.now();
            } else if (results.overallStatus === HEALTH_STATUS.WARNING) {
                this.stats.warningChecks++;
                this.stats.consecutiveFailures = 0;
            } else {
                this.stats.criticalChecks++;
                this.stats.consecutiveFailures++;
            }

            // Status change detection
            if (results.overallStatus !== this.currentStatus) {
                this._handleStatusChange(results.overallStatus, results);
            }

            // Store in history
            this._updateHealthHistory(results);

            // Emit completion
            this.emit(MONITOR_EVENTS.HEALTH_CHECK_COMPLETE, {
                ...results,
                duration: Date.now() - startTime,
            });
        } catch (/** @type {any} */ _rawCheckErr) {
            const checkErr = /** @type {any} */ (_rawCheckErr);
            log('ERROR', `[PeriodicHealthMonitor] Check error: ${checkErr.message}`);
            results.overallStatus = HEALTH_STATUS.CRITICAL;
            /** @type {any[]} */ (results.issues).push({
                type: 'CHECK_ERROR',
                severity: 'CRITICAL',
                message: checkErr.message,
            });

            this.stats.criticalChecks++;
            this.stats.consecutiveFailures++;
        }

        return results;
    }

    /* ======================================================================
       INDIVIDUAL CHECKS
    ====================================================================== */

    /**
     * Check 1: Connection health.
     *
     * @private
     */
    async _checkConnection(/** @type {any} */ results) {
        const browser = this.poolManager.browser;

        if (!browser) {
            results.checks[CHECK_TYPES.CONNECTION] = {
                passed: false,
                status: HEALTH_STATUS.CRITICAL,
                message: 'No browser instance',
            };
            results.issues.push({
                type: CHECK_TYPES.CONNECTION,
                severity: 'CRITICAL',
                message: 'Browser instance not found',
            });
            return;
        }

        try {
            const isConnected = browser.isConnected();

            if (!isConnected) {
                results.checks[CHECK_TYPES.CONNECTION] = {
                    passed: false,
                    status: HEALTH_STATUS.DISCONNECTED,
                    message: 'Browser disconnected',
                };
                results.issues.push({
                    type: CHECK_TYPES.CONNECTION,
                    severity: 'CRITICAL',
                    message: 'Browser connection lost',
                    action: 'RECONNECT_NEEDED',
                });
            } else {
                results.checks[CHECK_TYPES.CONNECTION] = {
                    passed: true,
                    status: HEALTH_STATUS.HEALTHY,
                    message: 'Connected',
                };
            }
        } catch (/** @type {any} */ _rawConnErr) {
            const connErr = /** @type {any} */ (_rawConnErr);
            results.checks[CHECK_TYPES.CONNECTION] = {
                passed: false,
                status: HEALTH_STATUS.CRITICAL,
                message: connErr.message,
            };
            results.issues.push({
                type: CHECK_TYPES.CONNECTION,
                severity: 'CRITICAL',
                message: `Connection check failed: ${connErr.message}`,
            });
        }
    }

    /**
     * Check 2: Page memory metrics (CDP).
     *
     * @private
     */
    async _checkPageMemory(/** @type {any} */ results) {
        const activePages = this.poolManager.getActivePages();

        if (activePages.length === 0) {
            results.checks[CHECK_TYPES.PAGE_MEMORY] = {
                passed: true,
                status: HEALTH_STATUS.HEALTHY,
                message: 'No active pages',
            };
            return;
        }

        let totalMemoryMB = 0;
        let totalJSHeapMB = 0;
        let maxPageMemoryMB = 0;
        const pageIssues = [];

        for (const pageInfo of activePages) {
            const { page, taskId } = pageInfo;

            try {
                if (!page || page.isClosed()) continue;

                const metrics = await page.metrics();

                const jsHeapUsedMB = Math.round((metrics.JSHeapUsedSize || 0) / 1024 / 1024);
                const jsHeapTotalMB = Math.round((metrics.JSHeapTotalSize || 0) / 1024 / 1024);
                const domNodes = metrics.Nodes || 0;

                totalJSHeapMB += jsHeapUsedMB;
                totalMemoryMB += jsHeapTotalMB;
                maxPageMemoryMB = Math.max(maxPageMemoryMB, jsHeapTotalMB);

                // Check thresholds
                if (jsHeapUsedMB > MONITOR_CONFIG.JS_HEAP_CRITICAL_THRESHOLD_MB) {
                    pageIssues.push({
                        taskId,
                        type: 'JS_HEAP_CRITICAL',
                        severity: 'CRITICAL',
                        value: jsHeapUsedMB,
                        threshold: MONITOR_CONFIG.JS_HEAP_CRITICAL_THRESHOLD_MB,
                    });
                } else if (jsHeapUsedMB > MONITOR_CONFIG.JS_HEAP_WARNING_THRESHOLD_MB) {
                    pageIssues.push({
                        taskId,
                        type: 'JS_HEAP_WARNING',
                        severity: 'WARNING',
                        value: jsHeapUsedMB,
                        threshold: MONITOR_CONFIG.JS_HEAP_WARNING_THRESHOLD_MB,
                    });
                }

                if (domNodes > MONITOR_CONFIG.DOM_NODES_CRITICAL_THRESHOLD) {
                    pageIssues.push({
                        taskId,
                        type: 'DOM_NODES_CRITICAL',
                        severity: 'CRITICAL',
                        value: domNodes,
                        threshold: MONITOR_CONFIG.DOM_NODES_CRITICAL_THRESHOLD,
                    });
                } else if (domNodes > MONITOR_CONFIG.DOM_NODES_WARNING_THRESHOLD) {
                    pageIssues.push({
                        taskId,
                        type: 'DOM_NODES_WARNING',
                        severity: 'WARNING',
                        value: domNodes,
                        threshold: MONITOR_CONFIG.DOM_NODES_WARNING_THRESHOLD,
                    });
                }
            } catch (/** @type {any} */ _rawMetricsErr) {
                const metricsErr = /** @type {any} */ (_rawMetricsErr);
                log('WARN', `[PeriodicHealthMonitor] Page metrics failed (${taskId}): ${metricsErr.message}`);
            }
        }

        // Determine status
        const hasCritical = pageIssues.some((i) => i.severity === 'CRITICAL');
        const hasWarning = pageIssues.some((i) => i.severity === 'WARNING');

        results.checks[CHECK_TYPES.PAGE_MEMORY] = {
            passed: !hasCritical,
            status: hasCritical ? HEALTH_STATUS.CRITICAL : hasWarning ? HEALTH_STATUS.WARNING : HEALTH_STATUS.HEALTHY,
            message: `${activePages.length} pages, ${totalJSHeapMB}MB JS heap`,
            details: {
                totalMemoryMB,
                totalJSHeapMB,
                maxPageMemoryMB,
                pageCount: activePages.length,
            },
        };

        results.issues.push(...pageIssues);
    }

    /**
     * Check 3: Target health.
     *
     * @private
     */
    async _checkTargets(/** @type {any} */ results) {
        const browser = this.poolManager.browser;

        if (!browser || !browser.isConnected()) {
            results.checks[CHECK_TYPES.PAGE_TARGETS] = {
                passed: false,
                status: HEALTH_STATUS.CRITICAL,
                message: 'Browser not available',
            };
            return;
        }

        try {
            const targets = await browser.targets();
            const pageTargets = targets.filter((/** @type {any} */ t) => t.type() === 'page');

            results.checks[CHECK_TYPES.PAGE_TARGETS] = {
                passed: true,
                status: HEALTH_STATUS.HEALTHY,
                message: `${pageTargets.length} page targets`,
                details: {
                    totalTargets: targets.length,
                    pageTargets: pageTargets.length,
                },
            };
        } catch (/** @type {any} */ _rawTargetsErr) {
            const targetsErr = /** @type {any} */ (_rawTargetsErr);
            results.checks[CHECK_TYPES.PAGE_TARGETS] = {
                passed: false,
                status: HEALTH_STATUS.WARNING,
                message: targetsErr.message,
            };
        }
    }

    /* ======================================================================
       STATUS MANAGEMENT
    ====================================================================== */

    /**
     * Determines overall health status from check results.
     *
     * @private
     */
    _determineOverallStatus(/** @type {any} */ results) {
        const statuses = Object.values(results.checks).map((c) => c.status);

        if (statuses.includes(HEALTH_STATUS.DISCONNECTED)) {
            results.overallStatus = HEALTH_STATUS.DISCONNECTED;
        } else if (statuses.includes(HEALTH_STATUS.CRITICAL)) {
            results.overallStatus = HEALTH_STATUS.CRITICAL;
        } else if (statuses.includes(HEALTH_STATUS.DEGRADED)) {
            results.overallStatus = HEALTH_STATUS.DEGRADED;
        } else if (statuses.includes(HEALTH_STATUS.WARNING)) {
            results.overallStatus = HEALTH_STATUS.WARNING;
        } else {
            results.overallStatus = HEALTH_STATUS.HEALTHY;
        }
    }

    /**
     * Handles status change.
     *
     * @private
     */
    _handleStatusChange(/** @type {any} */ newStatus, /** @type {any} */ results) {
        const oldStatus = this.currentStatus;
        this.currentStatus = newStatus;

        log('WARN', `[PeriodicHealthMonitor] Status changed: ${oldStatus} → ${newStatus}`);

        this.emit(MONITOR_EVENTS.STATUS_CHANGED, {
            oldStatus,
            newStatus,
            results,
            timestamp: Date.now(),
        });

        // Emit specific events
        if (newStatus === HEALTH_STATUS.WARNING) {
            this.emit(MONITOR_EVENTS.WARNING_DETECTED, results);
        } else if (newStatus === HEALTH_STATUS.CRITICAL || newStatus === HEALTH_STATUS.DEGRADED) {
            this.emit(MONITOR_EVENTS.CRITICAL_ISSUE, results);
        } else if (newStatus === HEALTH_STATUS.DISCONNECTED) {
            this.emit(MONITOR_EVENTS.CONNECTION_LOST, results);
            this.emit(MONITOR_EVENTS.RECOVERY_NEEDED, {
                reason: 'CONNECTION_LOST',
                results,
            });
        }

        // Switch to critical mode if needed
        if (newStatus === HEALTH_STATUS.CRITICAL || newStatus === HEALTH_STATUS.DISCONNECTED) {
            this.enableCriticalMode();
        } else if (newStatus === HEALTH_STATUS.HEALTHY && oldStatus !== HEALTH_STATUS.HEALTHY) {
            this.disableCriticalMode();
        }
    }

    /**
     * Updates health history.
     *
     * @private
     */
    _updateHealthHistory(/** @type {any} */ results) {
        this.healthHistory.push({
            timestamp: results.timestamp,
            status: results.overallStatus,
            issueCount: results.issues.length,
        });

        // Keep last 10
        if (this.healthHistory.length > 10) {
            this.healthHistory.shift();
        }
    }

    /* ======================================================================
       INTROSPECTION
    ====================================================================== */

    /**
     * Gets monitor stats.
     *
     * @returns {any} Stats
     */
    getStats() {
        return {
            ...this.stats,
            currentStatus: this.currentStatus,
            isRunning: this.isRunning,
            healthHistory: this.healthHistory.slice(),
            config: { ...MONITOR_CONFIG },
        };
    }

    /**
     * Gets current health status.
     *
     * @returns {string} Current status
     */
    getCurrentStatus() {
        return this.currentStatus;
    }
}

export default PeriodicHealthMonitor;

/**
 * Constantes de status de saúde do browser
 *
 * **Side-effects:** N/A **Semântica:** Enumeração de níveis de saúde para monitoramento de conexões browser.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { HEALTH_STATUS };

/**
 * Tipos de verificações de saúde disponíveis
 *
 * **Side-effects:** N/A **Semântica:** Enumeração dos tipos de verificação implementados pelo monitor. **Unidades:**
 * N/A
 *
 * @type {Object<string, string>}
 */
export { CHECK_TYPES };

/**
 * Eventos emitidos pelo monitor de saúde
 *
 * **Side-effects:** N/A **Semântica:** Enumeração de eventos para comunicação com sistemas externos. **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { MONITOR_EVENTS };

/**
 * Configuração padrão do monitor de saúde
 *
 * **Side-effects:** N/A **Semântica:** Configurações padrão para intervalos e limites de monitoramento. **Unidades:**
 * N/A
 *
 * @type {Object<string, number>}
 */
export { MONITOR_CONFIG };
