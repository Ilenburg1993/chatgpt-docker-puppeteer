// @ts-check
/**
 * Dynamic OpenAI-compatible ingress primitives for Model Gateway routes.
 *
 * This module is intentionally server-agnostic: it validates and normalizes the route contract, builds the SDK-facing
 * provider config and prepares upstream OpenAI-compatible requests with explicit auth injection. A terminal/server
 * boundary can mount these helpers behind HTTP without duplicating provider/model/secret logic.
 *
 * @module copilot/model-gateway/ingress/openai-compatible-ingress
 */

import { createHash } from 'node:crypto';

const DEFAULT_CHAT_COMPLETIONS_PATH = '/chat/completions';
const DEFAULT_LOCAL_API_KEY = 'model-gateway-ingress-local';
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);
const SENSITIVE_FORWARD_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'api-key',
]);

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
 * @param {string} value
 * @returns {URL}
 */
function parseSafeHttpUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`MODEL_GATEWAY_INGRESS_URL_UNSUPPORTED_PROTOCOL: protocol=${url.protocol}`);
    }
    if (url.username || url.password) {
        throw new Error('MODEL_GATEWAY_INGRESS_URL_CONTAINS_CREDENTIALS');
    }
    return url;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
    const url = parseSafeHttpUrl(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '');
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function normalizeHeaders(value) {
    if (!isRecord(value)) return {};
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (!normalizedKey || HOP_BY_HOP_HEADERS.has(normalizedKey)) continue;
        if (SENSITIVE_FORWARD_HEADERS.has(normalizedKey)) continue;
        const text = optionalString(rawValue);
        if (text) headers[key] = text;
    }
    return headers;
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function normalizeTrustedHeaders(value) {
    if (!isRecord(value)) return {};
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (!normalizedKey || HOP_BY_HOP_HEADERS.has(normalizedKey)) continue;
        const text = optionalString(rawValue);
        if (text) headers[key] = text;
    }
    return headers;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function parseRequestBody(body) {
    if (isRecord(body)) return { ...body };
    if (typeof body === 'string' && body.trim()) {
        const parsed = JSON.parse(body);
        if (isRecord(parsed)) return { ...parsed };
    }
    return {};
}

/**
 * @param {Record<string, unknown>} route
 * @returns {string}
 */
