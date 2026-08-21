// @ts-check
/**
 * OpenAI-compatible HTTP ingress for Model Gateway live routes.
 *
 * Mounted under `/v1/model-gateway-ingress/:routeId`, this router is the SDK-facing local provider endpoint. It
 * authenticates with the per-route local API key and forwards requests to the real upstream provider through the Model
 * Gateway ingress primitives.
 *
 * @module copilot/server/routes/model-gateway-ingress
 */

import { readBoundedResponseText } from '#copilot/infra/public/platform';
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import {
    MODEL_GATEWAY_INGRESS_HOP_BY_HOP_HEADERS,
    defaultModelGatewayIngressRouteRegistry,
    proxyModelGatewayIngressOpenAIChatCompletions,
} from '../../model-gateway/ingress/index.js';

const ROUTE_PREFIX = '/v1/model-gateway-ingress';
const HOP_BY_HOP_HEADERS = new Set(MODEL_GATEWAY_INGRESS_HOP_BY_HOP_HEADERS);

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
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function readBearerToken(req) {
    const authorization = optionalString(req.headers.authorization);
    if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice('bearer '.length).trim();
    return null;
}

/**
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function readProvidedLocalApiKey(req) {
    return readBearerToken(req) ?? optionalString(req.headers['x-api-key']) ?? optionalString(req.headers['api-key']);
}

/**
 * @param {string | null} provided
 * @param {string} expected
 * @returns {boolean}
 */
function localApiKeysMatch(provided, expected) {
    if (!provided) return false;
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * @param {import('express').Response} res
 * @param {unknown} upstreamResponse
 * @returns {Promise<void>}
 */
async function sendUpstreamResponse(res, upstreamResponse) {
    if (!isRecord(upstreamResponse)) {
        res.status(502).json({ ok: false, error: 'MODEL_GATEWAY_INGRESS_INVALID_UPSTREAM_RESPONSE' });
        return;
    }

    const status = typeof upstreamResponse['status'] === 'number' ? upstreamResponse['status'] : 200;
    res.status(status);

    const headers = upstreamResponse['headers'];
    if (headers && typeof (/** @type {{ forEach?: unknown }} */ (headers).forEach) === 'function') {
        /** @type {{ forEach: (callback: (value: string, key: string) => void) => void }} */ (headers).forEach(
            (value, key) => {
                const normalizedKey = key.toLowerCase();
                if (!HOP_BY_HOP_HEADERS.has(normalizedKey)) res.setHeader(key, value);
            },
        );
    }

    const body = upstreamResponse['body'];
    if (body && typeof (/** @type {{ getReader?: unknown }} */ (body).getReader) === 'function') {
        await new Promise((resolve, reject) => {
            Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (body))
                .on('error', reject)
                .pipe(res)
                .on('finish', resolve);
        });
        return;
    }

    if (typeof (/** @type {{ text?: unknown }} */ (upstreamResponse).text) === 'function') {
        res.send(
            await readBoundedResponseText(/** @type {Response} */ (/** @type {unknown} */ (upstreamResponse)), {
                maxBytes: 16 * 1024 * 1024,
            }),
        );
        return;
    }

    if (isRecord(upstreamResponse['data'])) {
        res.json(upstreamResponse['data']);
        return;
    }

    res.end();
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {object} [options]
 * @param {import('../../model-gateway/ingress/route-registry.js').ModelGatewayIngressRouteRegistry} [options.registry]
 * @param {(
 *     url: string,
 *     init: { method: string; headers: Record<string, string>; body: string },
 * ) => Promise<unknown>} [options.fetchImpl]
 * @returns {import('express').Router}
 */
export function createModelGatewayIngressRouter(options = {}) {
    const router = express.Router();
    const registry = options.registry ?? defaultModelGatewayIngressRouteRegistry;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

    router.post(`${ROUTE_PREFIX}/:routeId/chat/completions`, async (req, res) => {
        try {
            const routeId = req.params.routeId;
            const entry = registry.get(routeId);
            if (!entry) {
                res.status(404).json({ ok: false, error: 'MODEL_GATEWAY_INGRESS_ROUTE_NOT_FOUND' });
                return;
            }

            const providedApiKey = readProvidedLocalApiKey(req);
            if (!localApiKeysMatch(providedApiKey, entry.localApiKey)) {
                res.status(401).json({ ok: false, error: 'MODEL_GATEWAY_INGRESS_UNAUTHORIZED' });
                return;
            }

            const proxied = await proxyModelGatewayIngressOpenAIChatCompletions(entry.ingressRoute, {
                method: req.method,
                path: req.path,
                headers: req.headers,
                body: req.body,
                fetchImpl,
                resolveUpstreamAuthHeaders: () => entry.upstreamAuthHeaders,
            });
            await sendUpstreamResponse(res, proxied.response);
        } catch (error) {
            res.status(502).json({ ok: false, error: errorMessage(error) });
        }
    });

    return router;
}

export const MODEL_GATEWAY_INGRESS_ROUTE_PREFIX = ROUTE_PREFIX;
