// @ts-check
/**
 * MCP tool-surface status for ChatGPT autonomy planning.
 *
 * @module copilot/mcp/tools/tools-status
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { MCP_AUTH_SCOPES, readMcpAuthConfig } from '../control-plane/auth.js';
import { okResult } from '../control-plane/result.js';

const MAX_POWER_REPO_SCOPES = [
    MCP_AUTH_SCOPES.read,
    MCP_AUTH_SCOPES.write,
    MCP_AUTH_SCOPES.validate,
    MCP_AUTH_SCOPES.admin,
];

/** @type {() => import('../registry.js').McpToolDefinition[]} */
let toolsProvider = () => [];

/**
 * @param {() => import('../registry.js').McpToolDefinition[]} provider
 * @returns {void}
 */
export function bindMcpToolsStatusProvider(provider) {
    toolsProvider = provider;
}

const NEVER_REMEMBER_APPROVAL_TOOLS = new Set(['job_cancel']);

/**
 * @param {{ name: string; riskClass: string }} tool
 * @returns {boolean}
 */
function requiresManualApproval(tool) {
    return tool.riskClass === 'destructive' || NEVER_REMEMBER_APPROVAL_TOOLS.has(tool.name);
}

/**
 * @param {{ name: string; riskClass: string; rememberApprovalCandidate: boolean }[]} summaries
 */
function buildApprovalFrictionProfile(summaries) {
    const manual = summaries
        .filter(requiresManualApproval)
        .map((tool) => tool.name)
        .sort();
    const manualSet = new Set(manual);
    const remember = summaries
        .filter((tool) => tool.rememberApprovalCandidate && !manualSet.has(tool.name))
        .map((tool) => tool.name)
        .sort();
    return {
        hostPolicy:
            'write actions may require ChatGPT confirmation; readOnlyHint and conversation-level remembered approvals reduce friction but do not disable host safety UI',
        firstCalls: ['mcp_session_profile', 'mcp_tools_status', 'mcp_capabilities_summary'],
        firstRememberApprovalWave: remember.filter((name) =>
            [
                'repo_apply_patch',
                'repo_write_file',
                'repo_create_file',
                'repo_move_file',
                'repo_quarantine_file',
                'repo_restore_quarantined_file',
                'mcp_run_safe_validation_suite',
            ].includes(name),
        ),
        rememberApprovalCandidates: remember,
        neverRememberApproval: manual,
        planFirstWorkflows: [
            ['repo_patch_plan', 'repo_apply_patch'],
            ['repo_create_file_plan', 'repo_create_file'],
            ['repo_move_file_plan', 'repo_move_file'],
            ['repo_quarantine_file_plan', 'repo_quarantine_file'],
            ['repo_apply_file_batch_plan', 'repo_apply_file_batch'],
            ['mcp_validation_plan', 'mcp_run_safe_validation_suite'],
        ],
    };
}

function summarizeTool(tool = /** @type {any} */ ({})) {
    const annotations = tool.annotations;
    const readOnly = annotations.readOnlyHint === true;
    const destructive = annotations.destructiveHint === true;
    const openWorld = annotations.openWorldHint === true;
    const idempotent = annotations.idempotentHint === true;
    const riskClass = readOnly
        ? idempotent
            ? 'read-idempotent'
            : 'read'
        : destructive
          ? 'destructive'
          : openWorld
            ? 'open-world'
            : 'bounded-write';
    return {
        name: tool.name,
        title: tool.title,
        riskClass,
        annotations: {
            readOnlyHint: readOnly,
            destructiveHint: destructive,
            openWorldHint: openWorld,
            idempotentHint: idempotent,
        },
        hasOutputSchema: Boolean(tool.outputSchema),
        securitySchemes: tool.securitySchemes ?? tool._meta?.['securitySchemes'] ?? [],
        rememberApprovalCandidate: !readOnly && !destructive && !openWorld,
    };
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpToolsStatusTool = {
    name: 'mcp_tools_status',
    title: 'MCP tools status',
    description:
        'Return all MCP tools, annotations and risk classes so ChatGPT can choose low-friction tools and approval strategy.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const tools = toolsProvider();
        const summaries = tools.map(summarizeTool).sort((left, right) => left.name.localeCompare(right.name));
        const readOnly = summaries.filter((tool) => tool.annotations.readOnlyHint);
        const boundedWrite = summaries.filter((tool) => tool.riskClass === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.riskClass === 'destructive');
        const openWorld = summaries.filter((tool) => tool.riskClass === 'open-world');
        const auth = readMcpAuthConfig();
        const maxPowerRepoScopesByDefault = MAX_POWER_REPO_SCOPES.every((scope) => auth.initialScopes.includes(scope));
        return okResult({
            success: true,
            totalTools: summaries.length,
            readOnlyCount: readOnly.length,
            boundedWriteCount: boundedWrite.length,
            destructiveCount: destructive.length,
            openWorldCount: openWorld.length,
            idempotentReadCount: readOnly.filter((tool) => tool.annotations.idempotentHint).length,
            rememberApprovalCandidates: boundedWrite
                .filter((tool) => tool.rememberApprovalCandidate && !requiresManualApproval(tool))
                .map((tool) => tool.name),
            destructiveTools: destructive.map((tool) => tool.name),
            openWorldTools: openWorld.map((tool) => tool.name),
            hostApprovalProfile: {
                oauthGrantsAllRepoScopesByDefault: maxPowerRepoScopesByDefault,
                writeActionsMayStillPrompt:
                    'ChatGPT host confirmation is separate from OAuth consent. Developer Mode requires confirmation for write actions by default; this MCP cannot disable that UI from the server side.',
                approvalMinimizers: [
                    'Use read-only *_plan tools before write tools.',
                    'Use mcp_run_safe_validation_suite instead of separate validator jobs.',
                    'Use delegate_to_repo_autonomy_runner for fixed multi-step missions.',
                    'When ChatGPT offers it, remember approval for trusted bounded-write tools in the current conversation.',
                ],
            },
            approvalFrictionProfile: buildApprovalFrictionProfile(summaries),
            tools: summaries,
        });
    },
};

