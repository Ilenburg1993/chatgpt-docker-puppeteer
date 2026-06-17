// @ts-check
/**
 * In-memory registry for live Model Gateway ingress routes.
 *
 * The registry stores runtime-only data required by the local OpenAI-compatible ingress, while keeping redacted route
 * snapshots available for operator/LLM-B observability. Secret-bearing upstream auth must remain in this process-local
 * registry and must not be copied into route URLs, transcripts, ledgers or roadmap docs.
 *
 * Every mutation is revisioned. Existing routes can only be replaced with compare-and-swap (CAS), preventing a stale
 * reconnect or rollback from silently overwriting a newer upstream target that shares the same stable SDK route key.
 *
 * @module copilot/model-gateway/ingress/route-registry
 */

import { createHash } from 'node:crypto';

import {
    createModelGatewayIngressRoute,
    redactModelGatewayIngressRoute,
} from './openai-compatible-ingress.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function stringHeaders(value) {
    if (!isRecord(value)) return {};
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const headerValue = optionalString(rawValue);
        if (headerValue) headers[key] = headerValue;
    }
    return headers;
}

/**
 * @param {unknown} expiresAt
 * @param {number} now
 * @returns {boolean}
 */
function isExpired(expiresAt, now) {
    if (!expiresAt) return false;
    if (typeof expiresAt !== 'string') return false;
    const timestamp = Date.parse(expiresAt);
    return Number.isFinite(timestamp) && timestamp <= now;
}

/**
 * @param {ReturnType<typeof createModelGatewayIngressRoute>} ingressRoute
 * @returns {string}
 */
