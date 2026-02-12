/**
 * Error Classification for Tool Execution Retry Logic
 *
 * Integrates with existing error taxonomy from task_state_projector.js:
 * - ENV_UNAVAILABLE: Infrastructure failures (don't count attempts)
 * - TASK_ERROR: Application failures (count attempts)
 * - USER_ACTION_REQUIRED: Permanent failures (no retry)
 *
 * Usage:
 * ```javascript
 * import { classifyError, calculateBackoff } from './error-classifier.mjs';
 *
 * const classification = classifyError(error, { tool: 'ollama_generate', model: 'qwen3' });
 * if (classification.retryable) {
 *   const delay = calculateBackoff(attempt, classification.suggestedDelayMs);
 *   await sleep(delay);
 * }
 * ```
 */

/**
 * Error classification categories
 * @enum {string}
 */
export const ErrorClass = Object.freeze({
    TRANSIENT: 'TRANSIENT',       // Temporary failures (network blips) - retry immediately
    DEGRADED: 'DEGRADED',          // Service degraded (timeouts, rate limits) - retry with backoff
    PERMANENT: 'PERMANENT',        // Permanent failures (auth, invalid input) - don't retry
    CIRCUIT_OPEN: 'CIRCUIT_OPEN',  // Circuit breaker active - don't retry
});

/**
 * Retry strategies
 * @enum {string}
 */
export const RetryStrategy = Object.freeze({
    IMMEDIATE: 'IMMEDIATE',                      // Retry now (for very transient errors)
    EXPONENTIAL_BACKOFF: 'EXPONENTIAL_BACKOFF',  // Retry with backoff (standard)
    MODEL_FALLBACK: 'MODEL_FALLBACK',            // Try smaller/faster model
    NO_RETRY: 'NO_RETRY',                        // Give up (permanent error)
});

/**
 * Classify error for retry decision
 *
 * @param {Error} error - Error object from tool execution
 * @param {Object} context - Execution context
 * @param {string} [context.tool] - Tool name (e.g., 'ollama_generate')
 * @param {string} [context.model] - Model being used (for fallback suggestion)
 * @param {number} [context.attempt] - Current attempt number
 * @returns {Object} Classification result with strategy
 *
 * @example
 * const classification = classifyError(new Error('ECONNREFUSED'), {
 *   tool: 'ollama_models',
 *   attempt: 1
 * });
 * // Returns: {
 * //   errorClass: 'TRANSIENT',
 * //   reasonClass: 'ENV_UNAVAILABLE',
 * //   reasonCode: 'NETWORK_ERROR',
 * //   strategy: 'EXPONENTIAL_BACKOFF',
 * //   retryable: true,
 * //   countAttempt: false,
 * //   suggestedDelayMs: 1000
 * // }
 */
