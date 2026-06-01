// @ts-check
/**
 * Read-only Cloudflare configuration/product posture audit for the Copilot MCP hostname.
 *
 * This audit complements edge-audit.js. It focuses on Cloudflare products and configuration settings that are
 * harmless for ordinary websites but can interfere with remote MCP clients, OAuth discovery, JSON-RPC, SSE and
 * non-browser traffic.
 *
 * @module copilot/mcp/cloudflare/config-audit
 */

import Cloudflare from 'cloudflare';
import { readCloudflareRemoteApiConfig } from './remote-api.js';

const CONFIG_PHASE = 'http_config_settings';
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const DYNAMIC_MCP_PATHS = ['/mcp', '/oauth/', '/.well-known/', '/health'];

const ZONE_SETTINGS = [
    {
        id: 'browser_check',
        label: 'Browser Integrity Check',
        desired: 'off',
        mcpImpact: 'Can challenge non-browser MCP clients or clients with unusual headers/user agents.',
        severityWhenEnabled: 'warning',
    },
    {
        id: 'security_level',
        label: 'Security Level / Under Attack Mode',
        desired: 'essentially_off or a host-specific bypass for MCP routes',
        mcpImpact: 'High or under_attack security levels can introduce challenges that MCP clients cannot solve.',
        severityWhenEnabled: 'warning',
    },
    {
        id: 'bot_fight_mode',
        label: 'Bot Fight Mode',
        desired: 'off for MCP routes or not enabled zone-wide',
        mcpImpact: 'Classic Bot Fight Mode cannot be skipped by WAF skip rules and can interfere with API clients.',
        severityWhenEnabled: 'warning',
    },
    {
        id: 'rocket_loader',
        label: 'Rocket Loader',
        desired: 'off for MCP routes',
        mcpImpact: 'Browser optimization feature; should not affect JSON/SSE but is not useful for MCP.',
        severityWhenEnabled: 'advisory',
    },
    {
        id: 'zaraz',
        label: 'Zaraz',
        desired: 'off for MCP routes',
        mcpImpact: 'Browser/site script injection is irrelevant and potentially undesirable for API endpoints.',
        severityWhenEnabled: 'advisory',
    },
    {
        id: 'rum',
        label: 'Browser RUM',
        desired: 'off for MCP routes',
        mcpImpact: 'Browser telemetry is irrelevant for MCP API endpoints.',
        severityWhenEnabled: 'advisory',
    },
    {
        id: 'email_obfuscation',
        label: 'Email Obfuscation',
        desired: 'off for MCP routes',
        mcpImpact: 'HTML transform feature; not useful for API endpoints.',
        severityWhenEnabled: 'advisory',
    },
    {
        id: 'polish',
        label: 'Polish/Image Optimization',
        desired: 'off or irrelevant for MCP routes',
        mcpImpact: 'Image optimization is irrelevant for MCP API endpoints.',
        severityWhenEnabled: 'advisory',
    },
    {
        id: 'hotlink_protection',
        label: 'Hotlink Protection',
        desired: 'not applicable to MCP routes',
        mcpImpact: 'Usually static-asset oriented; should not be relied on for MCP security.',
        severityWhenEnabled: 'advisory',
    },
];

/**
 * @typedef {object} ConfigAuditConfig
 * @property {string | undefined} apiToken
 * @property {string | undefined} accountId
 * @property {string | undefined} zoneId
 * @property {string} zone
 * @property {string} publicHostname
 * @property {string} expectedPublicMcpUrl
 * @property {string[]} credentialSources
 */

/**
 * @typedef {object} ZoneSettingSummary
 * @property {string} id
 * @property {string} label
 * @property {string | boolean | number | null} value
 * @property {string | null} editable
 * @property {string} status
 * @property {string} desired
 * @property {string} mcpImpact
 * @property {string | null} error
 */

