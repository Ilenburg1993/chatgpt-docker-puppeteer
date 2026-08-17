// @ts-check
/**
 * Canonical full connector smoke shared by the CLI and MCP tool surface.
 *
 * The unauthenticated edge/OAuth-challenge smoke and the authenticated OAuth/DCR smoke are independent and therefore
 * execute concurrently. Only their combined result is persisted as connector readiness, so a healthy public challenge
 * can no longer mask a broken authenticated connector path.
 *
 * @module copilot/mcp/cloudflare/connector-smoke
 */

import { runCloudflareSmoke } from './cli-smoke.js';
import { writeConnectorSmokeState } from './state.js';

/** @param {unknown} value @returns {Record<string, any>} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {unknown} value @returns {string[]} */
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/** @param {unknown} value @returns {number | null} */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {{
 *   config: import('./config.js').CloudflareTunnelConfig;
 *   env?: NodeJS.ProcessEnv;
 *   persistState?: boolean;
 *   deps?: {
 *     runUnauthenticatedSmoke?: typeof runCloudflareSmoke;
 *     runOauthSmoke?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
 *     writeState?: typeof writeConnectorSmokeState;
 *   };
 * }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runCanonicalConnectorSmoke({ config, env = process.env, persistState = true, deps = {} }) {
    const startedAt = Date.now();
    const runUnauthenticatedSmoke = deps.runUnauthenticatedSmoke ?? runCloudflareSmoke;
    const runOauthSmoke =
        deps.runOauthSmoke ??
        (async (options) => {
            const { runMcpOAuthSmoke } = await import('../scripts/oauth-smoke.js');
            return /** @type {Promise<Record<string, unknown>>} */ (runMcpOAuthSmoke(options));
        });
    const oauthOptions = {
        ...(config.publicMcpUrl ? { resource: new URL('/', config.publicMcpUrl).origin } : {}),
        timeoutMs: 5_000,
        retryAttempts: 2,
        retryBaseDelayMs: 250,
        retryMaxDelayMs: 1_000,
        runPrivateKeyJwt: false,
        runNegativeResourceChecks: false,
    };
    const [unauthenticated, oauth] = await Promise.all([
        runUnauthenticatedSmoke({ config, authenticated: false, env, persistState: false }),
        runOauthSmoke(oauthOptions),
    ]);
    const oauthRecord = asRecord(oauth);
    const dcrFlow = asRecord(oauthRecord['dcrFlow']);
    const authenticatedToolsList = asRecord(dcrFlow['authenticatedToolsList']);
    const authenticatedSse = asRecord(dcrFlow['authenticatedSse']);
    const runtimeHealth = asRecord(dcrFlow['runtimeHealth']);
    const authenticatedOk = oauthRecord['ok'] === true;
    const combinedOk = unauthenticated['ok'] === true && authenticatedOk;
    const unauthenticatedTimings = asRecord(unauthenticated['timings']);
    const report = {
        ...unauthenticated,
        ok: combinedOk,
        orchestrationTimings: {
            strategy: 'parallel-unauthenticated-and-oauth',
            totalMs: Date.now() - startedAt,
            unauthenticatedMs: finiteNumber(unauthenticatedTimings['totalMs']),
            authenticatedOauthMs: finiteNumber(oauthRecord['durationMs']),
        },
        authenticatedOAuthSmoke: {
            ok: authenticatedOk,
            durationMs: oauthRecord['durationMs'] ?? null,
            phaseTimings: asRecord(oauthRecord['phaseTimings']),
            failedChecks: Array.isArray(oauthRecord['failedChecks']) ? oauthRecord['failedChecks'] : [],
            runtimeHealth: Object.keys(runtimeHealth).length > 0 ? runtimeHealth : null,
            authenticatedToolsList: Object.keys(authenticatedToolsList).length > 0 ? authenticatedToolsList : null,
            authenticatedSse: Object.keys(authenticatedSse).length > 0 ? authenticatedSse : null,
        },
    };

    if (persistState && config.smokeStateFile) {
        const authChallenge = asRecord(unauthenticated['authChallenge']);
        const criticalTools = asRecord(unauthenticated['criticalTools']);
        const writeState = deps.writeState ?? writeConnectorSmokeState;
        try {
            await writeState(config.smokeStateFile, /** @type {any} */ ({
                connectorUrl: String(unauthenticated['connectorUrl'] ?? config.publicMcpUrl ?? ''),
                checkedAt: new Date().toISOString(),
                health: asRecord(unauthenticated['health']),
                toolsList: {
                    ok: authenticatedToolsList['ok'] === true,
                    status: finiteNumber(authenticatedToolsList['status']),
                    tools: finiteNumber(authenticatedToolsList['tools']) ?? 0,
                    expectedLocalTools: finiteNumber(authenticatedToolsList['expectedLocalTools']) ?? 0,
                    toolsMatchLocalRegistry: authenticatedToolsList['toolsMatchLocalRegistry'] === true,
                    criticalToolsPresent: criticalTools['ok'] === true,
                    missingCriticalTools: stringArray(criticalTools['missing']),
                    missingLocalTools: stringArray(authenticatedToolsList['missingLocalTools']),
                    unexpectedRemoteTools: stringArray(authenticatedToolsList['unexpectedRemoteTools']),
                    authChallenge: authChallenge['ok'] === true,
                },
                ok: combinedOk,
                oauth: asRecord(unauthenticated['oauth']),
                authenticatedOAuthSmoke: report.authenticatedOAuthSmoke,
                timings: report.orchestrationTimings,
            }));
        } catch {
            // Canonical smoke state persistence is best-effort; the returned report remains authoritative for this call.
        }
    }

    return report;
}
