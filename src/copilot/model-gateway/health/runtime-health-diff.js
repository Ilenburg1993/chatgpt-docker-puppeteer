// @ts-check
/**
 * Storage-neutral diff helpers for already-observed BYOK runtime health.
 *
 * These functions do not execute providers. They classify operational deltas between two runtime health snapshots so
 * live-test scripts can distinguish regressions from newly discovered failing routes and recoveries.
 *
 * @module copilot/model-gateway/health/runtime-health-diff
 */

import { byokProviderHealthRecordKey, byokProviderHealthRecordLastObservedAt } from './provider-health.js';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {Record<string, unknown>} probe
 * @returns {string}
 */
function probeStatusOf(probe) {
    return (
        optionalString(probe['status']) ?? (probe['ok'] === true ? 'ok' : probe['ok'] === false ? 'failed' : 'unknown')
    );
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Record<string, string>}
 */
function probeStatusesOf(record) {
    const probes = optionalRecord(record['probes']);
    if (!probes) return {};
    /** @type {[string, string][]} */
    const entries = [];
    for (const [kind, probe] of Object.entries(probes)) {
        const normalizedProbe = optionalRecord(probe);
        if (normalizedProbe) entries.push([kind, probeStatusOf(normalizedProbe)]);
    }
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * @param {Record<string, string>} probeStatuses
 * @returns {string}
 */
function probeStatusFingerprint(probeStatuses) {
    return Object.entries(probeStatuses)
        .map(([kind, status]) => `${kind}:${status}`)
        .join('|');
}

/**
 * @param {Record<string, string>} probeStatuses
 * @returns {string[]}
 */
function failedProbeKinds(probeStatuses) {
    return Object.entries(probeStatuses)
        .filter(([, status]) => status === 'failed')
        .map(([kind]) => kind);
}

/**
 * @param {string[]} probeKinds
 * @returns {string[]}
 */
function blockingFailedProbeKinds(probeKinds) {
    return probeKinds.filter((kind) => kind !== 'vision');
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function statusOf(record) {
    const directStatus = optionalString(record['lastStatus']) ?? optionalString(record['agentProbeStatus']);
    if (directStatus) return directStatus;
    const probeStatuses = probeStatusesOf(record);
    if (blockingFailedProbeKinds(failedProbeKinds(probeStatuses)).length > 0) return 'failed';
    if (Object.values(probeStatuses).some((status) => status === 'ok')) return 'ok';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function failureKindOf(record) {
    return optionalString(record['lastFailureKind']) ?? optionalString(record['lastErrorContext']) ?? null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {{
 *     key: string;
 *     routeProfile: string | null;
 *     providerId: string | null;
 *     providerModel: string | null;
 *     lastStatus: string | null;
 *     failureKind: string | null;
 *     lastFailureStatusCode: number | null;
 *     lastRetryAfterSeconds: number | null;
 *     lastResetAt: string | null;
 *     agentProbeStatus: string | null;
 *     probeStatuses: Record<string, string>;
 *     probeStatusFingerprint: string;
 *     failedProbeKinds: string[];
 *     blockingFailedProbeKinds: string[];
 *     observedAt: number;
 *     status: string;
 * }}
 */
export function comparableModelGatewayRuntimeHealthRecord(record) {
    const routeProfile = optionalString(record['routeProfile']) ?? optionalString(record['profile']);
    const providerId = optionalString(record['providerId']) ?? optionalString(record['provider']);
    const providerModel = optionalString(record['providerModel']) ?? optionalString(record['model']);
    const identityKey = [routeProfile, providerId, providerModel].every(Boolean)
        ? [routeProfile, providerId, providerModel].join('|')
        : null;
    const probeStatuses = probeStatusesOf(record);
    const failedProbes = failedProbeKinds(probeStatuses);
    return {
        key: byokProviderHealthRecordKey(record) ?? optionalString(record['key']) ?? identityKey ?? 'unknown',
        routeProfile,
        providerId,
        providerModel,
        lastStatus: optionalString(record['lastStatus']),
        failureKind: failureKindOf(record),
        lastFailureStatusCode: optionalNumber(record['lastFailureStatusCode']),
        lastRetryAfterSeconds: optionalNumber(record['lastRetryAfterSeconds']),
        lastResetAt: optionalString(record['lastResetAt']),
        agentProbeStatus: optionalString(record['agentProbeStatus']),
        probeStatuses,
        probeStatusFingerprint: probeStatusFingerprint(probeStatuses),
        failedProbeKinds: failedProbes,
        blockingFailedProbeKinds: blockingFailedProbeKinds(failedProbes),
        observedAt: byokProviderHealthRecordLastObservedAt(record),
        status: statusOf(record),
    };
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[]} records
 * @returns {{
 *     total: number;
 *     byProvider: Record<string, number>;
 *     byStatus: Record<string, number>;
 *     byFailureKind: Record<string, number>;
 *     byProbeStatus: Record<string, number>;
 * }}
 */
export function summarizeModelGatewayRuntimeHealthRecords(records) {
    /** @type {Record<string, number>} */
    const byProvider = {};
    /** @type {Record<string, number>} */
    const byStatus = {};
    /** @type {Record<string, number>} */
    const byFailureKind = {};
    /** @type {Record<string, number>} */
    const byProbeStatus = {};
    for (const record of records) {
        const providerId = record.providerId ?? 'unknown';
        const status = record.status ?? 'unknown';
        const failureKind = record.failureKind ?? 'none';
        byProvider[providerId] = (byProvider[providerId] ?? 0) + 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        byFailureKind[failureKind] = (byFailureKind[failureKind] ?? 0) + 1;
        for (const [probeKind, probeStatus] of Object.entries(record.probeStatuses)) {
            const key = `${probeKind}:${probeStatus}`;
            byProbeStatus[key] = (byProbeStatus[key] ?? 0) + 1;
        }
    }
    return {
        total: records.length,
        byProvider,
        byStatus,
        byFailureKind,
        byProbeStatus,
    };
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[]} records
 * @returns {Map<string, ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>>}
 */
function mapByKey(records) {
    return new Map(records.map((record) => [record.key, record]));
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>} record
 * @returns {boolean}
 */
function failed(record) {
    return (
        record.status === 'failed' ||
        record.lastStatus === 'failed' ||
        record.agentProbeStatus === 'failed' ||
        record.blockingFailedProbeKinds.length > 0
    );
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>} record
 * @returns {boolean}
 */
function ok(record) {
    return (
        record.status === 'ok' ||
        record.lastStatus === 'ok' ||
        record.agentProbeStatus === 'ok' ||
        Object.values(record.probeStatuses).some((status) => status === 'ok')
    );
}

/**
 * @param {{
 *     before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *     after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *     changedFields: string[];
 * }} item
 * @returns {boolean}
 */
function hasNonProbeSurfaceRegression(item) {
    return (
        item.changedFields.some((field) => field !== 'probeStatusFingerprint') && ok(item.before) && failed(item.after)
    );
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>} before
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>} after
 * @returns {boolean}
 */
function hasProbeStatusRegression(before, after) {
    return Object.entries(after.probeStatuses).some(
        ([probeKind, afterStatus]) => before.probeStatuses[probeKind] === 'ok' && afterStatus === 'failed',
    );
}

/**
 * @param {{
 *     before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *     after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *     changedFields: string[];
 * }} item
 * @returns {boolean}
 */
function hasAnyRegression(item) {
    return hasNonProbeSurfaceRegression(item) || hasProbeStatusRegression(item.before, item.after);
}

/**
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[]} beforeRecords
 * @param {ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[]} afterRecords
 * @returns {{
 *     added: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[];
 *     removed: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[];
 *     changed: {
 *         key: string;
 *         before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         changedFields: string[];
 *     }[];
 *     regressions: {
 *         key: string;
 *         before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         changedFields: string[];
 *     }[];
 *     newFailures: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>[];
 *     becameFailed: {
 *         key: string;
 *         before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         changedFields: string[];
 *     }[];
 *     recovered: {
 *         key: string;
 *         before: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         after: ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>;
 *         changedFields: string[];
 *     }[];
 *     summary: {
 *         added: number;
 *         removed: number;
 *         changed: number;
 *         regressions: number;
 *         newFailures: number;
 *         becameFailed: number;
 *         recovered: number;
 *     };
 * }}
 */
export function diffModelGatewayRuntimeHealthSnapshots(beforeRecords, afterRecords) {
    const before = mapByKey(beforeRecords);
    const after = mapByKey(afterRecords);
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, record] of after) {
        const previous = before.get(key);
        if (!previous) {
            added.push(record);
            continue;
        }
        /** @type {(keyof ReturnType<typeof comparableModelGatewayRuntimeHealthRecord>)[]} */
        const fields = [
            'status',
            'failureKind',
            'lastFailureStatusCode',
            'lastRetryAfterSeconds',
            'lastResetAt',
            'agentProbeStatus',
            'probeStatusFingerprint',
        ];
        const changedFields = fields.filter((field) => previous[field] !== record[field]);
        if (changedFields.length > 0) changed.push({ key, before: previous, after: record, changedFields });
    }
    for (const [key, record] of before) {
        if (!after.has(key)) removed.push(record);
    }

    const regressions = changed.filter(hasAnyRegression);
    const becameFailed = changed.filter((item) => !failed(item.before) && failed(item.after) && hasAnyRegression(item));
    const recovered = changed.filter((item) => failed(item.before) && ok(item.after) && !failed(item.after));
    const newFailures = added.filter(failed);

    return {
        added,
        removed,
        changed,
        regressions,
        newFailures,
        becameFailed,
        recovered,
        summary: {
            added: added.length,
            removed: removed.length,
            changed: changed.length,
            regressions: regressions.length,
            newFailures: newFailures.length,
            becameFailed: becameFailed.length,
            recovered: recovered.length,
        },
    };
}
