// @ts-check
/**
 * Generation-owned request-budget state for the built-in development OAuth issuer.
 *
 * The parent `createDevOAuthRuntime()` creates exactly one instance and injects its response writer. This module owns
 * only the bounded rate-limit map; it has no module-global mutable state and no service-locator dependency.
 */

import { firstHeaderValue, normalizeHostname } from '../http-values.js';

const MAX_REQUEST_BUDGET_SUBJECT_LENGTH = 128;

/**
 * @param {{ writeJson: (res: import('node:http').ServerResponse, status: number, body: unknown) => void }} dependencies
 */
export function createDevOAuthRequestBudgetRuntime(dependencies) {
    if (!dependencies || typeof dependencies.writeJson !== 'function') {
        throw new TypeError('Dev OAuth request-budget runtime requires an explicit writeJson dependency.');
    }
    /** @type {Map<string, { count: number; resetAt: number }>} */
    const requestBudgets = new Map();

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {string} name
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     * @param {number} [nowMs]
     */
    function consume(req, name, issuerConfig, nowMs = Date.now()) {
        pruneExpired(nowMs);
        const subject = readSubject(req, issuerConfig);
        const key = `${name}:${subject}`;
        const current = requestBudgets.get(key);
        const limit = readLimit(name, issuerConfig);
        const windowMs = issuerConfig.rateLimit.windowMs;
        if (!current || current.resetAt <= nowMs) {
            requestBudgets.set(key, { count: 1, resetAt: nowMs + windowMs });
            return true;
        }
        current.count += 1;
        return current.count <= limit;
    }

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     * @param {string} name
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     */
    function writeExceeded(req, res, name, issuerConfig) {
        const subject = readSubject(req, issuerConfig);
        const current = requestBudgets.get(`${name}:${subject}`);
        const nowMs = Date.now();
        const retryAfterSeconds = Math.max(1, Math.ceil(((current?.resetAt ?? nowMs + 1000) - nowMs) / 1000));
        const limit = readLimit(name, issuerConfig);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(Math.floor((current?.resetAt ?? nowMs) / 1000)));
        dependencies.writeJson(res, 429, { error: 'temporarily_unavailable' });
    }

    /** @param {number} [nowMs] */
    function pruneExpired(nowMs = Date.now()) {
        let removed = 0;
        for (const [key, budget] of requestBudgets) {
            if (budget.resetAt <= nowMs) {
                requestBudgets.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     */
    function readSubject(req, issuerConfig) {
        const cloudflareIp = firstHeaderValue(req.headers['cf-connecting-ip']);
        if (isTrustedCloudflareHeaderRequest(req, issuerConfig) && isSafeSubject(cloudflareIp)) return cloudflareIp;

        if (issuerConfig.proxyTrust.xForwardedFor) {
            const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for']);
            const forwardedSubject = forwardedFor.split(',')[0]?.trim() || '';
            if (isSafeSubject(forwardedSubject)) return forwardedSubject;
        }

        const remoteAddress = String(req.socket?.remoteAddress ?? 'unknown');
        return isSafeSubject(remoteAddress) ? remoteAddress : 'unknown';
    }

    /** @param {string} value */
    function isSafeSubject(value) {
        return Boolean(
            value && value.length <= MAX_REQUEST_BUDGET_SUBJECT_LENGTH && /^[A-Za-z0-9:._\-[\]]+$/u.test(value),
        );
    }

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     */
    function isTrustedCloudflareHeaderRequest(req, issuerConfig) {
        if (issuerConfig.proxyTrust.cloudflareHeaders === 'always') return true;
        if (issuerConfig.proxyTrust.cloudflareHeaders === 'never') return false;
        return isLoopbackSocketAddress(String(req.socket?.remoteAddress ?? ''));
    }

    /** @param {string} address */
    function isLoopbackSocketAddress(address) {
        const normalized = normalizeHostname(address);
        return (
            normalized === 'localhost' ||
            normalized === '127.0.0.1' ||
            normalized === '::1' ||
            normalized === '::ffff:127.0.0.1'
        );
    }

    /** @param {string} name @param {import('../config.js').DevOAuthProcessConfig} issuerConfig */
    function readLimit(name, issuerConfig) {
        return issuerConfig.rateLimit.limits[name] ?? 60;
    }

    return Object.freeze({
        consume,
        writeExceeded,
        pruneExpired,
        reset: () => requestBudgets.clear(),
        size: () => requestBudgets.size,
    });
}
