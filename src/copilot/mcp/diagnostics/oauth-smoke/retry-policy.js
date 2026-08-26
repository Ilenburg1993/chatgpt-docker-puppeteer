// @ts-check
/** Bounded transient retry policy for OAuth/MCP connector smoke probes. */

/**
 * @typedef {{ retryAttempts: number; retryBaseDelayMs: number; retryMaxDelayMs: number }} OAuthSmokeRetryPolicy
 */

/**
 * @template {Record<string, unknown> & { ok: boolean; transient?: boolean; attempts?: number }} T
 * @param {() => Promise<T>} operation
 * @param {OAuthSmokeRetryPolicy} policy
 * @param {(probe: T) => boolean} isTransient
 * @returns {Promise<T>}
 */
export async function retryOAuthSmokeOperation(operation, policy, isTransient) {
    /** @type {T | null} */
    let last = null;
    for (let attempt = 1; attempt <= policy.retryAttempts; attempt += 1) {
        last = await operation();
        last.attempts = attempt;
        if (last.ok || !isTransient(last) || attempt >= policy.retryAttempts) return last;
        await sleep(computeOAuthSmokeBackoffMs(attempt, policy));
    }
    if (last === null) throw new Error('OAuth smoke retry policy requires at least one attempt.');
    return last;
}

/** @param {number | undefined} status */
export function isTransientOAuthSmokeHttpStatus(status) {
    if (!status) return true;
    return (
        status === 429 ||
        status === 530 ||
        status === 520 ||
        status === 521 ||
        status === 522 ||
        status === 523 ||
        status === 524 ||
        status === 525 ||
        status === 526 ||
        status === 527 ||
        status === 502 ||
        status === 503 ||
        status === 504
    );
}

/** @param {number} attempt @param {OAuthSmokeRetryPolicy} policy */
function computeOAuthSmokeBackoffMs(attempt, policy) {
    const exponential = policy.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    const jitter = Math.floor(Math.random() * Math.max(1, policy.retryBaseDelayMs));
    return Math.min(policy.retryMaxDelayMs, exponential + jitter);
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
