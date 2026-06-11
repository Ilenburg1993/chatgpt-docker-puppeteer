// @ts-check
/**
 * Read-only Cloudflare edge/rulesets audit for the Copilot MCP hostname.
 *
 * @module copilot/mcp/cloudflare/edge-audit
 */

import { createTtlCache } from '#copilot/mcp/control-plane';
import { getCloudflareClient, readCloudflareRemoteApiConfig } from './remote-api.js';

/** @typedef {import('cloudflare').default} CloudflareEdgeAuditClient */

export const CLOUDFLARE_EDGE_PHASES = [
    'http_request_cache_settings',
    'http_request_firewall_custom',
    'http_ratelimit',
    'http_request_transform',
    'http_response_headers_transform',
    'http_config_settings',
    'http_request_origin',
];

const SENSITIVE_HEADER_NAMES = [
    'authorization',
    'www-authenticate',
    'set-cookie',
    'location',
    'content-type',
    'cache-control',
    'access-control-allow-origin',
    'access-control-allow-headers',
    'access-control-allow-methods',
];

const INTERACTIVE_OR_BLOCKING_ACTIONS = ['managed_challenge', 'js_challenge', 'challenge', 'block'];
const DEFAULT_EDGE_AUDIT_CACHE_TTL_MS = 5_000;

/** @type {import('#copilot/mcp/control-plane').TtlCache<Record<string, unknown> & { ok: boolean }>} */
const edgeAuditCache = createTtlCache({
    name: 'cloudflare-edge-audit',
    ttlMs: DEFAULT_EDGE_AUDIT_CACHE_TTL_MS,
    maxEntries: 32,
});

/**
 * @typedef {object} EdgeAuditConfig
 * @property {string | undefined} apiToken
 * @property {string | undefined} accountId
 * @property {string | undefined} zoneId
 * @property {string} zone
 * @property {string} publicHostname
 * @property {string} expectedPublicMcpUrl
 * @property {string[]} credentialSources
 */

/**
 * @typedef {object} SimplifiedRule
 * @property {string | null} id
 * @property {string | null} ref
 * @property {string | null} description
 * @property {string | null} action
 * @property {string | null} expression
 * @property {boolean} enabled
 * @property {string[]} actionParameterKeys
 * @property {boolean | null} cacheEnabled
 * @property {string[]} actionParameterHeaderNames
 */

/**
 * @typedef {object} SimplifiedRuleset
 * @property {string | null} id
 * @property {string | null} name
 * @property {string | null} phase
 * @property {string | null} kind
 * @property {string | null} version
 * @property {string | null} lastUpdated
 * @property {SimplifiedRule[]} rules
 */

