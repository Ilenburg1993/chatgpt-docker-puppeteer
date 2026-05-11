// @ts-check
/**
 * Audit trail de decisões de hooks no domínio de auditoria.
 *
 * @module copilot/audit/hook-audit-trail
 */

import { log } from './logger.js';

export class AuditTrail {
    /** @type {(Record<string, unknown> | undefined)[]} */
    #buffer;

    /** @type {number} */
    #maxSize;

    /** @type {number} */
    #writeIndex = 0;

    /** @type {number} */
    #count = 0;

    /**
     * @param {{ maxSize?: number }} [opts]
     */
    constructor(opts) {
        this.#maxSize = opts?.maxSize ?? 1000;
        this.#buffer = new Array(this.#maxSize);
    }

    /**
     * @param {Record<string, unknown>} decision
     * @returns {void}
     */
    record(decision) {
        this.#buffer[this.#writeIndex] = decision;
        this.#writeIndex = (this.#writeIndex + 1) % this.#maxSize;
        if (this.#count < this.#maxSize) this.#count++;

        log(
            'DEBUG',
            `[audit/hook-audit-trail] ${String(decision['hookName'] ?? 'unknown')}: ${String(decision['decision'] ?? 'unknown')} session=${String(decision['sessionId'] ?? '')}`,
        );
    }

    /**
     * @param {number} [n]
     * @returns {Record<string, unknown>[]}
     */
    tail(n) {
        const count = Math.min(n ?? this.#count, this.#count);
        /** @type {Record<string, unknown>[]} */
        const result = [];
        for (let i = 0; i < count; i++) {
            const idx = (this.#writeIndex - 1 - i + this.#maxSize) % this.#maxSize;
            const entry = this.#buffer[idx];
            if (entry) result.push(entry);
        }
        return result;
    }

    /**
     * @param {{
     *     hookName?: string;
     *     decision?: string;
     *     sessionId?: string;
     *     toolName?: string;
     *     since?: number;
     * }} filter
     * @returns {Record<string, unknown>[]}
     */
    query(filter) {
        const all = this.tail();
        return all.filter((d) => {
            if (filter.hookName && d['hookName'] !== filter.hookName) return false;
            if (filter.decision && d['decision'] !== filter.decision) return false;
            if (filter.sessionId && d['sessionId'] !== filter.sessionId) return false;
            if (filter.toolName && d['toolName'] !== filter.toolName) return false;
            if (filter.since && typeof d['timestamp'] === 'number' && d['timestamp'] < filter.since) return false;
            return true;
        });
    }

    /**
     * @returns {{
     *     total: number;
     *     byDecision: Record<string, number>;
     *     byHook: Record<string, number>;
     *     deniedCount: number;
     *     allowedCount: number;
     *     errorCount: number;
     * }}
     */
    stats() {
        const all = this.tail();
        /** @type {Record<string, number>} */
        const byDecision = {};
        /** @type {Record<string, number>} */
        const byHook = {};
        let deniedCount = 0;
        let allowedCount = 0;
        let errorCount = 0;

        for (const d of all) {
            const decision = String(d['decision'] ?? 'unknown');
            const hookName = String(d['hookName'] ?? 'unknown');
            byDecision[decision] = (byDecision[decision] ?? 0) + 1;
            byHook[hookName] = (byHook[hookName] ?? 0) + 1;
            if (decision === 'deny') deniedCount++;
            if (decision === 'allow') allowedCount++;
            if (decision === 'abort') errorCount++;
        }

        return {
            total: all.length,
            byDecision,
            byHook,
            deniedCount,
            allowedCount,
            errorCount,
        };
    }

    /**
     * @returns {{ decisions: Record<string, unknown>[]; stats: ReturnType<AuditTrail['stats']> }}
     */
    toJSON() {
        return {
            decisions: this.tail(),
            stats: this.stats(),
        };
    }

    /** @returns {void} */
    clear() {
        this.#buffer = new Array(this.#maxSize);
        this.#writeIndex = 0;
        this.#count = 0;
    }

    /** @returns {number} */
    get size() {
        return this.#count;
    }
}

/** @type {AuditTrail} */
export const globalAuditTrail = new AuditTrail({ maxSize: 2000 });

/**
 * @param {import('#copilot/sdk/types').PreToolUseHandler} handler
 * @param {AuditTrail} [trail]
 * @returns {import('#copilot/sdk/types').PreToolUseHandler}
 */
export function withPreToolAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);
        const decision = result?.permissionDecision ?? 'allow';
        const hasModifiedArgs = result?.modifiedArgs !== undefined;

        t.record({
            hookName: 'onPreToolUse',
            decision: hasModifiedArgs ? 'modify' : decision,
            sessionId: invocation?.sessionId ?? '',
            toolName: input.toolName,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
            ...(result?.additionalContext ? { reason: result.additionalContext } : {}),
        });

        return result;
    };
}

/**
 * @param {import('#copilot/sdk/types').PostToolUseHandler} handler
 * @param {AuditTrail} [trail]
 * @returns {import('#copilot/sdk/types').PostToolUseHandler}
 */
export function withPostToolAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);
        const hasContext = result?.additionalContext !== undefined;
        t.record({
            hookName: 'onPostToolUse',
            decision: hasContext ? 'enrich' : 'allow',
            sessionId: invocation?.sessionId ?? '',
            toolName: input.toolName,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
        });
        return result;
    };
}

/**
 * @param {import('#copilot/sdk/types').ErrorOccurredHandler} handler
 * @param {AuditTrail} [trail]
 * @returns {import('#copilot/sdk/types').ErrorOccurredHandler}
 */
export function withErrorAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);

        t.record({
            hookName: 'onErrorOccurred',
            decision: result?.errorHandling ?? 'abort',
            sessionId: invocation?.sessionId ?? '',
            reason: `${input.errorContext}: ${String(input.error ?? '')}`,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
            metadata: { recoverable: input.recoverable },
        });

        return result;
    };
}
