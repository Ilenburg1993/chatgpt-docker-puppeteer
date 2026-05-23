// @ts-check
/**
 * Runtime state helpers for temporary Cloudflare MCP sessions.
 *
 * @module copilot/mcp/cloudflare/state
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} QuickTunnelSmokeState
 * @property {string} checkedAt
 * @property {boolean} ok
 * @property {string} connectorUrl
 * @property {{ ok: boolean; status?: number; error?: string }} health
 * @property {{
 *   ok: boolean;
 *   status?: number;
 *   error?: string;
 *   tools: number;
 *   expectedLocalTools: number;
 *   toolsMatchLocalRegistry: boolean;
 *   criticalToolsPresent: boolean;
 *   missingCriticalTools: string[];
 *   missingLocalTools: string[];
 *   unexpectedRemoteTools: string[];
 * }} toolsList
 */

/**
 * @typedef {object} QuickTunnelState
 * @property {number} schemaVersion
 * @property {'temporary-trycloudflare'} mode
 * @property {string} createdAt
 * @property {number | null} pid
 * @property {string} originUrl
 * @property {string} publicBaseUrl
 * @property {string} connectorUrl
 * @property {'auto' | 'http2' | 'quic'} transportProtocol
 * @property {string} stateFile
 * @property {{ name: string; description: string; mcpServerUrl: string; authentication: string }} chatgpt
 * @property {string} smokeCommand
 * @property {QuickTunnelSmokeState} [lastSmoke]
 */

/**
 * @typedef {QuickTunnelSmokeState & { oauth?: Record<string, unknown> }} ConnectorSmokeState
 */

/**
 * @param {string} stateFile
 * @returns {Promise<QuickTunnelState | { error: string } | undefined>}
 */