/**
 * @param {{ env?: NodeJS.ProcessEnv; cacheTtlMs?: number; forceRefresh?: boolean }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function auditCloudflareEdgeRulesets(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    const edgeConfig = {
        apiToken: config.apiToken,
        accountId: config.accountId,
        zoneId: config.zoneId,
        zone: config.zone,
        publicHostname: config.publicHostname,
        expectedPublicMcpUrl: config.expectedPublicMcpUrl,
        credentialSources: config.credentialSources,
    };
    const missingCredentials = [];
    if (!edgeConfig.apiToken) missingCredentials.push('CLOUDFLARE_API_TOKEN');
    if (!edgeConfig.accountId) missingCredentials.push('CLOUDFLARE_ACCOUNT_ID');
    if (missingCredentials.length > 0) {
        return {
            ok: false,
            success: true,
            mode: 'read-only',
            edgeAuditable: false,
            credentials: summarizeEdgeCredentials(edgeConfig),
            desired: buildDesiredEdgePolicy(edgeConfig),
            critical: [`Missing required Cloudflare API credential(s): ${missingCredentials.join(', ')}.`],
            warnings: [],
            permissionGaps: ['Cloudflare edge audit requires an API token and account ID.'],
            nextActions: [
                'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env.local or the process environment.',
                'Use a read-only token first; keep mutation tokens separate.',
            ],
        };
    }
    const cacheKey = buildEdgeAuditCacheKey(edgeConfig);
    return edgeAuditCache.getOrLoad(
        cacheKey,
        () => auditCloudflareEdgeRulesetsUncached(edgeConfig),
        { forceRefresh: options.forceRefresh === true, ttlMs: readEdgeAuditCacheTtlMs(options.cacheTtlMs) },
    );
}

/**
 * @param {EdgeAuditConfig} edgeConfig
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
async function auditCloudflareEdgeRulesetsUncached(edgeConfig) {
    const client = getCloudflareClient(edgeConfig.apiToken ?? '');
    const zoneResolution = await resolveZoneId(client, edgeConfig);
    if (!zoneResolution.zoneId) {
        return {
            ok: true,
            success: true,
            mode: 'read-only',
            edgeAuditable: false,
            credentials: summarizeEdgeCredentials(edgeConfig),
            desired: buildDesiredEdgePolicy(edgeConfig),
            zone: zoneResolution,
            rulesets: [],
            critical: [],
            warnings: zoneResolution.warnings,
            permissionGaps: [
                'The current Cloudflare token cannot resolve the zone ID or CLOUDFLARE_ZONE_ID is not configured.',
                'Grant Zone:Read and Zone Rulesets:Read, or set CLOUDFLARE_ZONE_ID with a token that can read that zone.',
            ],
            nextActions: [
                'Create a read-only Cloudflare audit token with Zone:Read, DNS:Read, Zone Rulesets:Read and Zone Settings:Read.',
                'Set CLOUDFLARE_ZONE_ID to avoid relying on zone-name lookup.',
                'Re-run npm run copilot:mcp:cloudflare:edge-audit.',
            ],
        };
    }

    try {
        const rulesets = await readZoneRulesets(client, zoneResolution.zoneId);
        const analysis = analyzeEdgeRulesets(rulesets, {
            publicHostname: edgeConfig.publicHostname,
        });
        return {
            ok: analysis.critical.length === 0,
            success: true,
            mode: 'read-only',
            edgeAuditable: true,
            credentials: summarizeEdgeCredentials(edgeConfig),
            desired: buildDesiredEdgePolicy(edgeConfig),
            zone: zoneResolution,
            rulesets,
            ...analysis,
            permissionGaps: [],
            nextActions:
                analysis.critical.length === 0
                    ? [
                          'Keep this audit in the Cloudflare smoke sequence before changing WAF, cache or rate limit rules.',
                          'If warnings remain, decide whether to add explicit cache/rate-limit rules or document the dashboard state.',
                      ]
                    : [
                          'Fix critical edge interference before relying on long ChatGPT or Claude MCP sessions.',
                          'Prefer observe/log mode before adding stricter WAF or rate-limit actions to /mcp.',
                      ],
        };
    } catch (error) {
        return {
            ok: true,
            success: true,
            mode: 'read-only',
            edgeAuditable: false,
            credentials: summarizeEdgeCredentials(edgeConfig),
            desired: buildDesiredEdgePolicy(edgeConfig),
            zone: zoneResolution,
            rulesets: [],
            critical: [],
            warnings: [`Cloudflare rulesets audit failed: ${sanitizeError(error)}`],
            permissionGaps: [
                'The current Cloudflare token likely lacks Zone Rulesets:Read, or the account plan/API did not expose rulesets.',
            ],
            nextActions: [
                'Grant Zone Rulesets:Read to the read-only audit token.',
                'Re-run npm run copilot:mcp:cloudflare:edge-audit after the permission change.',
            ],
        };
    }
}

/**
 * @param {number | undefined} value
 * @returns {number}
 */
function readEdgeAuditCacheTtlMs(value) {
    if (value === undefined) return DEFAULT_EDGE_AUDIT_CACHE_TTL_MS;
    return Number.isFinite(value) && value >= 0 && value <= 60_000 ? Math.floor(value) : DEFAULT_EDGE_AUDIT_CACHE_TTL_MS;
}

/**
 * @param {EdgeAuditConfig} config
 * @returns {string}
 */
function buildEdgeAuditCacheKey(config) {
    return JSON.stringify({
        accountId: config.accountId ?? null,
        zoneId: config.zoneId ?? null,
        zone: config.zone,
        publicHostname: config.publicHostname,
        expectedPublicMcpUrl: config.expectedPublicMcpUrl,
    });
}

