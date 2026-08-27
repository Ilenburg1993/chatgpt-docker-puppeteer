// @ts-check
/**
 * MCP tool-surface status for ChatGPT autonomy planning.
 *
 * @module copilot/mcp/tools/tools-status
 */

import { buildToolPayloadAudit } from '#copilot/mcp/public/diagnostics/tool-payload';
import {
    classifyMcpToolContractRisk,
    defineMcpRawTool,
    readMcpDescriptorObservationState,
} from '#copilot/mcp/public/protocol/catalog';
import {
    MCP_TOOL_EXECUTION_LIMITS,
    MCP_TOOL_EXECUTION_LIMITS_VERSION,
    okResult,
    requireMcpToolAuthConfig,
    requireMcpToolPayloadAuditConfig,
    requireMcpToolSurface,
} from '#copilot/mcp/public/protocol/tools';
import { buildMcpWorkflowStatusProjection } from '#copilot/mcp/public/workflow-policy';

const NEVER_REMEMBER_APPROVAL_TOOLS = Object.freeze(['job_cancel']);

/** @type {WeakMap<object, Promise<Record<string, unknown>>>} */
const wirePayloadSummaryByConfig = new WeakMap();

/**
 * tools/list metadata is immutable for the lifetime of one MCP process. Cache the compact summary so frequent status
 * calls do not rebuild an in-memory SDK client/server pair or transport descriptor detail that belongs in the dedicated
 * mcp_tool_payload_audit tool.
 *
 * @param {import('#copilot/mcp/public/diagnostics/tool-payload').McpToolPayloadAuditConfig} config
 * @param {readonly import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]} tools
 * @returns {Promise<Record<string, unknown>>}
 */
async function readCompactWirePayloadSummary(config, tools) {
    let promise = wirePayloadSummaryByConfig.get(config);
    if (!promise) {
        promise = (async () => {
            const audit = await buildToolPayloadAudit({ tools: [...tools], config, top: 3 });
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
                largestDescriptors: (Array.isArray(audit['topTools']) ? audit['topTools'] : [])
                    .slice(0, 3)
                    .map((row) => {
                        const descriptor = /** @type {Record<string, unknown>} */ (row);
                        return { name: descriptor['name'], totalBytes: descriptor['totalBytes'] };
                    }),
                detailsTool: 'mcp_tool_payload_audit',
            };
        })().catch((error) => {
            wirePayloadSummaryByConfig.delete(config);
            throw error;
        });
        wirePayloadSummaryByConfig.set(config, promise);
    }
    return promise;
}

/**
 * @param {{ name: string; destructive: boolean }} tool
 * @returns {boolean}
 */
function requiresManualApproval(tool) {
    return tool.destructive || NEVER_REMEMBER_APPROVAL_TOOLS.includes(tool.name);
}

/**
 * @param {{ name: string; destructive: boolean; rememberApprovalCandidate: boolean }[]} summaries
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
        ...buildMcpWorkflowStatusProjection(),
    };
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool
 */
