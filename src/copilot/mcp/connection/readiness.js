// @ts-check
/**
 * Consolidated ChatGPT/Claude connector profile and transport readiness operations.
 *
 * @module copilot/mcp/connection/readiness
 */

import { validateConfiguredPublicUrl } from '#copilot/mcp/public/cloudflare/config';
import { probeHealth } from '#copilot/mcp/public/cloudflare/observability';
import {
    createCloudflareManagedProcessController,
    readCloudflaredOriginDiagnostics,
} from '#copilot/mcp/public/cloudflare/process';
import {
    CONNECTOR_SMOKE_STALE_AFTER_MINUTES,
    createCloudflareStateStore,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '#copilot/mcp/public/cloudflare/tunnel';
import { normalizeMcpUrl, validatePublicConnectorUrl } from '#copilot/mcp/public/connection/url';
import { readMcpReloadState, summarizeMcpReloadState } from '#copilot/mcp/public/runtime/reload';
import { readMcpHttpStatefulRuntimePolicySnapshot } from '#copilot/mcp/public/transport/http/stateful/config';
import { buildConnectionAuthReadiness } from './oauth-diagnostics.js';
import {
    buildChatGptConnectorProfile,
    buildClaudeConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
    formatChatGptConnectorAuthentication,
} from './profile.js';

/**
 * @param {import('./config.js').McpConnectionRuntimeConfig} runtimeConfig
 * @param {string | null | undefined} connectorUrl
 * @returns {Record<string, unknown>}
 */
function buildHttp2PlusPosture(runtimeConfig, connectorUrl) {
    const cloudflareConfig = runtimeConfig.cloudflare;
    const authConfig = runtimeConfig.owner.auth;
    const originTransport = runtimeConfig.owner.profile.originTransport;
    const h2OriginRequested = runtimeConfig.owner.profile.cloudflareHttp2OriginRequested;
    const publicValidation = connectorUrl
        ? validatePublicConnectorUrl(connectorUrl)
        : { ok: false, reason: 'No connector URL.' };
    const expectedOriginScheme = originTransport === 'http2' || h2OriginRequested ? 'https://' : 'http://';
    return {
        defaultPolicy: 'HTTP/2+',
        publicUrl: connectorUrl ?? null,
        publicUrlValid: publicValidation.ok === true,
        publicUrlValidation: publicValidation,
        cloudflareTunnelTransport: cloudflareConfig.transportProtocol,
        originTransport: originTransport || (cloudflareConfig.originUrl.startsWith('https://') ? 'http2' : 'http'),
        cloudflareHttp2OriginRequested: h2OriginRequested,
        originUrl: cloudflareConfig.originUrl,
        originServerName: cloudflareConfig.originServerName ?? null,
        expectedOriginScheme,
        mode: cloudflareConfig.mode,
        authMode: authConfig.mode,
        authEnforcement: authConfig.enforcement,
        recommendations: buildHttp2PlusRecommendations(cloudflareConfig, originTransport, h2OriginRequested),
    };
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} cloudflareConfig
 * @param {string} originTransport
 * @param {boolean} h2OriginRequested
 * @returns {string[]}
 */
function buildHttp2PlusRecommendations(cloudflareConfig, originTransport, h2OriginRequested) {
    const recommendations = [];
    if (cloudflareConfig.transportProtocol === 'auto') {
        recommendations.push(
            'Cloudflare edge transport is auto; use COPILOT_MCP_CLOUDFLARE_PROTOCOL=quic only after the QUIC canary and metrics gates pass.',
        );
    }
    if (originTransport !== 'http2' && !h2OriginRequested) {
        recommendations.push(
            'For the HTTP/2+ target posture, set COPILOT_MCP_ORIGIN_TRANSPORT=http2 and COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN=true after remote origin rules are ready.',
        );
    }
    if (h2OriginRequested && !cloudflareConfig.originUrl.startsWith('https://')) {
        recommendations.push(
            'HTTP/2 to origin expects an HTTPS origin in this repo profile; ensure the remote Cloudflare service and local origin transport are synchronized.',
        );
    }
    if (!cloudflareConfig.originServerName && cloudflareConfig.originUrl.startsWith('https://')) {
        recommendations.push(
            'Set COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME to the hostname covered by the origin certificate.',
        );
    }
    return recommendations;
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} cloudflareConfig
 * @returns {Promise<any>}
 */
async function buildConnectorStateSummary(cloudflareConfig) {
    const nowMs = Date.now();
    const stateStore = createCloudflareStateStore(cloudflareConfig);
    const [state, smokeState] = await Promise.all([
        stateStore.readQuickTunnelState(),
        stateStore.readConnectorSmokeState(),
    ]);
    const temporaryTunnel = summarizeQuickTunnelState(state, nowMs, cloudflareConfig.staleAfterMs);
    const currentUrl = cloudflareConfig.publicMcpUrl ?? temporaryTunnel.connectorUrl ?? null;
    const smoke = summarizeConnectorSmokeState(smokeState, currentUrl, nowMs);
    const validation = currentUrl
        ? validatePublicConnectorUrl(currentUrl)
        : (validateConfiguredPublicUrl(cloudflareConfig) ?? { ok: false, reason: 'No public MCP URL is configured.' });
    const source = cloudflareConfig.publicMcpUrl
        ? 'permanent-config'
        : temporaryTunnel.connectorUrl
          ? 'quick-tunnel-state'
          : 'missing';
    return {
        currentUrl,
        source,
        validation,
        permanentReady: source === 'permanent-config' && validation.ok === true,
        temporaryTunnel,
        smoke,
    };
}

/**
 * @returns {string[]}
 */
function buildCanonicalSmokePrompts() {
    return [
        'Use o conector Repo DevContainer MCP e chame mcp_connection_readiness view=auth-profile.',
        'Chame mcp_connection_readiness view=current-url e confirme success=true.',
        'Chame mcp_connection_readiness e confirme oauth.blockers vazio e http2Plus.defaultPolicy=HTTP/2+.',
        'Chame mcp_cloudflare_edge_snapshot view=remote e confirme que o origin remoto está sincronizado com HTTP/2+ antes de restart h2.',
        'Chame mcp_oauth_issuer_diagnostics e confirme authorization_endpoint, token_endpoint, PKCE S256, resource_parameter_supported e JWKS.',
        'Chame repo_status.',
        'Chame repo_tree path="src/copilot/mcp" maxDepth=2.',
        'Chame mcp_smoke_workspace.',
    ];
}

/**
 * @param {import('./config.js').McpConnectionRuntimeConfig | undefined} runtimeConfig
 * @returns {import('./config.js').McpConnectionRuntimeConfig}
 */
function requireConnectionRuntimeConfig(runtimeConfig) {
    if (!runtimeConfig) throw new TypeError('MCP connection readiness requires a process-scoped runtime config.');
    return runtimeConfig;
}

/**
 * @param {string} value
 * @returns {URL | null}
 */
function safeParseUrl(value) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

/**
 * @param {{ publicMcpUrl?: string | undefined }} [input]
 * @param {import('./config.js').McpConnectionRuntimeConfig | undefined} [runtimeConfig]
 */
export function readChatGptConnectorProfileReport(input = {}, runtimeConfig) {
    const profileOptions = input.publicMcpUrl === undefined ? {} : { publicMcpUrl: input.publicMcpUrl };
    const config = requireConnectionRuntimeConfig(runtimeConfig);
    const profile = buildChatGptConnectorProfile(profileOptions, config.owner);
    const authConfig = config.owner.auth;
    return {
        success: true,
        profile: { ...profile, smokePrompts: buildCanonicalSmokePrompts() },
        auth: buildConnectionAuthReadiness(authConfig),
        http2Plus: buildHttp2PlusPosture(config, profile.connectorUrl),
        runbook: buildSecureTunnelRunbook(profileOptions, config.owner),
        cloudflareRunbook: buildCloudflareTunnelRunbook(profileOptions, config.owner),
    };
}

/**
 * @param {{ publicMcpUrl?: string | undefined }} [input]
 * @param {import('./config.js').McpConnectionRuntimeConfig | undefined} [runtimeConfig]
 */
export function readClaudeConnectorProfileReport(input = {}, runtimeConfig) {
    const profileOptions = input.publicMcpUrl === undefined ? {} : { publicMcpUrl: input.publicMcpUrl };
    const config = requireConnectionRuntimeConfig(runtimeConfig);
    const profile = buildClaudeConnectorProfile(profileOptions, config.owner);
    const authConfig = config.owner.auth;
    return {
        success: true,
        profile,
        auth: buildConnectionAuthReadiness(authConfig),
        http2Plus: buildHttp2PlusPosture(config, profile.connectorUrl),
        cloudflareChecklist: [
            'Run npm run copilot:mcp:cloudflare:remote-audit and require ok=true.',
            'Run npm run copilot:mcp:cloudflare:h2-remote-audit before enabling/restarting HTTP/2 origin mode.',
            'Run make copilot-mcp-smoke and make copilot-mcp-oauth-smoke before adding or reconnecting in Claude.',
            'Keep the Cloudflare route service synchronized with the selected origin transport; do not accidentally point an HTTP service to an HTTPS/HTTP2 origin.',
            'Keep the public MCP URL ending in /mcp.',
        ],
    };
}

/** @param {string} publicMcpUrl */
export function checkChatGptConnectorUrl(publicMcpUrl) {
    const normalized = normalizeMcpUrl(publicMcpUrl);
    const validation = validatePublicConnectorUrl(normalized);
    const parsed = safeParseUrl(normalized);
    return {
        success: validation.ok,
        inputUrl: publicMcpUrl,
        normalizedUrl: normalized,
        validation,
        canonical: {
            scheme: parsed?.protocol.replace(/:$/u, '') ?? null,
            hostname: parsed?.hostname ?? null,
            pathname: parsed?.pathname ?? null,
            hasQuery: Boolean(parsed?.search),
            hasFragment: Boolean(parsed?.hash),
        },
        recommendations:
            validation.ok === true
                ? ['Use this URL in the ChatGPT connector form as MCP Server URL.']
                : ['Use an HTTPS public URL ending exactly in /mcp.'],
    };
}

/** @param {import('./config.js').McpConnectionRuntimeConfig} runtimeConfig */
export async function readChatGptConnectorCurrentUrlStatus(runtimeConfig) {
    const config = requireConnectionRuntimeConfig(runtimeConfig);
    const cloudflareConfig = config.cloudflare;
    const authConfig = config.owner.auth;
    const state = await buildConnectorStateSummary(cloudflareConfig);
    return {
        success: state.validation.ok === true,
        currentUrl: state.currentUrl,
        source: state.source,
        validation: state.validation,
        chatgptForm: {
            name: 'LLM-B Workspace MCP',
            description: 'Repo-scoped MCP connector for src/copilot development in this workspace.',
            mcpServerUrl: state.currentUrl,
            authentication:
                authConfig.mode === 'oauth' || authConfig.mode === 'mixed-auth' ? 'OAuth' : 'No authentication',
        },
        auth: buildConnectionAuthReadiness(authConfig),
        http2Plus: buildHttp2PlusPosture(config, state.currentUrl),
        temporaryTunnel: { ...state.temporaryTunnel, ignoredForOperationalReadiness: state.permanentReady },
        permanentTunnel: {
            mode: cloudflareConfig.mode,
            tunnelName: cloudflareConfig.tunnelName,
            zone: cloudflareConfig.zone,
            publicHostname: cloudflareConfig.publicHostname,
            tokenPresent: cloudflareConfig.hasTunnelToken,
            tokenFilePresent: cloudflareConfig.hasTunnelTokenFile,
            ready: state.permanentReady,
        },
        smoke: state.smoke,
        originUrl: cloudflareConfig.originUrl,
        localMcpUrl: cloudflareConfig.localMcpUrl,
        stateFile: cloudflareConfig.stateFile,
        recovery: state.permanentReady ? [] : state.temporaryTunnel.recovery,
    };
}

/**
 * @param {{ publicMcpUrl?: string | undefined }} [input]
 * @param {import('./config.js').McpConnectionRuntimeConfig | undefined} [runtimeConfig]
 */
export async function readMcpConnectionReadiness(input = {}, runtimeConfig) {
    const config = requireConnectionRuntimeConfig(runtimeConfig);
    const cloudflareConfig = config.cloudflare;
    const authConfig = config.owner.auth;
    const state = await buildConnectorStateSummary(cloudflareConfig);
    const candidateUrl = input.publicMcpUrl ? normalizeMcpUrl(input.publicMcpUrl) : state.currentUrl;
    const candidateValidation = candidateUrl
        ? validatePublicConnectorUrl(candidateUrl)
        : { ok: false, reason: 'No public MCP URL is configured.' };
    const auth = buildConnectionAuthReadiness(authConfig);
    const http2Plus = buildHttp2PlusPosture(config, candidateUrl);
    const blockers = [];
    if (candidateValidation.ok !== true)
        blockers.push(
            'connector-url: ' +
                ('reason' in candidateValidation ? candidateValidation.reason : 'invalid connector URL'),
        );
    if (authConfig.mode === 'oauth' && authConfig.authorizationServers.length === 0)
        blockers.push('oauth: authorization_servers missing');
    if (authConfig.mode === 'oauth' && !authConfig.expectedIssuer) blockers.push('oauth: expected issuer missing');
    if (authConfig.mode === 'oauth' && !authConfig.jwksUri) blockers.push('oauth: JWKS URI missing');
    if (Array.isArray(http2Plus['recommendations']) && http2Plus['recommendations'].length > 0)
        blockers.push('http2plus: recommendations pending');
    return {
        success: blockers.length === 0,
        ready: blockers.length === 0,
        blockers,
        connectorUrl: candidateUrl,
        connectorUrlValidation: candidateValidation,
        chatgptForm: {
            name: 'LLM-B Workspace MCP',
            description: 'Repo-scoped MCP connector for src/copilot development in this workspace.',
            mcpServerUrl: candidateUrl,
            authentication:
                authConfig.mode === 'oauth' || authConfig.mode === 'mixed-auth' ? 'OAuth' : 'No authentication',
        },
        auth,
        http2Plus,
        tunnel: {
            source: state.source,
            permanentReady: state.permanentReady,
            temporaryTunnel: state.temporaryTunnel,
            smoke: state.smoke,
        },
        smokePrompts: buildCanonicalSmokePrompts(),
        acceptanceCriteria: [
            'Connector URL is HTTPS and ends with /mcp.',
            'Protected Resource Metadata and Authorization Server Metadata are reachable.',
            'OAuth token validation is configured for issuer, JWKS, audience/resource and scopes.',
            'HTTP/2+ Cloudflare/origin settings are synchronized.',
            'Remote smoke and OAuth smoke pass before reconnecting in ChatGPT.',
        ],
    };
}

/**
 * Compact one post-restart readiness snapshot for result surfaces that do not need every diagnostic field.
 *
 * @param {Record<string, unknown>} snapshot
 * @returns {Record<string, unknown>}
 */
export function summarizeMcpPostRestartReadiness(snapshot) {
    const processes = recordOrEmpty(snapshot['processes']);
    const mcpHttp = recordOrEmpty(processes['mcpHttp']);
    const cloudflared = recordOrEmpty(processes['cloudflared']);
    const reload = recordOrEmpty(snapshot['reload']);
    const connectorSmoke = recordOrEmpty(snapshot['connectorSmoke']);
    return {
        ready: snapshot['ready'] === true,
        mode: snapshot['mode'] ?? null,
        connectorUrl: snapshot['connectorUrl'] ?? null,
        healthReady: snapshot['healthReady'] === true,
        processes: {
            mcpHttpAlive: mcpHttp['alive'] === true,
            cloudflaredAlive: cloudflared['alive'] === true,
        },
        reload: {
            status: reload['status'] ?? null,
            completedSuccessfully: reload['completedSuccessfully'] === true,
            failed: reload['failed'] === true,
            inFlight: reload['inFlight'] === true,
            smokeAfterReload: reload['smokeAfterReload'] === true,
            reconciledWithConnectorSmoke: reload['reconciledWithConnectorSmoke'] === true,
        },
        connectorSmoke: {
            ok: connectorSmoke['ok'] === true,
            fresh: connectorSmoke['fresh'] === true,
            checkedAt: connectorSmoke['checkedAt'] ?? null,
            ageMinutes: connectorSmoke['ageMinutes'] ?? null,
        },
        nextActions: Array.isArray(snapshot['nextActions']) ? snapshot['nextActions'] : [],
    };
}

/**
 * Process/tunnel generation readiness after an MCP restart. This is a connector-composition concern rather than a
 * Cloudflare wire concern: it joins process liveness, local/public health, reload reconciliation and persisted smoke.
 *
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} cloudflareConfig
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} authConfig
 * @param {{ includeDiagnostics?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readMcpPostRestartReadiness(workspace, cloudflareConfig, authConfig, options = {}) {
    const publicUrlValidation = validateConfiguredPublicUrl(cloudflareConfig) ?? null;
    const connectorSmoke = summarizeConnectorSmokeState(
        await createCloudflareStateStore(cloudflareConfig).readConnectorSmokeState(),
        cloudflareConfig.publicMcpUrl ?? null,
    );
    const processes = createCloudflareManagedProcessController(cloudflareConfig);
    const reload = summarizeMcpReloadState(await readMcpReloadState(workspace), connectorSmoke.checkedAt);
    const connectorSmokeAgeFresh =
        connectorSmoke.ok === true &&
        typeof connectorSmoke.ageMinutes === 'number' &&
        connectorSmoke.ageMinutes <= CONNECTOR_SMOKE_STALE_AFTER_MINUTES;
    const connectorSmokeFresh = connectorSmokeAgeFresh && reload.reconciledWithConnectorSmoke === true;
    const publicHealthUrl = cloudflareConfig.publicMcpUrl
        ? new URL('/health', cloudflareConfig.publicMcpUrl).toString()
        : null;
    const [mcpHttpProcess, cloudflaredProcess, localHealth, publicHealth] = await Promise.all([
        processes.mcpHttp.status(),
        processes.cloudflared.status(),
        probeHealth(cloudflareConfig.healthUrl, {
            allowInsecureHttps: cloudflareConfig.healthUrl.startsWith('https://'),
            ...(cloudflareConfig.originServerName ? { servername: cloudflareConfig.originServerName } : {}),
            timeoutMs: 3000,
        }),
        publicHealthUrl
            ? probeHealth(publicHealthUrl, { timeoutMs: 3000 })
            : Promise.resolve({ ok: false, error: 'public MCP URL not configured' }),
    ]);
    const originDiagnostics =
        options.includeDiagnostics === false ? null : await readCloudflaredOriginDiagnostics(cloudflareConfig);
    const statefulPolicy = readMcpHttpStatefulRuntimePolicySnapshot();
    const permanentUrlReady =
        cloudflareConfig.mode === 'named-permanent' &&
        Boolean(cloudflareConfig.publicMcpUrl) &&
        publicUrlValidation?.ok === true;
    const healthReady = localHealth.ok || publicHealth.ok;
    const ready =
        permanentUrlReady && mcpHttpProcess.alive && cloudflaredProcess.alive && healthReady && connectorSmokeFresh;
    /** @type {string[]} */
    const nextActions = [];
    if (!permanentUrlReady) nextActions.push('Fix COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or public hostname configuration.');
    if (!mcpHttpProcess.alive || !cloudflaredProcess.alive || !healthReady) {
        nextActions.push('Run make copilot-mcp-restart.');
    } else if (!localHealth.ok && publicHealth.ok) {
        nextActions.push(
            'Local HTTPS health probe failed, but public connector health is OK; inspect SNI/local TLS only if origin debugging is needed.',
        );
    }
    if (reload.inFlight) {
        nextActions.push(
            'Wait for mcp_reload_status to leave the in-flight state before trusting post-restart readiness.',
        );
    } else if (reload.failed) {
        nextActions.push('Inspect mcp_reload_status: the latest controlled MCP reload did not complete successfully.');
    }
    if (!connectorSmokeFresh) {
        nextActions.push(
            reload.completedSuccessfully && reload.smokeAfterReload !== true
                ? 'Run mcp_connector_smoke_refresh after the latest completed reload to reconcile the new process/tunnel generation.'
                : 'Run mcp_connector_smoke_refresh or make copilot-mcp-smoke-refresh.',
        );
    }
    if (ready)
        nextActions.push(
            'Start with repo_status; use mcp_capabilities_summary view=session only when task-routing guidance is useful, and mcp_validation_dashboard when validation state matters.',
        );
    return {
        success: true,
        ready,
        mode: cloudflareConfig.mode,
        connectorUrl: cloudflareConfig.publicMcpUrl ?? null,
        publicUrlValidation,
        processes: { mcpHttp: mcpHttpProcess, cloudflared: cloudflaredProcess },
        localHealth,
        publicHealth,
        healthReady,
        ...(originDiagnostics === null ? {} : { originDiagnostics }),
        statefulPolicy,
        reload,
        connectorSmoke: {
            ...connectorSmoke,
            ageFresh: connectorSmokeAgeFresh,
            fresh: connectorSmokeFresh,
            staleAfterMinutes: CONNECTOR_SMOKE_STALE_AFTER_MINUTES,
        },
        chatgpt: {
            authentication: formatChatGptConnectorAuthentication(authConfig),
            recommendedFirstCalls: ready
                ? ['repo_status', 'mcp_capabilities_summary view=session', 'mcp_validation_dashboard']
                : ['mcp_tunnel_status', 'mcp_connector_smoke_refresh'],
        },
        nextActions,
    };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}