/**
 * @typedef {object} ConfigRuleSummary
 * @property {string | null} id
 * @property {string | null} ref
 * @property {string | null} description
 * @property {string | null} expression
 * @property {boolean} enabled
 * @property {string | null} action
 * @property {Record<string, unknown>} actionParameters
 * @property {string[]} actionParameterKeys
 * @property {boolean} dynamicMcpScoped
 * @property {boolean} mcpEndpointScoped
 */

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function auditCloudflareConfigPosture(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
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
            mode: 'read-only-config-audit',
            configAuditable: false,
            credentials: summarizeCredentials(auditConfig),
            desired: buildDesiredConfigPosture(auditConfig),
            critical: [`Missing required Cloudflare API credential(s): ${missingCredentials.join(', ')}.`],
            warnings: [],
            permissionGaps: ['Cloudflare config audit requires an API token and account ID.'],
            nextActions: [
                'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env.local or the process environment.',
                'Use a read-only token first; keep mutation tokens separate.',
            ],
        };
    }

    const client = new Cloudflare({ apiToken: auditConfig.apiToken ?? '', maxRetries: 1, timeout: 15000 });
    const zoneResolution = await resolveZoneId(client, auditConfig);
    if (!zoneResolution.zoneId) {
        return {
            ok: true,
            success: true,
            mode: 'read-only-config-audit',
            configAuditable: false,
            credentials: summarizeCredentials(auditConfig),
            desired: buildDesiredConfigPosture(auditConfig),
            zone: zoneResolution,
            zoneSettings: [],
            configRulesets: [],
            findings: buildEmptyFindings(auditConfig.publicHostname),
            critical: [],
            warnings: zoneResolution.warnings,
            permissionGaps: [
                'The current Cloudflare token cannot resolve the zone ID or CLOUDFLARE_ZONE_ID is not configured.',
                'Grant Zone:Read and Zone Settings:Read, or set CLOUDFLARE_ZONE_ID.',
            ],
            nextActions: [
                'Create a read-only Cloudflare audit token with Zone:Read, Zone Settings:Read and Zone Rulesets:Read.',
                'Re-run mcp_cloudflare_config_audit after the permission change.',
            ],
        };
    }

    const [zoneSettingsResult, configRulesetsResult] = await Promise.all([
        readZoneSettings(auditConfig.apiToken ?? '', zoneResolution.zoneId),
        readConfigRulesets(client, zoneResolution.zoneId, auditConfig.publicHostname),
    ]);

    const analysis = analyzeConfigPosture(zoneSettingsResult.settings, configRulesetsResult.rulesets, {
        publicHostname: auditConfig.publicHostname,
    });
    const permissionGaps = [...zoneSettingsResult.permissionGaps, ...configRulesetsResult.permissionGaps];
    const warnings = [...zoneSettingsResult.warnings, ...configRulesetsResult.warnings, ...analysis.warnings];

    return {
        ok: analysis.critical.length === 0,
        success: true,
        mode: 'read-only-config-audit',
        configAuditable: true,
        credentials: summarizeCredentials(auditConfig),
        endpoint: {
            publicHostname: auditConfig.publicHostname,
            publicMcpUrl: auditConfig.expectedPublicMcpUrl,
            zone: auditConfig.zone,
        },
        desired: buildDesiredConfigPosture(auditConfig),
        zone: zoneResolution,
        zoneSettings: zoneSettingsResult.settings,
        configRulesets: configRulesetsResult.rulesets,
        findings: analysis.findings,
        critical: analysis.critical,
        warnings,
        permissionGaps,
        nextActions:
            analysis.critical.length === 0
                ? [
                      'Use this audit before planning MCP passthrough/configuration rules.',
                      'If Browser Integrity Check or Security Level are enabled zone-wide, prefer a scoped configuration/skip plan for MCP routes.',
                      'Do not apply rate limits until config/product posture is understood.',
                  ]
                : [
                      'Fix critical config/product interference before relying on long MCP sessions.',
                      'Prefer scoped MCP passthrough rules over global zone changes.',
                  ],
    };
}

/**
 * @param {ZoneSettingSummary[]} zoneSettings
 * @param {ConfigRuleSummary[]} configRules
 * @param {{ publicHostname: string }} context
 * @returns {{ critical: string[]; warnings: string[]; findings: Record<string, unknown> }}
 */
