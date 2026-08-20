// @ts-check
/**
 * Cloudflare remote tunnel audit tools.
 *
 * The underlying audit remains rich because policy/diff/backup flows consume it internally. The MCP presentation is
 * deliberately compact so a routine read-only diagnostic does not inject tens of KiB of repeated desired-profile data
 * into the caller context.
 *
 * @module copilot/mcp/tools/cloudflare-remote
 */

import { auditCloudflareRemoteTunnel } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareRemoteAuditTool = {
    name: 'mcp_cloudflare_remote_audit',
    title: 'Cloudflare remote tunnel audit',
    description:
        'Read the remotely-managed Cloudflare tunnel configuration and return compact sanitized drift/readiness evidence.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(compactCloudflareRemoteAudit(await auditCloudflareRemoteTunnel())),
};

/**
 * @param {Record<string, unknown> & { ok: boolean }} audit
 */
export function compactCloudflareRemoteAudit(audit) {
    const desired = asRecord(audit['desired']);
    const remote = asRecord(audit['remote']);
    const tunnel = asRecord(remote['tunnel']);
    const config = asRecord(remote['config']);
    const hostnameRule = asRecord(config['hostnameRule']);
    const originRequest = asRecord(hostnameRule['originRequest']);
    const originFindings = asRecord(hostnameRule['originRequestFindings']);
    const score = asRecord(originFindings['score']);
    const connections = Array.isArray(tunnel['connections']) ? tunnel['connections'].map(asRecord) : [];
    const dns = asRecord(audit['dns']);
    const dnsRecords = Array.isArray(dns['records']) ? dns['records'].map(asRecord) : [];
    const fieldFindings = Array.isArray(originFindings['fieldFindings'])
        ? originFindings['fieldFindings'].map(asRecord)
        : [];
    const drift = fieldFindings
        .filter((row) => row['status'] !== 'ok')
        .map((row) => ({
            key: row['key'],
            status: row['status'],
            actualValue: row['actualValue'],
            recommendedValue: row['recommendedValue'],
            action: row['action'],
        }));

    return {
        ok: audit.ok,
        success: audit['success'],
        mode: audit['mode'],
        credentials: audit['credentials'],
        desired: {
            tunnelName: desired['tunnelName'],
            publicHostname: desired['publicHostname'],
            publicMcpUrl: desired['publicMcpUrl'],
            originService: desired['originService'],
            zone: desired['zone'],
        },
        tunnel: {
            id: tunnel['id'],
            name: tunnel['name'],
            status: tunnel['status'],
            source: tunnel['source'],
            createdAt: tunnel['createdAt'],
            connections: {
                total: connections.length,
                active: connections.filter((row) => row['isPendingReconnect'] !== true).length,
                colos: [
                    ...new Set(connections.map((row) => row['coloName']).filter((value) => typeof value === 'string')),
                ],
                clientVersions: [
                    ...new Set(
                        connections.map((row) => row['clientVersion']).filter((value) => typeof value === 'string'),
                    ),
                ],
            },
        },
        config: {
            source: config['source'],
            version: config['version'],
            catchAllConfigured: config['catchAllConfigured'],
            hostnameRule: {
                hostname: hostnameRule['hostname'],
                service: hostnameRule['service'],
                matchesExpectedOrigin: hostnameRule['matchesExpectedOrigin'],
                originRequest: pickOriginRequest(originRequest),
                score: {
                    explicitMatches: score['explicitMatches'],
                    explicitRecommendedCount: score['explicitRecommendedCount'],
                    explicitCoverage: score['explicitCoverage'],
                },
                drift,
                critical: originFindings['critical'],
                warnings: originFindings['warnings'],
            },
        },
        dns: {
            checked: dns['checked'],
            matchesExpectedTunnel: dns['matchesExpectedTunnel'],
            records: dnsRecords.map((record) => ({
                type: record['type'],
                name: record['name'],
                content: record['content'],
                proxied: record['proxied'],
                ttl: record['ttl'],
            })),
            critical: dns['critical'],
            warnings: dns['warnings'],
        },
        critical: audit['critical'],
        warnings: audit['warnings'],
        nextActions: audit['nextActions'],
        detailsAvailableInternally: true,
    };
}

/** @param {Record<string, unknown>} input */
function pickOriginRequest(input) {
    return {
        originServerName: input['originServerName'],
        noTLSVerify: input['noTLSVerify'],
        http2Origin: input['http2Origin'],
        disableChunkedEncoding: input['disableChunkedEncoding'],
        connectTimeout: input['connectTimeout'],
        noHappyEyeballs: input['noHappyEyeballs'],
        keepAliveTimeout: input['keepAliveTimeout'],
        keepAliveConnections: input['keepAliveConnections'],
        tcpKeepAlive: input['tcpKeepAlive'],
    };
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}
