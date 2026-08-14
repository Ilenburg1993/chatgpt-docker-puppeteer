// @ts-check
/**
 * Allowlisted local delegation runner for ChatGPT MCP.
 *
 * @module copilot/mcp/tools/delegation-runner
 */

import { z } from 'zod';
import {
    boundedWriteAnnotations,
    errorResult,
    normalizeFocusedUnitTestFiles,
    okResult,
    readMcpMetricsSnapshot,
    spawnValidatorJob,
} from '#copilot/mcp/control-plane';
import { buildMcpCapabilitiesSummary } from './meta.js';
import { repoStatusHandler } from './repo-status.js';
import { mcpSmokeWorkspaceTool } from './smoke-workspace.js';

const missionSchema = z.enum([
    'diagnose-mcp',
    'validate-focused',
    'validate-mcp-full',
    'maintenance-safe-dry-run',
]);

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
    if (mission === 'validate-focused') {
        return [
            { step: 'run_copilot_validator', effect: 'Start one unit-focused validator job for an explicit Copilot test file.' },
            { step: 'job_get_summary', effect: 'Caller reads compact focused-job status.' },
        ];
    }
    if (mission === 'validate-mcp-full') {
        return [
            { step: 'mcp_run_safe_validation_suite', effect: 'Start suite-mcp-full only as explicit broad escalation.' },
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
    description: 'Run or dry-run a fixed local autonomy mission; no arbitrary shell, paths, or destructive actions.',
    inputSchema: {
        mission: missionSchema.describe('Fixed mission; prefer validate-focused for localized validation.'),
        testFile: z
            .string()
            .min(1)
            .max(1024)
            .optional()
            .describe('Explicit Copilot .spec.js path for validate-focused.'),
        dryRun: z.boolean().optional().describe('Plan only. Default: true.'),
        timeoutMs: z.number().int().min(1000).max(3600000).optional().describe('Validator timeout ms.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ mission, testFile, dryRun, timeoutMs }) => {
        const selectedMission = String(mission);
        const isFocused = selectedMission === 'validate-focused';
        const isDryRun = dryRun !== false;
        /** @type {string | null} */
        let focusedTestFile = null;
        if (isFocused) {
            if (!testFile) {
                return errorResult('validate-focused requires testFile.', {
                    code: 'ERR_FOCUSED_TEST_FILE_REQUIRED',
                    hint: 'Pass one explicit tests/unit/copilot/**/*.spec.js path.',
                });
            }
            try {
                focusedTestFile = normalizeFocusedUnitTestFiles([testFile])[0] ?? null;
            } catch (error) {
                return errorResult('Invalid focused test file.', {
                    code: 'ERR_INVALID_FOCUSED_TEST_FILE',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } else if (testFile) {
            return errorResult('testFile is valid only with validate-focused.', {
                code: 'ERR_UNEXPECTED_FOCUSED_TEST_FILE',
            });
        }
        const plan = buildMissionPlan(selectedMission);

        if (isDryRun) {
            return okResult({
                success: true,
                mission: selectedMission,
                ...(focusedTestFile ? { testFile: focusedTestFile } : {}),
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

        if (selectedMission === 'validate-focused') {
            if (!focusedTestFile) {
                return errorResult('Focused test file was not resolved.', {
                    code: 'ERR_FOCUSED_TEST_FILE_REQUIRED',
                });
            }
            const job = await spawnValidatorJob('unit-focused', {
                testFiles: [focusedTestFile],
                ...(timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) }),
            });
            return okResult({
                success: true,
                mission: selectedMission,
                testFile: focusedTestFile,
                dryRun: false,
                executed: true,
                plan,
                job,
                nextStep: 'Use job_get_summary with job.id; read a small job_get_output tail only on failure.',
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