export function analyzeConfigPosture(zoneSettings, configRules, context) {
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];
    const potentiallyInterferingSettings = zoneSettings.filter((setting) => setting.status === 'potentially-interfering');
    const needsExplicitOffSettings = zoneSettings.filter((setting) => setting.status === 'needs-explicit-off');
    const unknownSettings = zoneSettings.filter((setting) => setting.status === 'unknown');
    const dynamicConfigRules = configRules.filter((rule) => rule.dynamicMcpScoped);
    const mcpConfigRules = configRules.filter((rule) => rule.mcpEndpointScoped);

    const responseBufferingRules = mcpConfigRules.filter(
        (rule) => normalizeActionParameterValue(rule.actionParameters['response_body_buffering']) === 'none',
    );
    const requestBufferingNoneRules = mcpConfigRules.filter(
        (rule) => normalizeActionParameterValue(rule.actionParameters['request_body_buffering']) === 'none',
    );
    const bicOffRules = dynamicConfigRules.filter((rule) => normalizeActionParameterValue(rule.actionParameters['bic']) === 'false');

    for (const setting of potentiallyInterferingSettings) {
        warnings.push(`${setting.label} appears enabled or strict zone-wide; confirm MCP routes are explicitly exempt.`);
    }
    for (const setting of needsExplicitOffSettings) {
        warnings.push(`${setting.label} should be explicitly disabled or bypassed for MCP routes.`);
    }
    if (unknownSettings.length > 0) {
        warnings.push(`Could not determine ${unknownSettings.length} Cloudflare product/setting value(s); treat as audit gaps.`);
    }
    if (responseBufferingRules.length === 0) {
        warnings.push('No explicit response_body_buffering=none configuration rule was detected for /mcp streaming/SSE.');
    }
    if (requestBufferingNoneRules.length > 0) {
        warnings.push('Detected request_body_buffering=none for /mcp; this may reduce WAF request inspection and should be justified.');
    }
    if (bicOffRules.length === 0 && zoneSettings.some((setting) => setting.id === 'browser_check' && setting.status !== 'safe')) {
        warnings.push('Browser Integrity Check is not explicitly disabled for dynamic MCP/OAuth routes.');
    }

    return {
        critical,
        warnings,
        findings: {
            targetHostname: context.publicHostname,
            inspectedZoneSettings: zoneSettings.length,
            inspectedConfigRules: configRules.length,
            dynamicMcpConfigRules: dynamicConfigRules.length,
            mcpEndpointConfigRules: mcpConfigRules.length,
            potentiallyInterferingSettings: potentiallyInterferingSettings.length,
            needsExplicitOffSettings: needsExplicitOffSettings.length,
            unknownSettings: unknownSettings.length,
            responseBodyBufferingNoneRules: responseBufferingRules.length,
            requestBodyBufferingNoneRules: requestBufferingNoneRules.length,
            bicOffRules: bicOffRules.length,
        },
    };
}

/**
 * @param {string} apiToken
 * @param {string} zoneId
 * @returns {Promise<{ settings: ZoneSettingSummary[]; warnings: string[]; permissionGaps: string[] }>}
 */
async function readZoneSettings(apiToken, zoneId) {
    const settings = [];
    const warnings = [];
    const permissionGaps = [];
    for (const setting of ZONE_SETTINGS) {
        const result = await readZoneSetting(apiToken, zoneId, setting);
        settings.push(result.summary);
        if (result.permissionGap) permissionGaps.push(result.permissionGap);
        if (result.warning) warnings.push(result.warning);
    }
    return { settings, warnings, permissionGaps };
}

/**
 * @param {string} apiToken
 * @param {string} zoneId
 * @param {typeof ZONE_SETTINGS[number]} setting
 * @returns {Promise<{ summary: ZoneSettingSummary; warning: string | null; permissionGap: string | null }>}
 */
