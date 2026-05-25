// @ts-check
/**
 * Import run, raw payload reference and projection diff helpers.
 *
 * These helpers are storage-neutral. They produce the records that a future SQLite/JSON store can persist without
 * carrying secrets or full provider payloads inline.
 *
 * @module copilot/model-gateway/catalog/import-runs
 */

import { createHash } from 'node:crypto';

import { optionalPositiveInteger, optionalString } from '../contracts/index.js';
import { redactSecretText } from '../secrets/index.js';
import { MODEL_GATEWAY_CATALOG_SCHEMA_VERSION } from './contracts.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizePayload(value) {
    if (typeof value === 'string') return redactSecretText(value);
    if (Array.isArray(value)) return value.map(sanitizePayload);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                /^(?:authorization|proxy-authorization|api[_-]?key|secret|token|bearer[_-]?token|access[_-]?token)$/iu.test(key)
                    ? '[redacted]'
                    : sanitizePayload(item),
            ]),
        );
    }
    if (value === undefined) return null;
    return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    return `{${Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(',')}}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.sourceId
 * @param {unknown} input.payload
 * @param {string} [input.mediaType]
 * @returns {{ schemaVersion: number; rawPayloadRef: string; providerId: string; sourceId: string; mediaType: string; byteLength: number; sanitizedPayload: unknown; redactionStatus: string }}
 */
export function createSanitizedRawPayloadRef(input) {
    const providerId = optionalString(input.providerId);
    const sourceId = optionalString(input.sourceId);
    if (!providerId) throw new Error('[model-gateway/catalog] raw payload providerId is required');
    if (!sourceId) throw new Error('[model-gateway/catalog] raw payload sourceId is required');
    const sanitizedPayload = sanitizePayload(input.payload);
    const serialized = stableJson(sanitizedPayload);
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        rawPayloadRef: `sha256:${sha256(serialized)}`,
        providerId,
        sourceId,
        mediaType: optionalString(input.mediaType) ?? 'application/json',
        byteLength: Buffer.byteLength(serialized, 'utf8'),
        sanitizedPayload,
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {string} input.providerId
 * @param {string} input.sourceId
 * @param {string} [input.status]
 * @param {string | number | Date} [input.startedAt]
 * @param {string | number | Date | null} [input.completedAt]
 * @param {number} [input.rowCount]
 * @param {unknown[]} [input.errors]
 * @param {unknown} [input.diff]
 * @returns {object}
 */
export function createCatalogImportRun(input) {
    const runId = optionalString(input.runId);
    const providerId = optionalString(input.providerId);
    const sourceId = optionalString(input.sourceId);
    if (!runId) throw new Error('[model-gateway/catalog] import runId is required');
    if (!providerId) throw new Error('[model-gateway/catalog] import providerId is required');
    if (!sourceId) throw new Error('[model-gateway/catalog] import sourceId is required');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        runId,
        providerId,
        sourceId,
        status: optionalString(input.status) ?? 'completed',
        startedAt: normalizeIsoDate(input.startedAt) ?? new Date().toISOString(),
        completedAt: normalizeIsoDate(input.completedAt),
        rowCount: optionalPositiveInteger(input.rowCount) ?? 0,
        errors: Array.isArray(input.errors) ? input.errors.map(sanitizePayload) : [],
        diff: sanitizePayload(input.diff ?? null),
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {Array<Record<string, any>>} previous
 * @param {Array<Record<string, any>>} next
 * @returns {{ added: string[]; removed: string[]; changed: Array<{ key: string; changedFields: string[]; changedKinds: string[] }> }}
 */
export function diffCanonicalModelProjections(previous, next) {
    const previousByKey = new Map(previous.map((item) => [projectionKey(item), item]));
    const nextByKey = new Map(next.map((item) => [projectionKey(item), item]));
    const added = [...nextByKey.keys()].filter((key) => !previousByKey.has(key)).sort();
    const removed = [...previousByKey.keys()].filter((key) => !nextByKey.has(key)).sort();
    const changed = [];
    for (const [key, nextItem] of nextByKey.entries()) {
        const previousItem = previousByKey.get(key);
        if (!previousItem) continue;
        const changedFields = Object.keys({ ...previousItem, ...nextItem })
            .filter((field) => !['provenanceByField', 'confidenceByField'].includes(field))
            .filter((field) => stableJson(previousItem[field]) !== stableJson(nextItem[field]))
            .sort();
        if (changedFields.length > 0) changed.push({ key, changedFields, changedKinds: classifyChangedFields(changedFields) });
    }
    return { added, removed, changed: changed.sort((a, b) => a.key.localeCompare(b.key)) };
}

/**
 * @param {{ added?: unknown[]; removed?: unknown[]; changed?: Array<{ changedKinds?: unknown[] }> }} diff
 * @returns {{ addedCount: number; removedCount: number; changedCount: number; changedKinds: string[]; changedKindCounts: Record<string, number> }}
 */
export function summarizeCanonicalModelProjectionDiff(diff) {
    /** @type {Record<string, number>} */
    const changedKindCounts = {};
    /** @type {string[]} */
    const changedKinds = [];
    const changed = Array.isArray(diff.changed) ? diff.changed : [];
    for (const item of changed) {
        /** @type {Set<string>} */
        const itemKinds = new Set();
        for (const rawKind of Array.isArray(item.changedKinds) ? item.changedKinds : []) {
            const kind = optionalString(rawKind);
            if (kind) itemKinds.add(kind);
        }
        for (const kind of itemKinds) {
            changedKindCounts[kind] = (changedKindCounts[kind] ?? 0) + 1;
            if (!changedKinds.includes(kind)) changedKinds.push(kind);
        }
    }
    return {
        addedCount: Array.isArray(diff.added) ? diff.added.length : 0,
        removedCount: Array.isArray(diff.removed) ? diff.removed.length : 0,
        changedCount: changed.length,
        changedKinds,
        changedKindCounts,
    };
}

/**
 * @param {string[]} changedFields
 * @returns {string[]}
 */
function classifyChangedFields(changedFields) {
    const kinds = new Set();
    for (const field of changedFields) {
        if (field === 'pricing') kinds.add('pricing_changed');
        else if (field === 'limits' || field === 'rateLimits') kinds.add('limits_changed');
        else if (field === 'capabilities' || field === 'supportedParameters' || field === 'unsupportedParameters') {
            kinds.add('capabilities_changed');
        } else if (field === 'lifecycle') {
            kinds.add('lifecycle_changed');
            kinds.add('deprecation_changed');
        } else if (field === 'modalities') {
            kinds.add('modalities_changed');
        } else if (field === 'accountOverlayRefs') {
            kinds.add('account_overlay_changed');
        } else if (field === 'routingHints') {
            kinds.add('routing_changed');
        } else if (field === 'providerMetadata' || field === 'dataPolicy') {
            kinds.add('provider_metadata_changed');
        } else {
            kinds.add('metadata_changed');
        }
    }
    return [...kinds].sort();
}

/**
 * @param {Record<string, any>} projection
 * @returns {string}
 */
function projectionKey(projection) {
    return [
        optionalString(projection['providerId']) ?? 'unknown-provider',
        optionalString(projection['providerModel']) ?? 'unknown-model',
        optionalString(projection['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeIsoDate(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
