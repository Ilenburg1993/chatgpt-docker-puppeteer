// @ts-check
/**
 * Read-only Cloudflare skip/non-interference audit for the Copilot MCP hostname.
 *
 * This module does not mutate Cloudflare. It inspects rulesets that can skip or challenge Cloudflare products and
 * combines that with MCP-specific configuration findings to decide whether an MCP skip rule is necessary, or whether
 * a narrower configuration rule should be preferred first.
 *
 * @module copilot/mcp/cloudflare/skip-audit
 */

import { createTtlCache } from '#copilot/mcp/control-plane';
import { auditCloudflareConfigPosture } from './config-audit.js';
import { getCloudflareClient, readCloudflareRemoteApiConfig } from './remote-api.js';
import { readCloudflareRulesetSnapshot } from './ruleset-snapshot.js';

const SKIP_AUDIT_PHASES = [
    'http_request_firewall_custom',
    'http_ratelimit',
    'http_request_late_transform',
    'http_request_transform',
    'http_response_headers_transform',
    'http_config_settings',
];

const MCP_DYNAMIC_PATHS = ['/mcp', '/oauth/', '/.well-known/', '/health'];
const SKIPPABLE_PRODUCTS = [
    'bic',
    'securityLevel',
    'uaBlock',
    'zoneLockdown',
    'waf',
    'botFightMode',
    'rateLimit',
];
const NON_SKIPPABLE_OR_CONFIG_FIRST_PRODUCTS = ['rocketLoader', 'rum', 'emailObfuscation', 'zaraz'];
const DEFAULT_SKIP_AUDIT_CACHE_TTL_MS = 60_000;

/** @type {import('#copilot/mcp/control-plane').TtlCache<Record<string, unknown> & { ok: boolean }>} */
const skipAuditCache = createTtlCache({
    name: 'cloudflare-skip-audit',
    ttlMs: DEFAULT_SKIP_AUDIT_CACHE_TTL_MS,
    maxEntries: 32,
});

/**
 * @typedef {object} SkipAuditConfig
 * @property {string | undefined} apiToken
 * @property {string | undefined} accountId
 * @property {string | undefined} zoneId
 * @property {string} zone
 * @property {string} publicHostname
 * @property {string} expectedPublicMcpUrl
 * @property {string[]} credentialSources
 *
 * @typedef {object} SkipRuleSummary
 * @property {string | null} id
 * @property {string | null} ref
 * @property {string | null} description
 * @property {string | null} phase
 * @property {string | null} action
 * @property {string | null} expression
 * @property {boolean} enabled
 * @property {string[]} products
 * @property {string[]} phases
 * @property {string[]} actionParameterKeys
 * @property {boolean} hostScoped
 * @property {boolean} dynamicMcpScoped
 * @property {boolean} mcpEndpointScoped
 * @property {boolean} skipsRateLimit
 * @property {boolean} skipsAllProducts
 */

/**
 * @param {{ env?: NodeJS.ProcessEnv; cacheTtlMs?: number; forceRefresh?: boolean }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function auditCloudflareSkipPosture(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    /** @type {SkipAuditConfig} */
    const auditConfig = {
        apiToken: config.apiToken,
        accountId: config.accountId,
        zoneId: config.zoneId,
        zone: config.zone,
        publicHostname: config.publicHostname,
        expectedPublicMcpUrl: config.expectedPublicMcpUrl,
        credentialSources: config.credentialSources,
    };
    const missingCredentials = [];
    if (!auditConfig.apiToken) missingCredentials.push('CLOUDFLARE_API_TOKEN');
    if (!auditConfig.accountId) missingCredentials.push('CLOUDFLARE_ACCOUNT_ID');
    if (missingCredentials.length > 0) {
        return {
            ok: false,
            success: true,
            mode: 'read-only-skip-audit',
            skipAuditable: false,
            credentials: summarizeCredentials(auditConfig),
            critical: [`Missing required Cloudflare API credential(s): ${missingCredentials.join(', ')}.`],
            warnings: [],
            permissionGaps: ['Cloudflare skip audit requires an API token and account ID.'],
            nextActions: ['Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, then re-run the audit.'],
        };
    }

    const cacheKey = buildSkipAuditCacheKey(auditConfig);
    return skipAuditCache.getOrLoad(
        cacheKey,
        () => auditCloudflareSkipPostureUncached(auditConfig, options),
        { forceRefresh: options.forceRefresh === true, ttlMs: readSkipAuditCacheTtlMs(options.cacheTtlMs) },
    );
}

