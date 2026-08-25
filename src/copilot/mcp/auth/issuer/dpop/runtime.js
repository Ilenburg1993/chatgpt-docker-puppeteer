// @ts-check
/**
 * Generation-owned DPoP verification, replay and nonce state for the built-in development OAuth issuer.
 *
 * The parent issuer creates exactly one runtime and injects the persistent replay capability already scoped to the
 * issuer-DPoP namespace. Both in-memory maps are lexical to that generation; this module has no mutable module-global
 * state and no process/environment authority.
 */

import { calculateJwkThumbprint, importJWK, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { firstHeaderValue } from '../http-values.js';

const DPOP_MAX_TTL_SECONDS = 5 * 60;
const DPOP_CLOCK_TOLERANCE_SECONDS = 30;
const DPOP_REPLAY_CACHE_MAX_ENTRIES = 2000;
const DPOP_NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_DPOP_NONCES = 2000;
const MAX_DPOP_NONCE_LENGTH = 256;
const MAX_DPOP_PROOF_LENGTH = 16 * 1024;
export const DEV_OAUTH_MAX_DPOP_JKT_LENGTH = 256;
export const DEV_OAUTH_DPOP_SIGNING_ALGORITHMS = /** @type {const} */ (['ES256', 'RS256']);
const CONTROL_CHARACTERS_PATTERN = new RegExp(
    `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
    'u',
);

/**
 * @typedef {{ available: boolean; replay: boolean }} DpopPersistentReplayResult
 *
 * @param {{ rememberReplay: (replayKey: string, expiresAtMs: number) => DpopPersistentReplayResult }} dependencies
 */
export function createDevOAuthDpopRuntime(dependencies) {
    if (!dependencies || typeof dependencies.rememberReplay !== 'function') {
        throw new TypeError('Dev OAuth DPoP runtime requires an explicit persistent replay dependency.');
    }

    /** @type {Map<string, number>} */
    const replayCache = new Map();
    /** @type {Map<string, number>} */
    const nonces = new Map();

    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('../../resource-server/service.js').McpAuthConfig} config
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     * @returns {Promise<{ ok: true; jkt: string } | { ok: true; jkt: '' } | { ok: false; error: string; errorCode?: string }>}
     */
    async function resolveBindingForRequest(req, config, issuerConfig) {
        const proof = firstHeaderValue(req.headers['dpop']);
        if (!proof) return { ok: true, jkt: '' };
        if (!issuerConfig.dpop.enabled) return { ok: false, error: 'DPoP is not enabled for this issuer.' };
        return verifyProof(
            proof,
            { method: String(req.method ?? 'POST').toUpperCase(), htu: `${config.resource}/oauth/token` },
            issuerConfig,
        );
    }

    /**
     * @param {string} proof
     * @param {{ method: string; htu: string }} expected
     * @param {import('../config.js').DevOAuthProcessConfig} issuerConfig
     * @returns {Promise<{ ok: true; jkt: string } | { ok: false; error: string; errorCode?: string }>}
     */
    async function verifyProof(proof, expected, issuerConfig) {
        if (!proof || proof.length > MAX_DPOP_PROOF_LENGTH || hasControlCharacters(proof)) {
            return { ok: false, error: 'DPoP proof is missing or too large.' };
        }
        try {
            const header = decodeJwtHeader(proof);
            const jwk = header['jwk'];
            const alg = String(header['alg'] ?? '');
            const typ = String(header['typ'] ?? '').toLowerCase();
            if (issuerConfig.dpop.typRequired && typ !== 'dpop+jwt') {
                return { ok: false, error: 'DPoP proof typ must be dpop+jwt.' };
            }
            if (!DEV_OAUTH_DPOP_SIGNING_ALGORITHMS.includes(/** @type {'ES256' | 'RS256'} */ (alg))) {
                return { ok: false, error: 'DPoP proof uses an unsupported signing algorithm.' };
            }
            if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
                return { ok: false, error: 'DPoP proof is missing an embedded public JWK.' };
            }
            if (hasPrivateJwkFields(/** @type {Record<string, unknown>} */ (jwk))) {
                return { ok: false, error: 'DPoP proof JWK must be public.' };
            }
            const key = await importJWK(/** @type {Record<string, unknown>} */ (jwk), alg);
            const verified = await jwtVerify(proof, key, {
                algorithms: [...DEV_OAUTH_DPOP_SIGNING_ALGORITHMS],
                clockTolerance: DPOP_CLOCK_TOLERANCE_SECONDS,
                maxTokenAge: `${DPOP_MAX_TTL_SECONDS}s`,
            });
            const payload = verified.payload;
            const htm = String(payload['htm'] ?? '').toUpperCase();
            const htu = normalizeHtu(String(payload['htu'] ?? ''));
            const expectedHtu = normalizeHtu(expected.htu);
            const iat = Number(payload.iat);
            const jti = typeof payload.jti === 'string' ? payload.jti : '';
            if (!Number.isFinite(iat)) return { ok: false, error: 'DPoP proof iat is missing.' };
            if (htm !== expected.method.toUpperCase()) return { ok: false, error: 'DPoP proof htm does not match.' };
            if (htu !== expectedHtu) return { ok: false, error: 'DPoP proof htu does not match.' };
            if (!jti || jti.length > 256 || hasControlCharacters(jti)) {
                return { ok: false, error: 'DPoP proof jti is missing or invalid.' };
            }
            if (issuerConfig.dpop.nonceRequired) {
                const nonce = typeof payload['nonce'] === 'string' ? payload['nonce'] : '';
                if (!isValidNonce(nonce)) {
                    return {
                        ok: false,
                        error: 'Authorization server requires nonce in DPoP proof.',
                        errorCode: 'use_dpop_nonce',
                    };
                }
            }
            const publicJwk = /** @type {Record<string, unknown>} */ ({ ...jwk });
            for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) delete publicJwk[privateField];
            const jkt = await calculateJwkThumbprint(publicJwk);
            pruneReplayCache();
            const replayKey = `${jkt}:${jti}`;
            if (replayCache.has(replayKey)) return { ok: false, error: 'DPoP proof replay detected.' };
            const expMs = Number(payload.exp) ? Number(payload.exp) * 1000 : Date.now() + DPOP_MAX_TTL_SECONDS * 1000;
            const persistentReplay = dependencies.rememberReplay(replayKey, expMs);
            if (!persistentReplay.available) {
                return { ok: false, error: 'Persistent DPoP replay protection is unavailable.' };
            }
            if (persistentReplay.replay) return { ok: false, error: 'DPoP proof replay detected.' };
            replayCache.set(replayKey, expMs);
            trimReplayCache(DPOP_REPLAY_CACHE_MAX_ENTRIES);
            return { ok: true, jkt };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? sanitizeError(error.message) : 'DPoP proof could not be verified.',
            };
        }
    }

    function issueNonce() {
        pruneNonces();
        trimNonces(MAX_DPOP_NONCES - 1);
        const nonce = randomUUID().replace(/-/gu, '');
        nonces.set(nonce, Date.now() + DPOP_NONCE_TTL_MS);
        return nonce;
    }

    /** @param {string} nonce */
    function isValidNonce(nonce) {
        if (!nonce || nonce.length > MAX_DPOP_NONCE_LENGTH || hasControlCharacters(nonce)) return false;
        pruneNonces();
        const expiresAt = nonces.get(nonce);
        return Number.isFinite(expiresAt) && Number(expiresAt) > Date.now();
    }

    /** @param {number} [nowMs] */
    function pruneReplayCache(nowMs = Date.now()) {
        let removed = 0;
        for (const [key, expiresAt] of replayCache) {
            if (expiresAt <= nowMs) {
                replayCache.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    /** @param {number} maxSize */
    function trimReplayCache(maxSize) {
        if (replayCache.size <= maxSize) return;
        const oldest = [...replayCache.entries()].sort((left, right) => left[1] - right[1]);
        for (const [key] of oldest) {
            if (replayCache.size <= maxSize) break;
            replayCache.delete(key);
        }
    }

    /** @param {number} [nowMs] */
    function pruneNonces(nowMs = Date.now()) {
        let removed = 0;
        for (const [nonce, expiresAt] of nonces) {
            if (expiresAt <= nowMs) {
                nonces.delete(nonce);
                removed += 1;
            }
        }
        return removed;
    }

    /** @param {number} maxSize */
    function trimNonces(maxSize) {
        if (nonces.size <= maxSize) return;
        const oldest = [...nonces.entries()].sort((left, right) => left[1] - right[1]);
        for (const [nonce] of oldest) {
            if (nonces.size <= maxSize) break;
            nonces.delete(nonce);
        }
    }

    return Object.freeze({
        issueNonce,
        resolveBindingForRequest,
        reset() {
            replayCache.clear();
            nonces.clear();
        },
        state: () => ({ replayEntries: replayCache.size, nonceEntries: nonces.size }),
    });
}

/** @param {unknown} value */
export function normalizeDevOAuthDpopJkt(value) {
    const normalized = String(value ?? '').trim();
    return isValidDevOAuthDpopJkt(normalized) ? normalized : '';
}

/** @param {string} value */
export function isValidDevOAuthDpopJkt(value) {
    return Boolean(
        value && value.length <= DEV_OAUTH_MAX_DPOP_JKT_LENGTH && value.length >= 32 && /^[A-Za-z0-9_-]+$/u.test(value),
    );
}

/** @param {string} jwt */
function decodeJwtHeader(jwt) {
    const [encoded] = jwt.split('.', 1);
    if (!encoded) throw new Error('JWT header is missing.');
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

/** @param {Record<string, unknown>} jwk */
function hasPrivateJwkFields(jwk) {
    return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => Object.prototype.hasOwnProperty.call(jwk, field));
}

/** @param {string} value */
function normalizeHtu(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

/** @param {string} value */
function hasControlCharacters(value) {
    return CONTROL_CHARACTERS_PATTERN.test(value);
}

/** @param {string} value */
function sanitizeError(value) {
    return String(value ?? '')
        .replace(new RegExp(CONTROL_CHARACTERS_PATTERN, 'gu'), '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 240);
}
