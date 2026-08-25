// @ts-check
/**
 * Cloudflare named-tunnel origin planning and guarded apply helpers for the Copilot MCP endpoint.
 *
 * The named tunnel receives its ingress config from Cloudflare. Therefore HTTP/2-to-origin is not complete until the
 * remote ingress service changes from http://127.0.0.1:3333 to https://127.0.0.1:3333 with http2Origin enabled.
 *
 * @module copilot/mcp/cloudflare/tunnel-origin-plan
 */

import { readBoundedResponseJson } from '#copilot/infra/public/platform/http-response';
import { buildRecommendedOriginRequestPatch } from '../origin-request-profile.js';
import { readCloudflareRemoteApiConfig, resolveCloudflareRemoteTunnelReference } from '../remote/public/runtime.js';

/**
 * @param {{ authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function buildCloudflareTunnelOriginPlan(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options);
    const desired = buildDesiredTunnelOriginConfig(config);
    const h2Requested = config.enableHttp2Origin === true;
    const h2Compatible = h2Requested && config.expectedOriginUrl.startsWith('https://');
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];

    if (h2Requested && !config.expectedOriginUrl.startsWith('https://')) {
        critical.push('HTTP/2 origin rollout was requested, but the expected tunnel origin URL is not HTTPS.');
    }
    if (config.expectedOriginUrl.startsWith('https://') && !h2Requested) {
        warnings.push('Tunnel origin is HTTPS but COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN is not enabled.');
    }

    return {
        ok: critical.length === 0,
        success: true,
        mode: 'read-only-tunnel-origin-plan',
        rollout: h2Compatible ? 'https-http2-origin' : 'http-origin',
        desired,
        guardrails: {
            requiresRemoteConfigUpdateForNamedTunnel: true,
            h2OriginRequiresHttpsService: true,
            h2OriginRequested: h2Requested,
            h2OriginCompatible: h2Compatible,
        },
        critical,
        warnings,
        nextActions: h2Compatible
            ? [
                  'Apply the remote named-tunnel ingress so mcp.aurelin.org points to https://127.0.0.1:3333.',
                  'Ensure the hostname rule originRequest includes http2Origin=true.',
                  'Run npm run copilot:mcp:h2:restart.',
                  'Run npm run copilot:mcp:cloudflare:h2-remote-audit before smoke.',
              ]
            : [
                  'Keep using npm run copilot:mcp:restart for the stable HTTP/1 origin.',
                  'For HTTP/2 rollout, use npm run copilot:mcp:h2:restart only after the remote ingress is updated.',
              ],
    };
}

/**
 * Guarded remote apply for the named tunnel origin configuration.
 *
 * Dry-run is the default. Real mutation requires dryRun=false and confirmApply=true.
 *
 * @param {{ authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; env?: NodeJS.ProcessEnv; dryRun?: boolean; confirmApply?: boolean }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function applyCloudflareTunnelOriginPlan(options = {}) {
    const dryRun = options.dryRun !== false;
    const confirmApply = options.confirmApply === true;
    const localConfig = await readCloudflareRemoteApiConfig(options);
    const desired = buildDesiredTunnelOriginConfig(localConfig);
    const preflight = await buildCloudflareTunnelOriginPlan(options);
    const blockedReason = dryRun
        ? 'Dry-run only. Set dryRun=false and confirmApply=true to update the remotely-managed tunnel origin.'
        : !confirmApply
          ? 'confirmApply=true is required to update the remotely-managed tunnel origin.'
          : null;

    if (blockedReason) {
        return {
            ok: preflight.ok,
            success: true,
            mode: 'guarded-tunnel-origin-apply',
            appliesChanges: false,
            dryRun: true,
            confirmApply,
            tunnelId: localConfig.tunnelId ? redactIdentifier(localConfig.tunnelId) : null,
            desired,
            apiConfigPreview: buildCloudflareTunnelOriginApiConfig(asRecord(desired['config'])),
            preflight,
            blockedReason,
        };
    }

    const reference = await resolveCloudflareRemoteTunnelReference(options);
    const result = await putTunnelConfiguration(reference.config, reference.tunnelId, desired);
    return {
        ok: true,
        success: true,
        mode: 'guarded-tunnel-origin-apply',
        appliesChanges: true,
        dryRun: false,
        confirmApply,
        tunnelId: redactIdentifier(reference.tunnelId),
        desired,
        applied: result,
        nextActions: buildPostApplyNextActions(localConfig.enableHttp2Origin === true),
    };
}

/**
 * @param {boolean} h2Origin
 * @returns {string[]}
 */
function buildPostApplyNextActions(h2Origin) {
    return h2Origin
        ? [
              'Run npm run copilot:mcp:cloudflare:h2-remote-audit.',
              'Run npm run copilot:mcp:h2:restart.',
              'Run npm run copilot:mcp:cloudflare:smoke.',
          ]
        : [
              'Run npm run copilot:mcp:cloudflare:remote-audit.',
              'Run npm run copilot:mcp:restart.',
              'Run npm run copilot:mcp:cloudflare:smoke.',
          ];
}

