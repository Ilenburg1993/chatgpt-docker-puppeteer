// @ts-check
/**
 * Plan-only diff between actual Cloudflare edge audit and desired MCP edge policy.
 *
 * @module copilot/mcp/cloudflare/edge-policy-diff
 */

import { auditCloudflareEdgeRulesets } from './edge-audit.js';
import { buildCloudflareEdgePolicyPlan } from './edge-policy-plan.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function diffCloudflareEdgePolicy(options = {}) {
    const [actual, desired] = await Promise.all([
        auditCloudflareEdgeRulesets(options),
        buildCloudflareEdgePolicyPlan(options),
    ]);
    return buildEdgePolicyDiff(actual, desired);
}

/**
 * @param {Record<string, unknown> & { ok?: boolean }} actual
 * @param {Record<string, unknown> & { ok?: boolean }} desired
 * @returns {Record<string, unknown> & { ok: boolean }}
 */
export function buildEdgePolicyDiff(actual, desired) {
    const findings = asRecord(actual['findings']);
    const critical = normalizeStringArray(actual['critical']);
    const permissionGaps = normalizeStringArray(actual['permissionGaps']);
    const warnings = normalizeStringArray(actual['warnings']);
    const diffs = [];

    if (actual['edgeAuditable'] !== true) {
        diffs.push({
            id: 'edge-not-auditable',
            severity: 'warning',
            status: 'unknown',
            phase: null,
            summary: 'Cloudflare edge rulesets are not currently auditable.',
            desired: 'Read-only visibility over zone rulesets.',
            actual: permissionGaps.length > 0 ? permissionGaps : warnings,
            recommendedAction: 'Fix token permissions before changing Cloudflare edge policy.',
        });
    }

    if (numberValue(findings['cacheBypassCandidateCount']) === 0) {
        diffs.push({
            id: 'cache-bypass-missing',
            severity: 'warning',
            status: 'missing',
            phase: 'http_request_cache_settings',
            summary: 'No explicit cache bypass rule was detected for MCP/OAuth dynamic routes.',
            desired: findDesiredRule(desired, 'MCP dynamic routes cache bypass'),
            actual: 'No matching cache=false rule found in actual edge audit.',
            recommendedAction: 'Create cache bypass first, then run edge audit and connector smoke.',
        });
    }

    if (numberValue(findings['oauthTokenRateLimitCount']) === 0) {
        diffs.push({
            id: 'oauth-token-rate-limit-missing',
            severity: 'advisory',
            status: 'missing',
            phase: 'http_ratelimit',
            summary: 'No explicit /oauth/token rate limit was detected.',
            desired: findDesiredRule(desired, 'MCP OAuth token endpoint protection'),
            actual: 'No matching /oauth/token rate-limit rule found in actual edge audit.',
            recommendedAction: 'Add moderate /oauth/token protection after cache bypass is confirmed.',
        });
    }

    if (numberValue(findings['mcpRateLimitCount']) === 0) {
        diffs.push({
            id: 'anonymous-mcp-rate-limit-missing',
            severity: 'advisory',
            status: 'missing',
            phase: 'http_ratelimit',
            summary: 'No explicit anonymous /mcp rate limit was detected.',
            desired: findDesiredRule(desired, 'MCP anonymous request protection'),
            actual: 'No matching anonymous /mcp rate-limit rule found in actual edge audit.',
            recommendedAction:
                'Only bound anonymous /mcp traffic; avoid throttling authenticated ChatGPT/Claude MCP sessions.',
        });
    }

    if (numberValue(findings['blockingMcpRuleCount']) > 0 || numberValue(findings['hostWideChallengeRuleCount']) > 0) {
        diffs.push({
            id: 'mcp-interactive-or-blocking-rule-present',
            severity: 'critical',
            status: 'conflict',
            phase: 'http_request_firewall_custom',
            summary: 'A WAF/block/challenge rule may interfere with MCP clients.',
            desired: 'No managed_challenge, js_challenge, challenge or broad block on /mcp.',
            actual: {
                blockingMcpRuleCount: numberValue(findings['blockingMcpRuleCount']),
                hostWideChallengeRuleCount: numberValue(findings['hostWideChallengeRuleCount']),
            },
            recommendedAction: 'Remove or narrow the rule before relying on long MCP sessions.',
        });
    }

    if (numberValue(findings['sensitiveHeaderTransformCount']) > 0) {
        diffs.push({
            id: 'sensitive-header-transform-present',
            severity: 'critical',
            status: 'conflict',
            phase: 'http_request_transform/http_response_headers_transform',
            summary: 'A transform rule mentions sensitive MCP/OAuth headers.',
            desired: 'Do not rewrite Authorization, WWW-Authenticate, Set-Cookie, Location, Content-Type, Cache-Control or CORS headers.',
            actual: {
                sensitiveHeaderTransformCount: numberValue(findings['sensitiveHeaderTransformCount']),
            },
            recommendedAction: 'Remove sensitive header transforms for MCP dynamic routes.',
        });
    }

    const criticalDiffs = diffs.filter((diff) => asRecord(diff)['severity'] === 'critical');
    const mutationReady = actual['edgeAuditable'] === true && critical.length === 0 && criticalDiffs.length === 0;
    return {
        ok: criticalDiffs.length === 0 && critical.length === 0,
        success: true,
        mode: 'plan-only-diff',
        appliesChanges: false,
        mutationReady,
        endpoint: desired['endpoint'] ?? actual['desired'] ?? null,
        summary: {
            actualOk: actual.ok === true,
            desiredOk: desired.ok === true,
            diffCount: diffs.length,
            criticalDiffs: criticalDiffs.length,
            permissionGaps: permissionGaps.length,
            warnings: warnings.length,
        },
        diffs,
        actual: {
            edgeAuditable: actual['edgeAuditable'] ?? null,
            findings,
            critical,
            warnings,
            permissionGaps,
        },
        desired: {
            desiredRulesets: desired['desiredRulesets'] ?? [],
            nonInterferenceRules: desired['nonInterferenceRules'] ?? [],
        },
        recommendedSequence: [
            'Treat this output as advisory until backup/diff/rollback mutation tooling exists.',
            'Apply cache bypass before rate-limit rules.',
            'After every Cloudflare dashboard/API change, run remote-audit, edge-audit, edge-policy-diff and smoke-refresh.',
            'Do not add interactive Cloudflare challenges to /mcp.',
        ],
    };
}

/**
 * @param {Record<string, unknown>} desired
 * @param {string} name
 * @returns {unknown}
 */
function findDesiredRule(desired, name) {
    const desiredRulesets = Array.isArray(desired['desiredRulesets']) ? desired['desiredRulesets'] : [];
    return desiredRulesets.find((ruleset) => asRecord(ruleset)['name'] === name) ?? null;
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
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
