// @ts-check
/**
 * Read-only Cloudflare API audit helpers for the Copilot MCP tunnel.
 *
 * @module copilot/mcp/cloudflare/remote-api
 */

import Cloudflare from 'cloudflare';
import { readFile } from 'node:fs/promises';
import { readCloudflareTunnelConfig } from './config.js';
import {
    auditOriginRequestProfile as auditOriginRequestProfileBase,
    buildDesiredOriginRequestProfile,
} from './origin-request-profile.js';

const DEFAULT_ENV_FILE = '.env.local';

/**
 * @typedef {object} CloudflareRemoteApiConfig
 * @property {string | undefined} apiToken
 * @property {string | undefined} accountId
 * @property {string | undefined} zoneId
 * @property {string | undefined} tunnelId
 * @property {string} tunnelName
 * @property {string} publicHostname
 * @property {string} expectedOriginUrl
 * @property {string | undefined} originServerName
 * @property {boolean} enableHttp2Origin
 * @property {string} expectedPublicMcpUrl
 * @property {string} zone
 * @property {string[]} credentialSources
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<CloudflareRemoteApiConfig>}
 */
export async function readCloudflareRemoteApiConfig(env = process.env) {
    const fileEnv = await readLocalEnvFile();
    const merged = { ...fileEnv, ...env };
    const tunnelConfig = readCloudflareTunnelConfig(/** @type {NodeJS.ProcessEnv} */ (merged));
    return {
        apiToken:
            firstNonEmpty(merged['CLOUDFLARE_API_TOKEN'], merged['CLOUDFLARE_API_KEY'], merged['CLOUDFLARE_KEY']) ??
            undefined,
        accountId: firstNonEmpty(merged['CLOUDFLARE_ACCOUNT_ID']) ?? undefined,
        zoneId: firstNonEmpty(merged['CLOUDFLARE_ZONE_ID']) ?? undefined,
        tunnelId: firstNonEmpty(merged['COPILOT_MCP_CLOUDFLARE_TUNNEL_ID']) ?? undefined,
        tunnelName: tunnelConfig.tunnelName,
        publicHostname: tunnelConfig.publicHostname,
        expectedOriginUrl: tunnelConfig.originUrl,
        originServerName: tunnelConfig.originServerName,
        enableHttp2Origin: readBooleanEnv(merged['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false),
        expectedPublicMcpUrl: tunnelConfig.publicMcpUrl ?? `https://${tunnelConfig.publicHostname}/mcp`,
        zone: tunnelConfig.zone,
        credentialSources: buildCredentialSources(env, fileEnv),
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function auditCloudflareRemoteTunnel(options = {}) {
    const apiConfig = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    const missingCredentials = [];
    if (!apiConfig.apiToken) missingCredentials.push('CLOUDFLARE_API_TOKEN');
    if (!apiConfig.accountId) missingCredentials.push('CLOUDFLARE_ACCOUNT_ID');
    if (missingCredentials.length > 0) {
        return {
            ok: false,
            success: true,
            mode: 'read-only',
            critical: [`Missing required Cloudflare API credential(s): ${missingCredentials.join(', ')}.`],
            warnings: [],
            credentials: summarizeCredentials(apiConfig),
            desired: buildDesiredRemoteConfigSummary(apiConfig),
            remote: null,
            dns: null,
            nextActions: [
                'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env.local or the process environment.',
                'Keep tokens out of git; this audit only reports presence and sources.',
            ],
        };
    }

    try {
        const apiToken = apiConfig.apiToken ?? '';
        const accountId = apiConfig.accountId ?? '';
        const client = new Cloudflare({ apiToken, maxRetries: 1, timeout: 15000 });
        const tunnel = await findRemoteTunnel(client, { ...apiConfig, accountId });
        if (!tunnel.ok) return buildTunnelLookupFailure(apiConfig, tunnel);
        const configuration = await client.zeroTrust.tunnels.cloudflared.configurations.get(tunnel.id, {
            account_id: accountId,
        });
        const comparison = compareRemoteConfig(apiConfig, tunnel, configuration);
        const dns = await auditDnsRecord(client, apiConfig, tunnel);
        const critical = [...comparison.critical, ...(dns.critical ?? [])];
        const warnings = [...comparison.warnings, ...(dns.warnings ?? [])];
        return {
            ok: critical.length === 0,
            success: true,
            mode: 'read-only',
            credentials: summarizeCredentials(apiConfig),
            desired: buildDesiredRemoteConfigSummary(apiConfig),
            remote: comparison.remote,
            dns,
            critical,
            warnings,
            nextActions:
                critical.length === 0
                    ? buildRemoteAuditNextActions(apiConfig.enableHttp2Origin === true)
                    : [
                          'Fix critical Cloudflare drift before relying on ChatGPT or Claude connector sessions.',
                          'The canonical origin service is http://127.0.0.1:3333, not localhost and not a /mcp path.',
                      ],
        };
    } catch (error) {
        return {
            ok: false,
            success: true,
            mode: 'read-only',
            critical: ['Cloudflare API audit failed.'],
            warnings: [],
            credentials: summarizeCredentials(apiConfig),
            desired: buildDesiredRemoteConfigSummary(apiConfig),
            remote: null,
            dns: null,
            error: sanitizeError(error),
            nextActions: [
                'Check that the Cloudflare token has read access to Zero Trust tunnels for the configured account.',
                'Check that CLOUDFLARE_ACCOUNT_ID matches the account that owns workspace-mcp-dev.',
            ],
        };
    }
}

/**
 * @param {boolean} h2Origin
 * @returns {string[]}
 */
function buildRemoteAuditNextActions(h2Origin) {
    return h2Origin
        ? [
              'Keep npm run copilot:mcp:cloudflare:h2-remote-audit in the HTTP/2 origin smoke sequence.',
              'Run make copilot-mcp-h2-remote-audit and make copilot-mcp-smoke after H2 remote config or DNS changes.',
          ]
        : [
              'Keep npm run copilot:mcp:cloudflare:remote-audit in the regular tunnel smoke sequence.',
              'Run make copilot-mcp-smoke after remote config or DNS changes.',
          ];
}

/**
 * @returns {Promise<Record<string, string>>}
 */
async function readLocalEnvFile() {
    try {
        return parseEnvFile(await readFile(DEFAULT_ENV_FILE, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
    /** @type {Record<string, string>} */
    const env = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const equalsAt = line.indexOf('=');
        if (equalsAt <= 0) continue;
        const key = line.slice(0, equalsAt).trim();
        const value = unquoteEnvValue(line.slice(equalsAt + 1).trim());
        if (/^[A-Z0-9_]+$/u.test(key)) env[key] = value;
    }
    return env;
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquoteEnvValue(value) {
    if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
        return value.slice(1, -1);
    }
    return value;
}

/**
 * @param {(string | undefined)[]} values
 * @returns {string | undefined}
 */
function firstNonEmpty(...values) {
    return values.map((value) => String(value ?? '').trim()).find(Boolean);
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(value, fallback) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {Record<string, string>} fileEnv
 * @returns {string[]}
 */
function buildCredentialSources(env, fileEnv) {
    const sources = [];
    for (const key of [
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_API_KEY',
        'CLOUDFLARE_KEY',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_ZONE_ID',
        'COPILOT_MCP_CLOUDFLARE_TUNNEL_ID',
    ]) {
        if (String(env[key] ?? '').trim()) sources.push(`process:${key}`);
        else if (String(fileEnv[key] ?? '').trim()) sources.push(`${DEFAULT_ENV_FILE}:${key}`);
    }
    return sources;
}

/**
 * @param {CloudflareRemoteApiConfig} config
 * @returns {Record<string, unknown>}
 */
function summarizeCredentials(config) {
    return {
        apiTokenPresent: Boolean(config.apiToken),
        accountIdPresent: Boolean(config.accountId),
        zoneIdPresent: Boolean(config.zoneId),
        tunnelIdPresent: Boolean(config.tunnelId),
        credentialSources: config.credentialSources,
        tokenRedaction: config.apiToken ? redactSecret(config.apiToken) : null,
        accountIdRedaction: config.accountId ? redactSecret(config.accountId) : null,
        zoneIdRedaction: config.zoneId ? redactSecret(config.zoneId) : null,
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactSecret(value) {
    const text = String(value);
    if (text.length <= 8) return '<redacted>';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

/**
 * @param {CloudflareRemoteApiConfig} config
 * @returns {Record<string, unknown>}
 */
function buildDesiredRemoteConfigSummary(config) {
    return {
        tunnelName: config.tunnelName,
        publicHostname: config.publicHostname,
        publicMcpUrl: config.expectedPublicMcpUrl,
        originService: config.expectedOriginUrl,
        zone: config.zone,
        catchAll: 'http_status:404',
        desiredOriginRequestProfile: buildDesiredOriginRequestProfile({
            originServiceUrl: config.expectedOriginUrl,
            ...(config.originServerName ? { originServerName: config.originServerName } : {}),
            enableHttp2Origin: config.enableHttp2Origin,
        }),
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ config: CloudflareRemoteApiConfig; tunnelId: string; tunnel: Record<string, unknown> }>}
 */
export async function resolveCloudflareRemoteTunnelReference(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    if (!config.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to resolve the remote Cloudflare tunnel.');
    if (!config.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required to resolve the remote Cloudflare tunnel.');
    const client = new Cloudflare({ apiToken: config.apiToken, maxRetries: 1, timeout: 15000 });
    const lookup = await findRemoteTunnel(client, { ...config, accountId: config.accountId });
    if (!lookup.ok) {
        throw new Error(`Could not resolve Cloudflare tunnel "${config.tunnelName}": ${lookup.reason}.`);
    }
    return { config, tunnelId: lookup.id, tunnel: lookup.tunnel };
}

/**
 * @param {Cloudflare} client
 * @param {CloudflareRemoteApiConfig} config
 * @returns {Promise<
 *     | { ok: true; id: string; tunnel: Record<string, unknown> }
 *     | { ok: false; reason: string; matches: Record<string, unknown>[] }
 * >}
 */
async function findRemoteTunnel(client, config) {
    if (config.tunnelId) {
        const tunnel = await client.zeroTrust.tunnels.cloudflared.get(config.tunnelId, {
            account_id: config.accountId ?? '',
        });
        return { ok: true, id: config.tunnelId, tunnel: asRecord(tunnel) };
    }

    const matches = [];
    for await (const tunnel of client.zeroTrust.tunnels.cloudflared.list({
        account_id: config.accountId ?? '',
        is_deleted: false,
        name: config.tunnelName,
    })) {
        const record = asRecord(tunnel);
        if (record['name'] === config.tunnelName) matches.push(record);
    }
    if (matches.length !== 1) {
        return {
            ok: false,
            reason: matches.length === 0 ? 'tunnel-not-found' : 'tunnel-name-ambiguous',
            matches: matches.map(summarizeTunnel),
        };
    }
    return { ok: true, id: String(matches[0]?.['id'] ?? ''), tunnel: matches[0] ?? {} };
}

/**
 * @param {CloudflareRemoteApiConfig} config
 * @param {{ ok: false; reason: string; matches: Record<string, unknown>[] }} lookup
 * @returns {Record<string, unknown> & { ok: false }}
 */
function buildTunnelLookupFailure(config, lookup) {
    return {
        ok: false,
        success: true,
        mode: 'read-only',
        critical: [`Could not resolve Cloudflare tunnel "${config.tunnelName}": ${lookup.reason}.`],
        warnings: [],
        credentials: summarizeCredentials(config),
        desired: buildDesiredRemoteConfigSummary(config),
        remote: {
            lookupReason: lookup.reason,
            matches: lookup.matches,
        },
        dns: null,
        nextActions: [
            'Set COPILOT_MCP_CLOUDFLARE_TUNNEL_ID if name lookup is ambiguous.',
            'Confirm the tunnel belongs to CLOUDFLARE_ACCOUNT_ID.',
        ],
    };
}

/**
 * @param {CloudflareRemoteApiConfig} config
 * @param {{ id: string; tunnel: Record<string, unknown> }} tunnel
 * @param {unknown} configuration
 * @returns {{ critical: string[]; warnings: string[]; remote: Record<string, unknown> }}
 */
export function compareRemoteConfig(config, tunnel, configuration) {
    const critical = [];
    const warnings = [];
    const configRecord = asRecord(configuration);
    const nestedConfig = asRecord(configRecord['config']);
    const ingress = Array.isArray(nestedConfig['ingress']) ? nestedConfig['ingress'].map(asRecord) : [];
    const hostnameRule = ingress.find((rule) => rule['hostname'] === config.publicHostname);
    const catchAllRule = ingress.find((rule) => !rule['hostname'] && rule['service'] === 'http_status:404');
    const originRequest = hostnameRule ? asRecord(hostnameRule['originRequest']) : {};
    const originRequestAudit = auditOriginRequestProfileBase(originRequest, {
        hostnameRulePresent: Boolean(hostnameRule),
        originServiceUrl: config.expectedOriginUrl,
        ...(config.originServerName ? { originServerName: config.originServerName } : {}),
        enableHttp2Origin: config.enableHttp2Origin,
    });
    warnings.push(...originRequestAudit.warnings);
    if (!hostnameRule) {
        critical.push(`Missing ingress rule for ${config.publicHostname}.`);
    } else if (hostnameRule['service'] !== config.expectedOriginUrl) {
        critical.push(
            `Ingress service for ${config.publicHostname} is ${String(hostnameRule['service'])}; expected ${config.expectedOriginUrl}.`,
        );
    }
    if (!catchAllRule) warnings.push('Remote tunnel config has no http_status:404 catch-all ingress rule.');
    if (configRecord['source'] !== 'cloudflare') {
        warnings.push('Tunnel config source is not cloudflare/remotely-managed.');
    }

    const connections = Array.isArray(tunnel.tunnel['connections']) ? tunnel.tunnel['connections'] : [];
    const activeConnections = connections.filter((connection) => {
        const record = asRecord(connection);
        return String(record['is_pending_reconnect'] ?? 'false') !== 'true';
    });
    const status = String(tunnel.tunnel['status'] ?? '');
    if (status && status !== 'healthy') warnings.push(`Tunnel status is ${status}; expected healthy.`);
    if (connections.length === 0) warnings.push('Cloudflare reports zero active connector records for this tunnel.');

    return {
        critical,
        warnings,
        remote: {
            tunnel: summarizeTunnel(tunnel.tunnel),
            config: {
                source: configRecord['source'] ?? null,
                version: configRecord['version'] ?? null,
                ingress: ingress.map((rule) => ({
                    hostname: rule['hostname'] ?? null,
                    service: rule['service'] ?? null,
                    path: rule['path'] ?? null,
                })),
                hostnameRule: hostnameRule
                    ? {
                          hostname: hostnameRule['hostname'],
                          service: hostnameRule['service'],
                          matchesExpectedOrigin: hostnameRule['service'] === config.expectedOriginUrl,
                          originRequest: originRequestAudit.actual,
                          originRequestFindings: originRequestAudit,
                      }
                    : null,
                catchAllConfigured: Boolean(catchAllRule),
            },
            connections: {
                total: connections.length,
                active: activeConnections.length,
            },
        },
    };
}

/**
 * @param {Cloudflare} client
 * @param {CloudflareRemoteApiConfig} config
 * @param {{ id: string }} tunnel
 * @returns {Promise<Record<string, unknown> & { critical?: string[]; warnings?: string[] }>}
 */
async function auditDnsRecord(client, config, tunnel) {
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const critical = [];
    let zoneId = config.zoneId;
    if (!zoneId) {
        try {
            const query =
                typeof config.accountId === 'string'
                    ? { name: config.zone, account: { id: config.accountId } }
                    : { name: config.zone };
            for await (const zone of client.zones.list(query)) {
                const record = asRecord(zone);
                if (record['name'] === config.zone && typeof record['id'] === 'string') {
                    zoneId = record['id'];
                    break;
                }
            }
        } catch (error) {
            warnings.push(`Could not resolve zone ID from Cloudflare API: ${sanitizeError(error)}`);
        }
    }
    if (!zoneId) {
        return {
            checked: false,
            reason: 'zone-id-not-configured-or-resolved',
            critical,
            warnings: [...warnings, 'Set CLOUDFLARE_ZONE_ID to enable DNS record drift audit.'],
        };
    }

    try {
        const records = [];
        for await (const record of client.dns.records.list({
            zone_id: zoneId,
            type: 'CNAME',
            name: { exact: config.publicHostname },
        })) {
            records.push(asRecord(record));
        }
        const expectedSuffix = `${tunnel.id}.cfargotunnel.com`;
        const matching = records.find((record) => String(record['content'] ?? '').endsWith(expectedSuffix));
        if (!matching) {
            critical.push(`DNS CNAME for ${config.publicHostname} does not point to ${expectedSuffix}.`);
        }
        return {
            checked: true,
            zoneIdRedaction: redactSecret(zoneId),
            expectedContentSuffix: expectedSuffix,
            records: records.map((record) => ({
                id: typeof record['id'] === 'string' ? redactSecret(record['id']) : null,
                type: record['type'] ?? null,
                name: record['name'] ?? null,
                content: record['content'] ?? null,
                proxied: record['proxied'] ?? null,
                ttl: record['ttl'] ?? null,
            })),
            matchesExpectedTunnel: Boolean(matching),
            critical,
            warnings,
        };
    } catch (error) {
        return {
            checked: false,
            reason: 'dns-api-error',
            error: sanitizeError(error),
            critical,
            warnings: [...warnings, 'Cloudflare DNS audit failed; tunnel config audit still completed.'],
        };
    }
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

/**
 * @param {Record<string, unknown>} tunnel
 * @returns {Record<string, unknown>}
 */
function summarizeTunnel(tunnel) {
    const connections = Array.isArray(tunnel['connections']) ? tunnel['connections'].map(asRecord) : [];
    return {
        id: typeof tunnel['id'] === 'string' ? redactSecret(tunnel['id']) : null,
        name: tunnel['name'] ?? null,
        status: tunnel['status'] ?? null,
        source: tunnel['tun_type'] ?? tunnel['config_src'] ?? null,
        createdAt: tunnel['created_at'] ?? null,
        deletedAt: tunnel['deleted_at'] ?? null,
        connections: connections.map((connection) => ({
            id: typeof connection['id'] === 'string' ? redactSecret(connection['id']) : null,
            coloName: connection['colo_name'] ?? null,
            isPendingReconnect: connection['is_pending_reconnect'] ?? null,
            originIp: connection['origin_ip'] ? '<redacted-ip>' : null,
            openedAt: connection['opened_at'] ?? null,
            clientVersion: connection['client_version'] ?? null,
        })),
    };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeError(error) {
    if (error instanceof Error) return error.message.replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1<redacted>');
    return String(error).replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1<redacted>');
}