/**
 * @param {SkipAuditConfig} auditConfig
 * @param {{ cacheTtlMs?: number; forceRefresh?: boolean }} options
 */
async function auditCloudflareSkipPostureUncached(auditConfig, options) {
    const client = getCloudflareClient(auditConfig.apiToken ?? '');
    const zoneResolution = await resolveZoneId(client, auditConfig);
    if (!zoneResolution.zoneId) {
        return {
            ok: true,
            success: true,
            mode: 'read-only-skip-audit',
            skipAuditable: false,
            credentials: summarizeCredentials(auditConfig),
            zone: zoneResolution,
            skipRules: [],
            configBaseline: null,
            findings: buildEmptyFindings(auditConfig.publicHostname),
            critical: [],
            warnings: zoneResolution.warnings,
            permissionGaps: [
                'The current Cloudflare token cannot resolve the zone ID or CLOUDFLARE_ZONE_ID is not configured.',
                'Grant Zone:Read and Zone Rulesets:Read, or set CLOUDFLARE_ZONE_ID.',
            ],
            recommendation: {
                skipNeeded: 'unknown',
                preferredNextStep: 'Resolve zone permissions before planning skip/config rules.',
                rationale: ['Zone ID could not be resolved.'],
            },
            nextActions: ['Re-run mcp_cloudflare_skip_audit after the permission change.'],
        };
    }

    const [skipRulesResult, configBaseline] = await Promise.all([
        readSkipRules(auditConfig.apiToken ?? '', zoneResolution.zoneId, auditConfig.publicHostname, options),
        auditCloudflareConfigPosture(options),
    ]);
    const analysis = analyzeSkipPosture(skipRulesResult.rules, configBaseline, {
        publicHostname: auditConfig.publicHostname,
    });

    return {
        ok: analysis.critical.length === 0,
        success: true,
        mode: 'read-only-skip-audit',
        skipAuditable: true,
        credentials: summarizeCredentials(auditConfig),
        endpoint: {
            publicHostname: auditConfig.publicHostname,
            publicMcpUrl: auditConfig.expectedPublicMcpUrl,
            zone: auditConfig.zone,
        },
        zone: zoneResolution,
        skipRules: onlySkipRules(skipRulesResult.rules),
        relatedDynamicRules: nonSkipDynamicRules(skipRulesResult.rules),
        configBaseline: compactConfigBaseline(configBaseline),
        findings: analysis.findings,
        critical: analysis.critical,
        warnings: [...skipRulesResult.warnings, ...analysis.warnings],
        permissionGaps: [...skipRulesResult.permissionGaps, ...extractPermissionGaps(configBaseline)],
        recommendation: analysis.recommendation,
        nextActions: analysis.nextActions,
    };
}

/**
 * @param {SkipRuleSummary[]} skipRules
 * @param {Record<string, unknown> & { ok: boolean }} configBaseline
 * @param {{ publicHostname: string }} context
 * @returns {{ critical: string[]; warnings: string[]; findings: Record<string, unknown>; recommendation: Record<string, unknown>; nextActions: string[] }}
 */
