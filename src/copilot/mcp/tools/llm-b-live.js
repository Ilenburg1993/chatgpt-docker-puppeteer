// @ts-check
/**
 * Allowlisted MCP adapters for the canonical terminal LLM-B live harness.
 *
 * These tools never accept arbitrary commands or script paths. Readiness/runs are read-only. The live runner defaults
 * to a control-only terminal boot; any mode capable of opening a real model/provider turn requires explicit
 * confirmation.
 *
 * @module copilot/mcp/tools/llm-b-live
 */

import {
    DETACHED_LIVE_RUN_ID_RE,
    MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS,
    buildModelGatewayLiveRunPlan,
    cancelDetachedLiveRun,
    executeModelGatewayLiveReadiness,
    inspectDetachedLiveRunCompletion,
    readDetachedLiveRunManifestById,
    readModelGatewayPersistedLiveRuns,
    runModelGatewayLiveCommand,
    spawnDetachedLiveRun,
} from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolModelGatewayLiveRunEnvironmentAuthority,
    requireMcpToolModelGatewaySqliteFingerprintCapability,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

const liveScenarioSchema = z.enum([
    'canonical',
    'freeform',
    'invalid-choice',
    'long-tool-heartbeat',
    'recoverable-tool-error',
    'file-write-roundtrip',
    'file-patch-roundtrip',
    'model-gateway-tools-readonly',
    'model-gateway-adaptive-probe',
    'model-gateway-tools-all-plan',
    'model-gateway-tools-apply-safe',
    'model-gateway-route-apply-minimal',
    'model-gateway-admin-apply',
]);
const liveModeSchema = z.enum([
    'control-only',
    'dry-run',
    'canonical-turn',
    'byok-fixture-control',
    'byok-real-control',
    'byok-real-turn',
]);
const transportSchema = z.enum(['pty', 'stdio']);
const selectionPolicySchema = z.enum(['metadata_first', 'prefer_runtime_proved', 'require_runtime_proof']);

