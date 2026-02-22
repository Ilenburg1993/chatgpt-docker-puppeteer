// @ts-check - Type checking rigoroso habilitado (arquivo core)

/**
 * Normaliza inteiro positivo para parâmetros de retry/backoff.
 *
 * @param {unknown} rawValue
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveInt(rawValue, fallback) {
    const parsed = Number.parseInt(String(rawValue ?? fallback), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Calcula atraso exponencial com jitter para políticas de retry.
 *
 * @param {number} attempt
 * @param {number} baseDelayMs
 * @param {number} maxDelayMs
 * @param {number} [jitterRatio=0.2]
 * @returns {number}
 */
function computeExponentialBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio = 0.2) {
    const normalizedAttempt = Math.max(1, Number(attempt) || 1);
    const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (normalizedAttempt - 1));
    const jitterWindow = Math.max(1, Math.floor(exponentialDelay * jitterRatio));
    const jitterMs = Math.floor(Math.random() * jitterWindow);
    return exponentialDelay + jitterMs;
}

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{
 *   maxAttempts: number,
 *   baseDelayMs: number,
 *   maxDelayMs: number,
 *   jitterRatio?: number,
 *   onRetry?: (ctx: { attempt: number, maxAttempts: number, error: unknown, delayMs: number }) => Promise<void>|void
 * }} config
 * @returns {Promise<T>}
 */
async function retryWithBackoff(operation, config) {
    const maxAttempts = readPositiveInt(config?.maxAttempts, 3);
    const baseDelayMs = readPositiveInt(config?.baseDelayMs, 1000);
    const maxDelayMs = readPositiveInt(config?.maxDelayMs, 8000);
    const jitterRatio = Number.isFinite(config?.jitterRatio) ? Number(config.jitterRatio) : 0.2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts) break;

            const delayMs = computeExponentialBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio);
            if (typeof config?.onRetry === 'function') {
                await config.onRetry({ attempt, maxAttempts, error, delayMs });
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'retry exhausted'));
}

export { computeExponentialBackoffDelay, readPositiveInt, retryWithBackoff };
