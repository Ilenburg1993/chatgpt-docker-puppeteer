// @ts-check
/**
 * Canonical planning policy for controlled MCP/Cloudflare reloads.
 *
 * Environment interpretation and process identity are runtime concerns. Wire adapters consume this plan instead of
 * reading ambient process state or duplicating allowlists/bounds.
 *
 * @module copilot/mcp/runtime/reload/plan
 */

import process from 'node:process';
import { MCP_RELOAD_STATE_FILE } from './state.js';

export const MCP_RELOAD_MIN_DELAY_MS = 1_000;
export const MCP_RELOAD_MAX_DELAY_MS = 60_000;
export const MCP_RELOAD_DEFAULT_DELAY_MS = 2_500;
export const MCP_RELOAD_EXECUTABLE_PROFILES = /** @type {const} */ (['quic', 'h2', 'auto']);
export const MCP_RELOAD_REQUEST_PROFILES = /** @type {const} */ (['current', 'quic', 'h2', 'auto']);

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeControlledMcpReloadDelay(value) {
    const raw = Number(value ?? MCP_RELOAD_DEFAULT_DELAY_MS);
    return Number.isFinite(raw)
        ? Math.min(MCP_RELOAD_MAX_DELAY_MS, Math.max(MCP_RELOAD_MIN_DELAY_MS, Math.trunc(raw)))
        : MCP_RELOAD_DEFAULT_DELAY_MS;
}

/**
 * @param {string | undefined} requested
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'quic' | 'h2' | 'auto'}
 */
export function resolveControlledMcpReloadProfile(requested, env = process.env) {
    const normalizedRequested = String(requested ?? 'current')
        .trim()
        .toLowerCase();
    if (normalizedRequested !== 'current') {
        if (!MCP_RELOAD_EXECUTABLE_PROFILES.some((profile) => profile === normalizedRequested)) {
            throw new Error(`Unsupported controlled reload profile: ${normalizedRequested || '<empty>'}`);
        }
        return /** @type {'quic' | 'h2' | 'auto'} */ (normalizedRequested);
    }
    const current = String(env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'quic')
        .trim()
        .toLowerCase();
    return MCP_RELOAD_EXECUTABLE_PROFILES.some((profile) => profile === current)
        ? /** @type {'quic' | 'h2' | 'auto'} */ (current)
        : 'quic';
}

/**
 * @param {{
 *     profile?: string;
 *     delayMs?: unknown;
 *     reason?: string | null;
 *     env?: NodeJS.ProcessEnv;
 *     processId?: number;
 * }} [input]
 */
export function buildControlledMcpReloadPlan(input = {}) {
    const requestedProfile = String(input.profile ?? 'current')
        .trim()
        .toLowerCase();
    if (!MCP_RELOAD_REQUEST_PROFILES.some((profile) => profile === requestedProfile)) {
        throw new Error(`Unsupported controlled reload request profile: ${requestedProfile || '<empty>'}`);
    }
    const delayMs = normalizeControlledMcpReloadDelay(input.delayMs);
    return {
        success: true,
        executable: true,
        scheduled: false,
        requestedProfile,
        resolvedProfile: resolveControlledMcpReloadProfile(requestedProfile, input.env ?? process.env),
        delayMs,
        stateFile: MCP_RELOAD_STATE_FILE,
        runner: 'runtime/reload',
        currentPid: input.processId ?? process.pid,
        reason: input.reason ?? null,
        safety: {
            arbitraryShell: false,
            arbitraryCommand: false,
            arbitraryPath: false,
            allowedProfiles: [...MCP_RELOAD_EXECUTABLE_PROFILES],
            responseBeforeRestart: true,
        },
        expectedFollowUp: ['mcp_connector_smoke_refresh'],
        diagnosticFallback: ['mcp_reload_status', 'mcp_post_restart_readiness', 'mcp_runtime_health'],
    };
}