function targetFingerprint(ingressRoute) {
    const target = ingressRoute.targetRoute;
    const payload = {
        routeId: ingressRoute.routeId,
        sessionId: ingressRoute.sessionId,
        providerId: ingressRoute.providerId,
        providerModel: ingressRoute.providerModel,
        sdkRouteKey: ingressRoute.sdkRouteKey,
        sdkVisibleModel: ingressRoute.sdkVisibleModel,
        upstreamBaseUrl: ingressRoute.upstreamBaseUrl,
        upstreamChatCompletionsUrl: ingressRoute.upstreamChatCompletionsUrl,
        wireApi: target['wireApi'] ?? null,
        routeProfile: target['routeProfile'] ?? null,
        selectedRouteKey: target['selectedRouteKey'] ?? null,
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

/**
 * @typedef {{
 *   ingressRoute: ReturnType<typeof createModelGatewayIngressRoute>;
 *   localApiKey: string;
 *   upstreamAuthHeaders: Record<string, string>;
 *   metadata: Record<string, unknown>;
 *   revision: number;
 *   targetFingerprint: string;
 *   registeredAt: string;
 *   updatedAt: string;
 * }} ModelGatewayIngressRouteEntry
 */

/**
 * @typedef {{
 *   schemaVersion: 'model-gateway.ingress-route-snapshot.v1';
 *   routeId: string;
 *   revision: number;
 *   capturedAt: string;
 *   entry: ModelGatewayIngressRouteEntry;
 * }} ModelGatewayIngressRouteSnapshot
 */

/**
 * @param {ModelGatewayIngressRouteEntry} entry
 * @returns {ModelGatewayIngressRouteEntry}
 */
function cloneEntry(entry) {
    return {
        ingressRoute: {
            ...entry.ingressRoute,
            targetRoute: { ...entry.ingressRoute.targetRoute },
        },
        localApiKey: entry.localApiKey,
        upstreamAuthHeaders: { ...entry.upstreamAuthHeaders },
        metadata: { ...entry.metadata },
        revision: entry.revision,
        targetFingerprint: entry.targetFingerprint,
        registeredAt: entry.registeredAt,
        updatedAt: entry.updatedAt,
    };
}

/**
 * @param {string} routeId
 * @param {number | null} expectedRevision
 * @param {number | null} actualRevision
 * @returns {Error & { code?: string; routeId?: string; expectedRevision?: number | null; actualRevision?: number | null }}
 */
function revisionConflict(routeId, expectedRevision, actualRevision) {
    const error = /** @type {Error & { code?: string; routeId?: string; expectedRevision?: number | null; actualRevision?: number | null }} */ (
        new Error(
            `MODEL_GATEWAY_INGRESS_ROUTE_REVISION_CONFLICT: routeId=${routeId} expected=${String(expectedRevision)} actual=${String(actualRevision)}`,
        )
    );
    error.code = 'MODEL_GATEWAY_INGRESS_ROUTE_REVISION_CONFLICT';
    error.routeId = routeId;
    error.expectedRevision = expectedRevision;
    error.actualRevision = actualRevision;
    return error;
}

export class ModelGatewayIngressRouteRegistry {
    constructor() {
        /** @type {Map<string, ModelGatewayIngressRouteEntry>} */
        this.routes = new Map();
    }

    /**
     * @param {string} routeId
     * @param {number} now
     * @returns {ModelGatewayIngressRouteEntry | null}
     */
    #current(routeId, now) {
        const entry = this.routes.get(routeId) ?? null;
        if (!entry) return null;
        if (isExpired(entry.ingressRoute.expiresAt, now)) {
            this.routes.delete(routeId);
            return null;
        }
        return entry;
    }

    /**
     * Registers a route using compare-and-swap.
     *
     * `expectedRevision: null` means "create only if absent". Replacing an existing route requires its exact current
     * revision; omitting the field is accepted only for a brand-new route.
     *
     * @param {object} input
     * @param {ReturnType<typeof createModelGatewayIngressRoute>} [input.ingressRoute]
     * @param {Parameters<typeof createModelGatewayIngressRoute>[0]} [input.routeInput]
     * @param {string} input.localApiKey
     * @param {Record<string, string>} [input.upstreamAuthHeaders]
     * @param {Record<string, unknown>} [input.metadata]
     * @param {number | null} [input.expectedRevision]
     * @param {number} [input.now]
     * @returns {ModelGatewayIngressRouteEntry}
     */
    register(input) {
        const ingressRoute = input.ingressRoute ?? (input.routeInput ? createModelGatewayIngressRoute(input.routeInput) : null);
        if (!ingressRoute) throw new Error('MODEL_GATEWAY_INGRESS_ROUTE_REQUIRED');
        const localApiKey = optionalString(input.localApiKey);
        if (!localApiKey) throw new Error('MODEL_GATEWAY_INGRESS_LOCAL_API_KEY_REQUIRED');
        const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
        const current = this.#current(ingressRoute.routeId, now);
        const actualRevision = current?.revision ?? null;
        const expectedProvided = Object.prototype.hasOwnProperty.call(input, 'expectedRevision');
        const expectedRevision = expectedProvided ? input.expectedRevision ?? null : null;
        if (current) {
            if (!expectedProvided || expectedRevision !== actualRevision) {
                throw revisionConflict(ingressRoute.routeId, expectedRevision, actualRevision);
            }
        } else if (expectedProvided && expectedRevision !== null) {
            throw revisionConflict(ingressRoute.routeId, expectedRevision, null);
        }
        const timestamp = new Date(now).toISOString();
        const entry = {
            ingressRoute,
            localApiKey,
            upstreamAuthHeaders: stringHeaders(input.upstreamAuthHeaders),
            metadata: isRecord(input.metadata) ? { ...input.metadata } : {},
            revision: (actualRevision ?? 0) + 1,
            targetFingerprint: targetFingerprint(ingressRoute),
            registeredAt: current?.registeredAt ?? timestamp,
            updatedAt: timestamp,
        };
        this.routes.set(ingressRoute.routeId, entry);
        return cloneEntry(entry);
    }

    /**
     * @param {string} routeId
     * @param {{ now?: number }} [options]
     * @returns {ModelGatewayIngressRouteEntry | null}
     */
    get(routeId, options = {}) {
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        const entry = this.#current(routeId, now);
        return entry ? cloneEntry(entry) : null;
    }

    /**
     * @param {string} sdkRouteKey
     * @param {{ now?: number }} [options]
     * @returns {ModelGatewayIngressRouteEntry | null}
     */
    findBySdkRouteKey(sdkRouteKey, options = {}) {
        const normalizedKey = optionalString(sdkRouteKey);
        if (!normalizedKey) return null;
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        this.pruneExpired({ now });
        const entry = [...this.routes.values()].find(
            (candidate) => candidate.ingressRoute.sdkRouteKey === normalizedKey,
        );
        return entry ? cloneEntry(entry) : null;
    }

    /**
     * Captures a process-local rollback snapshot, including runtime-only credentials. The snapshot must never be
     * serialized into logs, ledgers, transcripts or tool results.
     *
     * @param {string} routeId
     * @param {{ now?: number }} [options]
     * @returns {ModelGatewayIngressRouteSnapshot | null}
     */
    snapshot(routeId, options = {}) {
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        const entry = this.#current(routeId, now);
        if (!entry) return null;
        return {
            schemaVersion: 'model-gateway.ingress-route-snapshot.v1',
            routeId,
            revision: entry.revision,
            capturedAt: new Date(now).toISOString(),
            entry: cloneEntry(entry),
        };
    }

    /**
     * Restores a captured entry without rewinding the monotonic revision. The current route must still have the exact
     * revision expected by the caller, otherwise the rollback is stale and fails closed.
     *
     * @param {ModelGatewayIngressRouteSnapshot} snapshot
     * @param {{ expectedRevision: number; now?: number; metadata?: Record<string, unknown> }} options
     * @returns {ModelGatewayIngressRouteEntry}
     */
    restore(snapshot, options) {
        if (!snapshot || snapshot.schemaVersion !== 'model-gateway.ingress-route-snapshot.v1') {
            throw new Error('MODEL_GATEWAY_INGRESS_ROUTE_SNAPSHOT_INVALID');
        }
        const current = this.get(
            snapshot.routeId,
            typeof options.now === 'number' ? { now: options.now } : {},
        );
        if (!current || current.revision !== options.expectedRevision) {
            throw revisionConflict(snapshot.routeId, options.expectedRevision, current?.revision ?? null);
        }
        return this.register({
            ingressRoute: snapshot.entry.ingressRoute,
            localApiKey: snapshot.entry.localApiKey,
            upstreamAuthHeaders: snapshot.entry.upstreamAuthHeaders,
            metadata: {
                ...snapshot.entry.metadata,
                ...options.metadata,
                restoredFromRevision: snapshot.revision,
                rollbackOfRevision: current.revision,
            },
            expectedRevision: current.revision,
            ...(typeof options.now === 'number' ? { now: options.now } : {}),
        });
    }

    /**
     * @param {string} routeId
     * @param {{ expectedRevision?: number; now?: number }} [options]
     * @returns {boolean}
     */
    delete(routeId, options = {}) {
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        const current = this.#current(routeId, now);
        if (!current) return false;
        if (typeof options.expectedRevision === 'number' && current.revision !== options.expectedRevision) {
            throw revisionConflict(routeId, options.expectedRevision, current.revision);
        }
        return this.routes.delete(routeId);
    }

    /**
     * @param {{ now?: number }} [options]
     * @returns {number}
     */
    pruneExpired(options = {}) {
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        let deleted = 0;
        for (const [routeId, entry] of this.routes.entries()) {
            if (!isExpired(entry.ingressRoute.expiresAt, now)) continue;
            this.routes.delete(routeId);
            deleted += 1;
        }
        return deleted;
    }

    /**
     * @param {{ now?: number }} [options]
     * @returns {Array<Record<string, unknown>>}
     */
    listRedacted(options = {}) {
        this.pruneExpired(options);
        return [...this.routes.values()]
            .sort((left, right) => left.ingressRoute.routeId.localeCompare(right.ingressRoute.routeId))
            .map((entry) => ({
                ...redactModelGatewayIngressRoute(entry.ingressRoute),
                revision: entry.revision,
                targetFingerprint: entry.targetFingerprint,
                registeredAt: entry.registeredAt,
                updatedAt: entry.updatedAt,
                metadata: { ...entry.metadata },
            }));
    }

    /**
     * @returns {void}
     */
    clear() {
        this.routes.clear();
    }
}

/**
 * @returns {ModelGatewayIngressRouteRegistry}
 */
export function createModelGatewayIngressRouteRegistry() {
    return new ModelGatewayIngressRouteRegistry();
}

export const defaultModelGatewayIngressRouteRegistry = createModelGatewayIngressRouteRegistry();