/**
 * @param {import('../remote/public/runtime.js').CloudflareRemoteApiConfig} config
 * @returns {Record<string, unknown>}
 */
function buildDesiredTunnelOriginConfig(config) {
    const originRequest = buildRecommendedOriginRequestPatch({
        originServiceUrl: config.expectedOriginUrl,
        ...(config.originServerName ? { originServerName: config.originServerName } : {}),
        enableHttp2Origin: config.enableHttp2Origin,
    });
    const hostnameRule = {
        hostname: config.publicHostname,
        service: config.expectedOriginUrl,
        originRequest,
    };
    const catchAllRule = { service: 'http_status:404' };
    return {
        tunnelName: config.tunnelName,
        publicHostname: config.publicHostname,
        publicMcpUrl: config.expectedPublicMcpUrl,
        originService: config.expectedOriginUrl,
        originRequest,
        config: {
            ingress: [hostnameRule, catchAllRule],
        },
        ingress: [hostnameRule, catchAllRule],
    };
}

/**
 * @param {import('../remote/public/runtime.js').CloudflareRemoteApiConfig} config
 * @param {string} tunnelId
 * @param {Record<string, unknown>} desired
 * @returns {Promise<Record<string, unknown>>}
 */
async function putTunnelConfiguration(config, tunnelId, desired) {
    if (!config.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to apply tunnel origin config.');
    if (!config.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required to apply tunnel origin config.');
    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
        {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${config.apiToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ config: buildCloudflareTunnelOriginApiConfig(asRecord(desired['config'])) }),
        },
    );
    const body = await readBoundedResponseJson(response, {
        maxBytes: 2 * 1024 * 1024,
        label: 'Cloudflare tunnel configuration update',
    }).catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            `Cloudflare tunnel configuration update failed with HTTP ${response.status}: ${sanitizeCloudflareBody(body)}`,
        );
    }
    return summarizeCloudflareApplyResponse(body);
}

/**
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
function buildCloudflareTunnelOriginApiConfig(config) {
    const ingress = Array.isArray(config['ingress']) ? config['ingress'].map(normalizeIngressRuleForApi) : [];
    return { ...config, ingress };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizeIngressRuleForApi(value) {
    const rule = asRecord(value);
    const originRequest = asRecord(rule['originRequest']);
    return Object.keys(originRequest).length > 0
        ? { ...rule, originRequest: normalizeOriginRequestForApi(originRequest) }
        : rule;
}

const ORIGIN_REQUEST_DURATION_KEYS = Object.freeze([
    'connectTimeout',
    'keepAliveTimeout',
    'tcpKeepAlive',
    'tlsTimeout',
]);

/**
 * @param {Record<string, unknown>} originRequest
 * @returns {Record<string, unknown>}
 */
function normalizeOriginRequestForApi(originRequest) {
    /** @type {Record<string, unknown>} */
    const normalized = {};
    for (const [key, value] of Object.entries(originRequest)) {
        normalized[key] = ORIGIN_REQUEST_DURATION_KEYS.includes(key) ? parseCloudflareDurationNanos(value, key) : value;
    }
    return normalized;
}

/**
 * Cloudflare's REST cfd_tunnel configurations endpoint parses originRequest durations as Go time.Duration integers.
 * cloudflared config files accept human strings like "5s"; the REST endpoint rejects those with ParseInt errors.
 *
 * @param {unknown} value
 * @param {string} key
 * @returns {number}
 */
function parseCloudflareDurationNanos(value, key) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') throw new Error(`Invalid Cloudflare duration for ${key}: ${String(value)}.`);
    const text = value.trim();
    const matches = [...text.matchAll(/(\d+)(ms|s|m|h)/gu)];
    if (matches.length === 0 || matches.map((match) => match[0]).join('') !== text) {
        throw new Error(`Invalid Cloudflare duration for ${key}: ${value}.`);
    }
    let total = 0;
    for (const match of matches) {
        const amount = Number(match[1]);
        const unit = match[2];
        const factor =
            unit === 'ms'
                ? 1_000_000
                : unit === 's'
                  ? 1_000_000_000
                  : unit === 'm'
                    ? 60_000_000_000
                    : 3_600_000_000_000;
        total += amount * factor;
    }
    return total;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function summarizeCloudflareApplyResponse(body) {
    const record = asRecord(body);
    return {
        success: record['success'] ?? null,
        errors: record['errors'] ?? null,
        messages: record['messages'] ?? null,
        resultVersion: asRecord(record['result'])['version'] ?? null,
    };
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function sanitizeCloudflareBody(body) {
    return JSON.stringify(body).replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1<redacted>');
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactIdentifier(value) {
    if (value.length <= 8) return '<redacted>';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}