export function classifyError(error, context = {}) {
    const msg = String(error?.message || '');
    const name = String(error?.name || '');
    const code = String(error?.code || '');

    // 1. TRANSIENT: Network failures, temporary unavailability
    // These are infrastructure issues that often resolve quickly
    if (
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('Network request failed') ||
        msg.includes('fetch failed') ||
        name === 'FetchError' ||
        name === 'NetworkError'
    ) {
        return {
            errorClass: ErrorClass.TRANSIENT,
            reasonClass: 'ENV_UNAVAILABLE',  // Maps to existing taxonomy
            reasonCode: 'NETWORK_ERROR',
            strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
            retryable: true,
            countAttempt: false,  // Don't consume retry budget for infra issues
            suggestedDelayMs: 1000,  // 1s base backoff for network issues
            message: 'Network connectivity issue - will retry with backoff',
        };
    }

    // 2. DEGRADED: Timeouts, rate limits, service overload
    if (
        msg.includes('timeout') ||
        msg.includes('timed out') ||
        msg.includes('aborted') ||
        msg.includes('AbortError') ||
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('Too Many Requests') ||
        msg.includes('Service Unavailable') ||
        msg.includes('503') ||
        name === 'TimeoutError' ||
        name === 'AbortError'
    ) {
        // Special case: Ollama timeout → suggest model fallback
        const isOllamaTimeout =
            (context.tool?.includes('ollama') || msg.includes('Ollama')) &&
            (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted'));

        return {
            errorClass: ErrorClass.DEGRADED,
            reasonClass: 'ENV_UNAVAILABLE',  // Timeout is infrastructure issue
            reasonCode: isOllamaTimeout ? 'LLM_TIMEOUT' : 'TIMEOUT',
            strategy: isOllamaTimeout
                ? RetryStrategy.MODEL_FALLBACK
                : RetryStrategy.EXPONENTIAL_BACKOFF,
            retryable: true,
            countAttempt: false,  // Don't count timeouts as user errors
            suggestedDelayMs: msg.includes('rate limit') ? 5000 : 0,  // 5s for rate limits, 0 for timeout+fallback
            modelFallback: isOllamaTimeout ? getSmallerModel(context.model) : null,
            message: isOllamaTimeout
                ? `Timeout on ${context.model || 'model'} - will try smaller/faster model`
                : 'Service timeout or rate limit - will retry with backoff',
        };
    }

    // 3. PERMANENT: Auth failures, invalid input, not found
    // These won't succeed even with retries
    if (
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('Unauthorized') ||
        msg.includes('Forbidden') ||
        msg.includes('authentication failed') ||
        msg.includes('OLLAMA_CLOUD_API_KEY') ||
        msg.includes('API key') ||
        msg.includes('404') ||
        msg.includes('not found') ||
        msg.includes('Not Found') ||
        msg.includes('invalid') ||
        msg.includes('Invalid') ||
        msg.includes('Unknown tool') ||
        msg.includes('validation error') ||
        msg.includes('ValidationError') ||
        name === 'ValidationError'
    ) {
        const isAuthError = msg.includes('401') || msg.includes('403') ||
                          msg.includes('authentication') || msg.includes('Unauthorized');

        return {
            errorClass: ErrorClass.PERMANENT,
            reasonClass: 'TASK_ERROR',  // Count these attempts
            reasonCode: isAuthError ? 'AUTH_FAILURE' : 'INVALID_REQUEST',
            strategy: RetryStrategy.NO_RETRY,
            retryable: false,
            countAttempt: true,
            suggestedDelayMs: 0,
            message: isAuthError
                ? 'Authentication failure - check credentials'
                : 'Invalid request - fix parameters before retrying',
        };
    }

    // 4. CIRCUIT_OPEN: Circuit breaker active
    if (
        msg.includes('circuit') ||
        msg.includes('Circuit breaker') ||
        msg.includes('CIRCUIT_OPEN')
    ) {
        return {
            errorClass: ErrorClass.CIRCUIT_OPEN,
            reasonClass: 'ENV_UNAVAILABLE',
            reasonCode: 'CIRCUIT_OPEN',
            strategy: RetryStrategy.NO_RETRY,
            retryable: false,  // Don't retry while circuit open
            countAttempt: false,
            suggestedDelayMs: 30000,  // 30s before circuit might recover
            message: 'Service circuit breaker is open - wait before retrying',
        };
    }

    // 5. DEFAULT: Unknown errors → treat as degraded, be conservative
    // Better to retry unknown errors than fail immediately
    return {
        errorClass: ErrorClass.DEGRADED,
        reasonClass: 'TASK_ERROR',  // Count attempts by default for safety
        reasonCode: 'UNKNOWN_ERROR',
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        retryable: true,
        countAttempt: true,
        suggestedDelayMs: 2000,  // 2s base backoff for unknown errors
        message: 'Unknown error - will retry conservatively',
    };
}

/**
 * Get smaller/faster model for fallback
 *
 * Implements fallback chain: large cloud → medium local → small local
 *
 * @param {string} currentModel - Current model that timed out
 * @returns {string|null} Fallback model, or null if no fallback available
 *
 * @example
 * getSmallerModel('qwen3-coder-next')  // → 'qwen2.5-coder:7b'
 * getSmallerModel('qwen2.5-coder:3b')  // → null (already smallest)
 */
export function getSmallerModel(currentModel) {
    if (!currentModel) return null;

    // Fallback chain: cloud → local 7b → local 3b → null
    const fallbackChain = {
        // Cloud models (slow) → Local medium
        'qwen3-coder-next': 'qwen2.5-coder:7b',
        'qwen3-next': 'qwen2.5-coder:7b',
        'gemini-3-pro-preview': 'qwen2.5-coder:7b',

        // Local medium (moderate) → Local small
        'qwen2.5-coder:7b': 'qwen2.5-coder:3b',
        'qwen2.5-coder': 'qwen2.5-coder:3b',

        // Local small (fast) → No more fallbacks
        'qwen2.5-coder:3b': null,
        'qwen2.5-coder:1.5b': null,
    };

    return fallbackChain[currentModel] || null;
}

/**
 * Calculate exponential backoff with jitter
 *
 * Formula: delay = baseDelay * 2^(attempt-1) * jitter
 * Jitter: random value in [0.5, 1.0] to prevent thundering herd
 *
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} baseDelayMs - Base delay in milliseconds
 * @param {number} [maxDelayMs=60000] - Maximum delay cap (default 60s)
 * @returns {number} Calculated delay in milliseconds
 *
 * @example
 * calculateBackoff(1, 1000)  // → ~500-1000ms   (1s * 2^0 * [0.5-1.0])
 * calculateBackoff(2, 1000)  // → ~1000-2000ms  (1s * 2^1 * [0.5-1.0])
 * calculateBackoff(3, 1000)  // → ~2000-4000ms  (1s * 2^2 * [0.5-1.0])
 * calculateBackoff(10, 1000) // → ~30000-60000ms (capped at maxDelayMs)
 */
export function calculateBackoff(attempt, baseDelayMs, maxDelayMs = 60000) {
    // Exponential growth: 2^(attempt-1)
    const exponential = baseDelayMs * Math.pow(2, attempt - 1);

    // Cap at maxDelayMs to prevent runaway delays
    const capped = Math.min(exponential, maxDelayMs);

    // Jitter: random value in [0.5, 1.0]
    // Prevents synchronized retries (thundering herd problem)
    const jitter = 0.5 + Math.random() * 0.5;

    return Math.round(capped * jitter);
}

/**
 * Check if error is retryable based on classification
 *
 * @param {Error} error - Error to check
 * @param {Object} context - Context for classification
 * @returns {boolean} True if error is retryable
 *
 * @example
 * isRetryable(new Error('ECONNREFUSED'))  // → true
 * isRetryable(new Error('401 Unauthorized'))  // → false
 */
export function isRetryable(error, context = {}) {
    const classification = classifyError(error, context);
    return classification.retryable;
}

/**
 * Get human-readable error summary
 *
 * @param {Error} error - Error to summarize
 * @param {Object} context - Context for classification
 * @returns {string} Human-readable summary
 *
 * @example
 * getErrorSummary(new Error('ECONNREFUSED'))
 * // → "Network connectivity issue (TRANSIENT) - will retry with backoff"
 */
export function getErrorSummary(error, context = {}) {
    const classification = classifyError(error, context);
    return `${classification.message} (${classification.errorClass})`;
}
