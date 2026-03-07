// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/**
 * @fileoverview PageSessionTracker - Session metrics and health tracking
 *
 * **Purpose**: Track session-level metrics (turn count, response times, memory usage)
 *              to enable adaptive timeout adjustment for long conversations.
 *
 * **Phase**: 2 (Performance Upgrades) - P1-U1
 * **Status**: Production Ready
 * **Version**: 1.0
 *
 * **Responsibilities**:
 * - Track turn count (conversational interactions)
 * - Record response times (typing + submission + wait)
 * - Monitor session age (uptime)
 * - Calculate session health score
 * - Provide metrics for adaptive timeout calculation
 *
 * **Integration Points**:
 * - BaseDriver.sendPrompt() - Record turn metrics after each execution
 * - DriverReadinessGuard - Use session health for validation
 * - NERV Events - Emit session metrics updates
 *
 * **Key Metrics**:
 * - turnCount: Total interactions in session
 * - avgResponseTime: Moving average of response times
 * - recentResponseTimes: Last N response times (for trend analysis)
 * - sessionAge: Time since session start (ms)
 * - sessionHealth: Calculated health score (0-100)
 *
 * **Adaptive Timeout Logic**:
 * - Sessions with turnCount > 10: +50% timeout
 * - Sessions with turnCount > 20: +100% timeout
 * - Sessions with avgResponseTime > 10s: +50% timeout
 * - Sessions with sessionAge > 30min: +50% timeout
 *
 * **Created**: February 2026 (Phase 2 implementation)
 * **Related**: DRIVER_BROWSER_INTEGRATION_ANALYSIS.md (P1-U1, P1-U2)
 */

/* ==========================================================================
   CONFIGURATION
========================================================================== */

/**
 * Tracker configuration constants.
 * @readonly
 */
const TRACKER_CONFIG = Object.freeze({
    // Response time tracking
    MAX_RESPONSE_TIMES_STORED: 20, // Keep last 20 response times
    SLOW_RESPONSE_THRESHOLD_MS: 10000, // 10s considered "slow"
    VERY_SLOW_RESPONSE_THRESHOLD_MS: 30000, // 30s considered "very slow"

    // Session health thresholds
    LONG_SESSION_TURN_THRESHOLD: 10, // 10+ turns = long session
    VERY_LONG_SESSION_TURN_THRESHOLD: 20, // 20+ turns = very long
    SESSION_AGE_WARNING_MS: 30 * 60 * 1000, // 30 minutes
    SESSION_AGE_CRITICAL_MS: 60 * 60 * 1000, // 60 minutes

    // Health score weights
    HEALTH_WEIGHT_RESPONSE_TIME: 0.4,
    HEALTH_WEIGHT_TURN_COUNT: 0.3,
    HEALTH_WEIGHT_SESSION_AGE: 0.3,
});

/**
 * Session health levels.
 * @readonly
 * @enum {string}
 */
const HEALTH_LEVELS = {
    EXCELLENT: 'EXCELLENT', // 90-100
    GOOD: 'GOOD', // 70-89
    FAIR: 'FAIR', // 50-69
    DEGRADED: 'DEGRADED', // 30-49
    CRITICAL: 'CRITICAL', // 0-29
};

/**
 * Timeout multiplier based on session characteristics.
 * Used by adaptive timeout logic in BaseDriver.
 * @readonly
 */
const TIMEOUT_MULTIPLIERS = Object.freeze({
    // Base multiplier (no adjustment)
    BASE: 1.0,

    // Turn count multipliers
    LONG_SESSION: 1.5, // 10-20 turns
    VERY_LONG_SESSION: 2.0, // 20+ turns

    // Response time multipliers
    SLOW_RESPONSES: 1.5, // avgResponseTime > 10s
    VERY_SLOW_RESPONSES: 2.5, // avgResponseTime > 30s

    // Session age multipliers
    AGED_SESSION: 1.3, // 30+ minutes
    OLD_SESSION: 1.5, // 60+ minutes

    // Maximum multiplier (caps at 5x base timeout)
    MAX_MULTIPLIER: 5.0,
});

/* ==========================================================================
   PageSessionTracker Class
========================================================================== */

/**
 * Tracker de sessão por página para métricas de saúde e timeout adaptativo.
 */
class PageSessionTracker {
    /**
     * Creates a new PageSessionTracker instance.
     *
     * @param {object} driver - Reference to parent BaseDriver
     */
    constructor(driver) {
        this.driver = driver;

        // Session metrics
        this.turnCount = 0;
        this.responseTimes = /** @type {any[]} */ ([]); // Array of {timestamp, duration} objects
        this.sessionStartTime = Date.now();
        this.lastTurnTime = null;

        // Calculated metrics (cached)
        this._cachedMetrics = null;
        this._metricsLastCalculated = 0;
        this._metricsCacheDuration = 1000; // 1s cache

        log('DEBUG', '[SESSION_TRACKER] Initialized', this._getCorrelationId());
    }