export function analyzeSkipPosture(skipRules, configBaseline, context) {
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];
    const actualSkipRules = onlySkipRules(skipRules);
    const relatedDynamicRules = nonSkipDynamicRules(skipRules);
    const dynamicSkipRules = actualSkipRules.filter((rule) => rule.enabled && rule.dynamicMcpScoped);
    const mcpSkipRules = actualSkipRules.filter((rule) => rule.enabled && rule.mcpEndpointScoped);
    const broadSkipRules = dynamicSkipRules.filter((rule) => rule.skipsAllProducts || rule.skipsRateLimit);
    const productSkipCoverage = new Set(dynamicSkipRules.flatMap((rule) => rule.products));
    const configFindings = asRecord(configBaseline['findings']);
    const configRulesCount = Number(configFindings['inspectedConfigRules'] ?? 0);
    const bicOffRules = Number(configFindings['bicOffRules'] ?? 0);
    const responseBufferingRules = Number(configFindings['responseBodyBufferingNoneRules'] ?? 0);
    const potentiallyInterfering = Number(configFindings['potentiallyInterferingSettings'] ?? 0);
    const needsExplicitOff = Number(configFindings['needsExplicitOffSettings'] ?? 0);
    const unknownSettings = Number(configFindings['unknownSettings'] ?? 0);

    if (broadSkipRules.length > 0) {
        critical.push('Detected an enabled MCP-scoped skip rule that skips all products or rate limiting; this may bypass intended protections.');
    }
    if (dynamicSkipRules.length === 0) {
        warnings.push('No MCP/OAuth-scoped skip rule exists for BIC/Security Level/WAF products.');
    }
    if (productSkipCoverage.has('rateLimit') || productSkipCoverage.has('http_ratelimit')) {
        critical.push('Detected a skip rule that may skip rate limiting for MCP routes; rate limits should not be broadly skipped.');
    }

    const skipNeeded = potentiallyInterfering > 0 && !productSkipCoverage.has('bic') ? 'maybe' : 'not-yet';
    const configRulePreferred = needsExplicitOff > 0 || responseBufferingRules === 0 || bicOffRules === 0;
    const rationale = [];
    if (potentiallyInterfering > 0) rationale.push('Browser Integrity Check or similarly interfering product appears enabled zone-wide.');
    if (needsExplicitOff > 0) rationale.push('Browser/site optimization products are enabled and should be explicitly disabled for MCP/OAuth routes.');
    if (configRulesCount === 0) rationale.push('No http_config_settings rules currently scope MCP/OAuth behavior.');
    if (configRulesCount > 0 && bicOffRules > 0 && responseBufferingRules > 0) rationale.push('A scoped http_config_settings passthrough rule already exists; prefer evidence-based skip only if Cloudflare still challenges MCP traffic.');
    if (responseBufferingRules === 0) rationale.push('No response_body_buffering=none rule currently protects /mcp streaming/SSE.');
    if (unknownSettings > 0) rationale.push('Some products could not be determined by the current API/token and remain audit gaps.');
    if (broadSkipRules.length > 0) rationale.push('Existing skip posture is too broad for MCP safety.');

    return {
        critical,
        warnings,
        findings: {
            targetHostname: context.publicHostname,
            inspectedSkipRules: actualSkipRules.length,
            relatedDynamicRules: relatedDynamicRules.length,
            dynamicMcpSkipRules: dynamicSkipRules.length,
            mcpEndpointSkipRules: mcpSkipRules.length,
            broadSkipRules: broadSkipRules.length,
            skippedProducts: Array.from(productSkipCoverage).sort((left, right) => left.localeCompare(right)),
            configRulesCount,
            bicOffRules,
            responseBodyBufferingNoneRules: responseBufferingRules,
            potentiallyInterferingSettings: potentiallyInterfering,
            needsExplicitOffSettings: needsExplicitOff,
            unknownSettings,
        },
        recommendation: {
            skipNeeded,
            configRulePreferred,
            preferredNextStep: configRulePreferred
                ? 'Keep the existing MCP passthrough configuration rule and avoid skip unless trace/security-event evidence proves a remaining challenge.'
                : 'No skip rule is recommended until a trace/security-event audit proves Cloudflare challenges MCP traffic.',
            productsThatMightNeedSkip: Array.from(
                new Set([...SKIPPABLE_PRODUCTS.filter((product) => product === 'bic' && potentiallyInterfering > 0)]),
            ),
            productsBetterHandledByConfigRule: NON_SKIPPABLE_OR_CONFIG_FIRST_PRODUCTS,
            rationale,
        },
        nextActions: [
            'Create mcp_cloudflare_mcp_passthrough_plan for scoped http_config_settings on MCP/OAuth routes.',
            'Do not skip http_ratelimit broadly.',
            'Use skip only for products that cannot be safely disabled via configuration rules or after trace/security-event evidence.',
        ],
    };
}

