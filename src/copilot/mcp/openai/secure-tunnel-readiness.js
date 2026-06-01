// @ts-check
/**
 * Read-only readiness audit for OpenAI Secure MCP Tunnel.
 *
 * This module does not create tunnels, run tunnel-client, call OpenAI APIs, or return secret values.
 * It only reports local readiness signals and a migration checklist.
 *
 * @module copilot/mcp/openai/secure-tunnel-readiness
 */

import fs from 'node:fs';
import path from 'node:path';

const TUNNEL_ID_ENV_KEYS = ['OPENAI_MCP_TUNNEL_ID', 'OPENAI_TUNNEL_ID', 'MCP_TUNNEL_ID', 'TUNNEL_ID'];
const RUNTIME_KEY_ENV_KEYS = ['CONTROL_PLANE_API_KEY', 'OPENAI_CONTROL_PLANE_API_KEY'];
const MCP_URL_ENV_KEYS = ['OPENAI_SECURE_MCP_LOCAL_URL', 'MCP_SERVER_URL', 'COPILOT_MCP_LOCAL_URL'];

/**
 * @param {{ env?: NodeJS.ProcessEnv; pathEnv?: string; binaryName?: string }} [options]
 * @returns {Record<string, unknown> & { ok: boolean; success: boolean }}
 */
export function auditOpenAiSecureMcpTunnelReadiness(options = {}) {
    const env = options.env ?? process.env;
    const binaryName = options.binaryName ?? 'tunnel-client';
    const tunnelIdPresent = hasAnyEnv(env, TUNNEL_ID_ENV_KEYS);
    const runtimeKeyPresent = hasAnyEnv(env, RUNTIME_KEY_ENV_KEYS);
    const mcpUrl = firstEnvValue(env, MCP_URL_ENV_KEYS) ?? 'http://127.0.0.1:3333/mcp';
    const tunnelClient = findExecutable(binaryName, options.pathEnv ?? env['PATH'] ?? '');

    const blockers = [];
    const warnings = [];
    if (!tunnelIdPresent.present) blockers.push('Missing tunnel_id for the OpenAI-hosted MCP tunnel endpoint.');
    if (!runtimeKeyPresent.present) blockers.push('Missing tunnel-client runtime credential with Tunnels Read + Use.');
    if (!tunnelClient.found) warnings.push('tunnel-client binary was not found on PATH.');
    if (!isLikelyLocalOrPrivateMcpUrl(mcpUrl)) warnings.push('Configured MCP URL does not look private/local; Secure MCP Tunnel is most useful for private origins.');

    return {
        ok: blockers.length === 0,
        success: true,
        mode: 'read-only-openai-secure-mcp-tunnel-readiness',
        appliesChanges: false,
        officialModel: {
            purpose: 'Connect a private MCP server to supported OpenAI products without public inbound ingress.',
            networkInitiation: 'outbound-only HTTPS from tunnel-client to OpenAI',
            localForwarding: 'stdio command or HTTP MCP server reachable from inside the same trust boundary',
            oauthCaveat: 'OAuth discovery can travel through the tunnel, but the authorization server is not automatically tunneled.',
        },
        costPosture: {
            pricingKnownFromLocalAudit: false,
            policy: 'do-not-proceed-if-paid-or-plan-upgrade-required',
            currentDecision: blockers.length > 0 || !tunnelClient.found ? 'stay-on-current-cloudflare-mode' : 'eligible-for-manual-no-cost-confirmation-before-staging',
            rationale: 'This audit cannot prove the Platform tunnel feature is free for the current account, so paid or plan-upgrade-dependent actions are intentionally out of scope.',
        },
        observed: {
            tunnelClientBinary: tunnelClient,
            tunnelId: tunnelIdPresent,
            runtimeCredential: runtimeKeyPresent,
            mcpServerUrl: {
                configured: Boolean(firstEnvValue(env, MCP_URL_ENV_KEYS)),
                source: firstPresentKey(env, MCP_URL_ENV_KEYS) ?? 'default:http://127.0.0.1:3333/mcp',
                likelyPrivateOrLocal: isLikelyLocalOrPrivateMcpUrl(mcpUrl),
            },
        },
        readiness: {
            blockers,
            warnings,
            readyToRunDoctor: blockers.length === 0 && tunnelClient.found,
            readyToConnectFromChatGPT: blockers.length === 0 && tunnelClient.found,
        },
        recommendedNextActions: buildNextActions(blockers.length === 0, tunnelClient.found),
    };
}

/**
 * @param {boolean} credentialsReady
 * @param {boolean} tunnelClientFound
 * @returns {string[]}
 */
function buildNextActions(credentialsReady, tunnelClientFound) {
    const actions = [];
    if (!tunnelClientFound) actions.push('Install tunnel-client from Platform tunnel settings or latest release guidance.');
    if (!credentialsReady) actions.push('Provision tunnel_id and a runtime key with Tunnels Read + Use, then re-run this audit.');
    actions.push('Do not create or activate a Secure MCP Tunnel if the current account requires payment or a plan upgrade.');
    actions.push('Run tunnel-client doctor before ChatGPT connector discovery only after no-cost eligibility is confirmed.');
    actions.push('Stage Secure MCP Tunnel in parallel with the existing Cloudflare connector, then compare discovery, OAuth, latency, streaming and failure modes.');
    return actions;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} keys
 * @returns {{ present: boolean; source?: string; searched?: string[] }}
 */
function hasAnyEnv(env, keys) {
    const source = firstPresentKey(env, keys);
    return source ? { present: true, source } : { present: false, searched: keys };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} keys
 * @returns {string | null}
 */
function firstPresentKey(env, keys) {
    for (const key of keys) {
        if (String(env[key] ?? '').trim()) return key;
    }
    return null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} keys
 * @returns {string | null}
 */
function firstEnvValue(env, keys) {
    for (const key of keys) {
        const value = String(env[key] ?? '').trim();
        if (value) return value;
    }
    return null;
}

/**
 * @param {string} binaryName
 * @param {string} pathEnv
 * @returns {{ found: boolean; binaryName: string; pathHint?: string; searchedPathEntries: number }}
 */
function findExecutable(binaryName, pathEnv) {
    const entries = pathEnv.split(path.delimiter).filter(Boolean);
    for (const entry of entries) {
        const candidate = path.join(entry, binaryName);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return { found: true, binaryName, pathHint: `*/${binaryName}`, searchedPathEntries: entries.length };
        } catch {
            // continue
        }
    }
    return { found: false, binaryName, searchedPathEntries: entries.length };
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isLikelyLocalOrPrivateMcpUrl(url) {
    const text = String(url).toLowerCase();
    return text.includes('127.0.0.1') || text.includes('localhost') || text.includes('10.') || text.includes('192.168.') || /172\.(1[6-9]|2\d|3[01])\./u.test(text) || text.includes('.internal') || text.includes('.local');
}
