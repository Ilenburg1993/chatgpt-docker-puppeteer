// @ts-check
/**
 * Allowlisted local delegation runner for ChatGPT MCP.
 *
 * @module copilot/mcp/tools/delegation-runner
 */

import {
    TRANSPORT_BENCHMARK_STATE_PATH,
    spawnCloudflareTransportBenchmark,
} from '#copilot/mcp/public/cloudflare/transport-benchmark';
import { scheduleIoCacheBenchmark } from '#copilot/mcp/public/diagnostics/io-cache';
import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolCloudflareConfig,
    requireMcpToolCloudflareEnvironmentAuthority,
    requireMcpToolGitConfig,
    requireMcpToolIoCacheConfig,
    requireMcpToolValidationConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { normalizeFocusedUnitTestFiles, spawnValidatorJob } from '#copilot/mcp/public/validation';
import { readRepositoryStatus } from '#copilot/mcp/public/workspace/repository/status';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildMcpCapabilitiesSummary } from './meta.js';

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
            {
                step: 'run_copilot_validator',
                effect: 'Start one unit-focused validator job for an explicit Copilot test file.',
            },
            { step: 'job_get_summary', effect: 'Caller reads compact focused-job status.' },
        ];
    }
    if (mission === 'benchmark-io-cache') {
        return [
            {
                step: 'mcp_runtime_health',
                effect: 'Read current IO-cache posture and last persisted representative benchmark.',
            },
            {
                step: 'scheduled_io_cache_benchmark_runner',
                effect: 'Detached runner measures cold/L1/L2 in isolated child processes and temporary SQLite.',
            },
            { step: 'mcp_runtime_health', effect: 'Read persisted benchmark evidence and evidence-aware cache plan.' },
        ];
    }
    if (mission === 'benchmark-transport') {
        return [
            {
                step: 'mcp_cloudflare_metrics_snapshot view=transport-plan',
                effect: 'Read the fixed benchmark design and last persisted run.',
            },
            {
                step: 'scheduled_transport_benchmark_runner',
                effect: 'Detached runner measures quic/auto/http2 and restores the initial control.',
            },
            {
                step: 'mcp_cloudflare_metrics_snapshot view=transport-plan',
                effect: 'Read persisted comparison after the runner completes.',
            },
        ];
    }
    if (mission === 'validate-mcp-full') {
        return [
            {
                step: 'mcp_run_safe_validation_suite',
                effect: 'Start suite-mcp-full only as explicit broad escalation.',
            },
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
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const delegateToRepoAutonomyRunnerTool = defineMcpRawTool({
    name: 'delegate_to_repo_autonomy_runner',
    title: 'Delegate to repo autonomy runner',
    description: 'Run or dry-run a fixed local autonomy mission; no arbitrary shell, paths, or destructive actions.',
    inputSchema: {
        mission: missionSchema['describe']('Fixed mission; prefer validate-focused for localized validation.'),
        testFile: z
            .string()
            .min(1)
            .max(1024)
            .optional()
            ['describe']('Explicit Copilot .spec.js path for validate-focused.'),
        dryRun: z.boolean().optional()['describe']('Plan only. Default: true.'),
        timeoutMs: z.number().int().min(1000).max(3600000).optional()['describe']('Validator timeout ms.'),
    },

    handler: async ({ mission, testFile, dryRun, timeoutMs }, operationContext) => {
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

        const workspace = requireMcpToolWorkspace(operationContext);

        if (selectedMission === 'diagnose-mcp') {
            const gitConfig = requireMcpToolGitConfig(operationContext);
            const status = await readRepositoryStatus({
                workspaceRoot: workspace.workspaceRoot,
                gitConfig,
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
            const smoke = await runMcpWorkspaceSmoke(workspace, requireMcpToolCloudflareConfig(operationContext), {
                gitConfig,
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
            return okResult({
                success: status.success === true && smoke.success === true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                plan,
                results: {
                    status,
                    capabilities: buildMcpCapabilitiesSummary(),
                    smoke,
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
                workspace,
                config: requireMcpToolValidationConfig(operationContext),
                testFiles: [focusedTestFile],
                ...(timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) }),
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
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
            const ioCacheConfig = requireMcpToolIoCacheConfig(operationContext);
            const scheduled = await scheduleIoCacheBenchmark({
                workspaceRoot: workspace.workspaceRoot,
                runnerEnvironment: ioCacheConfig.runnerEnvironment,
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
            await requireMcpToolAuditCapability(operationContext).append({
                event: 'mcp_io_cache_benchmark_scheduled',
                tool: 'delegate_to_repo_autonomy_runner',
                requestId: scheduled.requestId,
                runnerPid: scheduled.runnerPid,
            });
            return okResult({
                success: true,
                mission: selectedMission,
                dryRun: false,
                executed: true,
                scheduled: true,
                plan,
                requestId: scheduled.requestId,
                stateFile: scheduled.stateFile,
                runnerPid: scheduled.runnerPid,
                autoEnable: false,
                isolatedDb: true,
                nextStep:
                    'Use mcp_runtime_health to read persisted benchmark evidence; do not enable L2 automatically.',
            });
        }

        if (selectedMission === 'benchmark-transport') {
            const config = requireMcpToolCloudflareConfig(operationContext);
            const controlProfile = config.transportProtocol;
            const requestId = `mcp-transport-benchmark-${randomUUID()}`;
            const { runnerPid } = await spawnCloudflareTransportBenchmark({
                requestId,
                controlProfile,
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
            await requireMcpToolAuditCapability(operationContext).append({
                event: 'mcp_transport_benchmark_scheduled',
                tool: 'delegate_to_repo_autonomy_runner',
                requestId,
                controlProfile,
                runnerPid,
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
                runnerPid,
                autoPromotion: false,
                note: 'The detached runner may cause transient connector interruptions while switching profiles; it always attempts to restore the initial control.',
                nextStep:
                    'After the runner settles, call mcp_cloudflare_metrics_snapshot view=transport-plan to read the persisted run and comparison.',
            });
        }

        if (selectedMission === 'validate-mcp-full') {
            const job = await spawnValidatorJob('suite-mcp-full', {
                workspace,
                config: requireMcpToolValidationConfig(operationContext),
                ...(timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) }),
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
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

        const status = await readRepositoryStatus({
            workspaceRoot: workspace.workspaceRoot,
            gitConfig: requireMcpToolGitConfig(operationContext),
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
        return okResult({
            success: status.success === true,
            mission: selectedMission,
            dryRun: false,
            executed: true,
            plan,
            results: {
                status,
                capabilities: buildMcpCapabilitiesSummary(),
                metrics: readMcpMetricsSnapshot(),
            },
            note: 'maintenance-safe-dry-run intentionally avoids mutation even when dryRun=false.',
        });
    },
});