/**
 * @param {CloudflareEdgeAuditClient} client
 * @param {EdgeAuditConfig} config
 * @returns {Promise<{ zoneId: string | null; source: string | null; zoneName: string; zoneIdRedaction: string | null; warnings: string[] }>}
 */
async function resolveZoneId(client, config) {
    const configuredZoneId = String(config.zoneId ?? '').trim();
    if (configuredZoneId) {
        return {
            zoneId: configuredZoneId,
            source: 'configured:CLOUDFLARE_ZONE_ID',
            zoneName: config.zone,
            zoneIdRedaction: redactSecret(configuredZoneId),
            warnings: [],
        };
    }

    try {
        const query =
            typeof config.accountId === 'string' && config.accountId
                ? { name: config.zone, account: { id: config.accountId } }
                : { name: config.zone };
        for await (const zone of client.zones.list(query)) {
            const record = asRecord(zone);
            if (record['name'] === config.zone && typeof record['id'] === 'string') {
                return {
                    zoneId: record['id'],
                    source: 'cloudflare:zones.list',
                    zoneName: config.zone,
                    zoneIdRedaction: redactSecret(record['id']),
                    warnings: [],
                };
            }
        }
        return {
            zoneId: null,
            source: null,
            zoneName: config.zone,
            zoneIdRedaction: null,
            warnings: [`Cloudflare zone ${config.zone} was not found by zones.list.`],
        };
    } catch (error) {
        return {
            zoneId: null,
            source: null,
            zoneName: config.zone,
            zoneIdRedaction: null,
            warnings: [`Could not resolve Cloudflare zone ID: ${sanitizeError(error)}`],
        };
    }
}

/**
 * @param {CloudflareEdgeAuditClient} client
 * @param {string} zoneId
 * @returns {Promise<SimplifiedRuleset[]>}
 */
async function readZoneRulesets(client, zoneId) {
    /** @type {SimplifiedRuleset[]} */
    const rulesets = [];
    for await (const ruleset of client.rulesets.list({ zone_id: zoneId })) {
        const summary = asRecord(ruleset);
        const phase = typeof summary['phase'] === 'string' ? summary['phase'] : '';
        if (!CLOUDFLARE_EDGE_PHASES.includes(phase)) continue;
        const id = typeof summary['id'] === 'string' ? summary['id'] : '';
        const detailed = id ? await client.rulesets.get(id, { zone_id: zoneId }) : summary;
        rulesets.push(simplifyRuleset(detailed));
    }
    return rulesets.sort((left, right) =>
        `${left.phase ?? ''}:${left.name ?? ''}`.localeCompare(`${right.phase ?? ''}:${right.name ?? ''}`),
    );
}

/**
 * @param {unknown} ruleset
 * @returns {SimplifiedRuleset}
 */
function simplifyRuleset(ruleset) {
    const record = asRecord(ruleset);
    const rules = Array.isArray(record['rules']) ? record['rules'].map(simplifyRule) : [];
    return {
        id: typeof record['id'] === 'string' ? redactSecret(record['id']) : null,
        name: typeof record['name'] === 'string' ? record['name'] : null,
        phase: typeof record['phase'] === 'string' ? record['phase'] : null,
        kind: typeof record['kind'] === 'string' ? record['kind'] : null,
        version: typeof record['version'] === 'string' ? record['version'] : null,
        lastUpdated: typeof record['last_updated'] === 'string' ? record['last_updated'] : null,
        rules,
    };
}

/**
 * @param {unknown} rule
 * @returns {SimplifiedRule}
 */
function simplifyRule(rule) {
    const record = asRecord(rule);
    const actionParameters = asRecord(record['action_parameters']);
    return {
        id: typeof record['id'] === 'string' ? redactSecret(record['id']) : null,
        ref: typeof record['ref'] === 'string' ? record['ref'] : null,
        description: typeof record['description'] === 'string' ? record['description'] : null,
        action: typeof record['action'] === 'string' ? record['action'] : null,
        expression: typeof record['expression'] === 'string' ? record['expression'] : null,
        enabled: record['enabled'] !== false,
        actionParameterKeys: Object.keys(actionParameters).sort((left, right) => left.localeCompare(right)),
        cacheEnabled: typeof actionParameters['cache'] === 'boolean' ? actionParameters['cache'] : null,
        actionParameterHeaderNames: extractActionParameterHeaderNames(actionParameters),
    };
}

