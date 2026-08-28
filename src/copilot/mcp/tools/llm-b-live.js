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
    estimateStructuredTextResultBytes,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolModelGatewayLiveRunEnvironmentAuthority,
    requireMcpToolModelGatewaySqliteFingerprintCapability,
    requireMcpToolWorkspace,
    withResultSizeHint,
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

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, any>} */ (value)
        : {};
}

/** @param {unknown} value */
function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

/** @param {Record<string, any>} parsed @param {Awaited<ReturnType<typeof executeModelGatewayLiveReadiness>>} execution */
function buildCompactLiveReadinessResult(parsed, execution) {
    const checks = Array.isArray(parsed['checks'])
        ? parsed['checks'].filter((item) => item && typeof item === 'object')
        : [];
    const failedChecks = checks
        .filter((check) => check['ok'] !== true)
        .slice(0, 16)
        .map((check) => ({ id: String(check['id'] ?? 'unknown'), detail: String(check['detail'] ?? '') }));
    const redaction = asRecord(parsed['redaction']);
    const catalogRedaction = asRecord(redaction['catalog']);
    const sqliteRedaction = asRecord(redaction['sqlite']);
    const selection = asRecord(parsed['selection']);
    const effectiveStrict = asRecord(selection['effectiveStrict']);
    const runtimeSelector = asRecord(selection['runtimeSelectorPlan']);
    const terminalSelector = asRecord(selection['terminalLiveRuntimeSelectorPlan']);
    const sqlite = asRecord(parsed['sqlite']);
    return {
        schema: String(parsed['schema'] ?? 'model-gateway-live-readiness'),
        ok: parsed['ok'] === true,
        snapshotId: typeof parsed['snapshotId'] === 'string' ? parsed['snapshotId'] : null,
        generatedAt: typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : null,
        checks: {
            total: checks.length,
            passed: checks.length - failedChecks.length,
            failed: failedChecks,
        },
        sqlite: {
            parityOk: sqlite['parityOk'] === true,
            runtimeHealthReadLimit: finiteNumber(sqlite['runtimeHealthReadLimit']),
            runtimeProbeOnlyRecords: finiteNumber(sqlite['runtimeProbeOnlyRecords']),
            runtimeProbeProofRecords: finiteNumber(sqlite['runtimeProbeProofRecords']),
        },
        redaction: {
            ok: redaction['ok'] === true,
            proofReused: redaction['proofReused'] === true,
            catalog: {
                mode: catalogRedaction['mode'] ?? null,
                ok: catalogRedaction['ok'] === true,
                leakCount: finiteNumber(catalogRedaction['leakCount']),
                scannedStringCount: finiteNumber(catalogRedaction['scannedStringCount']),
            },
            sqlite: {
                mode: sqliteRedaction['mode'] ?? null,
                ok: sqliteRedaction['ok'] === true,
                leakCount: finiteNumber(sqliteRedaction['leakCount']),
                scannedStringCount: finiteNumber(sqliteRedaction['scannedStringCount']),
                rowCount: finiteNumber(sqliteRedaction['rowCount']),
                maxRowsPerTable: finiteNumber(sqliteRedaction['maxRowsPerTable']),
            },
        },
        selection: {
            effectiveStrict: {
                ok: effectiveStrict['ok'] === true,
                selected: finiteNumber(effectiveStrict['selected']),
                profiles: finiteNumber(effectiveStrict['profiles']),
                providers: asRecord(effectiveStrict['providers']),
            },
            runtimeSelectorPlan: {
                ok: runtimeSelector['ok'] === true,
                ready: runtimeSelector['ready'] === true,
                selected: finiteNumber(runtimeSelector['selected']),
                profiles: finiteNumber(runtimeSelector['profiles']),
                blocked: finiteNumber(runtimeSelector['blocked']),
            },
            terminalLiveRuntimeSelectorPlan: {
                ok: terminalSelector['ok'] === true,
                ready: terminalSelector['ready'] === true,
                selected: finiteNumber(terminalSelector['selected']),
                blocked: finiteNumber(terminalSelector['blocked']),
                profiles: Array.isArray(terminalSelector['profiles']) ? terminalSelector['profiles'].slice(0, 8) : [],
            },
        },
        mcpAdapter: {
            execution: execution.execution,
            cacheAgeMs: execution.cacheAgeMs,
            cacheTtlMs: MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS,
            durationMs: execution.durationMs,
            processDurationMs: execution.processDurationMs,
            timing: execution.timing,
            isolation: execution.execution === 'fresh-process' ? 'call-scoped-process' : 'memory-cache',
            invalidation: 'catalog-file+sqlite-change-token+byok-health-fingerprint',
        },
        detailsAvailable: true,
    };
}

