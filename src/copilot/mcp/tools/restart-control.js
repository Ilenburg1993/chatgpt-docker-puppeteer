// @ts-check
/** Controlled MCP lifecycle preview, scheduling and persisted-state tools. @module copilot/mcp/tools/restart-control */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolReloadConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import {
    MCP_RELOAD_MAX_DELAY_MS,
    MCP_RELOAD_MIN_DELAY_MS,
    MCP_RELOAD_REQUEST_PROFILES,
    buildControlledMcpReloadPlan,
    readMcpReloadState,
    scheduleControlledMcpReload,
} from '#copilot/mcp/public/runtime/reload';
import { z } from 'zod';

const restartProfileSchema = z.enum(MCP_RELOAD_REQUEST_PROFILES);

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpReloadStatusTool = defineMcpRawTool({
    name: 'mcp_reload_status',
    title: 'Read MCP reload status',
    description: 'Read the fixed persisted state of the most recent controlled MCP reload request.',
    inputSchema: {},

    handler: async (_args, operationContext) => {
        const state = await readMcpReloadState(requireMcpToolWorkspace(operationContext));
        return okResult({ success: true, state }, JSON.stringify({ success: true, state }, null, 2));
    },
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpReloadScheduleTool = defineMcpRawTool({
    name: 'mcp_reload_schedule',
    title: 'Schedule controlled MCP reload',
    description:
        'Schedule an allowlisted detached MCP/tunnel restart only when the exact previously certified source manifest still verifies. No arbitrary command or environment override is accepted.',
    inputSchema: {
        profile: restartProfileSchema.optional(),
        delayMs: z.number().int().min(MCP_RELOAD_MIN_DELAY_MS).max(MCP_RELOAD_MAX_DELAY_MS).optional(),
        reason: z.string().max(240).optional(),
        dryRun: z
            .boolean()
            .optional()
            ['describe']('Preview the allowlisted reload plan without barrier verification or spawn.'),
        sourceBarrierManifest: z
            .string()
            .min(1)
            .max(1024)
            .optional()
            ['describe']('Apply-only: workspace-relative persisted source-barrier manifest from the validation gate.'),
        expectedSourceFingerprint: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional()
            ['describe']('Apply-only: exact SHA-256 source fingerprint returned by the validation gate.'),
        confirmRestart: z
            .literal(true)
            .optional()
            ['describe']('Apply-only: required to schedule the detached restart.'),
    },

    handler: async (
        { profile, delayMs, reason, dryRun, sourceBarrierManifest, expectedSourceFingerprint, confirmRestart },
        operationContext,
    ) => {
        const reloadConfig = requireMcpToolReloadConfig(operationContext);
        const plan = buildControlledMcpReloadPlan({
            config: reloadConfig,
            profile: profile ?? 'current',
            ...(delayMs === undefined ? {} : { delayMs }),
            reason: reason ?? null,
        });
        if (dryRun === true) {
            if (
                sourceBarrierManifest !== undefined ||
                expectedSourceFingerprint !== undefined ||
                confirmRestart !== undefined
            ) {
                return errorResult(
                    'sourceBarrierManifest, expectedSourceFingerprint and confirmRestart are apply-only fields.',
                    {
                        code: 'ERR_MCP_RELOAD_PREVIEW_FIELDS',
                    },
                );
            }
            return okResult({ ...plan, dryRun: true, scheduled: false }, JSON.stringify(plan, null, 2));
        }
        if (!sourceBarrierManifest || !expectedSourceFingerprint || confirmRestart !== true) {
            return errorResult(
                'sourceBarrierManifest, expectedSourceFingerprint and confirmRestart=true are required to schedule reload.',
                { code: 'ERR_MCP_RELOAD_CONFIRM_REQUIRED' },
            );
        }
        const workspace = requireMcpToolWorkspace(operationContext);
        const resolvedProfile = plan.resolvedProfile;
        const audit = requireMcpToolAuditCapability(operationContext);
        const scheduled = await scheduleControlledMcpReload({
            workspace,
            profile: resolvedProfile,
            delayMs: plan.delayMs,
            reason: plan.reason,
            runnerEnvironment: reloadConfig.runnerEnvironment,
            sourceBarrierManifestPath: sourceBarrierManifest,
            expectedSourceFingerprint,
            audit,
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
        const { requestId, acceptedAt, runnerPid } = scheduled;
        await audit.append({
            event: 'mcp_reload_scheduled',
            tool: 'mcp_reload_schedule',
            requestId,
            profile: resolvedProfile,
            delayMs: plan.delayMs,
            currentPid: plan.currentPid,
            sourceBarrierManifestPath: scheduled.sourceBarrierManifestPath,
            sourceBarrierFingerprint: scheduled.sourceBarrierFingerprint,
        });
        const result = {
            ...plan,
            scheduled: true,
            requestId,
            acceptedAt,
            runnerPid,
            sourceBarrierManifestPath: scheduled.sourceBarrierManifestPath,
            sourceBarrierFingerprint: scheduled.sourceBarrierFingerprint,
        };
        return okResult(
            result,
            `MCP reload ${requestId} scheduled in ${String(plan.delayMs)}ms using ${resolvedProfile}; this response returns before restart.`,
        );
    },
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const mcpReloadTools = [mcpReloadStatusTool, mcpReloadScheduleTool];