/**
 * @param {SimplifiedRuleset[]} rulesets
 * @param {{ publicHostname: string }} context
 * @returns {{
 *     critical: string[];
 *     warnings: string[];
 *     findings: Record<string, unknown>;
 * }}
 */
export function analyzeEdgeRulesets(rulesets, context) {
    const rules = rulesets.flatMap((ruleset) =>
        ruleset.rules.map((rule) => ({
            ...rule,
            phase: ruleset.phase,
            rulesetName: ruleset.name,
        })),
    );
    const hostRules = rules.filter((rule) => expressionMentionsHost(rule.expression, context.publicHostname));
    const mcpRules = hostRules.filter((rule) => expressionMentionsAnyPath(rule.expression, ['/mcp']));
    const dynamicRules = hostRules.filter((rule) =>
        expressionMentionsAnyPath(rule.expression, ['/mcp', '/.well-known', '/oauth', '/health']),
    );
    const critical = [];
    const warnings = [];

    const cacheBypassCandidates = dynamicRules.filter(
        (rule) =>
            rule.phase === 'http_request_cache_settings' &&
            rule.enabled &&
            rule.action === 'set_cache_settings' &&
            rule.cacheEnabled === false,
    );
    if (cacheBypassCandidates.length === 0) {
        warnings.push(
            'No explicit cache bypass rule was detected for /mcp, /.well-known, /oauth or /health on the MCP hostname.',
        );
    }

    const blockingMcpRules = mcpRules.filter(
        (rule) =>
            rule.enabled &&
            rule.action !== null &&
            INTERACTIVE_OR_BLOCKING_ACTIONS.includes(rule.action) &&
            rule.phase === 'http_request_firewall_custom',
    );
    if (blockingMcpRules.length > 0) {
        critical.push(
            `Detected ${blockingMcpRules.length} enabled Cloudflare WAF/block/challenge rule(s) that appear to target /mcp.`,
        );
    }

    const hostWideChallengeRules = hostRules.filter(
        (rule) =>
            rule.enabled &&
            rule.action !== null &&
            INTERACTIVE_OR_BLOCKING_ACTIONS.includes(rule.action) &&
            rule.phase === 'http_request_firewall_custom' &&
            !expressionMentionsAnyPath(rule.expression, ['/admin', '/internal', '/metrics']),
    );
    if (hostWideChallengeRules.length > blockingMcpRules.length) {
        critical.push(
            'Detected an enabled host-wide Cloudflare WAF/block/challenge rule that may catch MCP clients.',
        );
    }

    const oauthTokenRateLimits = hostRules.filter(
        (rule) => rule.enabled && rule.phase === 'http_ratelimit' && expressionMentionsAnyPath(rule.expression, ['/oauth/token']),
    );
    if (oauthTokenRateLimits.length === 0) {
        warnings.push('No explicit /oauth/token rate limit was detected; consider a moderate token-endpoint limit.');
    }

    const mcpRateLimits = mcpRules.filter((rule) => rule.enabled && rule.phase === 'http_ratelimit');
    if (mcpRateLimits.length === 0) {
        warnings.push(
            'No explicit /mcp rate-limit rule was detected; authenticated traffic can remain high, but anonymous abuse should be bounded.',
        );
    }

    const sensitiveHeaderTransforms = dynamicRules.filter(
        (rule) =>
            rule.enabled &&
            (rule.phase === 'http_request_transform' || rule.phase === 'http_response_headers_transform') &&
            (expressionMentionsAnyHeader(rule.expression, SENSITIVE_HEADER_NAMES) ||
                rule.actionParameterHeaderNames.some((headerName) => SENSITIVE_HEADER_NAMES.includes(headerName))),
    );
    if (sensitiveHeaderTransforms.length > 0) {
        critical.push(
            `Detected ${sensitiveHeaderTransforms.length} enabled transform rule(s) mentioning sensitive MCP/OAuth headers.`,
        );
    }

    return {
        critical,
        warnings,
        findings: {
            targetHostname: context.publicHostname,
            inspectedRulesets: rulesets.length,
            inspectedRules: rules.length,
            hostScopedRules: hostRules.length,
            mcpScopedRules: mcpRules.length,
            cacheBypassCandidateCount: cacheBypassCandidates.length,
            blockingMcpRuleCount: blockingMcpRules.length,
            hostWideChallengeRuleCount: hostWideChallengeRules.length,
            oauthTokenRateLimitCount: oauthTokenRateLimits.length,
            mcpRateLimitCount: mcpRateLimits.length,
            sensitiveHeaderTransformCount: sensitiveHeaderTransforms.length,
            phases: Object.fromEntries(
                CLOUDFLARE_EDGE_PHASES.map((phase) => [
                    phase,
                    rulesets.filter((ruleset) => ruleset.phase === phase).length,
                ]),
            ),
        },
    };
}

