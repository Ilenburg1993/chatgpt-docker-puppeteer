// @ts-check
/**
 * Guarded Cloudflare edge policy applier for MCP operations.
 *
 * @module copilot/mcp/cloudflare/edge-policy-apply
 */

import Cloudflare from 'cloudflare';
import { createCloudflareEdgeBackup } from './edge-backup.js';
import { auditCloudflareEdgeRulesets } from './edge-audit.js';
import { diffCloudflareEdgePolicy } from './edge-policy-diff.js';
import { readCloudflareRemoteApiConfig } from './remote-api.js';

const CACHE_PHASE = 'http_request_cache_settings';
const RATE_LIMIT_PHASE = 'http_ratelimit';

/**
 * @param {{ env?: NodeJS.ProcessEnv; dryRun?: boolean; confirmApply?: boolean; phases?: string[]; now?: Date }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function applyCloudflareEdgePolicy(options = {}) {
    const dryRun = options.dryRun !== false;
    const confirmApply = options.confirmApply === true;
    const phases = normalizePhases(options.phases);
    const env = options.env ?? process.env;
    const backup = await createCloudflareEdgeBackup({
        env,
        ...(options.now ? { now: options.now } : {}),
        label: dryRun ? 'preflight' : 'pre-apply',
    });
    const actual = await auditCloudflareEdgeRulesets({ env });
    const diff = await diffCloudflareEdgePolicy({ env });
    const desiredRules = buildCloudflareEdgeDesiredApiRules(asString(asRecord(diff['endpoint'])['publicHostname']));
    const plan = buildCloudflareEdgeApplyPlan(asRulesets(actual['rulesets']), desiredRules, { phases });
    const preflightOk = backup.ok === true && actual.ok === true && diff.ok === true && diff['mutationReady'] === true;
    const canApply = preflightOk && confirmApply && !dryRun;

    if (dryRun || !confirmApply) {
        return {
            ok: preflightOk,
            success: true,
            mode: 'guarded-edge-policy-apply',
            appliesChanges: false,
            dryRun: true,
            confirmApply,
            backup,
            preflight: summarizePreflight(actual, diff),
            plan,
            blockedReason: preflightOk
                ? 'Set dryRun=false and confirmApply=true to apply this exact plan.'
                : 'Preflight is not clean; do not apply Cloudflare edge policy.',
        };
    }

    if (!canApply) {
        return {
            ok: false,
            success: true,
            mode: 'guarded-edge-policy-apply',
            appliesChanges: false,
            dryRun,
            confirmApply,
            backup,
            preflight: summarizePreflight(actual, diff),
            plan,
            blockedReason: 'Cloudflare edge policy apply requires clean preflight, dryRun=false and confirmApply=true.',
        };
    }

    const config = await readCloudflareRemoteApiConfig(env);
    if (!config.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to apply Cloudflare edge policy.');
    const client = new Cloudflare({ apiToken: config.apiToken, maxRetries: 1, timeout: 15000 });
    const zoneId = await resolveZoneId(client, config);
    const applied = [];
    for (const action of plan.actions) {
        const record = asRecord(action);
        const phase = asString(record['phase']);
        if (!phase) continue;
        const rule = desiredRules.find((item) => item.phase === phase && item.ref === record['ref']);
        if (!rule || record['status'] === 'present') {
            applied.push({ ...record, applied: false, reason: record['status'] === 'present' ? 'already-present' : 'no-rule' });
            continue;
        }
        const result = await applyDesiredRule(client, zoneId, rule);
        applied.push({ ...record, applied: true, result });
    }

    return {
        ok: true,
        success: true,
        mode: 'guarded-edge-policy-apply',
        appliesChanges: true,
        dryRun: false,
        confirmApply,
        backup,
        preflight: summarizePreflight(actual, diff),
        plan,
        applied,
        nextActions: [
            'Run make copilot-mcp-edge-audit.',
            'Run make copilot-mcp-edge-policy-diff.',
            'Run make copilot-mcp-smoke-refresh.',
        ],
    };
}

/**
 * @param {string} hostname
 * @returns {{ phase: string; name: string; ref: string; rule: Record<string, unknown> }[]}
 */