/**
 * @param {string} apiToken
 * @param {string} zoneId
 * @param {string} publicHostname
 * @param {{ cacheTtlMs?: number; forceRefresh?: boolean }} options
 * @returns {Promise<{ rules: SkipRuleSummary[]; warnings: string[]; permissionGaps: string[] }>}
 */
async function readSkipRules(apiToken, zoneId, publicHostname, options) {
    /** @type {SkipRuleSummary[]} */
    const rules = [];
    try {
        const snapshot = await readCloudflareRulesetSnapshot({
            apiToken,
            zoneId,
            forceRefresh: options.forceRefresh === true,
            ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
        });
        for (const ruleset of snapshot.rulesets) {
            const record = asRecord(ruleset);
            const phase = typeof record['phase'] === 'string' ? record['phase'] : '';
            if (!SKIP_AUDIT_PHASES.includes(phase)) continue;
            const rawRules = Array.isArray(record['rules']) ? record['rules'] : [];
            for (const rule of rawRules) {
                const simplified = simplifySkipRule(rule, phase, publicHostname);
                if (simplified.action === 'skip' || simplified.dynamicMcpScoped) rules.push(simplified);
            }
        }
        return {
            rules: rules.sort((left, right) => `${left.phase ?? ''}:${left.description ?? ''}`.localeCompare(`${right.phase ?? ''}:${right.description ?? ''}`)),
            warnings: [],
            permissionGaps: [],
        };
    } catch (error) {
        const message = sanitizeError(error);
        return {
            rules: [],
            warnings: [`Cloudflare skip rules audit failed: ${message}`],
            permissionGaps: ['The current Cloudflare token likely lacks Zone Rulesets:Read for skip-relevant phases.'],
        };
    }
}

/**
 * @param {unknown} rule
 * @param {string} phase
 * @param {string} publicHostname
 * @returns {SkipRuleSummary}
 */
function simplifySkipRule(rule, phase, publicHostname) {
    const record = asRecord(rule);
    const expression = typeof record['expression'] === 'string' ? record['expression'] : null;
    const actionParameters = asRecord(record['action_parameters']);
    const products = extractStringArray(actionParameters['products']);
    const phases = extractStringArray(actionParameters['phases']);
    return {
        id: typeof record['id'] === 'string' ? redactSecret(record['id']) : null,
        ref: typeof record['ref'] === 'string' ? record['ref'] : null,
        description: typeof record['description'] === 'string' ? record['description'] : null,
        phase,
        action: typeof record['action'] === 'string' ? record['action'] : null,
        expression,
        enabled: record['enabled'] !== false,
        products,
        phases,
        actionParameterKeys: Object.keys(actionParameters).sort((left, right) => left.localeCompare(right)),
        hostScoped: expressionMentionsHost(expression, publicHostname),
        dynamicMcpScoped: expressionMentionsHost(expression, publicHostname) && expressionMentionsAnyPath(expression, MCP_DYNAMIC_PATHS),
        mcpEndpointScoped: expressionMentionsHost(expression, publicHostname) && expressionMentionsAnyPath(expression, ['/mcp']),
        skipsRateLimit: products.includes('rateLimit') || products.includes('http_ratelimit') || phases.includes('http_ratelimit'),
        skipsAllProducts: products.length === 0 && phases.length === 0 && typeof record['action'] === 'string' && record['action'] === 'skip',
    };
}

/**
 * @param {SkipRuleSummary[]} rules
 * @returns {SkipRuleSummary[]}
 */
function onlySkipRules(rules) {
    return rules.filter((rule) => rule.action === 'skip');
}

/**
 * @param {SkipRuleSummary[]} rules
 * @returns {SkipRuleSummary[]}
 */
function nonSkipDynamicRules(rules) {
    return rules.filter((rule) => rule.action !== 'skip' && rule.dynamicMcpScoped);
}