/**
 * @param {Record<string, unknown>} actionParameters
 * @returns {string[]}
 */
function extractActionParameterHeaderNames(actionParameters) {
    const headers = actionParameters['headers'];
    if (!Array.isArray(headers)) return [];
    return headers
        .map((header) => {
            const record = asRecord(header);
            const name = record['name'];
            return typeof name === 'string' ? name.trim().toLowerCase() : '';
        })
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string | null} expression
 * @param {string} hostname
 * @returns {boolean}
 */
function expressionMentionsHost(expression, hostname) {
    const text = String(expression ?? '').toLowerCase();
    return text.includes(hostname.toLowerCase());
}

/**
 * @param {string | null} expression
 * @param {string[]} paths
 * @returns {boolean}
 */
function expressionMentionsAnyPath(expression, paths) {
    const text = String(expression ?? '').toLowerCase();
    return paths.some((path) => text.includes(path.toLowerCase()));
}

/**
 * @param {string | null} expression
 * @param {string[]} headers
 * @returns {boolean}
 */
function expressionMentionsAnyHeader(expression, headers) {
    const text = String(expression ?? '').toLowerCase();
    return headers.some((header) => text.includes(header));
}

/**
 * @param {EdgeAuditConfig} config
 * @returns {Record<string, unknown>}
 */
function buildDesiredEdgePolicy(config) {
    return {
        publicHostname: config.publicHostname,
        publicMcpUrl: config.expectedPublicMcpUrl,
        zone: config.zone,
        cache: {
            expected: 'bypass for /mcp, /.well-known/*, /oauth/* and /health',
        },
        waf: {
            expected: 'no managed_challenge, js_challenge, challenge or broad block on /mcp',
        },
        rateLimit: {
            expected: 'moderate /oauth/token protection and bounded anonymous /mcp abuse without throttling authenticated MCP sessions',
        },
        transforms: {
            expected: 'do not modify Authorization, WWW-Authenticate, Set-Cookie, Location, Content-Type, Cache-Control or CORS headers',
        },
    };
}

/**
 * @param {EdgeAuditConfig} config
 * @returns {Record<string, unknown>}
 */
function summarizeEdgeCredentials(config) {
    return {
        apiTokenPresent: Boolean(config.apiToken),
        accountIdPresent: Boolean(config.accountId),
        zoneIdPresent: Boolean(config.zoneId),
        credentialSources: config.credentialSources,
        tokenRedaction: config.apiToken ? redactSecret(config.apiToken) : null,
        accountIdRedaction: config.accountId ? redactSecret(config.accountId) : null,
        zoneIdRedaction: config.zoneId ? redactSecret(config.zoneId) : null,
    };
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
 * @param {string} value
 * @returns {string}
 */
function redactSecret(value) {
    const text = String(value);
    if (text.length <= 8) return '<redacted>';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeError(error) {
    if (error instanceof Error) return error.message.replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1<redacted>');
    return String(error).replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1<redacted>');
}