const commonPlanInput = {
    mode: liveModeSchema.optional()['describe']('Default control-only.'),
    scenario: liveScenarioSchema.optional()['describe']('Default canonical.'),
    transport: transportSchema.optional()['describe']('Default pty for the canonical interactive LLM-B harness.'),
    timeoutMs: z.number().int().min(30_000).max(900_000).optional(),
    byokProfile: z.string().max(120).optional(),
    routeProfile: z.string().max(120).optional(),
    selectionPolicy: selectionPolicySchema.optional(),
};

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const llmBLiveTools = [
    defineMcpRawTool({
        name: 'llmb_live_readiness',
        title: 'LLM-B live readiness',
        description:
            'Run the canonical read-only Model Gateway/terminal LLM-B readiness audit. Does not start the terminal or call providers.',
        inputSchema: {
            includeSqliteRuntimeHealth: z.boolean().optional(),
        },

        handler: async ({ includeSqliteRuntimeHealth }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const environmentAuthority = requireMcpToolModelGatewayLiveRunEnvironmentAuthority(operationContext);
            const execution = await executeModelGatewayLiveReadiness(workspace, includeSqliteRuntimeHealth === true, {
                environmentAuthority,
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                sqliteFingerprint: requireMcpToolModelGatewaySqliteFingerprintCapability(operationContext),
            });
            if (!execution.success || !execution.parsed) {
                return errorResult(execution.error ?? 'LLM-B live readiness did not return valid JSON.', {
                    code: 'ERR_LLMB_LIVE_READINESS',
                    stderr: execution.stderr,
                    stdoutTail: String(execution.stdout ?? '').slice(-8000),
                });
            }
            const parsed = {
                ...execution.parsed,
                mcpAdapter: {
                    execution: execution.execution,
                    cacheAgeMs: execution.cacheAgeMs,
                    cacheTtlMs: MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS,
                    durationMs: execution.durationMs,
                    subprocessDurationMs: execution.execution === 'fallback-subprocess' ? execution.durationMs : null,
                    invalidation: 'catalog-file+model-gateway-sqlite-logical+byok-health-fingerprint',
                },
            };
            return okResult(parsed, JSON.stringify(parsed, null, 2));
        },
    }),
    defineMcpRawTool({
        name: 'llmb_live_runs',
        title: 'LLM-B persisted live runs',
        description:
            'Read persisted Model Gateway terminal live scenario summaries from SQLite. This never calls a provider.',
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional(),
        },

        handler: async ({ limit }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const environmentAuthority = requireMcpToolModelGatewayLiveRunEnvironmentAuthority(operationContext);
            const result = await readModelGatewayPersistedLiveRuns(workspace, limit ?? 20, {
                environmentAuthority,
                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
            });
            if (!result.success || !result.parsed) {
                return errorResult(result.error ?? 'LLM-B live runs did not return valid JSON.', {
                    code: 'ERR_LLMB_LIVE_RUNS',
                    stderr: result.stderr,
                    stdoutTail: result.stdout.slice(-8000),
                });
            }
            return okResult(result.parsed, JSON.stringify(result.parsed, null, 2));
        },
    }),
    defineMcpRawTool({
        name: 'llmb_live_test_cancel',
        title: 'Cancel detached LLM-B live test',
        description:
            'Cancel one allowlisted detached LLM-B live harness by its strict run id after verifying the manifest pid still belongs to that exact harness.',
        inputSchema: {
            runId: z.string()['regex'](DETACHED_LIVE_RUN_ID_RE),
        },

        handler: async ({ runId }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            try {
                const manifest = await readDetachedLiveRunManifestById(workspace, runId);
                if (!manifest) {
                    return errorResult('Detached LLM-B live run manifest was not found or is invalid.', {
                        code: 'ERR_LLMB_LIVE_CANCEL_NOT_FOUND',
                        runId,
                    });
                }
                const completion = await inspectDetachedLiveRunCompletion(workspace, manifest);
                if (completion.summaryReady) {
                    const processIdentity = completion.processIdentity;
                    if (!processIdentity.verified) {
                        const structured = {
                            success: true,
                            runId,
                            cancelled: false,
                            alreadyCompleted: true,
                            pid: manifest.pid,
                            outDir: manifest.outDir,
                            processIdentity: processIdentity.reason,
                            summaryPath: completion.summaryPath,
                        };
                        return okResult(structured, JSON.stringify(structured, null, 2));
                    }
                    // A summary is authoritative for result persistence, but a verified harness process can still be
                    // stranded afterward (for example while a PTY descendant refuses to close). Explicit cancellation
                    // should be able to reap that verified leftover instead of returning a misleading no-op.
                    const cancellation = await cancelDetachedLiveRun(manifest);
                    await requireMcpToolAuditCapability(operationContext).append({
                        event: 'llmb_live_test_completed_process_cancelled',
                        tool: 'llmb_live_test_cancel',
                        runId,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                    });
                    const structured = {
                        success: true,
                        runId,
                        cancelled: cancellation.cancelled,
                        alreadyCompleted: true,
                        lingeringCompletedProcess: true,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                        processIdentity: cancellation.identity.reason,
                        summaryPath: completion.summaryPath,
                    };
                    return okResult(structured, JSON.stringify(structured, null, 2));
                }
                const cancellation = await cancelDetachedLiveRun(manifest);
                await requireMcpToolAuditCapability(operationContext).append({
                    event: cancellation.cancelled
                        ? 'llmb_live_test_detached_cancelled'
                        : 'llmb_live_test_detached_already_stopped',
                    tool: 'llmb_live_test_cancel',
                    runId,
                    pid: manifest.pid,
                    outDir: manifest.outDir,
                });
                const structured = {
                    success: true,
                    runId,
                    cancelled: cancellation.cancelled,
                    alreadyStopped: cancellation.alreadyStopped,
                    pid: manifest.pid,
                    outDir: manifest.outDir,
                    processIdentity: cancellation.identity.reason,
                };
                return okResult(structured, JSON.stringify(structured, null, 2));
            } catch (error) {
                const code =
                    typeof error === 'object' && error !== null && typeof (/** @type {any} */ (error).code) === 'string'
                        ? /** @type {any} */ (error).code
                        : 'ERR_LLMB_LIVE_CANCEL';
                return errorResult(error instanceof Error ? error.message : String(error), { code, runId });
            }
        },
    }),
    defineMcpRawTool({
        name: 'llmb_live_test_plan',
        title: 'Plan canonical LLM-B live test',
        description:
            'Build an allowlisted live harness invocation and state whether it can consume GitHub Copilot AI Credits or BYOK/provider quota.',
        inputSchema: commonPlanInput,

        handler: async ({ mode, scenario, transport, timeoutMs, byokProfile, routeProfile, selectionPolicy }) => {
            try {
                const plan = buildModelGatewayLiveRunPlan({
                    mode: mode ?? 'control-only',
                    scenario: scenario ?? 'canonical',
                    transport: transport ?? 'pty',
                    timeoutMs: timeoutMs ?? 180_000,
                    ...(byokProfile ? { byokProfile } : {}),
                    ...(routeProfile ? { routeProfile } : {}),
                    ...(selectionPolicy ? { selectionPolicy } : {}),
                });
                return okResult({ success: true, ...plan }, JSON.stringify(plan, null, 2));
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    code: 'ERR_LLMB_LIVE_PLAN',
                });
            }
        },
    }),
    defineMcpRawTool({
        name: 'llmb_live_test_run',
        title: 'Run canonical LLM-B live test',
        description:
            'Run the fixed canonical LLM-B live harness. Defaults to control-only; real model/provider usage requires confirmModelUsage=true.',
        inputSchema: {
            ...commonPlanInput,
            confirmModelUsage: z
                .boolean()
                .optional()
                ['describe']('Required when the plan can invoke a model or real BYOK/provider.'),
        },

        handler: async (
            { mode, scenario, transport, timeoutMs, byokProfile, routeProfile, selectionPolicy, confirmModelUsage },
            operationContext,
        ) => {
            try {
                const effectiveMode = mode ?? 'control-only';
                const effectiveTimeoutMs = timeoutMs ?? (effectiveMode.includes('turn') ? 600_000 : 180_000);
                const plan = buildModelGatewayLiveRunPlan({
                    mode: effectiveMode,
                    scenario: scenario ?? 'canonical',
                    transport: transport ?? 'pty',
                    timeoutMs: effectiveTimeoutMs,
                    ...(byokProfile ? { byokProfile } : {}),
                    ...(routeProfile ? { routeProfile } : {}),
                    ...(selectionPolicy ? { selectionPolicy } : {}),
                });
                if (plan.requiresUsageConfirmation && confirmModelUsage !== true) {
                    return errorResult(
                        'This LLM-B live plan may consume AI Credits/provider quota; rerun with confirmModelUsage=true after reviewing llmb_live_test_plan.',
                        {
                            code: 'ERR_LLMB_MODEL_USAGE_CONFIRMATION_REQUIRED',
                            plan,
                        },
                    );
                }
                const workspace = requireMcpToolWorkspace(operationContext);
                const environmentAuthority = requireMcpToolModelGatewayLiveRunEnvironmentAuthority(operationContext);
                if (plan.executionMode === 'detached') {
                    const manifest = await spawnDetachedLiveRun({
                        workspace,
                        args: plan.args,
                        plan,
                        timeoutMs: effectiveTimeoutMs,
                        environmentAuthority,
                        ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                    });
                    await requireMcpToolAuditCapability(operationContext).append({
                        event: 'llmb_live_test_detached_started',
                        tool: 'llmb_live_test_run',
                        runId: manifest.runId,
                        mode: plan.mode,
                        scenario: plan.scenario,
                        invokesModel: plan.invokesModel,
                        invokesRealProvider: plan.invokesRealProvider,
                    });
                    const structured = {
                        success: true,
                        accepted: true,
                        detached: true,
                        runId: manifest.runId,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                        logPath: manifest.logPath,
                        plan,
                        next: 'Use llmb_live_runs to inspect detachedRuns and the persisted SQLite result; do not start a duplicate provider run while status=running.',
                    };
                    return okResult(structured, JSON.stringify(structured, null, 2));
                }
                const runId = `mcp-${Date.now().toString(36)}`;
                const outDir = `artifacts/terminal-live/${runId}`;
                const args = [...plan.args, `--out-dir=${outDir}`];
                await requireMcpToolAuditCapability(operationContext).append({
                    event: 'llmb_live_test_started',
                    tool: 'llmb_live_test_run',
                    runId,
                    mode: plan.mode,
                    scenario: plan.scenario,
                    invokesModel: plan.invokesModel,
                    invokesRealProvider: plan.invokesRealProvider,
                });
                const result = await runModelGatewayLiveCommand({
                    workspace,
                    command: 'live-runner',
                    args,
                    timeoutMs: effectiveTimeoutMs + 30_000,
                    plan,
                    environmentAuthority,
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                });
                await requireMcpToolAuditCapability(operationContext).append({
                    event: result.success ? 'llmb_live_test_completed' : 'llmb_live_test_failed',
                    tool: 'llmb_live_test_run',
                    runId,
                    mode: plan.mode,
                    scenario: plan.scenario,
                    exitCode: result.exitCode,
                });
                const structured = {
                    success: result.success,
                    runId,
                    outDir,
                    plan,
                    exitCode: result.exitCode,
                    signal: result.signal,
                    timedOut: result.timedOut,
                    aborted: result.aborted,
                    outputLimitExceeded: result.outputLimitExceeded,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    error: result.error ?? null,
                };
                if (!result.success)
                    return errorResult(result.error ?? 'LLM-B live harness failed.', {
                        code: 'ERR_LLMB_LIVE_RUN_FAILED',
                        ...structured,
                    });
                return okResult(structured, result.stdout.slice(-16000) || `LLM-B live run ${runId} completed.`);
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    code: 'ERR_LLMB_LIVE_RUN',
                });
            }
        },
    }),
];
