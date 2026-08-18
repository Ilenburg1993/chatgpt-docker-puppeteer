// @ts-check
/**
 * Read-only Cloudflare GraphQL HTTP latency analytics for the published MCP route.
 *
 * This module is deliberately aggregate-only. It never requests client IPs, Ray IDs,
 * headers or user agents. Adaptive Analytics can be sampled, so the result is supporting
 * transport evidence rather than per-request ground truth.
 *
 * @module copilot/mcp/cloudflare/http-latency-analytics
 */

import { createTtlCache } from '#copilot/mcp/control-plane';
import { getCloudflareClient, readCloudflareRemoteApiConfig } from './remote-api.js';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const DEFAULT_WINDOW_MINUTES = 30;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_WINDOW_MINUTES = 24 * 60;

/** @type {import('#copilot/mcp/control-plane').TtlCache<Record<string, unknown> & { ok: boolean; available: boolean }>} */
const analyticsCache = createTtlCache({
    name: 'cloudflare-http-latency-analytics',
    ttlMs: DEFAULT_CACHE_TTL_MS,
    maxEntries: 16,
});

const QUERY = `
query McpHttpLatency($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      groups: httpRequestsAdaptiveGroups(limit: 100, orderBy: [count_DESC], filter: $filter) {
        count
        avg {
          sampleInterval
          edgeTimeToFirstByteMs
          originResponseDurationMs
        }
        dimensions {
          coloCode
        }
      }
    }
  }
}`;

/**
 * @typedef {{
 *   edgeColo: string;
 *   count: number;
 *   sampleInterval: number | null;
 *   edgeTimeToFirstByteMs: number | null;
 *   originResponseDurationMs: number | null;
 * }} CloudflareLatencyRow
 */

/**
 * @param {{ windowMinutes?: number; timeoutMs?: number; forceRefresh?: boolean }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean; available: boolean }>}
 */
export async function readCloudflareHttpLatencyAnalytics(options = {}) {
    const windowMinutes = readBoundedInteger(options.windowMinutes, DEFAULT_WINDOW_MINUTES, 1, MAX_WINDOW_MINUTES);
    const timeoutMs = readBoundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 30_000);
    const config = await readCloudflareRemoteApiConfig();
    const cacheKey = `${config.zone}:${config.publicHostname}:${windowMinutes}`;
    return analyticsCache.getOrLoad(
        cacheKey,
        () => readCloudflareHttpLatencyAnalyticsUncached(config, { windowMinutes, timeoutMs }),
        { forceRefresh: options.forceRefresh === true, ttlMs: DEFAULT_CACHE_TTL_MS },
    );
}

/**
 * @param {import('./remote-api.js').CloudflareRemoteApiConfig} config
 * @param {{ windowMinutes: number; timeoutMs: number }} options
 */
