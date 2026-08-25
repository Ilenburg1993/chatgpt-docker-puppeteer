// @ts-check
/**
 * Opaque process-scoped Cloudflare environment/credential authority.
 *
 * Public consumers may create/prepare/pass the authority, but only Cloudflare-owner modules import the private
 * resolvers below. Raw credentials live exclusively in WeakMap state and are absent from serialization/config graphs.
 * `.env.local` is snapshotted at most once per authority generation during prepare/first remote use.
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { CLOUDFLARE_CONNECTOR_SMOKE_ENV_KEYS } from './environment.js';

export const CLOUDFLARE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION = 1;
export const CLOUDFLARE_ENVIRONMENT_AUTHORITY_KIND = 'copilot-mcp-cloudflare-environment-authority';
const DEFAULT_ENV_FILE = '.env.local';
const AUTHORITY_ENV_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.cloudflare.environment-authority',
        exactPaths: [DEFAULT_ENV_FILE],
        operations: ['read'],
        symlinkPolicy: 'deny',
    }),
);

const CLOUDFLARE_AUTHORITY_EXTRA_KEYS = Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_ZONE_ID',
    'CLOUDFLARE_TUNNEL_TOKEN',
    'CLOUDFLARE_TUNNEL_TOKEN_FILE',
    'COPILOT_MCP_CLOUDFLARE_TUNNEL_ID',
    'COPILOT_MCP_PROCESS_STOP_TIMEOUT_MS',
    'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_ENABLED',
    'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_WINDOW_MS',
    'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_REQUESTS',
    'COPILOT_MCP_ANONYMOUS_RATE_LIMIT_MAX_BUCKETS',
]);
const CLOUDFLARE_AUTHORITY_ENV_KEYS = Object.freeze([
    ...new Set([...CLOUDFLARE_CONNECTOR_SMOKE_ENV_KEYS, ...CLOUDFLARE_AUTHORITY_EXTRA_KEYS]),
]);

/** @typedef {Readonly<{ schemaVersion: 1; kind: 'copilot-mcp-cloudflare-environment-authority'; prepare(): Promise<void>; toJSON(): Record<string, unknown> }>} CloudflareEnvironmentAuthority */
/** @typedef {{ captured: Readonly<NodeJS.ProcessEnv>; remoteEnvironment: Readonly<NodeJS.ProcessEnv> | null; preparePromise: Promise<void> | null }} CloudflareAuthorityState */
/** @type {WeakMap<CloudflareEnvironmentAuthority, CloudflareAuthorityState>} */
const authorityStates = new WeakMap();

/** @param {NodeJS.ProcessEnv} parentEnv @returns {CloudflareEnvironmentAuthority} */
export function createCloudflareEnvironmentAuthority(parentEnv) {
    if (!parentEnv) throw new TypeError('Cloudflare environment authority requires an explicit parent environment.');
    const captured = captureCloudflareEnvironment(parentEnv);
    /** @type {CloudflareEnvironmentAuthority} */
    const authority = Object.freeze({
        schemaVersion: CLOUDFLARE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
        kind: CLOUDFLARE_ENVIRONMENT_AUTHORITY_KIND,
        async prepare() {
            await prepareCloudflareAuthority(authority);
        },
        toJSON() {
            const state = authorityStates.get(authority);
            return {
                schemaVersion: CLOUDFLARE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
                kind: CLOUDFLARE_ENVIRONMENT_AUTHORITY_KIND,
                prepared: Boolean(state?.remoteEnvironment),
                capturedKeyCount: Object.keys(captured).length,
                credentialsExposed: false,
            };
        },
    });
    authorityStates.set(authority, { captured, remoteEnvironment: null, preparePromise: null });
    return authority;
}

/** @param {NodeJS.ProcessEnv} parentEnv @returns {Readonly<NodeJS.ProcessEnv>} */
function captureCloudflareEnvironment(parentEnv) {
    const operational = buildMcpChildEnvironment({ parentEnv }).env;
    /** @type {NodeJS.ProcessEnv} */
    const captured = { ...operational };
    for (const key of CLOUDFLARE_AUTHORITY_ENV_KEYS) {
        const value = parentEnv[key];
        if (value !== undefined) captured[key] = value;
    }
    return Object.freeze(captured);
}

