// @ts-check
/** Best-effort error reporting for intentionally swallowed failures. */
import { toError } from '#copilot/infra/public/platform/error';
import { defaultErrorTracker } from './error-tracker.js';
import { log } from './logger.js';

/** @param {unknown} error @param {string} context */
export function logSwallowed(error, context) {
    const normalized = toError(error);
    try {
        log('DEBUG', `[swallowed:${context}] ${normalized.message}`);
    } catch {
        /* reporting never changes control flow */
    }
    try {
        defaultErrorTracker.trackError(error, { source: `swallowed:${context}` });
    } catch {
        /* reporting never changes control flow */
    }
}

/** @template T @param {()=>Promise<T>} fn @param {string} context @returns {Promise<T|undefined>} */
export async function wrapAsync(fn, context) {
    try {
        return await fn();
    } catch (error) {
        logSwallowed(error, context);
        return undefined;
    }
}