/**
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function clampScore(value, max) {
    return Math.max(0, Math.min(max, Math.round(value)));
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpAutonomyPowerScoreTool = {
    name: 'mcp_autonomy_power_score',
    title: 'MCP autonomy power score',
    description:
        'Return a deterministic autonomy score for the ChatGPT connector based on tool coverage, annotations, metadata, auth posture and validation readiness.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const tools = toolsProvider();
        const summaries = tools.map(summarizeTool);
        const readOnly = summaries.filter((tool) => tool.annotations.readOnlyHint);
        const boundedWrite = summaries.filter((tool) => tool.riskClass === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.riskClass === 'destructive');
        const openWorld = summaries.filter((tool) => tool.riskClass === 'open-world');
        const planOnly = summaries.filter((tool) => tool.name.endsWith('_plan') || tool.name.includes('_plan_'));
        const outputSchemaCoverage =
            summaries.length === 0 ? 0 : summaries.filter((tool) => tool.hasOutputSchema).length / summaries.length;
        const securityMetadataCoverage =
            summaries.length === 0
                ? 0
                : summaries.filter((tool) => Array.isArray(tool.securitySchemes) && tool.securitySchemes.length > 0)
                      .length / summaries.length;
        const auth = readMcpAuthConfig();
        const maxPowerRepoScopesByDefault = MAX_POWER_REPO_SCOPES.every((scope) => auth.initialScopes.includes(scope));
        const scoreParts = {
            toolSurface: clampScore((summaries.length / 66) * 18, 18),
            lowFrictionReads: clampScore((readOnly.length / Math.max(1, summaries.length)) * 18, 18),
            writeSafety: clampScore(
                (boundedWrite.length > 0 ? 9 : 0) + (planOnly.length >= 5 ? 7 : planOnly.length),
                16,
            ),
            metadata: clampScore((outputSchemaCoverage + securityMetadataCoverage) * 10, 20),
            validation: clampScore(
                [
                    'mcp_run_safe_validation_suite',
                    'run_typecheck_copilot',
                    'run_lint_copilot',
                    'run_unit_copilot',
                ].filter((name) => summaries.some((tool) => tool.name === name)).length * 3,
                12,
            ),
            authPosture: clampScore(
                auth.enforcement === 'off'
                    ? 6
                    : auth.staticBearerConfigured || (auth.expectedIssuer && auth.jwksUri)
                      ? maxPowerRepoScopesByDefault
                          ? 10
                          : 7
                      : 4,
                10,
            ),
            promptFriction: clampScore(openWorld.length === 0 ? 6 : 2, 6),
        };
        const score = Object.values(scoreParts).reduce((total, value) => total + value, 0);
        const blockers = [];
        if (openWorld.length > 0) blockers.push('Open-world tools increase host-side prompt friction.');
        if (outputSchemaCoverage < 1) blockers.push('Some tools still lack outputSchema.');
        if (securityMetadataCoverage < 1) blockers.push('Some tools still lack securitySchemes metadata.');
        if (auth.enforcement !== 'off' && !auth.staticBearerConfigured && !(auth.expectedIssuer && auth.jwksUri)) {
            blockers.push('Auth enforcement is enabled without a configured static token or OAuth/JWKS verifier.');
        }
        if (!maxPowerRepoScopesByDefault) {
            blockers.push('OAuth initial scopes are not max-power for the canonical ChatGPT connector.');
        }
        return okResult({
            success: true,
            score,
            grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D',
            scoreParts,
            toolCounts: {
                total: summaries.length,
                readOnly: readOnly.length,
                boundedWrite: boundedWrite.length,
                destructive: destructive.length,
                openWorld: openWorld.length,
                planOnly: planOnly.length,
            },
            coverage: {
                outputSchema: outputSchemaCoverage,
                securityMetadata: securityMetadataCoverage,
            },
            auth: {
                mode: auth.mode,
                enforcement: auth.enforcement,
                authorizationServersConfigured: auth.authorizationServers.length > 0,
                initialScopes: [...auth.initialScopes],
                maxPowerRepoScopesByDefault,
                jwksUriConfigured: Boolean(auth.jwksUri),
                staticBearerConfigured: auth.staticBearerConfigured,
            },
            blockers,
            nextActions:
                blockers.length === 0
                    ? ['Run mcp_golden_prompts in a real ChatGPT session and compare observed prompt friction.']
                    : blockers,
        });
    },
};
