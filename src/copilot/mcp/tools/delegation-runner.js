// @ts-check
/**
 * Allowlisted local delegation runner for ChatGPT MCP.
 *
 * @module copilot/mcp/tools/delegation-runner
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { z } from 'zod';
import {
    TRANSPORT_BENCHMARK_STATE_PATH,
    readCloudflareTunnelConfig,
} from '#copilot/mcp/cloudflare';
import {
    IO_CACHE_BENCHMARK_STATE_PATH,
    appendMcpAuditEvent,
    boundedWriteAnnotations,
    errorResult,
    getMcpWorkspaceRoot,
    normalizeFocusedUnitTestFiles,
    okResult,
    readMcpMetricsSnapshot,
    spawnValidatorJob,
} from '#copilot/mcp/control-plane';
import { buildMcpCapabilitiesSummary } from './meta.js';
import { repoStatusHandler } from './repo-status.js';
import { mcpSmokeWorkspaceTool } from './smoke-workspace.js';

const TRANSPORT_BENCHMARK_RUNNER = 'src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js';
const IO_CACHE_BENCHMARK_RUNNER = 'src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js';
const missionSchema = z.enum([
    'diagnose-mcp',
    'validate-focused',
    'benchmark-io-cache',
    'benchmark-transport',
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
    if (mission === 'benchmark-io-cache') {
        return [
            { step: 'mcp_runtime_health', effect: 'Read current IO-cache posture and last persisted representative benchmark.' },
            { step: 'scheduled_io_cache_benchmark_runner', effect: 'Detached runner measures cold/L1/L2 in isolated child processes and temporary SQLite.' },
            { step: 'mcp_runtime_health', effect: 'Read persisted benchmark evidence and evidence-aware cache plan.' },
        ];
    }
    if (mission === 'benchmark-transport') {
        return [
            { step: 'mcp_cloudflare_transport_benchmark_plan', effect: 'Read the fixed benchmark design and last persisted run.' },
            { step: 'scheduled_transport_benchmark_runner', effect: 'Detached runner measures quic/auto/http2 and restores the initial control.' },
            { step: 'mcp_cloudflare_transport_benchmark_plan', effect: 'Read persisted comparison after the runner completes.' },
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

        if (selectedMission === 'benchmark-io-cache') {
            const requestId = `mcp-io-cache-benchmark-${randomUUID()}`;
            const child = spawn(process.execPath, [IO_CACHE_BENCHMARK_RUNNER, '--request-id', requestId], {
                cwd: getMcpWorkspaceRoot(),
                env: process.env,
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            await appendMcpAuditEvent({
                event: 'mcp_io_cache_benchmark_scheduled',
                tool: 'delegate_to_repo_autonomy_runner',
                requestId,
                runnerPid: child.pid ?? null,
            });
            return okResult({
                success: true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                scheduled: true,
                plan,
                requestId,
                stateFile: IO_CACHE_BENCHMARK_STATE_PATH,
                runnerPid: child.pid ?? null,
                autoEnable: false,
                isolatedDb: true,
                nextStep: 'Use mcp_runtime_health to read persisted benchmark evidence; do not enable L2 automatically.',
            });
        }

        if (selectedMission === 'benchmark-transport') {
            const config = readCloudflareTunnelConfig();
            const controlProfile = config.transportProtocol;
            const requestId = `mcp-transport-benchmark-${randomUUID()}`;
            const child = spawn(
                process.execPath,
                [
                    TRANSPORT_BENCHMARK_RUNNER,
                    '--request-id',
                    requestId,
                    '--control-profile',
                    controlProfile,
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
                event: 'mcp_transport_benchmark_scheduled',
                tool: 'delegate_to_repo_autonomy_runner',
                requestId,
                controlProfile,
                runnerPid: child.pid ?? null,
            });
            return okResult({
                success: true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                scheduled: true,
                plan,
                requestId,
                controlProfile,
                stateFile: TRANSPORT_BENCHMARK_STATE_PATH,
                runnerPid: child.pid ?? null,
                autoPromotion: false,
                note: 'The detached runner may cause transient connector interruptions while switching profiles; it always attempts to restore the initial control.',
                nextStep: 'After the runner settles, call mcp_cloudflare_transport_benchmark_plan to read the persisted run and comparison.',
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
