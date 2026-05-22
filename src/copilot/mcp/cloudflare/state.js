// @ts-check
/**
 * Runtime state helpers for temporary Cloudflare MCP sessions.
 *
 * @module copilot/mcp/cloudflare/state
 */

import { readFile } from 'node:fs/promises';

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
 *   connectorUrl: string | null;
 *   publicBaseUrl: string | null;
 *   originUrl: string | null;
 *   stateError: string | null;
 *   recovery: string[];
 * }}
 */
export function summarizeQuickTunnelState(state, nowMs = Date.now()) {
    if (!state) {
        return {
            mode: 'temporary-trycloudflare',
            configured: false,
            stateValid: false,
            processAlive: false,
            ageMs: null,
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
            connectorUrl: null,
            publicBaseUrl: null,
            originUrl: null,
            stateError: state.error,
            recovery: ['Remove the invalid state file and start a new quick tunnel session.'],
        };
    }
    const processAlive = isProcessAlive(state.pid);
    const createdAtMs = Date.parse(state.createdAt);
    return {
        mode: state.mode,
        configured: true,
        stateValid: true,
        processAlive,
        ageMs: Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : null,
        connectorUrl: state.connectorUrl,
        publicBaseUrl: state.publicBaseUrl,
        originUrl: state.originUrl,
        stateError: null,
        recovery: processAlive
            ? ['Run npm run copilot:mcp:cloudflare:smoke before using the ChatGPT connector.']
            : [
                  'The saved quick tunnel process is no longer alive.',
                  'Start a new temporary tunnel with npm run copilot:mcp:cloudflare:quick.',
                  'Update or recreate the ChatGPT connector with the new /mcp URL.',
              ],
    };
}
