// @ts-check
/**
 * Plan-only MCP passthrough configuration rule for Cloudflare http_config_settings.
 *
 * This module never mutates Cloudflare. It builds the desired scoped configuration rule and compares it with the
 * read-only Cloudflare config audit so the next mutation can be reviewed explicitly.
 *
 * @module copilot/mcp/cloudflare/mcp-passthrough-plan
 */

// import Cloudflare from 'cloudflare';
// import { createCloudflareEdgeBackup } from './edge-backup.js';
import { auditCloudflareConfigPosture } from './config-audit.js';
import { readCloudflareRemoteApiConfig } from './remote-api.js';

const RULE_REF = 'copilot-mcp-passthrough-config-v1';
const PHASE = 'http_config_settings';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function buildCloudflareMcpPassthroughPlan(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    const desiredRule = buildDesiredMcpPassthroughRule(config.publicHostname);
    return {
        ok: true,
        success: true,
        mode: 'plan-only',
        appliesChanges: false,
        endpoint: {
            publicHostname: config.publicHostname,
            publicMcpUrl: config.expectedPublicMcpUrl,
            zone: config.zone,
        },
        desiredRuleset: {
            phase: PHASE,
            name: 'MCP passthrough configuration',
            rationale:
                'MCP/OAuth routes are API endpoints, not browser pages. They should avoid browser challenges/features and preserve streamable HTTP/SSE behavior.',
            rules: [desiredRule],
        },
        safetyInvariants: [
            'Expression must remain scoped to mcp.aurelin.org dynamic MCP/OAuth routes only.',
            'Do not disable or skip http_ratelimit in this rule.',
            'Do not weaken unrelated website routes on the same zone.',
            'Apply only after backup and after reviewing mcp_cloudflare_skip_audit findings.',
        ],
        recommendedValidationSequence: [
            'mcp_cloudflare_edge_backup_create',
            'mcp_cloudflare_mcp_passthrough_diff',
            'apply only this http_config_settings rule in a future bounded apply tool or Cloudflare dashboard/API review',
            'mcp_cloudflare_config_audit',
            'mcp_cloudflare_skip_audit',
            'mcp_connector_smoke_refresh',
        ],
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function diffCloudflareMcpPassthroughPlan(options = {}) {
    const [plan, audit] = await Promise.all([
        buildCloudflareMcpPassthroughPlan(options),
        auditCloudflareConfigPosture(options),
    ]);
    const desiredRule = /** @type {Record<string, unknown>} */ (
        /** @type {{ desiredRuleset?: { rules?: Record<string, unknown>[] } }} */ (plan).desiredRuleset?.rules?.[0] ??
            {}
    );
    const configRulesets = Array.isArray(audit['configRulesets']) ? audit['configRulesets'] : [];
    const existingRules = flattenRules(configRulesets);
    const existingByRef = existingRules.find((rule) => rule['ref'] === RULE_REF);
    const equivalentRule = existingRules.find((rule) => isEquivalentPassthroughRule(rule, desiredRule));
    const findings = asRecord(audit['findings']);
    const gaps = [];
    if (!existingByRef && !equivalentRule) gaps.push('missing-rule');
    if (Number(findings['bicOffRules'] ?? 0) === 0) gaps.push('bic-not-explicitly-off');
    if (Number(findings['responseBodyBufferingNoneRules'] ?? 0) === 0) gaps.push('response-body-buffering-not-none');

    return {
        ok: true,
        success: true,
        mode: 'diff-only',
        appliesChanges: false,
        endpoint: plan['endpoint'],
        desiredRule,
        actual: {
            inspectedConfigRulesets: configRulesets.length,
            inspectedRules: existingRules.length,
            existingRuleByRef: existingByRef ?? null,
            equivalentRule: equivalentRule ?? null,
            configFindings: findings,
        },
        diff: {
            needsCreate: !existingByRef && !equivalentRule,
            needsUpdate: Boolean(existingByRef && !isEquivalentPassthroughRule(existingByRef, desiredRule)),
            alreadySatisfied: Boolean(existingByRef || equivalentRule) && gaps.length === 0,
            gaps,
        },
        recommendation: {
            nextStep:
                gaps.length > 0
                    ? 'Create or update the scoped MCP passthrough http_config_settings rule after backup/review.'
                    : 'No MCP passthrough config mutation appears necessary.',
            applyScope: 'single ruleRef copilot-mcp-passthrough-config-v1 only',
            doNotApplyYet: true,
        },
        critical: [],
        warnings: Array.isArray(audit['warnings']) ? audit['warnings'] : [],
        permissionGaps: Array.isArray(audit['permissionGaps']) ? audit['permissionGaps'] : [],
    };
}

/**
 * @param {string} hostname
 * @returns {Record<string, unknown>}
 */
function buildDesiredMcpPassthroughRule(hostname) {
    const hostExpression = `http.host eq "${hostname}"`;
    const dynamicPathsExpression = [
        'starts_with(http.request.uri.path, "/mcp")',
        'starts_with(http.request.uri.path, "/oauth/")',
        'starts_with(http.request.uri.path, "/.well-known/")',
        'http.request.uri.path eq "/health"',
    ].join(' or ');
    return {
        ref: RULE_REF,
        description: 'MCP/OAuth passthrough config for non-browser API traffic',
        expression: `(${hostExpression} and (${dynamicPathsExpression}))`,
        action: 'set_config',
        actionParameters: {
            bic: false,
            rocket_loader: false,
            email_obfuscation: false,
            response_body_buffering: 'none',
        },
        notes: [
            'RUM/Zaraz may not be expressible in http_config_settings on all Cloudflare plans/APIs; keep them as audit warnings until capabilities are confirmed.',
            'Security Level should be handled only if Cloudflare exposes a scoped configuration field compatible with the current plan.',
        ],
    };
}

/**
 * Guarded apply for the single MCP passthrough configuration rule.
 *
 * @param {{ env?: NodeJS.ProcessEnv; dryRun?: boolean; confirmApply?: boolean; now?: Date }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function applyCloudflareMcpPassthroughPlan(options = {}) {
    const dryRun = options.dryRun !== false;
    const confirmApply = options.confirmApply === true;
    const env = options.env ?? process.env;
    const [{ default: Cloudflare }, { createCloudflareEdgeBackup }] = await Promise.all([
        import('cloudflare'),
        import('./edge-backup.js'),
    ]);
    const backup = await createCloudflareEdgeBackup({
        env,
        ...(options.now ? { now: options.now } : {}),
        label: dryRun ? 'passthrough-preflight' : 'passthrough-pre-apply',
    });
    const [config, diff] = await Promise.all([
        readCloudflareRemoteApiConfig(env),
        diffCloudflareMcpPassthroughPlan({ env }),
    ]);
    const desiredRule = buildDesiredMcpPassthroughApiRule(config.publicHostname);
    const diffRecord = asRecord(diff['diff']);
    const critical = Array.isArray(diff['critical']) ? diff['critical'] : [];
    const needsCreate = diffRecord['needsCreate'] === true;
    const needsUpdate = diffRecord['needsUpdate'] === true;
    const alreadySatisfied = diffRecord['alreadySatisfied'] === true;
    const preflightOk = backup.ok === true && diff.ok === true && critical.length === 0;
    const plan = {
        phase: PHASE,
        ref: RULE_REF,
        action: alreadySatisfied ? 'none' : needsCreate ? 'create-rule' : needsUpdate ? 'update-rule' : 'review',
        needsCreate,
        needsUpdate,
        alreadySatisfied,
        preservesExistingRules: true,
        rule: desiredRule,
    };

    if (dryRun || !confirmApply || alreadySatisfied) {
        return {
            ok: preflightOk,
            success: true,
            mode: 'guarded-mcp-passthrough-apply',
            appliesChanges: false,
            dryRun: true,
            confirmApply,
            backup,
            preflight: summarizePassthroughPreflight(diff),
            plan,
            blockedReason: alreadySatisfied
                ? 'MCP passthrough config rule is already satisfied.'
                : preflightOk
                  ? 'Set dryRun=false and confirmApply=true to apply only this rule.'
                  : 'Preflight is not clean; do not apply MCP passthrough config rule.',
        };
    }

    if (!preflightOk) {
        return {
            ok: false,
            success: true,
            mode: 'guarded-mcp-passthrough-apply',
            appliesChanges: false,
            dryRun,
            confirmApply,
            backup,
            preflight: summarizePassthroughPreflight(diff),
            plan,
            blockedReason: 'MCP passthrough apply requires clean backup/diff preflight.',
        };
    }

    if (!config.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to apply MCP passthrough config rule.');
    const client = new Cloudflare({ apiToken: config.apiToken, maxRetries: 1, timeout: 15000 });
    const zoneId = await resolveCloudflareZoneId(client, config);
    const result = await applyDesiredMcpPassthroughRule(client, zoneId, desiredRule);
    return {
        ok: true,
        success: true,
        mode: 'guarded-mcp-passthrough-apply',
        appliesChanges: true,
        dryRun: false,
        confirmApply,
        backup,
        preflight: summarizePassthroughPreflight(diff),
        plan,
        applied: result,
        nextActions: [
            'Run mcp_cloudflare_config_audit.',
            'Run mcp_cloudflare_mcp_passthrough_diff.',
            'Run mcp_connector_smoke_refresh.',
        ],
    };
}

/**
 * @param {string} hostname
 * @returns {Record<string, unknown>}
 */
function buildDesiredMcpPassthroughApiRule(hostname) {
    const desired = buildDesiredMcpPassthroughRule(hostname);
    const params = asRecord(desired['actionParameters']);
    return {
        ref: RULE_REF,
        description: desired['description'],
        expression: desired['expression'],
        action: desired['action'],
        action_parameters: {
            bic: params['bic'],
            rocket_loader: params['rocket_loader'],
            email_obfuscation: params['email_obfuscation'],
            response_body_buffering: params['response_body_buffering'],
        },
        enabled: true,
    };
}

/**
 * @param {unknown} client
 * @param {string} zoneId
 * @param {Record<string, unknown>} desiredRule
 * @returns {Promise<Record<string, unknown>>}
 */
async function applyDesiredMcpPassthroughRule(client, zoneId, desiredRule) {
    const api = /** @type {any} */ (client);
    const entrypoint = await getMcpPassthroughEntrypointRuleset(api, zoneId);
    if (!entrypoint) {
        const created = await api.rulesets.create({
            zone_id: zoneId,
            kind: 'zone',
            name: 'MCP passthrough configuration',
            phase: PHASE,
            rules: [desiredRule],
        });
        return { operation: 'create-entrypoint-ruleset', ruleset: summarizeMcpPassthroughRuleset(created) };
    }
    const entrypointRecord = asRecord(entrypoint);
    const rules = Array.isArray(entrypointRecord['rules']) ? [...entrypointRecord['rules']] : [];
    const existingIndex = rules.findIndex((rule) => asRecord(rule)['ref'] === RULE_REF);
    if (existingIndex >= 0) rules[existingIndex] = desiredRule;
    else rules.push(desiredRule);
    const rulesetId = String(entrypointRecord['id'] ?? '');
    if (!rulesetId) throw new Error(`Cloudflare entrypoint ruleset for ${PHASE} has no id.`);
    const updated = await api.rulesets.update(rulesetId, {
        zone_id: zoneId,
        kind: String(entrypointRecord['kind'] ?? 'zone'),
        name: String(entrypointRecord['name'] ?? 'MCP passthrough configuration'),
        phase: PHASE,
        rules,
    });
    return {
        operation: existingIndex >= 0 ? 'replace-rule' : 'append-rule',
        ruleset: summarizeMcpPassthroughRuleset(updated),
    };
}

/**
 * @param {unknown} client
 * @param {string} zoneId
 * @returns {Promise<unknown | null>}
 */
async function getMcpPassthroughEntrypointRuleset(client, zoneId) {
    try {
        return await /** @type {any} */ (client).rulesets.phases.get(PHASE, { zone_id: zoneId });
    } catch (error) {
        if (asRecord(error)['status'] === 404) return null;
        throw error;
    }
}

/**
 * @param {unknown} client
 * @param {import('./remote-api.js').CloudflareRemoteApiConfig} config
 * @returns {Promise<string>}
 */
async function resolveCloudflareZoneId(client, config) {
    if (config.zoneId) return config.zoneId;
    const query =
        typeof config.accountId === 'string' && config.accountId
            ? { name: config.zone, account: { id: config.accountId } }
            : { name: config.zone };
    for await (const zone of /** @type {any} */ (client).zones.list(query)) {
        const record = asRecord(zone);
        if (record['name'] === config.zone && typeof record['id'] === 'string') return record['id'];
    }
    throw new Error(`Cloudflare zone ${config.zone} was not found.`);
}

/**
 * @param {Record<string, unknown>} diff
 * @returns {Record<string, unknown>}
 */
function summarizePassthroughPreflight(diff) {
    return {
        diffOk: diff['ok'] === true,
        diff: diff['diff'] ?? null,
        critical: diff['critical'] ?? [],
        warnings: diff['warnings'] ?? [],
        permissionGaps: diff['permissionGaps'] ?? [],
    };
}

/**
 * @param {unknown} ruleset
 * @returns {Record<string, unknown>}
 */
function summarizeMcpPassthroughRuleset(ruleset) {
    const record = asRecord(ruleset);
    const rules = Array.isArray(record['rules']) ? record['rules'] : [];
    return {
        id: typeof record['id'] === 'string' ? '<redacted>' : null,
        name: record['name'] ?? null,
        phase: record['phase'] ?? null,
        ruleCount: rules.length,
        containsRuleRef: rules.some((rule) => asRecord(rule)['ref'] === RULE_REF),
    };
}

/**
 * @param {unknown[]} configRulesets
 * @returns {Record<string, unknown>[]}
 */
function flattenRules(configRulesets) {
    const rules = [];
    for (const ruleset of configRulesets) {
        const record = asRecord(ruleset);
        const nestedRules = Array.isArray(record['rules']) ? record['rules'] : [];
        if (nestedRules.length === 0 && typeof record['ref'] === 'string') {
            rules.push(record);
            continue;
        }
        for (const rule of nestedRules) rules.push(asRecord(rule));
    }
    return rules;
}

/**
 * @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} desired
 * @returns {boolean}
 */
function isEquivalentPassthroughRule(actual, desired) {
    const actualExpression = String(actual['expression'] ?? '');
    const desiredExpression = String(desired['expression'] ?? '');
    const actualParams = asRecord(actual['actionParameters'] ?? actual['action_parameters']);
    const desiredParams = asRecord(desired['actionParameters'] ?? desired['action_parameters']);
    return (
        actualExpression === desiredExpression &&
        normalize(actualParams['bic']) === normalize(desiredParams['bic']) &&
        normalize(actualParams['rocket_loader']) === normalize(desiredParams['rocket_loader']) &&
        normalize(actualParams['email_obfuscation']) === normalize(desiredParams['email_obfuscation']) &&
        normalize(actualParams['response_body_buffering']) === normalize(desiredParams['response_body_buffering'])
    );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalize(value) {
    return String(value ?? '').toLowerCase();
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
