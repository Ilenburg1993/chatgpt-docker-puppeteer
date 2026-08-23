// @ts-check
import { IO_POLICY_VERSION } from '#copilot/infra/internal/operations/contracts/io';
import { isIP } from 'node:net';
import { isPrivateIp } from './address.js';

export const IO_URL_MAX_REDIRECTS = 5;
const LOCAL_HOST_RE = /(^|\.)(localhost|local|internal|home\.arpa)$/iu;

export class PublicNetworkPolicyError extends Error {
    /** @param {string} message @param {string} [code='URL_BLOCKED'] @param {{cause?:unknown}} [options] */
    constructor(message, code = 'URL_BLOCKED', options = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'PublicNetworkPolicyError';
        this.code = code;
    }
}

/** @param {URL} url @param {{allowPrivate?:boolean}} [options] */
export function validateUrl(url, options = {}) {
    if (!(url instanceof URL)) return { safe: false, reason: 'URL inválida' };
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return { safe: false, reason: `Protocolo não permitido: ${url.protocol}` };
    if (url.username || url.password) return { safe: false, reason: 'Credenciais embutidas na URL não são permitidas' };
    const hostname = url.hostname
        .toLowerCase()
        .replace(/^\[|\]$/gu, '')
        .replace(/\.$/u, '');
    if (!hostname) return { safe: false, reason: 'Hostname ausente' };
    if (options.allowPrivate === true) return { safe: true };
    if (LOCAL_HOST_RE.test(hostname) || hostname === 'metadata.google.internal')
        return { safe: false, reason: `Host interno/privado bloqueado: ${hostname}` };
    if (isIP(hostname) && isPrivateIp(hostname))
        return { safe: false, reason: `Endereço IP privado/reservado bloqueado: ${hostname}` };
    return { safe: true };
}

/**
 * @param {string} input
 * @param {{allowPrivate?:boolean}} [options]
 * @returns {{safe:boolean;reason?:string;parsed:URL|null}}
 */
export function validateUrlString(input, options = {}) {
    try {
        const parsed = new URL(input);
        const validation = validateUrl(parsed, options);
        return validation.safe ? { safe: true, parsed } : { ...validation, parsed };
    } catch {
        return { safe: false, reason: 'URL inválida', parsed: null };
    }
}

/** @param {{input:string;allowPrivateNetworks?:boolean;allowLocalhost?:boolean;maxRedirects?:number}} options */
export function evaluatePublicHttpUrlPolicy(options) {
    const input = typeof options?.input === 'string' ? options.input.trim() : '';
    if (!input) return { ok: false, reason: 'URL is required', code: 'URL_REQUIRED', policyVersion: IO_POLICY_VERSION };
    const allowPrivate = options.allowPrivateNetworks === true || options.allowLocalhost === true;
    const validation = validateUrlString(input, { allowPrivate });
    if (!validation.safe || !validation.parsed)
        return {
            ok: false,
            reason: validation.reason || 'Invalid URL',
            code: 'URL_BLOCKED',
            policyVersion: IO_POLICY_VERSION,
        };
    return {
        ok: true,
        url: validation.parsed,
        maxRedirects:
            typeof options.maxRedirects === 'number' &&
            Number.isFinite(options.maxRedirects) &&
            options.maxRedirects >= 0
                ? Math.trunc(options.maxRedirects)
                : IO_URL_MAX_REDIRECTS,
        policyVersion: IO_POLICY_VERSION,
    };
}

/** @param {string} input @param {{allowPrivate?:boolean}} [options] */
export function assertPublicHttpUrl(input, options = {}) {
    const validation = validateUrlString(input, options);
    if (!validation.safe || !validation.parsed)
        throw new PublicNetworkPolicyError(validation.reason ?? 'URL bloqueada');
    return validation.parsed;
}