export function buildCloudflareEdgeDesiredApiRules(hostname) {
    const safeHostname = hostname || 'mcp.aurelin.org';
    const hostExpression = `http.host eq "${safeHostname}"`;
    const mcpPathExpression = 'starts_with(http.request.uri.path, "/mcp")';
    const dynamicExpression = `(${hostExpression} and (${mcpPathExpression} or starts_with(http.request.uri.path, "/oauth/") or starts_with(http.request.uri.path, "/.well-known/") or http.request.uri.path eq "/health"))`;
    return [
        {
            phase: CACHE_PHASE,
            name: 'MCP dynamic routes cache bypass',
            ref: 'copilot-mcp-cache-bypass-v1',
            rule: {
                ref: 'copilot-mcp-cache-bypass-v1',
                description: 'Bypass cache for MCP/OAuth dynamic routes',
                expression: dynamicExpression,
                action: 'set_cache_settings',
                action_parameters: { cache: false },
                enabled: true,
            },
        },
        {
            phase: RATE_LIMIT_PHASE,
            name: 'MCP OAuth token endpoint protection',
            ref: 'copilot-mcp-oauth-token-rate-limit-v1',
            rule: {
                ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                description: 'Moderate /oauth/token burst control',
                expression: `(${hostExpression} and http.request.uri.path eq "/oauth/token")`,
                action: 'block',
                ratelimit: {
                    characteristics: ['cf.colo.id', 'ip.src'],
                    period: 60,
                    requests_per_period: 120,
                    mitigation_timeout: 60,
                },
                enabled: true,
            },
        },
        {
            phase: RATE_LIMIT_PHASE,
            name: 'MCP anonymous request protection',
            ref: 'copilot-mcp-anonymous-rate-limit-v1',
            rule: {
                ref: 'copilot-mcp-anonymous-rate-limit-v1',
                description: 'Bound anonymous /mcp traffic',
                expression: `(${hostExpression} and ${mcpPathExpression} and not exists http.request.headers["authorization"][0])`,
                action: 'block',
                ratelimit: {
                    characteristics: ['cf.colo.id', 'ip.src'],
                    period: 60,
                    requests_per_period: 240,
                    mitigation_timeout: 60,
                },
                enabled: true,
            },
        },
    ];
}

/**
 * @param {Record<string, unknown>[]} actualRulesets
 * @param {{ phase: string; name: string; ref: string; rule: Record<string, unknown> }[]} desiredRules
 * @param {{ phases?: string[] }} [options]
 * @returns {{ actions: Record<string, unknown>[]; summary: Record<string, unknown>; recommendedSequence: string[] }}
 */
export function buildCloudflareEdgeApplyPlan(actualRulesets, desiredRules, options = {}) {
    const phases = normalizePhases(options.phases);
    const actions = [];
    const plannedCreatedPhases = new Set();
    for (const desired of desiredRules.filter((rule) => phases.includes(rule.phase))) {
        const ruleset = actualRulesets.find((item) => asString(item['phase']) === desired.phase) ?? null;
        const rules = Array.isArray(ruleset?.['rules']) ? /** @type {unknown[]} */ (ruleset['rules']) : [];
        const existing = rules.find((rule) => asRecord(rule)['ref'] === desired.ref);
        const missingRulesetStatus = plannedCreatedPhases.has(desired.phase)
            ? 'append-rule-after-entrypoint-create'
            : 'create-entrypoint-ruleset';
        if (!ruleset) plannedCreatedPhases.add(desired.phase);
        actions.push({
            phase: desired.phase,
            ref: desired.ref,
            name: desired.name,
            status: existing ? 'present' : ruleset ? 'append-rule' : missingRulesetStatus,
            rulesetId: asString(ruleset?.['id']) || null,
            preservesExistingRules: true,
            rateLimitRuleMustRemainLast: desired.phase === RATE_LIMIT_PHASE,
            rule: desired.rule,
        });
    }
    return {
        actions,
        summary: {
            phases,
            actionCount: actions.length,
            createEntrypointRulesets: actions.filter((action) => action['status'] === 'create-entrypoint-ruleset').length,
            appendRules: actions.filter(
                (action) => action['status'] === 'append-rule' || action['status'] === 'append-rule-after-entrypoint-create',
            ).length,
            alreadyPresent: actions.filter((action) => action['status'] === 'present').length,
        },
        recommendedSequence: [
            'Apply cache bypass before rate-limit rules.',
            'Preserve all existing Cloudflare rules when updating an entrypoint ruleset.',
            'Run edge audit, policy diff and connector smoke after applying.',
        ],
    };
}