    /* ======================================================================
       PUBLIC API - Turn Recording
    ====================================================================== */

    /**
     * Records a new turn (interaction).
     * Call this at the START of sendPrompt().
     *
     * @returns {number} Current turn count
     */
    recordTurn() {
        this.turnCount++;
        this.lastTurnTime = Date.now();

        log('DEBUG', `[SESSION_TRACKER] Turn recorded: #${this.turnCount}`, this._getCorrelationId());

        // Invalidate metrics cache
        this._cachedMetrics = null;

        return this.turnCount;
    }

    /**
     * Records response time for last turn.
     * Call this at the END of sendPrompt() (success or failure).
     *
     * @param {number} durationMs - Total response time in milliseconds
     * @param {boolean} [success=true] - Whether turn was successful
     * @returns {any} { avgResponseTime, trend }
     */
    recordResponseTime(durationMs, success = true) {
        const entry = {
            timestamp: Date.now(),
            duration: durationMs,
            success,
            turnNumber: this.turnCount,
        };

        this.responseTimes.push(entry);

        // Keep only last N entries
        const { MAX_RESPONSE_TIMES_STORED } = TRACKER_CONFIG;
        if (this.responseTimes.length > MAX_RESPONSE_TIMES_STORED) {
            this.responseTimes.shift();
        }

        // Calculate average
        const avgResponseTime = this._calculateAverageResponseTime();

        // Detect trend (improving/degrading)
        const trend = this._detectResponseTimeTrend();

        log(
            'DEBUG',
            `[SESSION_TRACKER] Response time recorded: ${durationMs}ms (avg: ${avgResponseTime}ms, trend: ${trend})`,
            this._getCorrelationId()
        );

        // Invalidate metrics cache
        this._cachedMetrics = null;

        return { avgResponseTime, trend };
    }

    /* ======================================================================
       PUBLIC API - Metrics Retrieval
    ====================================================================== */

    /**
     * Gets comprehensive session metrics.
     * Results are cached for 1s to avoid recalculation overhead.
     *
     * @returns {any} Session metrics
     */
    getMetrics() {
        const now = Date.now();

        // Return cached metrics if still valid
        if (this._cachedMetrics && now - this._metricsLastCalculated < this._metricsCacheDuration) {
            return this._cachedMetrics;
        }

        // Calculate fresh metrics
        const metrics = {
            // Core metrics
            turnCount: this.turnCount,
            sessionAge: now - this.sessionStartTime,
            lastTurnTime: this.lastTurnTime,
            timeSinceLastTurn: this.lastTurnTime ? now - this.lastTurnTime : null,

            // Response time metrics
            avgResponseTime: this._calculateAverageResponseTime(),
            minResponseTime: this._calculateMinResponseTime(),
            maxResponseTime: this._calculateMaxResponseTime(),
            recentResponseTimes: this.responseTimes.slice(-5).map(r => r.duration), // Last 5

            // Trend analysis
            responseTimeTrend: this._detectResponseTimeTrend(),

            // Health assessment
            sessionHealth: this._calculateSessionHealth(),
            healthLevel: this._getHealthLevel(),

            // Adaptive timeout calculation
            timeoutMultiplier: this._calculateTimeoutMultiplier(),

            // Metadata
            timestamp: now,
        };

        // Cache metrics
        this._cachedMetrics = metrics;
        this._metricsLastCalculated = now;

        return metrics;
    }

    /**
     * Gets session health score and level.
     * Quick method for health checks.
     *
     * @returns {any} { score, level, factors }
     */
    getSessionHealth() {
        const metrics = /** @type {any} */ (this.getMetrics());

        return {
            score: metrics.sessionHealth,
            level: metrics.healthLevel,
            factors: this._getHealthFactors(),
        };
    }

    /**
     * Gets timeout multiplier for adaptive timeout adjustment.
     * Used by BaseDriver to adjust timeouts dynamically.
     *
     * @returns {number} Timeout multiplier (1.0 - 5.0)
     */
    getTimeoutMultiplier() {
        return /** @type {any} */ (this.getMetrics()).timeoutMultiplier;
    }

    /**
     * Checks if session is considered "long" (needs higher timeouts).
     *
     * @returns {boolean} True if session has many turns
     */
    isLongSession() {
        const { LONG_SESSION_TURN_THRESHOLD } = TRACKER_CONFIG;
        return this.turnCount >= LONG_SESSION_TURN_THRESHOLD;
    }

    /**
     * Resets session metrics (e.g., after page reload).
     */
    reset() {
        log('INFO', '[SESSION_TRACKER] Resetting session metrics', this._getCorrelationId());

        this.turnCount = 0;
        this.responseTimes = [];
        this.sessionStartTime = Date.now();
        this.lastTurnTime = null;
        this._cachedMetrics = null;
    }

