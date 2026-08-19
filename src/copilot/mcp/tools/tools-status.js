// @ts-check
/**
 * MCP tool-surface status for ChatGPT autonomy planning.
 *
 * @module copilot/mcp/tools/tools-status
 */

import {
    MCP_AUTH_SCOPES,
    MCP_TOOL_EXECUTION_LIMITS,
    MCP_TOOL_EXECUTION_LIMITS_VERSION,
    okResult,
    readMcpAuthConfig,
    readMcpSchemaConvergenceState,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';

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

/** @type {Promise<Record<string, unknown>> | null} */
let wirePayloadSummaryPromise = null;

/**
 * tools/list metadata is immutable for the lifetime of one MCP process. Cache the compact summary so frequent status
 * calls do not rebuild an in-memory SDK client/server pair or transport descriptor detail that belongs in the dedicated
 * mcp_tool_payload_audit tool.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
async function readCompactWirePayloadSummary() {
    if (!wirePayloadSummaryPromise) {
        wirePayloadSummaryPromise = (async () => {
            const { buildToolPayloadAudit } = await import('../scripts/tool-payload-audit.js');
            const audit = /** @type {Record<string, any>} */ (await buildToolPayloadAudit({ top: 3 }));
            const fieldTotals = /** @type {Record<string, number>} */ (audit['fieldTotals'] ?? {});
            const largestField = Object.entries(fieldTotals)
                .filter(([name]) => name !== 'totalBytes')
                .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))[0] ?? ['unknown', 0];
            return {
                toolCount: audit['toolCount'],
                totalEnvelopeBytes: audit['totalEnvelopeBytes'],
                maxEnvelopeBytes: audit['maxEnvelopeBytes'],
                budgetHeadroomBytes: audit['budgetHeadroomBytes'],
                withinEnvelopeBudget: audit['withinEnvelopeBudget'],
                averageToolBytes: audit['averageToolBytes'],
                p50ToolBytes: audit['p50ToolBytes'],
                p95ToolBytes: audit['p95ToolBytes'],
                largestField: { name: largestField[0], bytes: largestField[1] },
                largestDescriptors: (Array.isArray(audit['topTools']) ? audit['topTools'] : []).slice(0, 3).map((row) => ({
                    name: row['name'],
                    totalBytes: row['totalBytes'],
                })),
                detailsTool: 'mcp_tool_payload_audit',
            };
        })().catch((error) => {
            wirePayloadSummaryPromise = null;
            throw error;
        });
    }
    return wirePayloadSummaryPromise;
}

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
            'Prefer direct bounded batch/write when intent is clear. Patch batches default to atomic-per-target best-effort progress; file batches adapt preflight to destructive risk. Plan only when preview or a separate approval boundary adds information; remember trusted approvals when the host offers it.',
        firstRememberApprovalWave: remember.filter((name) =>
            [
                'repo_apply_patch',
                'repo_apply_patch_batch',
                'repo_write_file',
                'repo_create_file',
                'repo_move_file',
                'repo_quarantine_file',
                'repo_restore_quarantined_file',
                'run_copilot_validator',
            ].includes(name),
        ),
        neverRememberApproval: manual,
        directBatchWorkflows: [
            ['repo_apply_patch_batch', 'repo_patch_batch_plan'],
            ['repo_apply_file_batch', 'repo_apply_file_batch_plan'],
            ['run_copilot_validator', 'mcp_validation_plan'],
        ],
        planFirstWorkflows: [],
        escalationOnlyPlans: ['mcp_validation_plan'], 
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
        'Return compact MCP tool counts, risk classes and approval strategy without repeating the full tools/list registry.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const tools = toolsProvider();
        const summaries = tools.map(summarizeTool).sort((left, right) => left.name.localeCompare(right.name));
        const readOnly = summaries.filter((tool) => tool.annotations.readOnlyHint);
        const boundedWrite = summaries.filter((tool) => tool.riskClass === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.riskClass === 'destructive');
        const openWorld = summaries.filter((tool) => tool.annotations.openWorldHint);
        const auth = readMcpAuthConfig();
        const maxPowerRepoScopesByDefault = MAX_POWER_REPO_SCOPES.every((scope) => auth.initialScopes.includes(scope));
        const outputSchemaCount = summaries.filter((tool) => tool.hasOutputSchema).length;
        const securityMetadataCount = summaries.filter(
            (tool) => Array.isArray(tool.securitySchemes) && tool.securitySchemes.length > 0,
        ).length;
        let wirePayloadAudit;
        try {
            wirePayloadAudit = await readCompactWirePayloadSummary();
        } catch (error) {
            wirePayloadAudit = {
                error: error instanceof Error ? error.message : String(error),
                detailsTool: 'mcp_tool_payload_audit',
            };
        }
        return okResult({
            success: true,
            totalTools: summaries.length,
            readOnlyCount: readOnly.length,
            boundedWriteCount: boundedWrite.length,
            destructiveCount: destructive.length,
            openWorldCount: openWorld.length,
            idempotentReadCount: readOnly.filter((tool) => tool.annotations.idempotentHint).length,
            metadataCoverage: {
                outputSchemaPolicy: 'specific-only',
                specificOutputSchemaCount: outputSchemaCount,
                securityMetadataCount,
                securityComplete: securityMetadataCount === summaries.length,
            },
            rememberApprovalCandidates: boundedWrite
                .filter((tool) => tool.rememberApprovalCandidate && !requiresManualApproval(tool))
                .map((tool) => tool.name),
            destructiveTools: destructive.map((tool) => tool.name),
            openWorldTools: openWorld.map((tool) => tool.name),
            hostApprovalProfile: {
                oauthGrantsAllRepoScopesByDefault: maxPowerRepoScopesByDefault,
                writeActionsMayStillPrompt: true,
                preferredStrategy:
                    'Use the direct bounded one-shot tool when intent is clear; use plan tools only when preview, escalation, or a separate approval boundary adds information.',
            },
            executionLimitsVersion: MCP_TOOL_EXECUTION_LIMITS_VERSION,
            executionLimits: MCP_TOOL_EXECUTION_LIMITS,
            schemaConvergence: readMcpSchemaConvergenceState(),
            publicationWorkflow: {
                preferred: 'git_publish_changes',
                happyPath:
                    'When the Git index starts clean and explicit changed paths are known, publish with one governed git_publish_changes call (stage → commit → optional upstream push → final verification).',
                granularFallbackOnlyFor: [
                    'preexisting-staged-index',
                    'merge-or-rebase-state',
                    'upstream-or-head-drift',
                    'explicit-preview-or-forensics',
                    'partial-publish-failure',
                ],
                avoidRoutineSequence: [
                    'git_stage_plan',
                    'git_stage',
                    'git_commit_plan',
                    'git_commit',
                    'git_push_plan',
                    'git_push',
                ],
            },
            approvalFrictionProfile: buildApprovalFrictionProfile(summaries),
            wirePayloadAudit,
            detailsTool: 'mcp_capabilities_summary',
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
        const openWorld = summaries.filter((tool) => tool.annotations.openWorldHint);
        const planOnly = summaries.filter((tool) => tool.name.endsWith('_plan') || tool.name.includes('_plan_'));
        const specificOutputSchemaCount = summaries.filter((tool) => tool.hasOutputSchema).length;
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
            metadata: clampScore(10 + securityMetadataCoverage * 10, 20),
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
                outputSchemaPolicy: 'specific-only',
                specificOutputSchemaCount,
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