async function readZoneSetting(apiToken, zoneId, setting) {
    try {
        const response = await fetch(`${CLOUDFLARE_API_BASE}/zones/${zoneId}/settings/${setting.id}`, {
            headers: { authorization: `Bearer ${apiToken}`, accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        const body = await response.json().catch(() => null);
        const result = asRecord(asRecord(body)['result']);
        const value = normalizeSettingValue(result['value']);
        const editable = typeof result['editable'] === 'boolean' ? String(result['editable']) : null;
        if (!response.ok || asRecord(body)['success'] === false) {
            const message = firstCloudflareErrorMessage(body) ?? `HTTP ${response.status}`;
            return {
                summary: buildUnknownSetting(setting, message),
                warning: `Could not read Cloudflare setting ${setting.id}: ${message}`,
                permissionGap: `Zone setting ${setting.id} could not be read: ${message}`,
            };
        }
        return {
            summary: {
                id: setting.id,
                label: setting.label,
                value,
                editable,
                status: classifyZoneSetting(setting.id, value),
                desired: setting.desired,
                mcpImpact: setting.mcpImpact,
                error: null,
            },
            warning: null,
            permissionGap: null,
        };
    } catch (error) {
        const message = sanitizeError(error);
        return {
            summary: buildUnknownSetting(setting, message),
            warning: `Could not read Cloudflare setting ${setting.id}: ${message}`,
            permissionGap: `Zone setting ${setting.id} could not be read: ${message}`,
        };
    }
}

/**
 * @param {Cloudflare} client
 * @param {string} zoneId
 * @param {string} publicHostname
 * @returns {Promise<{ rulesets: ConfigRuleSummary[]; warnings: string[]; permissionGaps: string[] }>}
 */
async function readConfigRulesets(client, zoneId, publicHostname) {
    const rules = [];
    try {
        for await (const ruleset of client.rulesets.list({ zone_id: zoneId })) {
            const summary = asRecord(ruleset);
            if (summary['phase'] !== CONFIG_PHASE) continue;
            const id = typeof summary['id'] === 'string' ? summary['id'] : '';
            const detailed = id ? await client.rulesets.get(id, { zone_id: zoneId }) : summary;
            const record = asRecord(detailed);
            const rawRules = Array.isArray(record['rules']) ? record['rules'] : [];
            for (const rule of rawRules) rules.push(simplifyConfigRule(rule, publicHostname));
        }
        return { rulesets: rules.sort((left, right) => String(left.description ?? '').localeCompare(String(right.description ?? ''))), warnings: [], permissionGaps: [] };
    } catch (error) {
        const message = sanitizeError(error);
        return {
            rulesets: [],
            warnings: [`Cloudflare config rulesets audit failed: ${message}`],
            permissionGaps: ['The current Cloudflare token likely lacks Zone Rulesets:Read for http_config_settings.'],
        };
    }
}

/**
 * @param {unknown} rule
 * @param {string} publicHostname
 * @returns {ConfigRuleSummary}
 */
function simplifyConfigRule(rule, publicHostname) {
    const record = asRecord(rule);
    const expression = typeof record['expression'] === 'string' ? record['expression'] : null;
    const actionParameters = asRecord(record['action_parameters']);
    return {
        id: typeof record['id'] === 'string' ? redactSecret(record['id']) : null,
        ref: typeof record['ref'] === 'string' ? record['ref'] : null,
        description: typeof record['description'] === 'string' ? record['description'] : null,
        expression,
        enabled: record['enabled'] !== false,
        action: typeof record['action'] === 'string' ? record['action'] : null,
        actionParameters: sanitizeActionParameters(actionParameters),
        actionParameterKeys: Object.keys(actionParameters).sort((left, right) => left.localeCompare(right)),
        dynamicMcpScoped: expressionMentionsHost(expression, publicHostname) && expressionMentionsAnyPath(expression, DYNAMIC_MCP_PATHS),
        mcpEndpointScoped: expressionMentionsHost(expression, publicHostname) && expressionMentionsAnyPath(expression, ['/mcp']),
    };
}

/**
 * @param {Cloudflare} client
 * @param {ConfigAuditConfig} config
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
        const query = typeof config.accountId === 'string' && config.accountId ? { name: config.zone, account: { id: config.accountId } } : { name: config.zone };
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
        return { zoneId: null, source: null, zoneName: config.zone, zoneIdRedaction: null, warnings: [`Cloudflare zone ${config.zone} was not found by zones.list.`] };
    } catch (error) {
        return { zoneId: null, source: null, zoneName: config.zone, zoneIdRedaction: null, warnings: [`Could not resolve Cloudflare zone ID: ${sanitizeError(error)}`] };
    }
}

/**
 * @param {typeof ZONE_SETTINGS[number]} setting
 * @param {string} error
 * @returns {ZoneSettingSummary}
 */
function buildUnknownSetting(setting, error) {
    return {
        id: setting.id,
        label: setting.label,
        value: null,
        editable: null,
        status: 'unknown',
        desired: setting.desired,
        mcpImpact: setting.mcpImpact,
        error,
    };
}

/**
 * @param {string} id
 * @param {string | boolean | number | null} value
 * @returns {string}
 */
function classifyZoneSetting(id, value) {
    const normalized = normalizeActionParameterValue(value);
    if (value === null || normalized === 'unknown') return 'unknown';
    if (['off', 'false', '0', 'essentially_off'].includes(normalized)) return 'safe';
    if (id === 'security_level' && ['low', 'medium'].includes(normalized)) return 'advisory';
    if (id === 'polish' || id === 'hotlink_protection' || id === 'email_obfuscation' || id === 'rocket_loader' || id === 'zaraz' || id === 'rum') {
        return 'needs-explicit-off';
    }
    return 'potentially-interfering';
}

/**
 * @param {unknown} value
 * @returns {string | boolean | number | null}
 */
function normalizeSettingValue(value) {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
    return value == null ? null : String(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeActionParameterValue(value) {
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value.trim().toLowerCase();
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} actionParameters
 * @returns {Record<string, unknown>}
 */
function sanitizeActionParameters(actionParameters) {
    return Object.fromEntries(
        Object.entries(actionParameters)
            .filter(([key]) => !/token|secret|key|password/iu.test(key))
            .map(([key, value]) => [key, sanitizeValue(value)]),
    );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, item]) => [key, sanitizeValue(item)]));
    }
    return value;
}

