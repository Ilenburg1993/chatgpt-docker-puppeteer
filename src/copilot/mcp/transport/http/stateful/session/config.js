// @ts-check
/**
 * Immutable process configuration for MCP Streamable HTTP session ownership.
 *
 * This is the single ambient environment parser for the stateful session owner. Runtime code receives the normalized
 * generation explicitly; diagnostics receive only the sanitized posture projection and never the session-id hash
 * secret.
 *
 * @module copilot/mcp/transport/http/stateful/session/config
 */

import { createHash } from 'node:crypto';

export const MCP_HTTP_STATEFUL_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_HTTP_STATEFUL_PROCESS_CONFIG_KIND = 'copilot-mcp-http-stateful-process-config';
export const DEFAULT_MCP_HTTP_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MCP_HTTP_MAX_SESSIONS = 256;
export const DEFAULT_MCP_HTTP_SESSION_ID_SECRET = 'copilot-mcp-http-session-id-v1';

/**
 * @typedef {Readonly<{
 *     enabled: boolean;
 *     requested: boolean;
 *     statelessCompat: boolean;
 *     ttlMs: number;
 *     maxSessions: number;
 *     reason: string;
 * }>} McpHttpSessionPolicy
 *
 * @typedef {Readonly<McpHttpSessionPolicy & {
 *     postSessionContractEnforced: boolean;
 *     sessionIdHashSecretPresent: boolean;
 *     statelessFallbackPossible: boolean;
 * }>} McpHttpStatefulRuntimePolicySnapshot
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-http-stateful-process-config';
 *     policy: McpHttpSessionPolicy;
 *     postSessionContractEnforced: boolean;
 *     sessionIdHashSecret: string;
 *     posture: McpHttpStatefulRuntimePolicySnapshot;
 *     runtimeConfigKey: string;
 * }>} McpHttpStatefulProcessConfig
 */

/**
 * Capture one immutable stateful-session configuration generation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpStatefulProcessConfig}
 */
export function readMcpHttpStatefulProcessConfig(env = process.env) {
    const raw = String(env['COPILOT_MCP_HTTP_STATEFUL_SESSIONS'] ?? '')
        .trim()
        .toLowerCase();
    const explicitTrue = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on' || raw === 'experimental';
    const explicitFalse = raw === 'false' || raw === '0' || raw === 'no' || raw === 'off' || raw === 'disabled';
    const oauthEnforcementRequiresStateful =
        !explicitFalse &&
        String(env['COPILOT_MCP_AUTH_MODE'] ?? '')
            .trim()
            .toLowerCase() === 'oauth' &&
        String(env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? '')
            .trim()
            .toLowerCase() === 'all';
    const requested = explicitTrue || oauthEnforcementRequiresStateful;
    const statelessCompat = readBoolean(env['COPILOT_MCP_HTTP_STATELESS_COMPAT'], false);
    const enabled = requested && !statelessCompat;
    const ttlMs = normalizePositiveInteger(
        env['COPILOT_MCP_HTTP_SESSION_TTL_MS'],
        DEFAULT_MCP_HTTP_SESSION_TTL_MS,
        10_000,
    );
    const maxSessions = normalizePositiveInteger(
        env['COPILOT_MCP_HTTP_MAX_SESSIONS'],
        DEFAULT_MCP_HTTP_MAX_SESSIONS,
        1,
    );
    const policy = Object.freeze({
        enabled,
        requested,
        statelessCompat,
        ttlMs,
        maxSessions,
        reason: enabled
            ? explicitTrue
                ? 'stateful-session-runtime-enabled-by-policy'
                : 'stateful-session-runtime-enabled-by-oauth-enforcement'
            : statelessCompat
              ? 'stateless-compatibility-fallback-enabled'
              : explicitFalse
                ? 'stateful-session-runtime-explicitly-disabled'
                : 'stateful-session-runtime-disabled-until-opt-in',
    });
    const explicitSecret = normalizeSessionIdSecret(env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET']);
    const sessionIdHashSecret = explicitSecret ?? DEFAULT_MCP_HTTP_SESSION_ID_SECRET;
    const postSessionContractEnforced = readBoolean(env['COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT'], false);
    const posture = Object.freeze({
        ...policy,
        postSessionContractEnforced,
        sessionIdHashSecretPresent: explicitSecret !== null,
        statelessFallbackPossible: !policy.enabled,
    });
    const runtimeConfigKey = createHash('sha256')
        .update(`${ttlMs}\n${maxSessions}\n${sessionIdHashSecret}`)
        .digest('hex');

    return Object.freeze({
        schemaVersion: MCP_HTTP_STATEFUL_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_HTTP_STATEFUL_PROCESS_CONFIG_KIND,
        policy,
        postSessionContractEnforced,
        sessionIdHashSecret,
        posture,
        runtimeConfigKey,
    });
}

/**
 * Read the public session policy through the canonical owner parser.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpSessionPolicy}
 */
export function readMcpHttpStatefulSessionPolicy(env = undefined) {
    return readMcpHttpStatefulProcessConfig(env).policy;
}

/**
 * Read the sanitized stateful posture without exposing secret material.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpStatefulRuntimePolicySnapshot}
 */
export function readMcpHttpStatefulRuntimePolicySnapshot(env = undefined) {
    return readMcpHttpStatefulProcessConfig(env).posture;
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} minimum */
function normalizePositiveInteger(value, fallback, minimum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/** @param {unknown} value @returns {string | null} */
function normalizeSessionIdSecret(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length >= 32 ? normalized : null;
}