async function readCloudflareHttpLatencyAnalyticsUncached(config, options) {
    if (!config.apiToken) return unavailable('missing-api-token', 'Cloudflare API token is not configured.');
    const zoneResolution = await resolveZoneId(config);
    if (!zoneResolution.zoneId) return unavailable('zone-id-unavailable', zoneResolution.error ?? 'Cloudflare zone ID unavailable.');

    const observedAt = Date.now();
    const from = new Date(observedAt - options.windowMinutes * 60 * 1000).toISOString();
    const to = new Date(observedAt).toISOString();
    const filter = {
        datetime_geq: from,
        datetime_leq: to,
        requestSource: 'eyeball',
        clientRequestHTTPHost: config.publicHostname,
        clientRequestPath: '/mcp',
    };
    try {
        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${config.apiToken}`,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({ query: QUERY, variables: { zoneTag: zoneResolution.zoneId, filter } }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        const payload = await readBoundedJson(response, 1024 * 1024);
        const graphqlErrors = normalizeGraphqlErrors(payload?.['errors']);
        if (!response.ok || graphqlErrors.length > 0) {
            return {
                ok: false,
                available: false,
                reason: response.ok ? 'graphql-query-unavailable' : `graphql-http-${response.status}`,
                authority: 'cloudflare-graphql-adaptive-aggregate',
                observedAt: new Date(observedAt).toISOString(),
                window: { from, to, minutes: options.windowMinutes },
                zoneSource: zoneResolution.source,
                hostname: config.publicHostname,
                path: '/mcp',
                graphqlErrors,
                note:
                    'The configured plan/token may not expose the requested timing fields. This is a capability gap, not an MCP health failure.',
            };
        }
        const rows = parseRows(payload);
        return {
            ok: true,
            available: true,
            authority: 'cloudflare-graphql-adaptive-aggregate',
            observedAt: new Date(observedAt).toISOString(),
            window: { from, to, minutes: options.windowMinutes },
            zoneSource: zoneResolution.source,
            hostname: config.publicHostname,
            path: '/mcp',
            rowCount: rows.length,
            requestCount: rows.reduce((sum, row) => sum + row.count, 0),
            summary: summarizeRows(rows),
            rows,
            sampling:
                'httpRequestsAdaptiveGroups uses Cloudflare Adaptive Bit Rate sampling; use short windows and treat these aggregates as supporting evidence.',
        };
    } catch (error) {
        return {
            ok: false,
            available: false,
            reason: 'graphql-request-failed',
            authority: 'cloudflare-graphql-adaptive-aggregate',
            observedAt: new Date(observedAt).toISOString(),
            window: { from, to, minutes: options.windowMinutes },
            zoneSource: zoneResolution.source,
            hostname: config.publicHostname,
            path: '/mcp',
            error: sanitizeError(error),
            note: 'Cloudflare Analytics failure does not imply MCP transport failure.',
        };
    }
}

/** @param {import('./remote-api.js').CloudflareRemoteApiConfig} config */
async function resolveZoneId(config) {
    if (config.zoneId) return { zoneId: config.zoneId, source: 'configured:CLOUDFLARE_ZONE_ID', error: null };
    try {
        const client = getCloudflareClient(config.apiToken ?? '');
        const query = config.accountId ? { name: config.zone, account: { id: config.accountId } } : { name: config.zone };
        for await (const zone of client.zones.list(query)) {
            const record = asRecord(zone);
            if (record?.['name'] === config.zone && typeof record['id'] === 'string') {
                return { zoneId: record['id'], source: 'cloudflare:zones.list', error: null };
            }
        }
        return { zoneId: null, source: null, error: `Zone ${config.zone} not found.` };
    } catch (error) {
        return { zoneId: null, source: null, error: sanitizeError(error) };
    }
}

/** @param {Response} response @param {number} maxBytes */
async function readBoundedJson(response, maxBytes) {
    const reader = response.body?.getReader();
    if (!reader) return {};
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`Cloudflare GraphQL response exceeded ${maxBytes} bytes.`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text || '{}');
    return asRecord(parsed) ?? {};
}

/** @param {Record<string, unknown>} payload @returns {CloudflareLatencyRow[]} */
function parseRows(payload) {
    const data = asRecord(payload['data']);
    const viewer = asRecord(data?.['viewer']);
    const zones = Array.isArray(viewer?.['zones']) ? viewer['zones'] : [];
    const zone = asRecord(zones[0]);
    const groups = Array.isArray(zone?.['groups']) ? zone['groups'] : [];
    return groups
        .map((value) => {
            const group = asRecord(value);
            const avg = asRecord(group?.['avg']);
            const dimensions = asRecord(group?.['dimensions']);
            const edgeColo = normalizeColo(dimensions?.['coloCode']);
            if (!group || !edgeColo) return null;
            return {
                edgeColo,
                count: nonNegativeNumber(group['count']) ?? 0,
                sampleInterval: nonNegativeNumber(avg?.['sampleInterval']),
                edgeTimeToFirstByteMs: nonNegativeNumber(avg?.['edgeTimeToFirstByteMs']),
                originResponseDurationMs: nonNegativeNumber(avg?.['originResponseDurationMs']),
            };
        })
        .filter((row) => row !== null);
}

/** @param {CloudflareLatencyRow[]} rows */
function summarizeRows(rows) {
    return {
        edgeTimeToFirstByteMs: weightedAverage(rows, 'edgeTimeToFirstByteMs'),
        originResponseDurationMs: weightedAverage(rows, 'originResponseDurationMs'),
        clientTCPRttMs: null,
        clientTCPRttCapability: 'not-requested-after-live-schema-rejection',
        sampleInterval: weightedAverage(rows, 'sampleInterval'),
        colos: rows.map((row) => row.edgeColo),
    };
}

/** @param {CloudflareLatencyRow[]} rows @param {'edgeTimeToFirstByteMs' | 'originResponseDurationMs' | 'sampleInterval'} field */
function weightedAverage(rows, field) {
    let weighted = 0;
    let weight = 0;
    for (const row of rows) {
        const value = row[field];
        if (value === null) continue;
        const rowWeight = Math.max(1, row.count);
        weighted += value * rowWeight;
        weight += rowWeight;
    }
    return weight > 0 ? Math.round((weighted / weight) * 100) / 100 : null;
}

/** @param {unknown} value */
function normalizeGraphqlErrors(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map((error) => {
        const record = asRecord(error);
        const message = typeof record?.['message'] === 'string' ? record['message'] : 'Unknown GraphQL error';
        return message.replace(/Bearer\s+[^\s]+/giu, 'Bearer <redacted>').slice(0, 500);
    });
}

/** @param {string} reason @param {string} message */
function unavailable(reason, message) {
    return {
        ok: false,
        available: false,
        reason,
        authority: 'cloudflare-graphql-adaptive-aggregate',
        message,
        note: 'Cloudflare Analytics capability is optional supporting evidence.',
    };
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value @returns {number | null} */
function nonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** @param {unknown} value @returns {string | null} */
function normalizeColo(value) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z0-9]{3,8}$/u.test(normalized) ? normalized : null;
}

/** @param {unknown} error */
function sanitizeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/Bearer\s+[^\s]+/giu, 'Bearer <redacted>').slice(0, 1000);
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function readBoundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}
