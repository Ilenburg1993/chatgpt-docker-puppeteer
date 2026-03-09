// @ts-check
/**
 * Circuit Breaker for Ollama API Calls
 *
 * Prevents thundering herd and cascading failures when Ollama is unavailable. Based on circuit_breaker.js pattern from
 * browser pool.
 *
 * States:
 *
 * - CLOSED: Normal operation (all requests allowed)
 * - OPEN: Too many failures (requests rejected for timeout period)
 * - HALF_OPEN: Testing recovery (1 request allowed to probe)
 *
 * Transitions:
 *
 * - CLOSED → OPEN: After N consecutive failures
 * - OPEN → HALF_OPEN: After timeout period
 * - HALF_OPEN → CLOSED: After M consecutive successes
 * - HALF_OPEN → OPEN: After any failure
 *
 * Usage:
 *
 * ```javascript
 * import { getCircuitBreaker } from './ollama-circuit-breaker.mjs';
 *
 * const breaker = getCircuitBreaker('cloud');
 *
 * if (!breaker.allowRequest()) {
 *   throw new Error('Circuit breaker OPEN - service unavailable');
 * }
 *
 * try {
 *   const result = await ollamaClient.generate(...);
 *   breaker.recordSuccess();
 *   return result;
 * } catch (error) {
 *   breaker.recordFailure();
 *   throw error;
 * }
 * ```
 */

import { log } from '#core/logger';

/**
 * Circuit states
 *
 * @enum {string}
 */
const CircuitState = Object.freeze({
    CLOSED: 'CLOSED', // Normal operation
    OPEN: 'OPEN', // Circuit open (reject calls)
    HALF_OPEN: 'HALF_OPEN', // Testing recovery
});

/**
 * Circuit Breaker for Ollama (prevent thundering herd)
 *
 * Implements 3-state circuit breaker pattern with sliding window for failure rate tracking.
 */
export class OllamaCircuitBreaker {
    /**
     * @param {object} options - Circuit breaker configuration
     * @param {number} [options.failureThreshold=5] - Consecutive failures to open circuit. Default is `5`
     * @param {number} [options.successThreshold=2] - Consecutive successes to close circuit (from half-open). Default
     *   is `2`
     * @param {number} [options.timeout=60000] - Milliseconds before trying half-open (60s). Default is `60000`
     * @param {number} [options.windowSize=10] - Number of recent calls to track for failure rate. Default is `10`
     */
    constructor({ failureThreshold = 5, successThreshold = 2, timeout = 60000, windowSize = 10 } = {}) {
        /** @type {'CLOSED' | 'OPEN' | 'HALF_OPEN'} */
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.failureThreshold = failureThreshold;
        this.successThreshold = successThreshold;
        this.timeout = timeout;

        this.lastFailureTime = 0;
        this.nextAttemptTime = 0;

        // Sliding window for failure rate calculation
        /** @type {any[]} */ this.callHistory = []; // Array of {timestamp, success: boolean}
        this.windowSize = windowSize;
    }

    /**
     * Check if request is allowed
     *
     * @returns {boolean} True if request should proceed
     */
    allowRequest() {
        const now = Date.now();

        switch (this.state) {
            case CircuitState.CLOSED:
                return true;

            case CircuitState.OPEN:
                // Check if timeout expired → transition to HALF_OPEN
                if (now >= this.nextAttemptTime) {
                    this.state = CircuitState.HALF_OPEN;
                    this.successCount = 0;
                    log('INFO', '[OllamaCircuitBreaker] Entering HALF_OPEN (testing recovery)');
                    return true;
                }
                return false;

            case CircuitState.HALF_OPEN:
                // In half-open, allow requests to test recovery
                return true;

            default:
                return false;
        }
    }