/**
 * Project parsed `.env.local` data into the exact Cloudflare authority allowlist.
 * Exported only through the test membrane; production consumers receive the opaque authority instead.
 *
 * @param {Record<string, string>} fileEnv
 * @returns {Readonly<NodeJS.ProcessEnv>}
 */
export function projectCloudflareAuthorityFileEnvironment(fileEnv) {
    /** @type {NodeJS.ProcessEnv} */
    const projected = {};
    for (const key of CLOUDFLARE_AUTHORITY_ENV_KEYS) {
        const value = fileEnv[key];
        if (value !== undefined) projected[key] = value;
    }
    return Object.freeze(projected);
}

/** @param {CloudflareEnvironmentAuthority} authority @returns {CloudflareAuthorityState} */
function requireAuthorityState(authority) {
    const state = authorityStates.get(authority);
    if (!state) throw new TypeError('Invalid Cloudflare environment authority.');
    return state;
}

/** @param {CloudflareEnvironmentAuthority} authority */
async function prepareCloudflareAuthority(authority) {
    const state = requireAuthorityState(authority);
    if (state.remoteEnvironment) return;
    if (!state.preparePromise) {
        state.preparePromise = (async () => {
            /** @type {Record<string, string>} */
            let fileEnv;
            try {
                fileEnv = parseEnvFile((await AUTHORITY_ENV_IO.readTextFresh(DEFAULT_ENV_FILE)).content);
            } catch {
                fileEnv = {};
            }
            const projectedFileEnv = projectCloudflareAuthorityFileEnvironment(fileEnv);
            // Explicit process projection wins over allowlisted file values. Unrelated .env.local secrets never enter
            // this authority generation, even transiently after parsing.
            state.remoteEnvironment = Object.freeze({ ...projectedFileEnv, ...state.captured });
        })().finally(() => {
            state.preparePromise = null;
        });
    }
    await state.preparePromise;
}

/**
 * Private intra-owner resolver for non-remote operations.
 * @param {unknown} input
 * @returns {NodeJS.ProcessEnv}
 */
export function resolveCloudflareEnvironment(input) {
    if (isAuthority(input)) return { ...requireAuthorityState(input).captured };
    if (input && typeof input === 'object' && 'authority' in input) {
        const authority = /** @type {{ authority?: unknown }} */ (input).authority;
        if (isAuthority(authority)) return { ...requireAuthorityState(authority).captured };
    }
    if (input && typeof input === 'object' && 'env' in input) {
        const candidateEnvironment = /** @type {{ env?: unknown }} */ (input).env;
        if (candidateEnvironment && typeof candidateEnvironment === 'object') {
            return { ...captureCloudflareEnvironment(/** @type {NodeJS.ProcessEnv} */ (candidateEnvironment)) };
        }
    }
    if (input && typeof input === 'object') {
        return { ...captureCloudflareEnvironment(/** @type {NodeJS.ProcessEnv} */ (input)) };
    }
    throw new TypeError('Cloudflare operation requires an explicit environment or authority.');
}

/**
 * Private intra-owner resolver for remote API operations. Authority-backed calls use the sealed `.env.local` snapshot.
 * @param {unknown} input
 * @returns {Promise<NodeJS.ProcessEnv>}
 */
export async function resolveCloudflareRemoteApiEnvironment(input) {
    const candidateAuthority =
        input && typeof input === 'object' && 'authority' in input
            ? /** @type {{ authority?: unknown }} */ (input).authority
            : undefined;
    const authority = isAuthority(input) ? input : isAuthority(candidateAuthority) ? candidateAuthority : undefined;
    if (authority) {
        await prepareCloudflareAuthority(authority);
        const state = requireAuthorityState(authority);
        if (!state.remoteEnvironment)
            throw new Error('Cloudflare authority did not produce a remote environment snapshot.');
        return { ...state.remoteEnvironment };
    }
    return resolveCloudflareEnvironment(input);
}

/** @param {unknown} value @returns {value is CloudflareEnvironmentAuthority} */
function isAuthority(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        authorityStates.has(/** @type {CloudflareEnvironmentAuthority} */ (value)),
    );
}

/** @param {string} text @returns {Record<string, string>} */
export function parseEnvFile(text) {
    /** @type {Record<string, string>} */
    const result = {};
    for (const rawLine of String(text).split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        if (!/^[A-Z_][A-Z0-9_]*$/iu.test(key)) continue;
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
