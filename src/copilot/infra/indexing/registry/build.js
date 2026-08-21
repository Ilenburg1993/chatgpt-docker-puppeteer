// @ts-check
/** Coalesced directory index build orchestration. */

import { beginIoAdvisoryBudget } from '#copilot/infra/internal/telemetry';
import { resolve } from 'node:path';
import { adoptIoIndexAutoRefreshDomain, requestIoIndexAutoRefreshDrain } from './refresh/index.js';
import { getIoIndex } from './runtime/index.js';
import { inflightIndexBuilds } from './state/index.js';

/**
 * @param {string} directory
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['indexDirectory']>[1] & {
 *     adoptAutoRefreshDomain?: boolean;
 * }} [options]
 */
export async function buildIoIndexForDirectory(directory, options = {}) {
    if (options.adoptAutoRefreshDomain === true) adoptIoIndexAutoRefreshDomain(directory, options);
    const index = getIoIndex();
    if (!index) {
        return {
            available: false,
            indexed: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
            reason: 'index-unavailable',
        };
    }

    const normalizedDirectory = resolve(directory);
    const key = JSON.stringify([
        normalizedDirectory,
        options.workspaceRoot ? resolve(options.workspaceRoot) : null,
        options.recursive ?? null,
        options.depth ?? null,
        options.respectGitignore ?? null,
        options.concurrency ?? null,
        options.maxFiles ?? null,
        options.pruneMissing ?? null,
        options.extensions ? [...options.extensions].map((ext) => String(ext).toLowerCase()).sort() : null,
        options.include ? [...options.include].map(String).sort() : null,
        options.exclude ? [...options.exclude].map(String).sort() : null,
    ]);

    const mayCoalesce = options.signal === undefined;
    const inflight = mayCoalesce ? inflightIndexBuilds.get(key) : null;
    if (inflight) {
        return /** @type {Awaited<ReturnType<typeof index.indexDirectory>>} */ (await inflight);
    }

    const budget = beginIoAdvisoryBudget({
        operation: 'index.build',
    });
    const buildPromise = (async () => {
        try {
            return await index.indexDirectory(directory, options);
        } finally {
            budget.finish();
            if (mayCoalesce) inflightIndexBuilds.delete(key);
            requestIoIndexAutoRefreshDrain();
        }
    })();

    if (mayCoalesce) inflightIndexBuilds.set(key, buildPromise);
    return await buildPromise;
}
