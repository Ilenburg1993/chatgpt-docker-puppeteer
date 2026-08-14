// @ts-check
/**
 * Controlled MCP lifecycle planning tool.
 *
 * This tool intentionally starts as plan-first: dryRun is the default and real execution requires a follow-up patchable
 * runner path. It never accepts arbitrary shell or user-provided commands.
 *
 * @module copilot/mcp/tools/restart-control
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { z } from 'zod';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import {
    appendMcpAuditEvent,
    boundedWriteAnnotations,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const DEFAULT_DELAY_MS = 2500;
const RELOAD_STATE_FILE = 'src/copilot/.ai/mcp/mcp-reload-state.json';
const RESTART_RUNNER = 'src/copilot/mcp/scripts/scheduled-restart-runner.js';
const restartProfileSchema = z.enum(['current', 'quic', 'h2', 'auto']);
const workspaceIo = createWorkspaceIo({ workspaceRoot: getMcpWorkspaceRoot() });

/** @param {unknown} value @returns {number} */
function normalizeDelayMs(value) {
    const raw = Number(value ?? DEFAULT_DELAY_MS);
    return Number.isFinite(raw) ? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.trunc(raw))) : DEFAULT_DELAY_MS;
}

/** @param {string | undefined} requested */
function resolveRestartProfile(requested) {
    if (requested && requested !== 'current') return requested;
    const current = String(
        process.env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? process.env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'quic',
    )
        .trim()
        .toLowerCase();
    return current === 'h2' || current === 'auto' || current === 'quic' ? current : 'quic';
}

/** @param {string} profile @param {number} delayMs @param {string | null} reason */
function buildReloadPlan(profile, delayMs, reason) {
    return {
        success: true,
        executable: true,
        scheduled: false,
        requestedProfile: profile,
        resolvedProfile: resolveRestartProfile(profile),
        delayMs,
        stateFile: RELOAD_STATE_FILE,
        runner: RESTART_RUNNER,
        currentPid: process.pid,
        reason,
        safety: {
            arbitraryShell: false,
            arbitraryCommand: false,
            arbitraryPath: false,
            allowedProfiles: ['quic', 'h2', 'auto'],
            responseBeforeRestart: true,
        },
        expectedFollowUp: [
            'mcp_reload_status',
            'mcp_post_restart_readiness',
            'mcp_connector_smoke_refresh',
            'mcp_runtime_health',
        ],
    };
}

async function readReloadState() {
    try {
        const file = await workspaceIo.readText(RELOAD_STATE_FILE);
        const parsed = JSON.parse(file.content);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return null;
        return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
    }
}

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpReloadPlanTool = {
    name: 'mcp_reload_plan',
    title: 'Plan controlled MCP reload',
    description:
        'Plan a detached restart of the managed MCP HTTP origin plus Cloudflare tunnel using only allowlisted transport profiles.',
    inputSchema: {
        profile: restartProfileSchema.optional().describe('Default current. quic/h2/auto are the only executable profiles.'),
        delayMs: z.number().int().min(MIN_DELAY_MS).max(MAX_DELAY_MS).optional(),
        reason: z.string().max(240).optional(),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ profile, delayMs, reason }) => {
        const plan = buildReloadPlan(profile ?? 'current', normalizeDelayMs(delayMs), reason ?? null);
        return okResult(plan, JSON.stringify(plan, null, 2));
    },
};

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpReloadStatusTool = {
    name: 'mcp_reload_status',
    title: 'Read MCP reload status',
    description: 'Read the fixed persisted state of the most recent controlled MCP reload request.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const state = await readReloadState();
        return okResult({ success: true, state }, JSON.stringify({ success: true, state }, null, 2));
    },
};

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpReloadScheduleTool = {
    name: 'mcp_reload_schedule',
    title: 'Schedule controlled MCP reload',
    description:
        'Schedule an allowlisted detached MCP/tunnel restart after this tool response is returned. No arbitrary command, path or environment override is accepted.',
    inputSchema: {
        profile: restartProfileSchema.optional(),
        delayMs: z.number().int().min(MIN_DELAY_MS).max(MAX_DELAY_MS).optional(),
        reason: z.string().max(240).optional(),
        confirmRestart: z.literal(true),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ profile, delayMs, reason }) => {
        const plan = buildReloadPlan(profile ?? 'current', normalizeDelayMs(delayMs), reason ?? null);
        const resolvedProfile = /** @type {string} */ (plan.resolvedProfile);
        const requestId = `mcp-reload-${randomUUID()}`;
        const acceptedAt = Date.now();
        await workspaceIo.writeFileAtomic(
            RELOAD_STATE_FILE,
            `${JSON.stringify(
                {
                    schemaVersion: 1,
                    status: 'accepted',
                    acceptedAt,
                    requestId,
                    profile: resolvedProfile,
                    delayMs: plan.delayMs,
                    reason: plan.reason,
                    requestedByPid: process.pid,
                },
                null,
                2,
            )}\n`,
        );
        const child = spawn(
            process.execPath,
            [
                RESTART_RUNNER,
                '--profile',
                resolvedProfile,
                '--delay-ms',
                String(plan.delayMs),
                '--request-id',
                requestId,
            ],
            {
                cwd: getMcpWorkspaceRoot(),
                env: process.env,
                detached: true,
                stdio: 'ignore',
            },
        );
        child.unref();
        await appendMcpAuditEvent({
            event: 'mcp_reload_scheduled',
            tool: 'mcp_reload_schedule',
            requestId,
            profile: resolvedProfile,
            delayMs: plan.delayMs,
            currentPid: process.pid,
        });
        const result = { ...plan, scheduled: true, requestId, acceptedAt, runnerPid: child.pid ?? null };
        return okResult(
            result,
            `MCP reload ${requestId} scheduled in ${String(plan.delayMs)}ms using ${resolvedProfile}; this response returns before restart.`,
        );
    },
};

/** @type {import('../registry.js').McpToolDefinition[]} */
export const mcpReloadTools = [mcpReloadPlanTool, mcpReloadStatusTool, mcpReloadScheduleTool];