/**
 * @param {unknown} body
 * @returns {string | null}
 */
function firstCloudflareErrorMessage(body) {
    const errors = asRecord(body)['errors'];
    if (!Array.isArray(errors)) return null;
    const first = errors.map(asRecord).find((error) => typeof error['message'] === 'string');
    return typeof first?.['message'] === 'string' ? first['message'] : null;
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
 * @param {ConfigAuditConfig} config
 * @returns {Record<string, unknown>}
 */
function buildDesiredConfigPosture(config) {
    return {
        publicHostname: config.publicHostname,
        publicMcpUrl: config.expectedPublicMcpUrl,
        zone: config.zone,
        apiProfile: 'MCP remote API passthrough, not website/browser optimization',
        dynamicRoutes: DYNAMIC_MCP_PATHS,
        desired: {
            browserIntegrityCheck: 'off or explicitly bypassed for MCP/OAuth routes',
            securityLevel: 'no Under Attack / interactive challenge behavior on MCP/OAuth routes',
            responseBodyBuffering: 'none for /mcp when supported, to preserve streamable HTTP/SSE',
            requestBodyBuffering: 'standard initially, not none unless justified',
            siteFeatures: 'Rocket Loader, Zaraz, RUM, Email Obfuscation, Polish and similar browser features off/irrelevant for MCP routes',
        },
    };
}

/**
 * @param {string} publicHostname
 * @returns {Record<string, unknown>}
 */
function buildEmptyFindings(publicHostname) {
    return {
        targetHostname: publicHostname,
        inspectedZoneSettings: 0,
        inspectedConfigRules: 0,
        dynamicMcpConfigRules: 0,
        mcpEndpointConfigRules: 0,
        potentiallyInterferingSettings: 0,
        needsExplicitOffSettings: 0,
        unknownSettings: 0,
        responseBodyBufferingNoneRules: 0,
        requestBodyBufferingNoneRules: 0,
        bicOffRules: 0,
    };
}

/**
 * @param {ConfigAuditConfig} config
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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
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
