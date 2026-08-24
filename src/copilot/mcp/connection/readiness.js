// @ts-check
/**
 * Consolidated ChatGPT/Claude connector profile and transport readiness operations.
 *
 * @module copilot/mcp/connection/readiness
 */

import { readMcpAuthConfig } from '#copilot/mcp/public/auth';
import { readCloudflareTunnelConfig, validateConfiguredPublicUrl } from '#copilot/mcp/public/cloudflare/config';
import {
    createCloudflareStateStore,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '#copilot/mcp/public/cloudflare/state';
import { buildConnectionAuthReadiness } from './oauth-diagnostics.js';
import {
    buildChatGptConnectorProfile,
    buildClaudeConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
} from './profile.js';
import { normalizeMcpUrl, validatePublicConnectorUrl } from './url.js';

/**
 * @param {ReturnType<typeof readCloudflareTunnelConfig>} cloudflareConfig
 * @param {ReturnType<typeof readMcpAuthConfig>} authConfig
 * @param {string | null | undefined} connectorUrl
 * @returns {Record<string, unknown>}
 */
function buildHttp2PlusPosture(cloudflareConfig, authConfig, connectorUrl) {
    const originTransport = String(process.env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '')
        .trim()
        .toLowerCase();
    const h2OriginRequested = readBooleanEnv(process.env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false);
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
 * @param {ReturnType<typeof readCloudflareTunnelConfig>} cloudflareConfig
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
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {ReturnType<typeof readCloudflareTunnelConfig>} cloudflareConfig
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
        'Use o conector Repo DevContainer MCP e chame mcp_auth_profile.',
        'Chame chatgpt_connector_current_url_status e confirme success=true.',
        'Chame mcp_connection_readiness e confirme oauth.blockers vazio e http2Plus.defaultPolicy=HTTP/2+.',
        'Chame mcp_cloudflare_remote_audit e confirme que o origin remoto está sincronizado com HTTP/2+ antes de restart h2.',
        'Chame mcp_oauth_issuer_diagnostics e confirme authorization_endpoint, token_endpoint, PKCE S256, resource_parameter_supported e JWKS.',
        'Chame repo_status.',
        'Chame repo_tree path="src/copilot/mcp" maxDepth=2.',
        'Chame mcp_smoke_workspace.',
    ];
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

/** @param {{ publicMcpUrl?: string | undefined }} [input] */
export function readChatGptConnectorProfileReport(input = {}) {
    const profileOptions = input.publicMcpUrl === undefined ? {} : { publicMcpUrl: input.publicMcpUrl };
    const profile = buildChatGptConnectorProfile(profileOptions);
    const authConfig = readMcpAuthConfig();
    const cloudflareConfig = readCloudflareTunnelConfig();
    return {
        success: true,
        profile: { ...profile, smokePrompts: buildCanonicalSmokePrompts() },
        auth: buildConnectionAuthReadiness(authConfig),
        http2Plus: buildHttp2PlusPosture(cloudflareConfig, authConfig, profile.connectorUrl),
        runbook: buildSecureTunnelRunbook(profileOptions),
        cloudflareRunbook: buildCloudflareTunnelRunbook(profileOptions),
    };
}

/** @param {{ publicMcpUrl?: string | undefined }} [input] */
export function readClaudeConnectorProfileReport(input = {}) {
    const profileOptions = input.publicMcpUrl === undefined ? {} : { publicMcpUrl: input.publicMcpUrl };
    const profile = buildClaudeConnectorProfile(profileOptions);
    const authConfig = readMcpAuthConfig();
    const cloudflareConfig = readCloudflareTunnelConfig();
    return {
        success: true,
        profile,
        auth: buildConnectionAuthReadiness(authConfig),
        http2Plus: buildHttp2PlusPosture(cloudflareConfig, authConfig, profile.connectorUrl),
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

export async function readChatGptConnectorCurrentUrlStatus() {
    const cloudflareConfig = readCloudflareTunnelConfig();
    const authConfig = readMcpAuthConfig();
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
        http2Plus: buildHttp2PlusPosture(cloudflareConfig, authConfig, state.currentUrl),
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

/** @param {{ publicMcpUrl?: string | undefined }} [input] */
export async function readMcpConnectionReadiness(input = {}) {
    const cloudflareConfig = readCloudflareTunnelConfig();
    const authConfig = readMcpAuthConfig();
    const state = await buildConnectorStateSummary(cloudflareConfig);
    const candidateUrl = input.publicMcpUrl ? normalizeMcpUrl(input.publicMcpUrl) : state.currentUrl;
    const candidateValidation = candidateUrl
        ? validatePublicConnectorUrl(candidateUrl)
        : { ok: false, reason: 'No public MCP URL is configured.' };
    const auth = buildConnectionAuthReadiness(authConfig);
    const http2Plus = buildHttp2PlusPosture(cloudflareConfig, authConfig, candidateUrl);
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
