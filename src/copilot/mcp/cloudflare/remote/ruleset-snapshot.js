// @ts-check
/**
 * Shared short-lived Cloudflare zone-ruleset snapshot for MCP diagnostics.
 *
 * Edge/config/skip audits inspect overlapping ruleset families. Fetching list + details independently in each audit
 * multiplies remote latency. This module materializes one bounded in-process snapshot, keyed by a non-reversible token
 * fingerprint + zone id, and reuses it for a short diagnostic window. No credential or mutable Cloudflare object is
 * returned in the snapshot.
 *
 * @module copilot/mcp/cloudflare/ruleset-snapshot
 */

import { createTtlCache } from '#copilot/infra/public/cache/ttl';
import { createHash } from 'node:crypto';
import { getCloudflareClient } from './remote-api.js';

export const DEFAULT_CLOUDFLARE_RULESET_SNAPSHOT_TTL_MS = 60_000;
const MAX_RULESET_DETAIL_CONCURRENCY = 6;

/**
 * @typedef {{
 *     rulesets: unknown[];
 *     listCount: number;
 *     detailCount: number;
 *     fetchedAtMs: number;
 *     durationMs: number;
 * }} CloudflareRulesetSnapshot
 */

/** @type {import('#copilot/infra/public/cache/ttl').TtlCache<CloudflareRulesetSnapshot>} */
const rulesetSnapshotCache = createTtlCache({
    name: 'cloudflare-ruleset-snapshot',
    ttlMs: DEFAULT_CLOUDFLARE_RULESET_SNAPSHOT_TTL_MS,
    maxEntries: 16,
});

/**
 * @param {{ apiToken: string; zoneId: string; cacheTtlMs?: number; forceRefresh?: boolean }} options
 * @returns {Promise<CloudflareRulesetSnapshot>}
 */
export async function readCloudflareRulesetSnapshot(options) {
    const cacheKey = `${fingerprintToken(options.apiToken)}:${options.zoneId}`;
    return rulesetSnapshotCache.getOrLoad(cacheKey, () => loadRulesetSnapshot(options.apiToken, options.zoneId), {
        forceRefresh: options.forceRefresh === true,
        ttlMs: normalizeSnapshotTtl(options.cacheTtlMs),
    });
}

/**
 * @param {string} apiToken
 * @param {string} zoneId
 * @returns {Promise<CloudflareRulesetSnapshot>}
 */
async function loadRulesetSnapshot(apiToken, zoneId) {
    const startedAt = Date.now();
    const client = getCloudflareClient(apiToken);
    /** @type {unknown[]} */
    const summaries = [];
    for await (const ruleset of client.rulesets.list({ zone_id: zoneId })) summaries.push(ruleset);

    const detailed = await mapConcurrent(summaries, MAX_RULESET_DETAIL_CONCURRENCY, async (ruleset) => {
        const record = asRecord(ruleset);
        const id = typeof record['id'] === 'string' ? record['id'] : '';
        return id ? await client.rulesets.get(id, { zone_id: zoneId }) : ruleset;
    });

    return {
        rulesets: detailed,
        listCount: summaries.length,
        detailCount: detailed.length,
        fetchedAtMs: Date.now(),
        durationMs: Math.max(0, Date.now() - startedAt),
    };
}

/**
 * @template T,U
 * @param {T[]} values
 * @param {number} concurrency
 * @param {(value: T, index: number) => Promise<U>} worker
 * @returns {Promise<U[]>}
 */
async function mapConcurrent(values, concurrency, worker) {
    /** @type {U[]} */
    const output = new Array(values.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (true) {
            const index = next;
            next += 1;
            if (index >= values.length) return;
            output[index] = await worker(/** @type {T} */ (values[index]), index);
        }
    });
    await Promise.all(workers);
    return output;
}

/** @param {number | undefined} value */
function normalizeSnapshotTtl(value) {
    if (value === undefined) return DEFAULT_CLOUDFLARE_RULESET_SNAPSHOT_TTL_MS;
    return Number.isFinite(value) && value >= 0 && value <= 300_000
        ? Math.floor(value)
        : DEFAULT_CLOUDFLARE_RULESET_SNAPSHOT_TTL_MS;
}

/** @param {string} token */
function fingerprintToken(token) {
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}
