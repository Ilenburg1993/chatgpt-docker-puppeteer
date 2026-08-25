// @ts-check
/**
 * Canonical planning policy for controlled MCP/Cloudflare reloads.
 *
 * Environment interpretation belongs to the reload process configuration parser. This module is pure with respect to
 * ambient process state: callers must provide the captured generation used to resolve `current`.
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

/** @param {unknown} value @returns {number} */
export function normalizeControlledMcpReloadDelay(value) {
    const raw = Number(value ?? MCP_RELOAD_DEFAULT_DELAY_MS);
    return Number.isFinite(raw)
        ? Math.min(MCP_RELOAD_MAX_DELAY_MS, Math.max(MCP_RELOAD_MIN_DELAY_MS, Math.trunc(raw)))
        : MCP_RELOAD_DEFAULT_DELAY_MS;
}

/**
 * @param {string | undefined} requested
 * @param {import('./config.js').McpReloadProcessConfig} config
 * @returns {'quic' | 'h2' | 'auto'}
 */
export function resolveControlledMcpReloadProfile(requested, config) {
    if (!config)
        throw new TypeError('Controlled reload profile resolution requires a process configuration generation.');
    const normalizedRequested = String(requested ?? 'current')
        .trim()
        .toLowerCase();
    if (normalizedRequested === 'current') return config.currentProfile;
    if (!MCP_RELOAD_EXECUTABLE_PROFILES.some((profile) => profile === normalizedRequested)) {
        throw new Error(`Unsupported controlled reload profile: ${normalizedRequested || '<empty>'}`);
    }
    return /** @type {'quic' | 'h2' | 'auto'} */ (normalizedRequested);
}

/**
 * @param {{
 *     config: import('./config.js').McpReloadProcessConfig;
 *     profile?: string;
 *     delayMs?: unknown;
 *     reason?: string | null;
 *     processId?: number;
 * }} input
 */
export function buildControlledMcpReloadPlan(input) {
    if (!input?.config) throw new TypeError('Controlled reload planning requires a process configuration generation.');
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
        resolvedProfile: resolveControlledMcpReloadProfile(requestedProfile, input.config),
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
