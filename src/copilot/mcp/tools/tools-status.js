// @ts-check
/**
 * MCP tool-surface status for ChatGPT autonomy planning.
 *
 * @module copilot/mcp/tools/tools-status
 */

import { buildToolPayloadAudit } from '#copilot/mcp/public/diagnostics/tool-payload';
import { classifyMcpToolContractRisk, readMcpDescriptorObservationState } from '#copilot/mcp/public/protocol/catalog';
import {
    MCP_TOOL_EXECUTION_LIMITS,
    MCP_TOOL_EXECUTION_LIMITS_VERSION,
    requireMcpToolAuthConfig,
    requireMcpToolPayloadAuditConfig,
    requireMcpToolSurface,
} from '#copilot/mcp/public/protocol/tools';
import { readMcpToolOptionContractCoverage } from '#copilot/mcp/public/tools/catalog/option-contracts';
import { MCP_TOOL_CONTRACTS_VERSION } from '#copilot/mcp/public/tools/catalog/semantic-contracts';
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
 * Build the explicit heavy/status projection used by mcp_capabilities_summary view=status.
 * The tools/list payload summary remains cached per process configuration.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 */
export async function readMcpToolsStatus(operationContext) {
    const auth = requireMcpToolAuthConfig(operationContext);
    const toolPayloadConfig = requireMcpToolPayloadAuditConfig(operationContext);
    const toolSurface = requireMcpToolSurface(operationContext);
    const tools = toolSurface.tools;
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
    const optionContractCoverage = readMcpToolOptionContractCoverage();
    const descriptorRevisionProfile = {
        authority: 'canonical-tool-contract-version+registry-tools-list-wire-fingerprint',
        semanticContractVersion: MCP_TOOL_CONTRACTS_VERSION,
        globalFingerprint: toolSurface.descriptorFingerprint ?? null,
        fingerprintKind: toolSurface.descriptorFingerprintKind ?? null,
        semanticProfileToken: `option-contract:${optionContractCoverage.version}`,
        semanticProfileMeaning:
            'Policy/normalization generation for enrolled options; it is not an input knob and does not by itself imply tools/list schema churn.',
        coveredToolRevisions: optionContractCoverage.toolNames.map((name) => ({
            name,
            revisionToken: toolSurface.toolDescriptorRevisionTokens?.[name] ?? null,
        })),
    };
    return {
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
        toolSurfaceLifecycle: {
            defaultAdvertisement: 'full',
            selection: 'process-generation-static',
            reducedProfiles: 'explicit-opt-in',
            serverDiscoverRole: 'server-versions-and-capabilities',
            toolsListRole: 'tool-descriptor-catalog',
            toolsListCache: 'private-fingerprint-partitioned',
            progressiveToolDiscovery: false,
            chatgptActionSnapshot: 'external-refresh-review-lifecycle',
            note: 'MCP server/discover, tools/list cache hints and list_changed do not by themselves update ChatGPT approved actions; descriptor changes still require the host Refresh/review lifecycle.',
        },
        hostApprovalProfile: {
            oauthInitialScopeProfile: auth.initialScopeProfile,
            oauthInitialScopes: [...auth.initialScopes],
            oauthStepUpPreferred: auth.stepUpPreferred,
            oauthBroadInitialGrantCompatibility: broadInitialGrant,
            writeActionsMayStillPrompt: true,
            preferredStrategy:
                'Use the direct bounded one-shot tool when intent is clear; prefer its dryRun/preview mode when available, and use a separate plan tool only when it provides distinct functionality.',
        },
        executionLimitsVersion: MCP_TOOL_EXECUTION_LIMITS_VERSION,
        executionLimits: MCP_TOOL_EXECUTION_LIMITS,
        descriptorObservation: readMcpDescriptorObservationState(),
        descriptorRevisionProfile,
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
            avoidRoutineSequence: ['git_stage', 'git_commit', 'git_push'],
        },
        approvalFrictionProfile: buildApprovalFrictionProfile(summaries),
        wirePayloadAudit,
        detailsTool: 'mcp_capabilities_summary',
    };
}
