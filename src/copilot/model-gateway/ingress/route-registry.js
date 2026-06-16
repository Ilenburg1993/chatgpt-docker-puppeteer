// @ts-check
/**
 * In-memory registry for live Model Gateway ingress routes.
 *
 * The registry stores runtime-only data required by the local OpenAI-compatible ingress, while keeping redacted route
 * snapshots available for operator/LLM-B observability. Secret-bearing upstream auth must remain in this process-local
 * registry and must not be copied into route URLs, transcripts, ledgers or roadmap docs.
 *
 * @module copilot/model-gateway/ingress/route-registry
 */

import {
    MODEL_GATEWAY_INGRESS_DEFAULT_LOCAL_API_KEY,
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
 * @typedef {{
 *   ingressRoute: ReturnType<typeof createModelGatewayIngressRoute>;
 *   localApiKey: string;
 *   upstreamAuthHeaders: Record<string, string>;
 *   metadata: Record<string, unknown>;
 * }} ModelGatewayIngressRouteEntry
 */

export class ModelGatewayIngressRouteRegistry {
    constructor() {
        /** @type {Map<string, ModelGatewayIngressRouteEntry>} */
        this.routes = new Map();
    }

    /**
     * @param {object} input
     * @param {ReturnType<typeof createModelGatewayIngressRoute>} [input.ingressRoute]
     * @param {Parameters<typeof createModelGatewayIngressRoute>[0]} [input.routeInput]
     * @param {string} [input.localApiKey]
     * @param {Record<string, string>} [input.upstreamAuthHeaders]
     * @param {Record<string, unknown>} [input.metadata]
     * @returns {ModelGatewayIngressRouteEntry}
     */
    register(input) {
        const ingressRoute = input.ingressRoute ?? (input.routeInput ? createModelGatewayIngressRoute(input.routeInput) : null);
        if (!ingressRoute) throw new Error('MODEL_GATEWAY_INGRESS_ROUTE_REQUIRED');
        const entry = {
            ingressRoute,
            localApiKey: optionalString(input.localApiKey) ?? MODEL_GATEWAY_INGRESS_DEFAULT_LOCAL_API_KEY,
            upstreamAuthHeaders: stringHeaders(input.upstreamAuthHeaders),
            metadata: isRecord(input.metadata) ? { ...input.metadata } : {},
        };
        this.routes.set(ingressRoute.routeId, entry);
        return entry;
    }

    /**
     * @param {string} routeId
     * @param {{ now?: number }} [options]
     * @returns {ModelGatewayIngressRouteEntry | null}
     */
    get(routeId, options = {}) {
        const entry = this.routes.get(routeId) ?? null;
        if (!entry) return null;
        const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
        if (isExpired(entry.ingressRoute.expiresAt, now)) {
            this.routes.delete(routeId);
            return null;
        }
        return entry;
    }

    /**
     * @param {string} routeId
     * @returns {boolean}
     */
    delete(routeId) {
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
        return [...this.routes.values()].map((entry) => ({
            ...redactModelGatewayIngressRoute(entry.ingressRoute),
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