/**
 * @param {Cloudflare} client
 * @param {string} zoneId
 * @param {{ phase: string; name: string; ref: string; rule: Record<string, unknown> }} desired
 * @returns {Promise<Record<string, unknown>>}
 */
async function applyDesiredRule(client, zoneId, desired) {
    const entrypoint = await getEntrypointRuleset(client, zoneId, desired.phase);
    if (!entrypoint) {
        const createParams = /** @type {any} */ ({
            zone_id: zoneId,
            kind: 'zone',
            name: desired.name,
            phase: desired.phase,
            rules: [desired.rule],
        });
        const created = await client.rulesets.create(createParams);
        return { operation: 'create-entrypoint-ruleset', ruleset: summarizeRuleset(created) };
    }
    const entrypointRecord = asRecord(entrypoint);
    const rules = Array.isArray(entrypointRecord['rules']) ? [.../** @type {unknown[]} */ (entrypointRecord['rules'])] : [];
    const existingIndex = rules.findIndex((rule) => asRecord(rule)['ref'] === desired.ref);
    if (existingIndex >= 0) rules[existingIndex] = desired.rule;
    else rules.push(desired.rule);
    const rulesetId = asString(entrypointRecord['id']);
    if (!rulesetId) throw new Error(`Cloudflare entrypoint ruleset for ${desired.phase} has no id.`);
    const updateParams = /** @type {any} */ ({
        zone_id: zoneId,
        kind: asString(entrypointRecord['kind']) || 'zone',
        name: asString(entrypointRecord['name']) || desired.name,
        phase: desired.phase,
        rules,
    });
    const updated = await client.rulesets.update(rulesetId, updateParams);
    return { operation: existingIndex >= 0 ? 'replace-rule' : 'append-rule', ruleset: summarizeRuleset(updated) };
}

/**
 * @param {Cloudflare} client
 * @param {string} zoneId
 * @param {string} phase
 * @returns {Promise<unknown | null>}
 */
async function getEntrypointRuleset(client, zoneId, phase) {
    try {
        return await client.rulesets.phases.get(/** @type {any} */ (phase), { zone_id: zoneId });
    } catch (error) {
        if (asRecord(error)['status'] === 404) return null;
        throw error;
    }
}

/**
 * @param {Cloudflare} client
 * @param {import('./remote-api.js').CloudflareRemoteApiConfig} config
 * @returns {Promise<string>}
 */
async function resolveZoneId(client, config) {
    if (config.zoneId) return config.zoneId;
    const query =
        typeof config.accountId === 'string' && config.accountId
            ? { name: config.zone, account: { id: config.accountId } }
            : { name: config.zone };
    for await (const zone of client.zones.list(query)) {
        const record = asRecord(zone);
        if (record['name'] === config.zone && typeof record['id'] === 'string') return record['id'];
    }
    throw new Error(`Cloudflare zone ${config.zone} was not found.`);
}

/**
 * @param {unknown} actualRulesets
 * @returns {Record<string, unknown>[]}
 */
function asRulesets(actualRulesets) {
    return Array.isArray(actualRulesets)
        ? actualRulesets.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map(asRecord)
        : [];
}

/**
 * @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} diff
 * @returns {Record<string, unknown>}
 */
function summarizePreflight(actual, diff) {
    return {
        actualOk: actual['ok'] === true,
        diffOk: diff['ok'] === true,
        mutationReady: diff['mutationReady'] === true,
        critical: actual['critical'] ?? [],
        permissionGaps: actual['permissionGaps'] ?? [],
        diffSummary: diff['summary'] ?? null,
    };
}

/**
 * @param {unknown} ruleset
 * @returns {Record<string, unknown>}
 */
function summarizeRuleset(ruleset) {
    const record = asRecord(ruleset);
    return {
        id: typeof record['id'] === 'string' ? '<redacted>' : null,
        name: record['name'] ?? null,
        phase: record['phase'] ?? null,
        version: record['version'] ?? null,
        rules: Array.isArray(record['rules']) ? record['rules'].length : 0,
    };
}

/**
 * @param {string[] | undefined} phases
 * @returns {string[]}
 */
function normalizePhases(phases) {
    const defaults = [CACHE_PHASE, RATE_LIMIT_PHASE];
    if (!Array.isArray(phases) || phases.length === 0) return defaults;
    const allowed = new Set(defaults);
    return [...new Set(phases.filter((phase) => allowed.has(phase)))];
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
 * @returns {string}
 */
function asString(value) {
    return typeof value === 'string' ? value : '';
}
