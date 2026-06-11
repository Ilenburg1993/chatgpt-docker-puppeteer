// @ts-check
/**
 * Controlled MCP lifecycle planning tool.
 *
 * This tool intentionally starts as plan-first: dryRun is the default and real execution requires a follow-up patchable
 * runner path. It never accepts arbitrary shell or user-provided commands.
 *
 * @module copilot/mcp/tools/restart-control
 */

import process from 'node:process';
import { z } from 'zod';
import { boundedWriteAnnotations, errorResult, okResult } from '#copilot/mcp/control-plane';

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const DEFAULT_DELAY_MS = 2500;
const RESTART_RUNNER_PID_FILE = 'src/copilot/.ai/mcp/mcp-restart-runner.pid';
const RESTART_RUNNER_LOG_FILE = 'src/copilot/.ai/mcp/mcp-restart-runner.log';
const restartProfileSchema = z.enum(['current', 'quic', 'h2', 'auto']);

/** @param {unknown} value @returns {number} */
function normalizeDelayMs(value) {
    const raw = Number(value ?? DEFAULT_DELAY_MS);
    return Number.isFinite(raw) ? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.trunc(raw))) : DEFAULT_DELAY_MS;
}

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpRestartServerTool = {
    name: 'mcp_restart_server',
    title: 'Plan MCP restart',
    description:
        'Plan a controlled restart of the managed MCP HTTP origin plus Cloudflare tunnel. Dry-run by default; the executable runner remains guarded by explicit implementation and validation.',
    inputSchema: {
        dryRun: z.boolean().optional().describe('Preview the restart plan without scheduling it. Default: true.'),
        confirmRestart: z.boolean().optional().describe('Reserved for future executable mode; ignored while runner is disabled.'),
        profile: restartProfileSchema.optional().describe('Restart profile. current uses current env; quic/h2/auto force tunnel transport.'),
        delayMs: z.number().int().min(MIN_DELAY_MS).max(MAX_DELAY_MS).optional().describe('Delay before restart so this tool can return first. Default 2500.'),
        reason: z.string().max(240).optional().describe('Optional operator reason recorded in the plan.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ dryRun, confirmRestart, profile, delayMs, reason }) => {
        const effectiveProfile = profile ?? 'current';
        const effectiveDelayMs = normalizeDelayMs(delayMs);
        const requestId = `mcp-restart-${Date.now().toString(36)}`;
        const plan = {
            success: true,
            dryRun: dryRun !== false,
            executable: false,
            scheduled: false,
            requestId,
            profile: effectiveProfile,
            delayMs: effectiveDelayMs,
            pidFile: RESTART_RUNNER_PID_FILE,
            logFile: RESTART_RUNNER_LOG_FILE,
            command: process.execPath,
            args: ['src/copilot/mcp/tools/restart-control.js', '--profile', effectiveProfile, '--delay-ms', String(effectiveDelayMs), '--request-id', requestId],
            requiredConfirmation: 'confirmRestart=true and executable runner support',
            expectedFollowUp: ['mcp_post_restart_readiness', 'mcp_connector_smoke_refresh', 'mcp_runtime_health'],
            reason: reason ?? null,
        };
        if (dryRun === false && confirmRestart === true) {
            return errorResult('Executable restart scheduling is intentionally disabled until the detached runner passes host review.', {
                code: 'ERR_MCP_RESTART_RUNNER_DISABLED',
                plan,
            });
        }
        return okResult(plan, 'MCP restart plan generated; no restart scheduled.');
    },
};