function resolveRouteBaseUrl(route) {
    const baseUrl =
        optionalString(route['openAICompatibleBaseUrl']) ??
        optionalString(route['baseUrl']) ??
        optionalString(route['endpoint']);
    if (!baseUrl) throw new Error('MODEL_GATEWAY_INGRESS_ROUTE_BASE_URL_REQUIRED');
    return normalizeBaseUrl(baseUrl);
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
function joinUrlPath(baseUrl, path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${cleanPath}`;
}

/**
 * @param {object} input
 * @param {string} input.sessionId
 * @param {Record<string, unknown>} input.route
 * @param {string} input.publicBaseUrl
 * @param {number} [input.now]
 * @param {number} [input.ttlMs]
 * @returns {{
 *   schemaVersion: 'model-gateway.ingress-route.v1';
 *   routeId: string;
 *   sessionId: string;
 *   providerId: string;
 *   providerModel: string;
 *   sdkRouteKey: string | null;
 *   sdkVisibleModel: string;
 *   upstreamBaseUrl: string;
 *   upstreamChatCompletionsUrl: string;
 *   sdkBaseUrl: string;
 *   targetRoute: Record<string, unknown>;
 *   createdAt: string;
 *   expiresAt: string | null;
 * }}
 */
export function createModelGatewayIngressRoute(input) {
    const sessionId = optionalString(input.sessionId);
    if (!sessionId) throw new Error('MODEL_GATEWAY_INGRESS_SESSION_ID_REQUIRED');
    const route = isRecord(input.route) ? input.route : null;
    if (!route) throw new Error('MODEL_GATEWAY_INGRESS_ROUTE_REQUIRED');
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']) ?? optionalString(route['selectorSyntax']);
    const sdkRouteKey =
        optionalString(route['sdkRouteKey']) ??
        optionalString(route['ingressRouteKey']) ??
        optionalString(route['routeOperationId']);
    if (!providerId) throw new Error('MODEL_GATEWAY_INGRESS_PROVIDER_ID_REQUIRED');
    if (!providerModel) throw new Error('MODEL_GATEWAY_INGRESS_PROVIDER_MODEL_REQUIRED');
    const sdkVisibleModel = optionalString(route['sdkVisibleModel']) ?? providerModel;

    const upstreamBaseUrl = resolveRouteBaseUrl(route);
    const publicBaseUrl = normalizeBaseUrl(input.publicBaseUrl);
    const chatPath = optionalString(route['chatCompletionsPath']) ?? DEFAULT_CHAT_COMPLETIONS_PATH;
    const hash = createHash('sha256')
        .update(
            JSON.stringify(
                sdkRouteKey
                    ? { sessionId, sdkRouteKey }
                    : {
                          sessionId,
                          providerId,
                          providerModel,
                          upstreamBaseUrl,
                          routeProfile: route['routeProfile'] ?? null,
                          selectedRouteKey: route['selectedRouteKey'] ?? null,
                      },
            ),
        )
        .digest('hex')
        .slice(0, 24);
    const routeId = `mgw-ingress-${hash}`;
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    const ttlMs =
        typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
            ? Math.floor(input.ttlMs)
            : null;

    return {
        schemaVersion: 'model-gateway.ingress-route.v1',
        routeId,
        sessionId,
        providerId,
        providerModel,
        sdkRouteKey,
        sdkVisibleModel,
        upstreamBaseUrl,
        upstreamChatCompletionsUrl: joinUrlPath(upstreamBaseUrl, chatPath),
        sdkBaseUrl: `${publicBaseUrl}/v1/model-gateway-ingress/${routeId}`,
        targetRoute: { ...route },
        createdAt: new Date(now).toISOString(),
        expiresAt: ttlMs ? new Date(now + ttlMs).toISOString() : null,
    };
}

/**
 * @param {ReturnType<typeof createModelGatewayIngressRoute>} ingressRoute
 * @param {{ localApiKey?: string }} [options]
 * @returns {{ model: string; provider: { type: 'openai'; baseUrl: string; apiKey: string }; modelCapabilities?: Record<string, unknown> }}
 */
export function buildModelGatewayIngressSessionOverrides(ingressRoute, options = {}) {
    const capabilities = isRecord(ingressRoute.targetRoute['modelCapabilities'])
        ? ingressRoute.targetRoute['modelCapabilities']
        : isRecord(ingressRoute.targetRoute['capabilities'])
          ? ingressRoute.targetRoute['capabilities']
          : null;
    return {
        model: ingressRoute.sdkVisibleModel,
        provider: {
            type: 'openai',
            baseUrl: ingressRoute.sdkBaseUrl,
            apiKey: optionalString(options.localApiKey) ?? DEFAULT_LOCAL_API_KEY,
        },
        ...(capabilities ? { modelCapabilities: capabilities } : {}),
    };
}

/**
 * @param {ReturnType<typeof createModelGatewayIngressRoute>} ingressRoute
 * @param {{
 *   method?: string;
 *   path?: string;
 *   headers?: Record<string, unknown>;
 *   body?: unknown;
 *   upstreamAuthHeaders?: Record<string, string>;
 * }} input
 * @returns {{ url: string; init: { method: string; headers: Record<string, string>; body: string } }}
 */
export function buildModelGatewayIngressUpstreamRequest(ingressRoute, input = {}) {
    const method = optionalString(input.method)?.toUpperCase() ?? 'POST';
    if (method !== 'POST') throw new Error(`MODEL_GATEWAY_INGRESS_METHOD_UNSUPPORTED: method=${method}`);
    const path = optionalString(input.path) ?? '/chat/completions';
    if (!/\/chat\/completions$/u.test(path)) {
        throw new Error(`MODEL_GATEWAY_INGRESS_PATH_UNSUPPORTED: path=${path}`);
    }

    const forwardedHeaders = normalizeHeaders(input.headers);
    const upstreamAuthHeaders = normalizeTrustedHeaders(input.upstreamAuthHeaders);
    const headers = {
        ...forwardedHeaders,
        ...upstreamAuthHeaders,
        'content-type': 'application/json',
    };
    const body = parseRequestBody(input.body);
    body['model'] = ingressRoute.providerModel;

    return {
        url: ingressRoute.upstreamChatCompletionsUrl,
        init: {
            method,
            headers,
            body: JSON.stringify(body),
        },
    };
}

/**
 * @param {ReturnType<typeof createModelGatewayIngressRoute>} ingressRoute
 * @param {{
 *   method?: string;
 *   path?: string;
 *   headers?: Record<string, unknown>;
 *   body?: unknown;
 *   fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<unknown>;
 *   resolveUpstreamAuthHeaders?: (route: ReturnType<typeof createModelGatewayIngressRoute>) => Promise<Record<string, string>> | Record<string, string>;
 * }} input
 * @returns {Promise<{ routeId: string; providerId: string; providerModel: string; upstream: ReturnType<typeof buildModelGatewayIngressUpstreamRequest>; response: unknown }>}
 */
export async function proxyModelGatewayIngressOpenAIChatCompletions(ingressRoute, input) {
    const upstreamAuthHeaders = input.resolveUpstreamAuthHeaders
        ? await input.resolveUpstreamAuthHeaders(ingressRoute)
        : {};
    const upstream = buildModelGatewayIngressUpstreamRequest(ingressRoute, {
        ...(input.method ? { method: input.method } : {}),
        ...(input.path ? { path: input.path } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        upstreamAuthHeaders,
    });
    const response = await input.fetchImpl(upstream.url, upstream.init);
    return {
        routeId: ingressRoute.routeId,
        providerId: ingressRoute.providerId,
        providerModel: ingressRoute.providerModel,
        upstream,
        response,
    };
}

/**
 * @param {ReturnType<typeof createModelGatewayIngressRoute>} ingressRoute
 * @returns {Record<string, unknown>}
 */
export function redactModelGatewayIngressRoute(ingressRoute) {
    return {
        schemaVersion: ingressRoute.schemaVersion,
        routeId: ingressRoute.routeId,
        sessionId: ingressRoute.sessionId,
        providerId: ingressRoute.providerId,
        providerModel: ingressRoute.providerModel,
        sdkRouteKey: ingressRoute.sdkRouteKey,
        sdkVisibleModel: ingressRoute.sdkVisibleModel,
        upstreamBaseUrl: ingressRoute.upstreamBaseUrl,
        sdkBaseUrl: ingressRoute.sdkBaseUrl,
        createdAt: ingressRoute.createdAt,
        expiresAt: ingressRoute.expiresAt,
    };
}

export const MODEL_GATEWAY_INGRESS_DEFAULT_CHAT_COMPLETIONS_PATH = DEFAULT_CHAT_COMPLETIONS_PATH;
export const MODEL_GATEWAY_INGRESS_DEFAULT_LOCAL_API_KEY = DEFAULT_LOCAL_API_KEY;
export const MODEL_GATEWAY_INGRESS_SENSITIVE_FORWARD_HEADERS = [...SENSITIVE_FORWARD_HEADERS];
export const MODEL_GATEWAY_INGRESS_HOP_BY_HOP_HEADERS = [...HOP_BY_HOP_HEADERS];
