// @ts-check
/**
 * Controlled MCP lifecycle planning tool.
 *
 * This tool intentionally starts as plan-first: dryRun is the default and real execution requires a follow-up patchable
 * runner path. It never accepts arbitrary shell or user-provided commands.
 *
 * @module copilot/mcp/tools/restart-control
 */

// @ts-check
/**
 * Controlled MCP lifecycle planning tool.
 *
 * This tool intentionally starts as plan-first: dryRun is the default and real execution requires a follow-up patchable
 * runner path. It never accepts arbitrary shell or user-provided commands.
 *
 * @module copilot/mcp/tools/restart-control
 */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
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
export const mcpReloadPlanTool = defineMcpRawTool({
    name: 'mcp_reload_plan',
    title: 'Plan controlled MCP reload',
    description:
        'Plan a detached restart of the managed MCP HTTP origin plus Cloudflare tunnel using only allowlisted transport profiles.',
    inputSchema: {
        profile: restartProfileSchema
            .optional()
            ['describe']('Default current. quic/h2/auto are the only executable profiles.'),
        delayMs: z.number().int().min(MCP_RELOAD_MIN_DELAY_MS).max(MCP_RELOAD_MAX_DELAY_MS).optional(),
        reason: z.string().max(240).optional(),
    },

    handler: async ({ profile, delayMs, reason }, operationContext) => {
        const reloadConfig = requireMcpToolReloadConfig(operationContext);
        const plan = buildControlledMcpReloadPlan({
            config: reloadConfig,
            profile: profile ?? 'current',
            ...(delayMs === undefined ? {} : { delayMs }),
            reason: reason ?? null,
        });
        return okResult(plan, JSON.stringify(plan, null, 2));
    },
});

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
        'Schedule an allowlisted detached MCP/tunnel restart after this tool response is returned. No arbitrary command, path or environment override is accepted.',
    inputSchema: {
        profile: restartProfileSchema.optional(),
        delayMs: z.number().int().min(MCP_RELOAD_MIN_DELAY_MS).max(MCP_RELOAD_MAX_DELAY_MS).optional(),
        reason: z.string().max(240).optional(),
        confirmRestart: z.literal(true),
    },

    handler: async ({ profile, delayMs, reason }, operationContext) => {
        const workspace = requireMcpToolWorkspace(operationContext);
        const reloadConfig = requireMcpToolReloadConfig(operationContext);
        const plan = buildControlledMcpReloadPlan({
            config: reloadConfig,
            profile: profile ?? 'current',
            ...(delayMs === undefined ? {} : { delayMs }),
            reason: reason ?? null,
        });
        const resolvedProfile = plan.resolvedProfile;
        const scheduled = await scheduleControlledMcpReload({
            workspace,
            profile: resolvedProfile,
            delayMs: plan.delayMs,
            reason: plan.reason,
            runnerEnvironment: reloadConfig.runnerEnvironment,
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
        const { requestId, acceptedAt, runnerPid } = scheduled;
        await requireMcpToolAuditCapability(operationContext).append({
            event: 'mcp_reload_scheduled',
            tool: 'mcp_reload_schedule',
            requestId,
            profile: resolvedProfile,
            delayMs: plan.delayMs,
            currentPid: plan.currentPid,
        });
        const result = { ...plan, scheduled: true, requestId, acceptedAt, runnerPid };
        return okResult(
            result,
            `MCP reload ${requestId} scheduled in ${String(plan.delayMs)}ms using ${resolvedProfile}; this response returns before restart.`,
        );
    },
});

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const mcpReloadTools = [mcpReloadPlanTool, mcpReloadStatusTool, mcpReloadScheduleTool];