function summarizeTool(tool) {
    const contract = tool.contract;
    const risk = classifyMcpToolContractRisk(contract);
    const readOnly = contract.effects.mutation === 'none';
    const destructive = contract.effects.mutation === 'destructive';
    const openWorld = contract.authority.network === 'open-world';
    return {
        name: tool.name,
        title: tool.title,
        riskClass: risk.category,
        readOnly,
        destructive,
        openWorld,
        contract: {
            mutation: contract.effects.mutation,
            externalSideEffects: contract.effects.externalSideEffects,
            callerScope: contract.authority.callerScope,
            networkAuthority: contract.authority.network,
            credentials: [...contract.credentials],
            idempotency: contract.idempotency,
            retry: contract.retry,
            cancellation: contract.execution.cancellation,
            outputClass: contract.output.class,
        },
        hasOutputSchema: contract.output.class === 'specific',
        securitySchemes: tool.securitySchemes ?? tool._meta?.['securitySchemes'] ?? [],
        rememberApprovalCandidate: contract.effects.mutation === 'bounded-write' && !openWorld,
    };
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpToolsStatusTool = defineMcpRawTool({
    name: 'mcp_tools_status',
    title: 'MCP tools status',
    description:
        'Return compact MCP tool counts, risk classes and approval strategy without repeating the full tools/list registry.',
    inputSchema: {},

    handler: async (_args, operationContext) => {
        const auth = requireMcpToolAuthConfig(operationContext);
        const toolPayloadConfig = requireMcpToolPayloadAuditConfig(operationContext);
        const tools = requireMcpToolSurface(operationContext).tools;
        const summaries = tools.map(summarizeTool).sort((left, right) => left.name.localeCompare(right.name));
        const readOnly = summaries.filter((tool) => tool.readOnly);
        const boundedWrite = summaries.filter((tool) => tool.contract.mutation === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.destructive);
        const openWorld = summaries.filter((tool) => tool.openWorld);
        const broadInitialGrant = auth.scopesSupported.every((scope) => auth.initialScopes.includes(scope));
        const specificOutputSchemaCount = summaries.filter((tool) => tool.contract.outputClass === 'specific').length;
        const intentionalUntypedOutputCount = summaries.filter(
            (tool) => tool.contract.outputClass === 'intentional-untyped',
        ).length;
        const securityMetadataCount = summaries.filter(
            (tool) => Array.isArray(tool.securitySchemes) && tool.securitySchemes.length > 0,
        ).length;
        let wirePayloadAudit;
        try {
            wirePayloadAudit = await readCompactWirePayloadSummary(toolPayloadConfig, tools);
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
            idempotentReadCount: readOnly.filter((tool) => tool.contract.idempotency === 'idempotent').length,
            metadataCoverage: {
                outputSchemaPolicy: 'semantic-specific-or-intentional-untyped',
                specificOutputSchemaCount,
                intentionalUntypedOutputCount,
                outputContractCoverageCount: specificOutputSchemaCount + intentionalUntypedOutputCount,
                outputContractComplete: specificOutputSchemaCount + intentionalUntypedOutputCount === summaries.length,
                securityMetadataCount,
                securityComplete: securityMetadataCount === summaries.length,
            },
            rememberApprovalCandidates: boundedWrite
                .filter((tool) => tool.rememberApprovalCandidate && !requiresManualApproval(tool))
                .map((tool) => tool.name),
            destructiveTools: destructive.map((tool) => tool.name),
            openWorldTools: openWorld.map((tool) => tool.name),
            hostApprovalProfile: {
                oauthInitialScopeProfile: auth.initialScopeProfile,
                oauthInitialScopes: [...auth.initialScopes],
                oauthStepUpPreferred: auth.stepUpPreferred,
                oauthBroadInitialGrantCompatibility: broadInitialGrant,
                writeActionsMayStillPrompt: true,
                preferredStrategy:
                    'Use the direct bounded one-shot tool when intent is clear; use plan tools only when preview, escalation, or a separate approval boundary adds information.',
            },
            executionLimitsVersion: MCP_TOOL_EXECUTION_LIMITS_VERSION,
            executionLimits: MCP_TOOL_EXECUTION_LIMITS,
            descriptorObservation: readMcpDescriptorObservationState(),
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
});

/**
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function clampScore(value, max) {
    return Math.max(0, Math.min(max, Math.round(value)));
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpAutonomyPowerScoreTool = defineMcpRawTool({
    name: 'mcp_autonomy_power_score',
    title: 'MCP autonomy power score',
    description:
        'Return a deterministic autonomy score for the ChatGPT connector based on tool coverage, annotations, metadata, auth posture and validation readiness.',
    inputSchema: {},

    handler: async (_args, operationContext) => {
        const auth = requireMcpToolAuthConfig(operationContext);
        const tools = requireMcpToolSurface(operationContext).tools;
        const summaries = tools.map(summarizeTool);
        const readOnly = summaries.filter((tool) => tool.readOnly);
        const boundedWrite = summaries.filter((tool) => tool.contract.mutation === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.destructive);
        const openWorld = summaries.filter((tool) => tool.openWorld);
        const planOnly = summaries.filter((tool) => tool.name.endsWith('_plan') || tool.name.includes('_plan_'));
        const specificOutputSchemaCount = summaries.filter((tool) => tool.hasOutputSchema).length;
        const securityMetadataCoverage =
            summaries.length === 0
                ? 0
                : summaries.filter((tool) => Array.isArray(tool.securitySchemes) && tool.securitySchemes.length > 0)
                      .length / summaries.length;
        const broadInitialGrant = auth.scopesSupported.every((scope) => auth.initialScopes.includes(scope));
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
                      ? 10
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
        const authAdvisories = broadInitialGrant
            ? [
                  'OAuth uses the max-autonomy initial grant by default so the workspace does not spend round-trips on reauthorization. Per-tool required scopes and runtime authorization remain explicit contracts; host-side approval prompts are a separate client policy.',
              ]
            : auth.stepUpPreferred
              ? [
                    'OAuth is explicitly running in least-privilege mode and therefore expects per-tool step-up when broader authority is needed; this is opt-in for this workspace.',
                ]
              : [];
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
                initialScopeProfile: auth.initialScopeProfile,
                stepUpPreferred: auth.stepUpPreferred,
                broadInitialGrant,
                jwksUriConfigured: Boolean(auth.jwksUri),
                staticBearerConfigured: auth.staticBearerConfigured,
            },
            blockers,
            authAdvisories,
            nextActions:
                blockers.length === 0
                    ? ['Run mcp_golden_prompts in a real ChatGPT session and compare observed prompt friction.']
                    : blockers,
        });
    },
});
