// @ts-check
/**
 * Projection family: usage.
 */

import { normalizeTerminalModelBillingProjection, readTerminalRuntimeBase } from './shared.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     contextWindow: import('./shared.js').ContextWindowProjection | null;
 *     pr: Record<string, any> | null;
 *     modelBilling: import('./shared.js').TerminalModelBillingProjection;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeSessionId: string | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 * }}
 */
export function readTerminalUsageNowProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const pr = /** @type {Record<string, any> | null} */ (base.lastPrInfo ?? null);
    return {
        contextWindow: base.contextWindow,
        pr,
        modelBilling: normalizeTerminalModelBillingProjection(pr, String(base.snap['model'] ?? base.model ?? '')),
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeSessionId: base.runtimeSessionId,
        binding: base.binding,
    };
}
