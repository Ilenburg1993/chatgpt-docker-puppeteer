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
import { createCloudflareStateStore } from './state.js';

/** @type {() => string[]} */
let localToolNamesProvider = () => [];

/**
 * @param {() => string[]} provider
 * @returns {void}
 */
export function bindConnectorSmokeLocalToolNamesProvider(provider) {
    localToolNamesProvider = provider;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @typedef {Record<string, unknown> & {
 *     ok: boolean;
 *     status: number | null;
 *     tools: number;
 *     expectedLocalTools: number;
 *     toolsMatchLocalRegistry: boolean;
 *     missingLocalTools: string[];
 *     unexpectedRemoteTools: string[];
 * }} AuthenticatedToolsListProjection
 *
 *
 * @typedef {{
 *     ok: boolean;
 *     durationMs: number | null;
 *     phaseTimings: Record<string, unknown>;
 *     failedChecks: string[];
 *     runtimeHealth: Record<string, unknown> | null;
 *     authenticatedToolsList: AuthenticatedToolsListProjection | null;
 *     authenticatedSse: Record<string, unknown> | null;
 * }} AuthenticatedOAuthSmokeProjection
 *
 *
 * @typedef {Record<string, unknown> & {
 *     ok: boolean;
 *     orchestrationTimings: {
 *         strategy: 'parallel-unauthenticated-and-oauth';
 *         totalMs: number;
 *         unauthenticatedMs: number | null;
 *         authenticatedOauthMs: number | null;
 *     };
 *     authenticatedOAuthSmoke: AuthenticatedOAuthSmokeProjection;
 * }} CanonicalConnectorSmokeReport
 */

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
 *     config: import('./config.js').CloudflareTunnelConfig;
 *     env?: NodeJS.ProcessEnv;
 *     persistState?: boolean;
 *     localToolNames?: string[];
 *     deps?: {
 *         runUnauthenticatedSmoke?: typeof runCloudflareSmoke;
 *         runOauthSmoke?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
 *         writeState?: (state: import('./state.js').ConnectorSmokeState) => Promise<void>;
 *     };
 * }} input
 * @returns {Promise<CanonicalConnectorSmokeReport>}
 */
export async function runCanonicalConnectorSmoke({
    config,
    env = process.env,
    persistState = true,
    localToolNames = localToolNamesProvider(),
    deps = {},
}) {
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
        localToolNames,
    };
    const [unauthenticated, oauth] = await Promise.all([
        runUnauthenticatedSmoke({ config, authenticated: false, env, persistState: false, localToolNames }),
        runOauthSmoke(oauthOptions),
    ]);
    const oauthRecord = asRecord(oauth);
    const dcrFlow = asRecord(oauthRecord['dcrFlow']);
    const authenticatedToolsList = asRecord(dcrFlow['authenticatedToolsList']);
    const authenticatedSse = asRecord(dcrFlow['authenticatedSse']);
    const runtimeHealth = asRecord(dcrFlow['runtimeHealth']);
    /** @type {AuthenticatedToolsListProjection | null} */
    const authenticatedToolsListProjection =
        Object.keys(authenticatedToolsList).length > 0
            ? {
                  ...authenticatedToolsList,
                  ok: authenticatedToolsList['ok'] === true,
                  status: finiteNumber(authenticatedToolsList['status']),
                  tools: finiteNumber(authenticatedToolsList['tools']) ?? 0,
                  expectedLocalTools: finiteNumber(authenticatedToolsList['expectedLocalTools']) ?? 0,
                  toolsMatchLocalRegistry: authenticatedToolsList['toolsMatchLocalRegistry'] === true,
                  missingLocalTools: stringArray(authenticatedToolsList['missingLocalTools']),
                  unexpectedRemoteTools: stringArray(authenticatedToolsList['unexpectedRemoteTools']),
              }
            : null;
    const authenticatedOk = oauthRecord['ok'] === true;
    const combinedOk = unauthenticated['ok'] === true && authenticatedOk;
    const unauthenticatedTimings = asRecord(unauthenticated['timings']);
    /** @type {CanonicalConnectorSmokeReport} */
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
            durationMs: finiteNumber(oauthRecord['durationMs']),
            phaseTimings: asRecord(oauthRecord['phaseTimings']),
            failedChecks: stringArray(oauthRecord['failedChecks']),
            runtimeHealth: Object.keys(runtimeHealth).length > 0 ? runtimeHealth : null,
            authenticatedToolsList: authenticatedToolsListProjection,
            authenticatedSse: Object.keys(authenticatedSse).length > 0 ? authenticatedSse : null,
        },
    };

    if (persistState && config.smokeStateFile) {
        const authChallenge = asRecord(unauthenticated['authChallenge']);
        const criticalTools = asRecord(unauthenticated['criticalTools']);
        const writeState = deps.writeState ?? createCloudflareStateStore(config).writeConnectorSmokeState;
        try {
            const healthRecord = asRecord(unauthenticated['health']);
            /** @type {import('./state.js').ConnectorSmokeState} */
            const smokeState = {
                connectorUrl: String(unauthenticated['connectorUrl'] ?? config.publicMcpUrl ?? ''),
                checkedAt: new Date().toISOString(),
                health: {
                    ok: healthRecord['ok'] === true,
                    status: finiteNumber(healthRecord['status']),
                    error: typeof healthRecord['error'] === 'string' ? healthRecord['error'] : null,
                },
                toolsList: {
                    ok: authenticatedToolsListProjection?.ok === true,
                    status: authenticatedToolsListProjection?.status ?? null,
                    tools: authenticatedToolsListProjection?.tools ?? 0,
                    expectedLocalTools: authenticatedToolsListProjection?.expectedLocalTools ?? 0,
                    toolsMatchLocalRegistry: authenticatedToolsListProjection?.toolsMatchLocalRegistry === true,
                    criticalToolsPresent: criticalTools['ok'] === true,
                    missingCriticalTools: stringArray(criticalTools['missing']),
                    missingLocalTools: authenticatedToolsListProjection?.missingLocalTools ?? [],
                    unexpectedRemoteTools: authenticatedToolsListProjection?.unexpectedRemoteTools ?? [],
                    authChallenge: authChallenge['ok'] === true,
                },
                ok: combinedOk,
                oauth: asRecord(unauthenticated['oauth']),
                authenticatedOAuthSmoke: report.authenticatedOAuthSmoke,
                timings: report.orchestrationTimings,
            };
            await writeState(smokeState);
        } catch {
            // Canonical smoke state persistence is best-effort; the returned report remains authoritative for this call.
        }
    }

    return report;
}
