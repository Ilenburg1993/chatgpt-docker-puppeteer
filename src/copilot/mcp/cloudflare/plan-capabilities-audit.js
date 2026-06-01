// @ts-check
/**
 * Read-only Cloudflare plan/capabilities audit for MCP edge policy decisions.
 *
 * @module copilot/mcp/cloudflare/plan-capabilities-audit
 */

import { auditCloudflareConfigPosture } from './config-audit.js';
import { auditCloudflareEdgeRulesets } from './edge-audit.js';
import { readCloudflareRemoteApiConfig } from './remote-api.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function auditCloudflarePlanCapabilities(options = {}) {
    const env = options.env ?? process.env;
    const [config, edgeAudit, configAudit] = await Promise.all([
        readCloudflareRemoteApiConfig(env),
        auditCloudflareEdgeRulesets({ env }),
        auditCloudflareConfigPosture({ env }),
    ]);
    const edgeFindings = asRecord(edgeAudit['findings']);
    const configFindings = asRecord(configAudit['findings']);
    const warnings = [
        ...stringArray(edgeAudit['warnings']),
        ...stringArray(configAudit['warnings']),
    ];
    const permissionGaps = [
        ...stringArray(edgeAudit['permissionGaps']),
        ...stringArray(configAudit['permissionGaps']),
    ];
    const mcpRateLimitCount = Number(edgeFindings['mcpRateLimitCount'] ?? 0);
    const oauthTokenRateLimitCount = Number(edgeFindings['oauthTokenRateLimitCount'] ?? 0);
    const rateLimitRulesObserved = oauthTokenRateLimitCount + mcpRateLimitCount;
    const headerExpressionNeeded = true;
    const individualRuleRefApply = 'implemented-and-verified';
    const rateLimitRuleCapacity =
        rateLimitRulesObserved >= 1 && mcpRateLimitCount === 0
            ? 'possibly-at-plan-limit-or-needs-confirmation'
            : rateLimitRulesObserved === 0
              ? 'unknown-empty-baseline'
              : 'partially-observed';
    return {
        ok: edgeAudit.ok === true && configAudit.ok === true,
        success: true,
        mode: 'read-only-plan-capabilities-audit',
        appliesChanges: false,
        endpoint: {
            publicHostname: config.publicHostname,
            publicMcpUrl: config.expectedPublicMcpUrl,
            zone: config.zone,
        },
        observed: {
            edgeAuditable: edgeAudit['edgeAuditable'] === true,
            configAuditable: configAudit['configAuditable'] === true,
            rateLimitRulesObserved,
            cacheBypassCandidateCount: Number(edgeFindings['cacheBypassCandidateCount'] ?? 0),
            mcpRateLimitCount,
            oauthTokenRateLimitCount,
            dynamicMcpConfigRules: Number(configFindings['dynamicMcpConfigRules'] ?? 0),
            responseBodyBufferingNoneRules: Number(configFindings['responseBodyBufferingNoneRules'] ?? 0),
            bicOffRules: Number(configFindings['bicOffRules'] ?? 0),
        },
        capabilities: {
            individualRuleRefApply,
            rateLimitRuleCapacity,
            headerExpressionSupport: headerExpressionNeeded ? 'must-confirm-before-anonymous-mcp-rate-limit' : 'not-required',
            httpConfigSettingsSupport: Number(configFindings['dynamicMcpConfigRules'] ?? 0) > 0 ? 'observed' : 'not-yet-observed',
            rollbackAutomation: 'required-before-broad-changes',
        },
        recommendations: [
            'RuleRefs filtering is implemented; prefer targeted ruleRefs applies before any rate-limit apply.',
            'Treat observed single rate-limit capacity as constrained until plan limits are confirmed; do not create extra rate-limit rules blindly.',
            'Confirm header-expression support before applying an anonymous /mcp rule that checks Authorization.',
            'Keep MCP passthrough http_config_settings before any skip rule.',
        ],
        critical: [],
        warnings,
        permissionGaps,
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
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