/**
 * @param {Record<string, unknown> & { ok: boolean }} baseline
 * @returns {Record<string, unknown>}
 */
function compactConfigBaseline(baseline) {
    return {
        ok: baseline.ok,
        configAuditable: baseline['configAuditable'],
        endpoint: baseline['endpoint'],
        findings: baseline['findings'],
        critical: baseline['critical'],
        warnings: baseline['warnings'],
        permissionGaps: baseline['permissionGaps'],
    };
}

/**
 * @param {Record<string, unknown> & { ok: boolean }} baseline
 * @returns {string[]}
 */
function extractPermissionGaps(baseline) {
    const gaps = baseline['permissionGaps'];
    return Array.isArray(gaps) ? gaps.filter((gap) => typeof gap === 'string') : [];
}

/**
 * @param {string} publicHostname
 * @returns {Record<string, unknown>}
 */
function buildEmptyFindings(publicHostname) {
    return {
        targetHostname: publicHostname,
        inspectedSkipRules: 0,
        dynamicMcpSkipRules: 0,
        mcpEndpointSkipRules: 0,
        broadSkipRules: 0,
        skippedProducts: [],
        configRulesCount: 0,
        bicOffRules: 0,
        responseBodyBufferingNoneRules: 0,
        potentiallyInterferingSettings: 0,
        needsExplicitOffSettings: 0,
        unknownSettings: 0,
    };
}

/**
 * @param {import('cloudflare').default} client
 * @param {{ zoneId: string | undefined; accountId: string | undefined; zone: string }} config
 * @returns {Promise<{ zoneId: string | null; source: string | null; zoneName: string; zoneIdRedaction: string | null; warnings: string[] }>}
 */
async function resolveZoneId(client, config) {
    const configuredZoneId = String(config.zoneId ?? '').trim();
    if (configuredZoneId) {
        return { zoneId: configuredZoneId, source: 'configured:CLOUDFLARE_ZONE_ID', zoneName: config.zone, zoneIdRedaction: redactSecret(configuredZoneId), warnings: [] };
    }
    try {
        const query = typeof config.accountId === 'string' && config.accountId ? { name: config.zone, account: { id: config.accountId } } : { name: config.zone };
        for await (const zone of client.zones.list(query)) {
            const record = asRecord(zone);
            if (record['name'] === config.zone && typeof record['id'] === 'string') {
                return { zoneId: record['id'], source: 'cloudflare:zones.list', zoneName: config.zone, zoneIdRedaction: redactSecret(record['id']), warnings: [] };
            }
        }
        return { zoneId: null, source: null, zoneName: config.zone, zoneIdRedaction: null, warnings: [`Cloudflare zone ${config.zone} was not found by zones.list.`] };
    } catch (error) {
        return { zoneId: null, source: null, zoneName: config.zone, zoneIdRedaction: null, warnings: [`Could not resolve Cloudflare zone ID: ${sanitizeError(error)}`] };
    }
}

/** @param {number | undefined} value */
function readSkipAuditCacheTtlMs(value) {
    if (value === undefined) return DEFAULT_SKIP_AUDIT_CACHE_TTL_MS;
    return Number.isFinite(value) && value >= 0 && value <= 300_000
        ? Math.floor(value)
        : DEFAULT_SKIP_AUDIT_CACHE_TTL_MS;
}

/** @param {SkipAuditConfig} config */
function buildSkipAuditCacheKey(config) {
    return JSON.stringify({
        accountId: config.accountId ?? null,
        zoneId: config.zoneId ?? null,
        zone: config.zone,
        publicHostname: config.publicHostname,
        expectedPublicMcpUrl: config.expectedPublicMcpUrl,
    });
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function extractStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

/**
 * @param {string | null} expression
 * @param {string} hostname
 * @returns {boolean}
 */
function expressionMentionsHost(expression, hostname) {
    return String(expression ?? '').toLowerCase().includes(hostname.toLowerCase());
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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {{ apiToken?: string | undefined; accountId?: string | undefined; zoneId?: string | undefined; credentialSources: string[] }} config
 * @returns {Record<string, unknown>}
 */
function summarizeCredentials(config) {
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
