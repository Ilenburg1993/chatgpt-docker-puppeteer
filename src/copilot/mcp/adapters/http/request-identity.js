// @ts-check
/**
 * HTTP request identity/authority projection for the Node host adapter.
 *
 * Proxy headers are interpreted only under an explicit immutable proxy policy. No ambient configuration is read here.
 *
 * @module copilot/mcp/adapters/http/request-identity
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/** @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest */
const MAX_REQUEST_TARGET_LENGTH = 4096;
const MAX_AUTHORITY_LENGTH = 255;

/** @param {McpHttpRequest} req @param {string} name */
export function readHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {McpHttpRequest} req
 * @param {{ host: string; port: number; publicScheme?: 'http' | 'https' }} options
 * @param {{ trustProxyHeaders: 'always'|'never'|'loopback'; trustXForwardedFor: boolean }} proxyPolicy
 */
export function buildRequestUrl(req, options, proxyPolicy) {
    const rawScheme =
        options.publicScheme ?? readHeader(req, ':scheme') ?? firstForwardedProto(req, proxyPolicy) ?? 'http';
    const scheme = rawScheme === 'https' || rawScheme === 'http' ? rawScheme : 'http';
    const authority = readRequestAuthority(req, options);
    const requestTarget = normalizeRequestTarget(req.url ?? '/');
    return new URL(requestTarget, `${scheme}://${authority}`);
}

/** @param {string} value */
export function normalizeRequestTarget(value) {
    const target = String(value ?? '/').trim() || '/';
    if (target.length > MAX_REQUEST_TARGET_LENGTH) throw new Error('Request target is too long.');
    if (target.includes('\0') || /[\r\n]/u.test(target)) throw new Error('Invalid request target.');
    if (target === '*') return '/';
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) throw new Error('Absolute-form request targets are not accepted.');
    return target.startsWith('/') ? target : `/${target}`;
}

/** @param {McpHttpRequest} req @param {{ host: string; port: number }} options */
function readRequestAuthority(req, options) {
    const authority = readHeader(req, ':authority') ?? readHeader(req, 'host');
    if (authority && isSyntacticallySafeAuthority(authority)) return authority;
    return `${options.host}:${options.port}`;
}

/** @param {string} value */
function isSyntacticallySafeAuthority(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.length > MAX_AUTHORITY_LENGTH) return false;
    if (raw.includes('\0') || /[\s/@\\]/u.test(raw)) return false;
    try {
        const parsed = new URL(`http://${raw}`);
        if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/') return false;
        if (parsed.port && (!/^\d{1,5}$/u.test(parsed.port) || Number(parsed.port) > 65535)) return false;
        return /^[A-Za-z0-9.:[\]-]+(?::\d{1,5})?$/u.test(raw) && !raw.includes('..:');
    } catch {
        return false;
    }
}

/** @param {McpHttpRequest} req @param {{ trustProxyHeaders: 'always'|'never'|'loopback'; trustXForwardedFor: boolean }} proxyPolicy */
export function firstForwardedProto(req, proxyPolicy) {
    if (!isTrustedProxyHeaderRequest(req, proxyPolicy)) return undefined;
    const value = readHeader(req, 'x-forwarded-proto');
    return value?.split(',')[0]?.trim().toLowerCase() || undefined;
}

/** @param {McpHttpRequest} req @param {{ trustProxyHeaders: 'always'|'never'|'loopback'; trustXForwardedFor: boolean }} proxyPolicy */
export function buildAnonymousRateLimitKey(req, proxyPolicy) {
    const fallbackRemote = typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : 'unknown';
    let source = 'socket';
    let value = normalizeClientIp(fallbackRemote) ?? fallbackRemote.slice(0, 128);
    if (isTrustedProxyHeaderRequest(req, proxyPolicy)) {
        const cfConnectingIp = normalizeClientIp(readHeader(req, 'cf-connecting-ip'));
        if (cfConnectingIp) {
            source = 'cloudflare';
            value = cfConnectingIp;
        } else if (proxyPolicy.trustXForwardedFor) {
            const forwardedFor = normalizeClientIp(readHeader(req, 'x-forwarded-for')?.split(',')[0]?.trim());
            if (forwardedFor) {
                source = 'forwarded';
                value = forwardedFor;
            }
        }
    }
    return createHash('sha256')
        .update(source)
        .update('\0')
        .update(value || 'unknown')
        .digest('hex')
        .slice(0, 32);
}

/** @param {McpHttpRequest} req @param {{ trustProxyHeaders: 'always'|'never'|'loopback'; trustXForwardedFor: boolean }} proxyPolicy */
export function isTrustedProxyHeaderRequest(req, proxyPolicy) {
    if (proxyPolicy.trustProxyHeaders === 'always') return true;
    if (proxyPolicy.trustProxyHeaders === 'never') return false;
    return isLoopbackSocketAddress(String(req.socket?.remoteAddress ?? ''));
}

/** @param {string} address */
function isLoopbackSocketAddress(address) {
    const normalized = String(address ?? '')
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/gu, '');
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '::ffff:127.0.0.1'
    );
}

/** @param {string | undefined} address */
function normalizeClientIp(address) {
    const normalized = String(address ?? '')
        .trim()
        .replace(/^\[|\]$/gu, '');
    if (!normalized || normalized.length > 64 || isIP(normalized) === 0) return null;
    return normalized.toLowerCase();
}

/** @param {string | undefined} value */
export function readCloudflareRayColo(value) {
    if (!value) return null;
    const suffix = value.trim().split('-').at(-1)?.trim().toUpperCase() ?? '';
    return /^[A-Z0-9]{3,8}$/u.test(suffix) ? suffix : null;
}
