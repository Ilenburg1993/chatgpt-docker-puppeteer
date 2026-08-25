// @ts-check
/**
 * Generation-owned HTTP response policy for the built-in development OAuth issuer.
 *
 * One instance is created by `createDevOAuthRuntime()`. Response→config binding is held in a private WeakMap so CORS
 * and security headers always use the same immutable process-config generation that accepted the request. No mutable
 * response state exists at module scope.
 */

import { randomUUID } from 'node:crypto';

export function createDevOAuthResponseRuntime() {
    /** @type {WeakMap<import('node:http').ServerResponse, import('../config.js').DevOAuthProcessConfig>} */
    const responseIssuerConfigs = new WeakMap();

    /**
     * @param {import('node:http').ServerResponse} res
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     */
    function bindConfig(res, issuerConfig) {
        responseIssuerConfigs.set(res, issuerConfig);
    }

    /**
     * @param {import('node:http').ServerResponse} res
     * @returns {import('../config.js').DevOAuthProcessConfig}
     */
    function requireConfig(res) {
        const issuerConfig = responseIssuerConfigs.get(res);
        if (!issuerConfig) throw new TypeError('Dev OAuth response is missing its process configuration generation.');
        return issuerConfig;
    }

    /** @param {import('node:http').ServerResponse} res */
    function ensureRequestId(res) {
        const existing = res.getHeader('x-request-id');
        if (existing) return String(existing);
        const requestId = randomUUID();
        res.setHeader('X-Request-Id', requestId);
        return requestId;
    }

    /**
     * @param {import('node:http').ServerResponse} res
     * @param {import('../../resource-server/service.js').McpAuthConfig} config
     * @param {string} [error]
     * @param {string} [description]
     * @param {string} [scope]
     */
    function setBearerChallenge(res, config, error = '', description = '', scope = '') {
        /** @type {[string, string][]} */
        const params = [['realm', config.resource]];
        if (error) params.push(['error', error]);
        if (description) params.push(['error_description', description]);
        if (scope) params.push(['scope', scope]);
        res.setHeader(
            'WWW-Authenticate',
            `Bearer ${params.map(([name, value]) => `${name}=${quoteAuthParam(value)}`).join(', ')}`,
        );
    }

    /**
     * @param {import('node:http').ServerResponse} res
     * @param {string} error
     * @param {string} description
     */
    function setDpopChallenge(res, error, description) {
        /** @type {[string, string][]} */
        const params = [['error', error]];
        if (description) params.push(['error_description', description]);
        res.setHeader(
            'WWW-Authenticate',
            `DPoP ${params.map(([name, value]) => `${name}=${quoteAuthParam(value)}`).join(', ')}`,
        );
    }

    /**
     * @param {import('node:http').ServerResponse} res
     * @param {number} status
     * @param {unknown} body
     */
    function writeJson(res, status, body) {
        ensureRequestId(res);
        const issuerConfig = requireConfig(res);
        const payload = `${JSON.stringify(body, null, 2)}\n`;
        res.writeHead(status, {
            ...securityHeaders(),
            ...corsHeaders(issuerConfig),
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(payload),
            'cache-control': 'no-store, no-transform',
            pragma: 'no-cache',
            expires: '0',
            'x-content-type-options': 'nosniff',
        });
        res.end(payload);
    }

    /** @param {import('node:http').ServerResponse} res */
    function writeCorsPreflight(res) {
        ensureRequestId(res);
        const issuerConfig = requireConfig(res);
        res.writeHead(204, {
            ...securityHeaders(),
            ...corsHeaders(issuerConfig),
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers':
                'accept, authorization, content-type, dpop, mcp-session-id, mcp-protocol-version, x-requested-with',
            'access-control-max-age': '600',
            'content-length': '0',
        });
        res.end();
    }

    /** @param {import('node:http').ServerResponse} res @param {URL} target */
    function redirect(res, target) {
        ensureRequestId(res);
        const issuerConfig = requireConfig(res);
        res.writeHead(302, {
            ...securityHeaders(),
            ...corsHeaders(issuerConfig),
            location: target.toString(),
            'cache-control': 'no-store, no-transform',
            pragma: 'no-cache',
            expires: '0',
        });
        res.end();
    }

    return Object.freeze({
        bindConfig,
        redirect,
        setBearerChallenge,
        setDpopChallenge,
        writeCorsPreflight,
        writeJson,
    });
}

/** @param {string} value */
function quoteAuthParam(value) {
    return `"${String(value).replace(/["\\]/gu, '\\$&')}"`;
}

function securityHeaders() {
    return {
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
        'cross-origin-resource-policy': 'same-origin',
        'cross-origin-opener-policy': 'same-origin',
    };
}

/** @param {import('../config.js').DevOAuthProcessConfig} issuerConfig */
function corsHeaders(issuerConfig) {
    const origin = issuerConfig.corsOrigin;
    if (!origin) return {};
    return {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'location, www-authenticate, dpop-nonce, x-request-id',
        vary: origin === '*' ? 'Access-Control-Request-Method, Access-Control-Request-Headers' : 'Origin',
    };
}
