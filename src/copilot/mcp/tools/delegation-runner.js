// @ts-check
/**
 * Allowlisted local delegation runner for ChatGPT MCP.
 *
 * @module copilot/mcp/tools/delegation-runner
 */

import { z } from 'zod';
import { boundedWriteAnnotations, okResult, readMcpMetricsSnapshot, spawnValidatorJob } from '#copilot/mcp/control-plane';
import { buildMcpCapabilitiesSummary } from './meta.js';
import { repoStatusHandler } from './repo-status.js';
import { mcpSmokeWorkspaceTool } from './smoke-workspace.js';

const missionSchema = z.enum(['diagnose-mcp', 'validate-mcp-full', 'maintenance-safe-dry-run']);

/**
 * @param {string} mission
 * @returns {Record<string, unknown>[]}
 */
function buildMissionPlan(mission) {
    if (mission === 'diagnose-mcp') {
        return [
            { step: 'repo_status', effect: 'Read workspace git status.' },
            { step: 'mcp_capabilities_summary', effect: 'Read canonical capability groups.' },
            { step: 'mcp_smoke_workspace', effect: 'Run read-only MCP smoke checks.' },
            { step: 'mcp_runtime_health', effect: 'Read in-process MCP metrics.' },
        ];
    }
    if (mission === 'validate-mcp-full') {
        return [
            { step: 'mcp_run_safe_validation_suite', effect: 'Start suite-mcp-full validator job.' },
            {
                step: 'mcp_validation_dashboard',
                effect: 'Caller reads compact validation status after the suite starts.',
            },
            { step: 'job_get_summary', effect: 'Caller inspects compact job status before any log tail.' },
        ];
    }
    return [
        { step: 'repo_status', effect: 'Read workspace git status.' },
        { step: 'mcp_capabilities_summary', effect: 'Read canonical capability groups.' },
        { step: 'mcp_smoke_workspace', effect: 'Plan read-only smoke; not executed in dry-run mission.' },
    ];
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const delegateToRepoAutonomyRunnerTool = {
    name: 'delegate_to_repo_autonomy_runner',
    title: 'Delegate to repo autonomy runner',
    description:
        'Run or dry-run a fixed local autonomy workflow without arbitrary shell, arbitrary paths, or direct destructive actions.',
    inputSchema: {
        mission: missionSchema.describe(
            'Allowlisted mission: diagnose-mcp, validate-mcp-full, or maintenance-safe-dry-run.',
        ),
        dryRun: z
            .boolean()
            .optional()
            .describe('Return the execution plan without running write-like steps. Default: true.'),
        timeoutMs: z
            .number()
            .int()
            .min(1000)
            .max(3600000)
            .optional()
            .describe('Optional timeout for validator job missions.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ mission, dryRun, timeoutMs }) => {
        const selectedMission = String(mission);
        const isDryRun = dryRun !== false;
        const plan = buildMissionPlan(selectedMission);

        if (isDryRun) {
            return okResult({
                success: true,
                mission: selectedMission,
                dryRun: true,
                executed: false,
                plan,
                constraints: {
                    arbitraryShell: false,
                    arbitraryPaths: false,
                    destructiveActions: false,
                },
            });
        }

        if (selectedMission === 'diagnose-mcp') {
            const status = await repoStatusHandler();
            const smoke = await mcpSmokeWorkspaceTool.handler({});
            return okResult({
                success:
                    status.structuredContent?.['success'] === true && smoke.structuredContent?.['success'] === true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                plan,
                results: {
                    status: status.structuredContent,
                    capabilities: buildMcpCapabilitiesSummary(),
                    smoke: smoke.structuredContent,
                    metrics: readMcpMetricsSnapshot(),
                },
            });
        }

        if (selectedMission === 'validate-mcp-full') {
            const job = await spawnValidatorJob(
                'suite-mcp-full',
                timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) },
            );
            return okResult({
                success: true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                plan,
                job,
                nextStep:
                    'Use mcp_validation_dashboard, then job_get_summary with the returned job.id; use job_get_output only for a small failure tail.',
            });
        }

        const status = await repoStatusHandler();
        return okResult({
            success: status.structuredContent?.['success'] === true,
            mission: selectedMission,
            dryRun: false,
            executed: true,
            plan,
            results: {
                status: status.structuredContent,
                capabilities: buildMcpCapabilitiesSummary(),
                metrics: readMcpMetricsSnapshot(),
            },
            note: 'maintenance-safe-dry-run intentionally avoids mutation even when dryRun=false.',
        });
    },
};