export async function readQuickTunnelState(stateFile) {
    try {
        const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
        return isQuickTunnelState(parsed) ? parsed : { error: 'Invalid Cloudflare quick tunnel state file.' };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} stateFile
 * @param {QuickTunnelState} state
 * @returns {Promise<void>}
 */
export async function saveQuickTunnelState(stateFile, state) {
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} stateFile
 * @param {QuickTunnelState | { error: string } | undefined} state
 * @param {QuickTunnelSmokeState} lastSmoke
 * @returns {Promise<boolean>}
 */
export async function updateQuickTunnelLastSmoke(stateFile, state, lastSmoke) {
    if (!isQuickTunnelState(state)) return false;
    await saveQuickTunnelState(stateFile, { ...state, lastSmoke });
    return true;
}

/**
 * @param {string} smokeFile
 * @returns {Promise<ConnectorSmokeState | { error: string } | undefined>}
 */
export async function readConnectorSmokeState(smokeFile) {
    try {
        const parsed = JSON.parse(await readFile(smokeFile, 'utf8'));
        return normalizeLastSmoke(parsed) ? /** @type {ConnectorSmokeState} */ (parsed) : { error: 'Invalid connector smoke state file.' };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} smokeFile
 * @param {ConnectorSmokeState} lastSmoke
 * @returns {Promise<void>}
 */
export async function writeConnectorSmokeState(smokeFile, lastSmoke) {
    await mkdir(path.dirname(smokeFile), { recursive: true });
    await writeFile(smokeFile, `${JSON.stringify(lastSmoke, null, 2)}\n`, 'utf8');
}

/**
 * @param {ConnectorSmokeState | { error: string } | undefined} smoke
 * @param {string | null | undefined} connectorUrl
 * @param {number} [nowMs]
 * @returns {{
 *   configured: boolean;
 *   ok: boolean | null;
 *   checkedAt: string | null;
 *   ageSeconds: number | null;
 *   ageMinutes: number | null;
 *   connectorUrl: string | null;
 *   stateError: string | null;
 * }}
 */
export function summarizeConnectorSmokeState(smoke, connectorUrl, nowMs = Date.now()) {
    if (!smoke) {
        return {
            configured: false,
            ok: null,
            checkedAt: null,
            ageSeconds: null,
            ageMinutes: null,
            connectorUrl: null,
            stateError: null,
        };
    }
    if ('error' in smoke) {
        return {
            configured: true,
            ok: null,
            checkedAt: null,
            ageSeconds: null,
            ageMinutes: null,
            connectorUrl: null,
            stateError: smoke.error,
        };
    }
    const smokeAtMs = Date.parse(smoke.checkedAt);
    const ageMs = Number.isFinite(smokeAtMs) ? Math.max(0, nowMs - smokeAtMs) : null;
    const matchesCurrentConnector = !connectorUrl || smoke.connectorUrl === connectorUrl;
    return {
        configured: matchesCurrentConnector,
        ok: matchesCurrentConnector ? smoke.ok : null,
        checkedAt: matchesCurrentConnector ? smoke.checkedAt : null,
        ageSeconds: ageMs === null || !matchesCurrentConnector ? null : Math.round(ageMs / 1000),
        ageMinutes: ageMs === null || !matchesCurrentConnector ? null : Math.round(ageMs / 60000),
        connectorUrl: smoke.connectorUrl,
        stateError: matchesCurrentConnector ? null : 'connector-url-mismatch',
    };
}

/**
 * @param {unknown} value
 * @returns {value is QuickTunnelState}
 */
export function isQuickTunnelState(value) {
    if (!value || typeof value !== 'object') return false;
    if (!('connectorUrl' in value) || typeof value.connectorUrl !== 'string') return false;
    if (!('chatgpt' in value) || !value.chatgpt || typeof value.chatgpt !== 'object') return false;
    const chatgpt = value.chatgpt;
    return (
        'name' in chatgpt &&
        typeof chatgpt.name === 'string' &&
        'description' in chatgpt &&
        typeof chatgpt.description === 'string' &&
        'mcpServerUrl' in chatgpt &&
        typeof chatgpt.mcpServerUrl === 'string' &&
        'authentication' in chatgpt &&
        typeof chatgpt.authentication === 'string'
    );
}

/**
 * @param {unknown} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
    try {
        process.kill(Number(pid), 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {QuickTunnelState | { error: string } | undefined} state
 * @param {number} [nowMs]
 * @returns {{
 *   mode: 'temporary-trycloudflare';
 *   configured: boolean;
 *   stateValid: boolean;
 *   processAlive: boolean;
 *   ageMs: number | null;
 *   ageSeconds: number | null;
 *   ageMinutes: number | null;
 *   staleAfterMs: number;
 *   stale: boolean;
 *   recommendedAction: 'start' | 'restart' | 'smoke' | 'use';
 *   lastSmokeAt: string | null;
 *   lastSmokeOk: boolean | null;
 *   lastSmokeAgeSeconds: number | null;
 *   lastSmokeAgeMinutes: number | null;
 *   lastSmokeConnectorUrl: string | null;
 *   connectorUrl: string | null;
 *   publicBaseUrl: string | null;
 *   originUrl: string | null;
 *   stateError: string | null;
 *   recovery: string[];
 * }}
 */
export function summarizeQuickTunnelState(state, nowMs = Date.now(), staleAfterMs = 6 * 60 * 60 * 1000) {
    if (!state) {
        return {
            mode: 'temporary-trycloudflare',
            configured: false,
            stateValid: false,
            processAlive: false,
            ageMs: null,
            ageSeconds: null,
            ageMinutes: null,
            staleAfterMs,
            stale: false,
            recommendedAction: 'start',
            lastSmokeAt: null,
            lastSmokeOk: null,
            lastSmokeAgeSeconds: null,
            lastSmokeAgeMinutes: null,
            lastSmokeConnectorUrl: null,
            connectorUrl: null,
            publicBaseUrl: null,
            originUrl: null,
            stateError: null,
            recovery: [
                'Start MCP HTTP with npm run copilot:mcp:http.',
                'Start a temporary tunnel with npm run copilot:mcp:cloudflare:quick.',
                'Read the current URL with npm run copilot:mcp:cloudflare:status.',
            ],
        };
    }
    if (!isQuickTunnelState(state)) {
        return {
            mode: 'temporary-trycloudflare',
            configured: true,
            stateValid: false,
            processAlive: false,
            ageMs: null,
            ageSeconds: null,
            ageMinutes: null,
            staleAfterMs,
            stale: false,
            recommendedAction: 'restart',
            lastSmokeAt: null,
            lastSmokeOk: null,
            lastSmokeAgeSeconds: null,
            lastSmokeAgeMinutes: null,
            lastSmokeConnectorUrl: null,
            connectorUrl: null,
            publicBaseUrl: null,
            originUrl: null,
            stateError: state.error,
            recovery: ['Remove the invalid state file and start a new quick tunnel session.'],
        };
    }
    const processAlive = isProcessAlive(state.pid);
    const createdAtMs = Date.parse(state.createdAt);
    const ageMs = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : null;
    const stale = ageMs !== null && ageMs > staleAfterMs;
    const recommendedAction = !processAlive ? 'restart' : stale ? 'smoke' : 'use';
    const rawLastSmoke = normalizeLastSmoke(state.lastSmoke);
    const lastSmoke = rawLastSmoke?.connectorUrl === state.connectorUrl ? rawLastSmoke : undefined;
    const lastSmokeAtMs = lastSmoke ? Date.parse(lastSmoke.checkedAt) : NaN;
    const lastSmokeAgeMs = Number.isFinite(lastSmokeAtMs) ? Math.max(0, nowMs - lastSmokeAtMs) : null;
    return {
        mode: state.mode,
        configured: true,
        stateValid: true,
        processAlive,
        ageMs,
        ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        ageMinutes: ageMs === null ? null : Math.round(ageMs / 60000),
        staleAfterMs,
        stale,
        recommendedAction,
        lastSmokeAt: lastSmoke?.checkedAt ?? null,
        lastSmokeOk: lastSmoke?.ok ?? null,
        lastSmokeAgeSeconds: lastSmokeAgeMs === null ? null : Math.round(lastSmokeAgeMs / 1000),
        lastSmokeAgeMinutes: lastSmokeAgeMs === null ? null : Math.round(lastSmokeAgeMs / 60000),
        lastSmokeConnectorUrl: lastSmoke?.connectorUrl ?? null,
        connectorUrl: state.connectorUrl,
        publicBaseUrl: state.publicBaseUrl,
        originUrl: state.originUrl,
        stateError: null,
        recovery: processAlive
            ? stale
                ? [
                      'The temporary tunnel is older than the configured stale window.',
                      'Run npm run copilot:mcp:cloudflare:smoke before reusing it.',
                      'If smoke fails, start a new quick tunnel and update the ChatGPT connector URL.',
                  ]
                : ['Run npm run copilot:mcp:cloudflare:smoke before using the ChatGPT connector.']
            : [
                  'The saved quick tunnel process is no longer alive.',
                  'Start a new temporary tunnel with npm run copilot:mcp:cloudflare:quick.',
                  'Update or recreate the ChatGPT connector with the new /mcp URL.',
              ],
    };
}

/**
 * @param {unknown} value
 * @returns {QuickTunnelSmokeState | null}
 */
function normalizeLastSmoke(value) {
    if (!value || typeof value !== 'object') return null;
    if (!('checkedAt' in value) || typeof value.checkedAt !== 'string') return null;
    if (!('ok' in value) || typeof value.ok !== 'boolean') return null;
    if (!('connectorUrl' in value) || typeof value.connectorUrl !== 'string') return null;
    const smoke = /** @type {QuickTunnelSmokeState} */ (value);
    return smoke;
}