/** @param {Record<string, any>} structured */
function renderCompactLiveReadinessText(structured) {
    const checks = asRecord(structured['checks']);
    const redaction = asRecord(structured['redaction']);
    const selection = asRecord(structured['selection']);
    const terminal = asRecord(selection['terminalLiveRuntimeSelectorPlan']);
    const adapter = asRecord(structured['mcpAdapter']);
    const failed = Array.isArray(checks['failed']) ? checks['failed'] : [];
    const failedIds = failed
        .map((item) => asRecord(item)['id'])
        .filter(Boolean)
        .slice(0, 6);
    return [
        `LLM-B readiness ${structured['ok'] === true ? 'READY' : 'BLOCKED'}`,
        `checks=${String(checks['passed'] ?? 0)}/${String(checks['total'] ?? 0)}`,
        `proof=${redaction['proofReused'] === true ? 'reused' : 'fresh'}`,
        `terminalRoutes=${String(terminal['selected'] ?? 0)}/${String((terminal['profiles'] ?? []).length || 0)}`,
        `execution=${String(adapter['execution'] ?? 'unknown')}`,
        `durationMs=${String(adapter['durationMs'] ?? 0)}`,
        ...(failedIds.length > 0 ? [`failed=${failedIds.join(',')}`] : []),
        'details=includeDetails:true',
    ].join(' | ');
}

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
            view: z.enum(['readiness', 'runs']).optional()['describe']('Read projection. Default: readiness.'),
            includeSqliteRuntimeHealth: z.boolean().optional()['describe']('view=readiness only.'),
            includeDetails: z
                .boolean()
                .optional()
                ['describe']('view=readiness only: return the complete readiness tree. Default: compact view.'),
            limit: z.number().int().min(1).max(100).optional()['describe']('view=runs only: persisted run limit. Default: 20.'),
        },

        handler: async ({ view, includeSqliteRuntimeHealth, includeDetails, limit }, operationContext) => {
            const projection = view ?? 'readiness';
            const workspace = requireMcpToolWorkspace(operationContext);
            const environmentAuthority = requireMcpToolModelGatewayLiveRunEnvironmentAuthority(operationContext);
            if (projection === 'runs') {
                if (includeSqliteRuntimeHealth !== undefined || includeDetails !== undefined) {
                    return errorResult('includeSqliteRuntimeHealth/includeDetails are valid only with view=readiness.', {
                        code: 'ERR_LLMB_LIVE_READ_VIEW_FIELDS',
                        view: projection,
                    });
                }
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
            }
            if (limit !== undefined) {
                return errorResult('limit is valid only with view=runs.', {
                    code: 'ERR_LLMB_LIVE_READ_VIEW_FIELDS',
                    view: projection,
                });
            }
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
            const compact = buildCompactLiveReadinessResult(execution.parsed, execution);
            const structured =
                includeDetails === true
                    ? {
                          ...execution.parsed,
                          mcpAdapter: compact.mcpAdapter,
                          detailsAvailable: true,
                      }
                    : compact;
            const text = renderCompactLiveReadinessText(compact);
            return withResultSizeHint(okResult(structured, text), {
                bytes: estimateStructuredTextResultBytes(structured, text),
                strategy: 'conservative-estimate',
                source: 'llmb-live-readiness',
            });
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
                        next: 'Use llmb_live_readiness view=runs to inspect detachedRuns and the persisted SQLite result; do not start a duplicate provider run while status=running.',
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