    /* ======================================================================
       INTERNAL - Response Time Calculations
    ====================================================================== */

    /**
     * Calculates average response time from recorded data.
     * @returns {number} Average in milliseconds (or 0 if no data)
     * @private
     */
    _calculateAverageResponseTime() {
        if (this.responseTimes.length === 0) return 0;

        const sum = this.responseTimes.reduce((acc, entry) => acc + entry.duration, 0);
        return Math.round(sum / this.responseTimes.length);
    }

    /**
     * Calculates minimum response time.
     * @returns {number} Min in milliseconds (or 0 if no data)
     * @private
     */
    _calculateMinResponseTime() {
        if (this.responseTimes.length === 0) return 0;
        return Math.min(...this.responseTimes.map(r => r.duration));
    }

    /**
     * Calculates maximum response time.
     * @returns {number} Max in milliseconds (or 0 if no data)
     * @private
     */
    _calculateMaxResponseTime() {
        if (this.responseTimes.length === 0) return 0;
        return Math.max(...this.responseTimes.map(r => r.duration));
    }

    /**
     * Detects response time trend (improving/degrading/stable).
     * Compares last 5 vs previous 5 response times.
     *
     * @returns {string} 'IMPROVING', 'DEGRADING', 'STABLE', or 'INSUFFICIENT_DATA'
     * @private
     */
    _detectResponseTimeTrend() {
        if (this.responseTimes.length < 10) return 'INSUFFICIENT_DATA';

        // Split into two halves (recent vs older)
        const half = Math.floor(this.responseTimes.length / 2);
        const older = this.responseTimes.slice(0, half);
        const recent = this.responseTimes.slice(half);

        // Calculate averages
        const olderAvg = older.reduce((acc, r) => acc + r.duration, 0) / older.length;
        const recentAvg = recent.reduce((acc, r) => acc + r.duration, 0) / recent.length;

        // Compare (20% threshold to avoid noise)
        const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

        if (changePercent > 20) return 'DEGRADING';
        if (changePercent < -20) return 'IMPROVING';
        return 'STABLE';
    }

    /* ======================================================================
       INTERNAL - Health Score Calculation
    ====================================================================== */

    /**
     * Calculates overall session health score (0-100).
     * Higher score = healthier session.
     *
     * Factors:
     * - Response time (40%): Lower is better
     * - Turn count (30%): Moderate is best (too low or too high penalized)
     * - Session age (30%): Younger is better
     *
     * @returns {number} Health score (0-100)
     * @private
     */
    _calculateSessionHealth() {
        const config = TRACKER_CONFIG;
        const metrics = {
            avgResponseTime: this._calculateAverageResponseTime(),
            sessionAge: Date.now() - this.sessionStartTime,
        };

        // 1. Response time score (40%)
        let responseScore = 100;
        if (metrics.avgResponseTime > config.VERY_SLOW_RESPONSE_THRESHOLD_MS) {
            responseScore = 20; // Very slow
        } else if (metrics.avgResponseTime > config.SLOW_RESPONSE_THRESHOLD_MS) {
            responseScore = 50; // Slow
        } else if (metrics.avgResponseTime > 5000) {
            responseScore = 75; // Moderate
        }

        // 2. Turn count score (30%)
        let turnScore = 100;
        if (this.turnCount === 0) {
            turnScore = 0; // No activity
        } else if (this.turnCount < 5) {
            turnScore = 70; // Low activity
        } else if (this.turnCount > config.VERY_LONG_SESSION_TURN_THRESHOLD) {
            turnScore = 50; // Very long session (potential degradation)
        } else if (this.turnCount > config.LONG_SESSION_TURN_THRESHOLD) {
            turnScore = 75; // Long session
        }

        // 3. Session age score (30%)
        let ageScore = 100;
        if (metrics.sessionAge > config.SESSION_AGE_CRITICAL_MS) {
            ageScore = 30; // Critical age
        } else if (metrics.sessionAge > config.SESSION_AGE_WARNING_MS) {
            ageScore = 60; // Warning age
        }

        // Weighted average
        const healthScore = Math.round(
            responseScore * config.HEALTH_WEIGHT_RESPONSE_TIME +
                turnScore * config.HEALTH_WEIGHT_TURN_COUNT +
                ageScore * config.HEALTH_WEIGHT_SESSION_AGE
        );

        return Math.max(0, Math.min(100, healthScore)); // Clamp 0-100
    }