    /**
     * Record successful call
     */
    recordSuccess() {
        this.failureCount = 0;
        this._recordCall(true);

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = CircuitState.CLOSED;
                log('INFO', '[OllamaCircuitBreaker] Circuit CLOSED (recovery successful)');
            }
        }
    }

    /**
     * Record failed call
     */
    recordFailure() {
        this.lastFailureTime = Date.now();
        this._recordCall(false);

        switch (this.state) {
            case CircuitState.CLOSED:
                this.failureCount++;
                if (this.failureCount >= this.failureThreshold) {
                    this._openCircuit();
                }
                break;

            case CircuitState.HALF_OPEN:
                // Single failure in half-open → back to open
                this._openCircuit();
                break;

            // OPEN state: already open, just record
        }
    }

    /**
     * Open circuit (transition to OPEN state)
     *
     * @private
     */
    _openCircuit() {
        this.state = CircuitState.OPEN;
        this.nextAttemptTime = Date.now() + this.timeout;
        this.successCount = 0;

        const failureRate = this._getFailureRate();
        log(
            'ERROR',
            `[OllamaCircuitBreaker] Circuit OPEN (${this.failureCount} consecutive failures, ` +
                `${Math.round(failureRate * 100)}% failure rate, retry in ${this.timeout}ms)`,
        );
    }

    /**
     * Record call in sliding window
     *
     * @private
     * @param {boolean} success
     */
    _recordCall(success) {
        this.callHistory.push({ timestamp: Date.now(), success });

        // Keep only windowSize recent calls
        if (this.callHistory.length > this.windowSize) {
            this.callHistory.shift();
        }
    }

    /**
     * Calculate failure rate from sliding window
     *
     * @private
     * @returns {number} Failure rate (0.0-1.0)
     */
    _getFailureRate() {
        if (this.callHistory.length === 0) return 0;

        const failures = this.callHistory.filter((c) => !c.success).length;
        return failures / this.callHistory.length;
    }

    /**
     * Get current circuit breaker status
     *
     * @returns {any} Status object with current state and metrics
     */
    getStatus() {
        const now = Date.now();
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            failureRate: this._getFailureRate(),
            nextAttemptTime: this.nextAttemptTime,
            nextAttemptIn: this.state === CircuitState.OPEN ? Math.max(0, this.nextAttemptTime - now) : 0,
            callHistorySize: this.callHistory.length,
            lastFailureTime: this.lastFailureTime,
        };
    }

    /**
     * Force circuit to CLOSED state (manual recovery)
     *
     * Use this for manual intervention or testing.
     */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        /** @type {any[]} */ this.callHistory = [];
        this.lastFailureTime = 0;
        this.nextAttemptTime = 0;
        log('INFO', '[OllamaCircuitBreaker] Circuit manually RESET to CLOSED');
    }

    /**
     * Check if circuit is currently open
     *
     * @returns {boolean} True if circuit is open
     */
    isOpen() {
        return this.state === CircuitState.OPEN;
    }

    /**
     * Check if circuit is currently closed
     *
     * @returns {boolean} True if circuit is closed
     */
    isClosed() {
        return this.state === CircuitState.CLOSED;
    }

    /**
     * Check if circuit is half-open (testing recovery)
     *
     * @returns {boolean} True if circuit is half-open
     */
    isHalfOpen() {
        return this.state === CircuitState.HALF_OPEN;
    }
}

/**
 * Singleton circuit breakers per endpoint
 *
 * @type {Map<string, OllamaCircuitBreaker>}
 */
const circuitBreakers = new Map();

/**
 * @typedef {object} GetCircuitBreakerOptions
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Get circuit breaker for endpoint (singleton)
 *
 * @example
 *     // Get breaker for Ollama cloud
 *     const cloudBreaker = getCircuitBreaker('cloud');
 *
 *     // Get breaker for local Ollama
 *     const localBreaker = getCircuitBreaker('local');
 *
 * @param {string} endpoint - Endpoint identifier ('cloud' or 'local')
 * @param {GetCircuitBreakerOptions} [options] - Circuit breaker options (only used if creating new instance)
 * @returns {OllamaCircuitBreaker} Circuit breaker instance
 */
export function getCircuitBreaker(/** @type {any} */ endpoint, /** @type {any} */ options = {}) {
    if (!circuitBreakers.has(endpoint)) {
        // Apply env var overrides
        const config = {
            failureThreshold: Number(process.env.OLLAMA_CIRCUIT_BREAKER_FAILURE_THRESHOLD || 5),
            successThreshold: Number(process.env.OLLAMA_CIRCUIT_BREAKER_SUCCESS_THRESHOLD || 2),
            timeout: Number(process.env.OLLAMA_CIRCUIT_BREAKER_TIMEOUT || 60000),
            windowSize: Number(process.env.OLLAMA_CIRCUIT_BREAKER_WINDOW_SIZE || 10),
            ...options,
        };

        circuitBreakers.set(endpoint, new OllamaCircuitBreaker(config));
        log('INFO', `[OllamaCircuitBreaker] Created circuit breaker for endpoint: ${endpoint}`);
    }

    return /** @type {any} */ (circuitBreakers.get(endpoint));
}

/**
 * Get all circuit breaker statuses
 *
 * @example
 *     const statuses = getAllStatuses();
 *     // { cloud: { state: 'CLOSED', failureRate: 0.0, ... }, local: { ... } }
 *
 * @returns {any} Map of endpoint → status
 */
export function getAllStatuses() {
    const statuses = {};
    for (const [endpoint, breaker] of circuitBreakers.entries()) {
        /** @type {any} */ (statuses)[endpoint] = breaker.getStatus();
    }
    return statuses;
}

/**
 * Reset all circuit breakers (for testing)
 *
 * @returns {void}
 */
export function resetAll() {
    for (const breaker of circuitBreakers.values()) {
        breaker.reset();
    }
}
