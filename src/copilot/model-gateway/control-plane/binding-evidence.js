// @ts-check
/**
 * Durable runtime evidence for same-session direct provider rebinds.
 *
 * A provider being configurable through ProviderConfig does not prove that changing to it during resumeSession is
 * reliable. This module turns the relational confirmation ledger into bounded, pair- and wire-specific evidence for the
 * binding strategy resolver.
 *
 * @module copilot/model-gateway/control-plane/binding-evidence
 */

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';

export const MODEL_GATEWAY_DIRECT_REBIND_EVIDENCE_DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

const SUCCESS_STATUSES = new Set(['route_confirmed_same_session']);
const FAILURE_STATUSES = new Set(['route_switch_failed_same_session', 'route_rollback_confirmed_same_session']);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function observedAtMs(value) {
    const row = record(value);
    const candidate = row?.['observedAt'] ?? row?.['timestamp'];
    const parsed = typeof candidate === 'number' ? candidate : Date.parse(String(candidate ?? ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {Record<string, unknown>[]} records
 * @param {{
 *     providerId?: string | null;
 *     previousProviderId?: string | null;
 *     wireApi?: string | null;
 *     now?: number;
 * }} [options]
 */
export function classifyModelGatewayDirectRebindEvidence(records, options = {}) {
    const providerId = text(options.providerId);
    const previousProviderId = text(options.previousProviderId);
    const wireApi = text(options.wireApi);
    const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
    const relevant = records
        .filter((item) => record(item) !== null)
        .filter((item) => text(item['bindingStrategy']) === 'direct')
        .filter((item) => !providerId || text(item['providerId'] ?? item['targetProviderId']) === providerId)
        .filter((item) => !previousProviderId || text(item['previousProviderId']) === previousProviderId)
        .filter((item) => !wireApi || text(item['wireApi']) === wireApi)
        .sort((left, right) => observedAtMs(right) - observedAtMs(left));

    const successes = relevant.filter((item) => SUCCESS_STATUSES.has(text(item['status']) ?? ''));
    const failures = relevant.filter((item) => FAILURE_STATUSES.has(text(item['status']) ?? ''));
    const latest =
        relevant.find((item) => {
            const status = text(item['status']) ?? '';
            return SUCCESS_STATUSES.has(status) || FAILURE_STATUSES.has(status);
        }) ?? null;
    const latestStatus = text(latest?.['status']);
    const latestObservedAtMs = latest ? observedAtMs(latest) : null;

    /** @type {'proven' | 'unreliable' | 'unknown'} */
    let directRebindReliability = 'unknown';
    /** @type {boolean | null} */
    let directRebindOk = null;
    if (latestStatus && SUCCESS_STATUSES.has(latestStatus)) {
        directRebindReliability = 'proven';
        directRebindOk = true;
    } else if (latestStatus && FAILURE_STATUSES.has(latestStatus)) {
        directRebindReliability = 'unreliable';
        directRebindOk = false;
    }

    return {
        schemaVersion: 'model-gateway.direct-rebind-evidence.v1',
        source: 'sdk_session_confirmation_ledger',
        providerId,
        previousProviderId,
        wireApi,
        directRebindReliability,
        directRebindOk,
        sameSessionReattachOk: directRebindOk,
        sampleSize: relevant.length,
        successCount: successes.length,
        failureCount: failures.length,
        latestStatus,
        latestObservedAt: latestObservedAtMs ? new Date(latestObservedAtMs).toISOString() : null,
        ageMs: latestObservedAtMs ? Math.max(0, now - latestObservedAtMs) : null,
        latestOperationState: text(latest?.['operationState']),
        latestError: text(latest?.['error']),
        nextActions:
            directRebindReliability === 'proven'
                ? ['prefer_direct_binding', 'continue_observing_rebinds']
                : directRebindReliability === 'unreliable'
                  ? ['prefer_ingress_when_protocol_eligible', 'inspect_latest_route_switch_failure']
                  : ['run_same_session_rebind_probe'],
    };
}

/**
 * @param {{
 *     providerId: string;
 *     previousProviderId?: string | null;
 *     wireApi?: string | null;
 *     selectedRouteKey?: string | null;
 *     limit?: number;
 *     maxAgeMs?: number;
 *     now?: number;
 *     store?: SqliteModelGatewayCatalogStore;
 * }} input
 */
export async function readModelGatewayDirectRebindEvidence(input) {
    const providerId = text(input.providerId);
    if (!providerId) throw new Error('MODEL_GATEWAY_DIRECT_REBIND_EVIDENCE_PROVIDER_ID_REQUIRED');
    const previousProviderId = text(input.previousProviderId);
    const wireApi = text(input.wireApi);
    const store = input.store ?? new SqliteModelGatewayCatalogStore();
    const records = await store.readSdkSessionBindingEvidenceRecords({
        providerId,
        previousProviderId,
        bindingStrategy: 'direct',
        wireApi,
        selectedRouteKey: text(input.selectedRouteKey),
        limit: input.limit ?? 20,
        maxAgeMs: input.maxAgeMs ?? MODEL_GATEWAY_DIRECT_REBIND_EVIDENCE_DEFAULT_MAX_AGE_MS,
        now: input.now ?? Date.now(),
    });
    return classifyModelGatewayDirectRebindEvidence(records, {
        providerId,
        previousProviderId,
        wireApi,
        ...(typeof input.now === 'number' ? { now: input.now } : {}),
    });
}