    /**
     * Converts health score to level enum.
     * @returns {string} Health level (EXCELLENT, GOOD, FAIR, DEGRADED, CRITICAL)
     * @private
     */
    _getHealthLevel() {
        const score = this._calculateSessionHealth();

        if (score >= 90) return HEALTH_LEVELS.EXCELLENT;
        if (score >= 70) return HEALTH_LEVELS.GOOD;
        if (score >= 50) return HEALTH_LEVELS.FAIR;
        if (score >= 30) return HEALTH_LEVELS.DEGRADED;
        return HEALTH_LEVELS.CRITICAL;
    }

    /**
     * Gets detailed health factors for debugging.
     * @returns {any} Health contributing factors
     * @private
     */
    _getHealthFactors() {
        const config = TRACKER_CONFIG;
        const avgResponseTime = this._calculateAverageResponseTime();
        const sessionAge = Date.now() - this.sessionStartTime;

        return {
            responseTime: {
                avg: avgResponseTime,
                isSlow: avgResponseTime > config.SLOW_RESPONSE_THRESHOLD_MS,
                isVerySlow: avgResponseTime > config.VERY_SLOW_RESPONSE_THRESHOLD_MS,
            },
            turnCount: {
                count: this.turnCount,
                isLong: this.turnCount >= config.LONG_SESSION_TURN_THRESHOLD,
                isVeryLong: this.turnCount >= config.VERY_LONG_SESSION_TURN_THRESHOLD,
            },
            sessionAge: {
                age: sessionAge,
                isWarning: sessionAge > config.SESSION_AGE_WARNING_MS,
                isCritical: sessionAge > config.SESSION_AGE_CRITICAL_MS,
            },
        };
    }

    /* ======================================================================
       INTERNAL - Adaptive Timeout Calculation
    ====================================================================== */

    /**
     * Calculates timeout multiplier based on session characteristics.
     * Used by BaseDriver for adaptive timeout adjustment.
     *
     * Rules:
     * - Long sessions (10-20 turns): 1.5x
     * - Very long sessions (20+ turns): 2.0x
     * - Slow avg response (10-30s): 1.5x
     * - Very slow avg response (30s+): 2.5x
     * - Aged sessions (30+ min): 1.3x
     * - Old sessions (60+ min): 1.5x
     * - Maximum cap: 5.0x
     *
     * @returns {number} Timeout multiplier (1.0 - 5.0)
     * @private
     */
    _calculateTimeoutMultiplier() {
        const config = TRACKER_CONFIG;
        const multipliers = TIMEOUT_MULTIPLIERS;
        /** @type {number} */
        let totalMultiplier = multipliers.BASE;

        const avgResponseTime = this._calculateAverageResponseTime();
        const sessionAge = Date.now() - this.sessionStartTime;

        // Turn count adjustments
        if (this.turnCount >= config.VERY_LONG_SESSION_TURN_THRESHOLD) {
            totalMultiplier *= multipliers.VERY_LONG_SESSION;
        } else if (this.turnCount >= config.LONG_SESSION_TURN_THRESHOLD) {
            totalMultiplier *= multipliers.LONG_SESSION;
        }

        // Response time adjustments
        if (avgResponseTime >= config.VERY_SLOW_RESPONSE_THRESHOLD_MS) {
            totalMultiplier *= multipliers.VERY_SLOW_RESPONSES;
        } else if (avgResponseTime >= config.SLOW_RESPONSE_THRESHOLD_MS) {
            totalMultiplier *= multipliers.SLOW_RESPONSES;
        }

        // Session age adjustments
        if (sessionAge >= config.SESSION_AGE_CRITICAL_MS) {
            totalMultiplier *= multipliers.OLD_SESSION;
        } else if (sessionAge >= config.SESSION_AGE_WARNING_MS) {
            totalMultiplier *= multipliers.AGED_SESSION;
        }

        // Apply cap
        totalMultiplier = Math.min(totalMultiplier, multipliers.MAX_MULTIPLIER);

        // Round to 1 decimal place
        return Math.round(totalMultiplier * 10) / 10;
    }

    /* ======================================================================
       UTILITIES
    ====================================================================== */

    /**
     * Gets correlation ID from parent driver.
     * @returns {string} Correlation ID
     * @private
     */
    _getCorrelationId() {
        return /** @type {any} */ (this.driver)?.correlationId || 'no-correlation';
    }
}

export default PageSessionTracker;

/**
 * Níveis de saúde da sessão
 *
 * **Side-effects:** N/A
 * **Semântica:** Enumeração de níveis de saúde para avaliação de qualidade da sessão.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { HEALTH_LEVELS };

/**
 * Multiplicadores de timeout adaptativos
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações para ajuste dinâmico de timeouts baseado no histórico da sessão.
 * **Unidades:** Números decimais para multiplicadores.
 *
 * @type {Object<string, number>}
 */
export { TIMEOUT_MULTIPLIERS };

/**
 * Configurações do tracker de sessão
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de limites e intervalos para monitoramento de sessão.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, any>}
 */
export { TRACKER_CONFIG };
