// @ts-check
/**
 * MCP tools for allowlisted Copilot validator jobs.
 *
 * @module copilot/mcp/tools/jobs
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/bulk';
import {
    boundedWriteAnnotations,
    cancelJob,
    COPILOT_VALIDATOR_NAMES,
    errorResult,
    isCopilotValidatorName,
    listJobs,
    MCP_TOOL_EXECUTION_LIMITS,
    okResult,
    readCopilotValidatorCapacityState,
    readJobOutput,
    readOnlyAnnotations,
    spawnValidatorJob,
    waitForJobCompletion,
    withResultExecutionHint,
} from '#copilot/mcp/control-plane';
import { z } from 'zod';
import { projectDoctorTool } from './project-doctor.js';

const validatorSchema = z
    .string()
    .min(1)
    .max(64)
    ['regex'](/^[a-z0-9-]+$/u)
    .describe(
        'Allowlisted validator name. The descriptor intentionally uses a bounded string instead of an enum so newly added fixed validators do not require a host-schema refresh; the server still enforces the current runtime allowlist.',
    );
const focusedTestFileSchema = z
    .string()
    .min(1)
    .max(1024)
    ['describe']('Explicit tests/unit/copilot/**/*.spec.js path for unit-focused.');
const validatorTimeoutMsSchema = z.number().int().min(1000).max(3600000);
const validatorWaitMsSchema = z.number().int().min(0).max(120000);
const validatorFailureTailBytesSchema = z.number().int().min(1000).max(12000);
const validatorRequestSchema = z.object({
    validator: validatorSchema,
    testFile: focusedTestFileSchema.optional(),
    timeoutMs: validatorTimeoutMsSchema.optional(),
    waitForCompletion: z.boolean().optional(),
    waitMs: validatorWaitMsSchema.optional(),
    failureTailBytes: validatorFailureTailBytesSchema.optional(),
});
const {
    maxBatchRequests: MAX_VALIDATOR_BATCH_REQUESTS,
    maxBatchConcurrency: MAX_VALIDATOR_BATCH_CONCURRENCY,
    acceptedInputMaxConcurrency: MAX_VALIDATOR_ACCEPTED_INPUT_CONCURRENCY,
} = MCP_TOOL_EXECUTION_LIMITS.validator;
const safeValidationSuiteSchema = z.enum(['mcp-fast', 'mcp-full', 'copilot-fast']);
const jobStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);
const DEFAULT_INLINE_WAIT_VALIDATORS = new Set([
    'typecheck',
    'lint',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
    'dependency-outdated',
]);
const COMPATIBILITY_MAINTENANCE_VALIDATORS = new Set(['dependency-outdated']);

/** @param {unknown} value */
function compactValidatorResourceSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const snapshot = /** @type {Record<string, unknown>} */ (value);
    const cgroup =
        snapshot['cgroup'] && typeof snapshot['cgroup'] === 'object' && !Array.isArray(snapshot['cgroup'])
            ? /** @type {Record<string, unknown>} */ (snapshot['cgroup'])
            : null;
    const events =
        cgroup?.['events'] && typeof cgroup['events'] === 'object' && !Array.isArray(cgroup['events'])
            ? /** @type {Record<string, unknown>} */ (cgroup['events'])
            : null;
    const loads = Array.isArray(snapshot['loadAverage']) ? snapshot['loadAverage'] : [];
    return {
        observedAt: snapshot['observedAt'] ?? null,
        mcpProcessRssBytes: snapshot['mcpProcessRssBytes'] ?? null,
        systemFreeRatio: snapshot['systemFreeRatio'] ?? null,
        load1m: loads[0] ?? null,
        load5m: loads[1] ?? null,
        availableParallelism: snapshot['availableParallelism'] ?? null,
        cgroupMemoryCurrentBytes: cgroup?.['memoryCurrentBytes'] ?? null,
        cgroupMemoryMaxBytes: cgroup?.['memoryMaxBytes'] ?? null,
        cgroupMemoryUsageRatio: cgroup?.['memoryUsageRatio'] ?? null,
        cgroupOom: events?.['oom'] ?? null,
        cgroupOomKill: events?.['oom_kill'] ?? null,
    };
}

/** @param {ReturnType<typeof compactValidatorResourceSnapshot>} before @param {ReturnType<typeof
  compactValidatorResourceSnapshot>} after */
function summarizeValidatorResourceDelta(before, after) {
    if (!before || !after) return null;
    const numberDelta = (/** @type {unknown} */ left, /** @type {unknown} */ right) =>
        typeof left === 'number' && typeof right === 'number'
            ? Math.round((right - left) * 1_000_000) / 1_000_000
            : null;
    return {
        mcpProcessRssBytes: numberDelta(before.mcpProcessRssBytes, after.mcpProcessRssBytes),
        systemFreeRatio: numberDelta(before.systemFreeRatio, after.systemFreeRatio),
        cgroupMemoryCurrentBytes: numberDelta(before.cgroupMemoryCurrentBytes, after.cgroupMemoryCurrentBytes),
        cgroupMemoryUsageRatio: numberDelta(before.cgroupMemoryUsageRatio, after.cgroupMemoryUsageRatio),
        cgroupOom: numberDelta(before.cgroupOom, after.cgroupOom),
        cgroupOomKill: numberDelta(before.cgroupOomKill, after.cgroupOomKill),
    };
}

/**
 * @param {import('../control-plane/jobs.js').PublicJobRecord} job
 * @returns {Record<string, unknown>}
 */
function summarizeJob(job) {
    const durationMs = job.endedAt === null ? Date.now() - job.startedAt : job.endedAt - job.startedAt;
    const runtimeAttached = 'runtimeAttached' in job ? job.runtimeAttached : null;
    const orphaned = job.status === 'running' && runtimeAttached === false;
    const resourceBefore = compactValidatorResourceSnapshot(job.resourceBefore);
    const resourceAfter = compactValidatorResourceSnapshot(job.resourceAfter);
    return {
        id: job.id,
        validator: job.validator,
        status: job.status,
        passed: job.status === 'completed' && job.exitCode === 0,
        running: job.status === 'running' && !orphaned,
        orphaned,
        runtimeAttached,
        runtimeSameEpoch: job.runtimeSameEpoch ?? null,
        ownerRuntimeEpoch: job.ownerRuntimeEpoch ?? null,
        ownerPid: job.ownerPid ?? null,
        childPid: job.childPid ?? null,
        resource: {
            before: resourceBefore,
            after: resourceAfter,
            delta: summarizeValidatorResourceDelta(resourceBefore, resourceAfter),
        },
        startedAt: new Date(job.startedAt).toISOString(),
        endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
        durationMs: Math.max(0, durationMs),
        exitCode: job.exitCode,
        signal: job.signal,
        timedOut: job.timedOut,
        commandLine: [job.command, ...job.args].join(' '),
        logFile: job.logFile,
    };
}

/**
 * @param {import('../control-plane/jobs.js').PublicJobRecord[]} jobs
 * @returns {Record<string, import('../control-plane/jobs.js').PublicJobRecord>}
 */
function latestJobsByValidator(jobs) {
    /** @type {Record<string, import('../control-plane/jobs.js').PublicJobRecord>} */
    const latest = {};
    for (const job of jobs) {
        const current = latest[job.validator];
        if (!current || job.startedAt > current.startedAt) latest[job.validator] = job;
    }
    return latest;
}

/** @type {Record<string, string[]>} */
const EFFECTIVE_CHECKS_BY_VALIDATOR = {
    typecheck: ['typecheck'],
    lint: ['lint'],
    'unit-mcp': ['unit-mcp'],
    'unit-copilot': ['unit-copilot'],
    'unit-focused': ['unit-focused'],
    'devcontainer-shell': ['devcontainer-shell'],
    'network-contracts': ['network-contracts'],
    'dependency-outdated': ['dependency-outdated'],
    'suite-mcp-fast': ['typecheck', 'unit-mcp'],
    'suite-mcp-full': ['typecheck', 'lint', 'unit-mcp'],
    'suite-copilot-fast': ['typecheck', 'lint', 'unit-copilot'],
};

/**
 * @param {import('../control-plane/jobs.js').PublicJobRecord[]} jobs
 * @returns {Record<string, Record<string, unknown>>}
 */
function buildEffectiveValidationChecks(jobs) {
    /** @type {Record<string, Record<string, unknown>>} */
    const effective = {};
    const sorted = [...jobs].sort((left, right) => left.startedAt - right.startedAt);
    for (const job of sorted) {
        const checks = EFFECTIVE_CHECKS_BY_VALIDATOR[job.validator] ?? [job.validator];
        for (const check of checks) {
            const orphaned = job.status === 'running' && job.runtimeAttached === false;
            effective[check] = {
                check,
                effectiveStatus: orphaned
                    ? 'orphaned'
                    : job.status === 'completed' && job.exitCode === 0
                      ? 'passed'
                      : job.status,
                passed: job.status === 'completed' && job.exitCode === 0,
                orphaned,
                runtimeAttached: job.runtimeAttached,
                sourceValidator: job.validator,
                sourceJobId: job.id,
                startedAt: new Date(job.startedAt).toISOString(),
                endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
                exitCode: job.exitCode,
                timedOut: job.timedOut,
            };
        }
    }
    return effective;
}

/**
 * @param {Record<string, Record<string, unknown>>} effectiveChecks
 * @returns {string}
 */
function recommendValidationAction(effectiveChecks) {
    const entries = Object.values(effectiveChecks);
    if (entries.some((check) => check['effectiveStatus'] === 'orphaned')) return 'inspect-orphaned-validation-job';
    if (entries.some((check) => check['effectiveStatus'] === 'running')) return 'wait-and-refresh-summary';
    if (entries.some((check) => check['passed'] === false)) return 'read-small-tail-for-failing-job';
    if (entries.length === 0) return 'run-validation-only-when-needed';
    return 'none';
}

/** @type {Record<string, import('../control-plane/jobs.js').CopilotValidatorName>} */
const SAFE_VALIDATION_SUITE_TO_VALIDATOR = {
    'mcp-fast': 'suite-mcp-fast',
    'mcp-full': 'suite-mcp-full',
    'copilot-fast': 'suite-copilot-fast',
};

/**
 * Execute one validator request through the canonical job manager. Single-call and batch modes share this exact path.
 *
 * @param {{
 *     validator: string;
 *     testFile?: string;
 *     timeoutMs?: number;
 *     waitForCompletion?: boolean;
 *     waitMs?: number;
 *     failureTailBytes?: number;
 * }} request
 * @returns {Promise<import('../control-plane/result.js').StructuredCallToolResult>}
 */
async function executeValidatorRequest(request) {
    const { validator, testFile, timeoutMs, waitForCompletion, waitMs, failureTailBytes } = request;
    if (!isCopilotValidatorName(validator)) {
        return errorResult('Unsupported validator.', {
            code: 'ERR_UNSUPPORTED_VALIDATOR',
            validator,
            allowedValidators: COPILOT_VALIDATOR_NAMES,
            hint: 'Choose one validator from allowedValidators; arbitrary commands are never accepted.',
        });
    }
    const focused = validator === 'unit-focused';
    if (focused && !testFile) {
        return errorResult('unit-focused requires testFile.', {
            code: 'ERR_FOCUSED_TEST_FILE_REQUIRED',
            hint: 'Pass one explicit tests/unit/copilot/**/*.spec.js path.',
        });
    }
    if (!focused && testFile) {
        return errorResult('testFile is valid only with unit-focused.', {
            code: 'ERR_UNEXPECTED_FOCUSED_TEST_FILE',
            hint: 'Remove testFile or choose unit-focused.',
        });
    }
    try {
        const job = await spawnValidatorJob(validator, {
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(focused ? { testFiles: [/** @type {string} */ (testFile)] } : {}),
        });
        const shouldWait =
            waitForCompletion !== false &&
            (waitForCompletion === true || waitMs !== undefined || DEFAULT_INLINE_WAIT_VALIDATORS.has(validator));
        if (!shouldWait) {
            return okResult(
                { success: true, ...(focused ? { testFile } : {}), job },
                `Started job ${job.id} (${validator}).`,
            );
        }
        const effectiveWaitMs = waitMs ?? 30_000;
        const waitedJob = await waitForJobCompletion(job.id, effectiveWaitMs);
        if (!waitedJob) {
            return errorResult('Validator job disappeared while waiting for completion.', {
                code: 'ERR_VALIDATOR_JOB_WAIT_LOST',
                jobId: job.id,
            });
        }
        const summary = summarizeJob(waitedJob);
        const completedWithinWait = waitedJob.status !== 'running';
        const failed = waitedJob.status === 'failed';
        const compatibilityMaintenance = COMPATIBILITY_MAINTENANCE_VALIDATORS.has(validator);
        const failureOutput = failed ? await readJobOutput(job.id, failureTailBytes ?? 4000) : { output: '' };
        const maintenanceOutput =
            compatibilityMaintenance && completedWithinWait ? await readJobOutput(job.id, 50_000) : { output: '' };
        return okResult(
            {
                success: waitedJob.status === 'completed',
                ...(focused ? { testFile } : {}),
                completedWithinWait,
                waitMs: effectiveWaitMs,
                job: summary,
                ...(failed && failureOutput.output ? { failureOutputTail: failureOutput.output } : {}),
                ...(compatibilityMaintenance && maintenanceOutput.output
                    ? {
                          compatibilityBridge: 'frozen-host-tool-snapshot',
                          maintenanceOutputTail: maintenanceOutput.output,
                      }
                    : {}),
                nextAction: completedWithinWait
                    ? failed
                        ? 'Fix the reported validation failure; the bounded failure tail is already included.'
                        : 'No job_get_summary call is needed; validation completed in this response.'
                    : 'The bounded wait expired while the job kept running; use job_get_summary only if needed.',
            },
            completedWithinWait
                ? `Validator ${validator} finished during the bounded wait.`
                : `Validator ${validator} is still running after ${effectiveWaitMs}ms; job ${job.id}.`,
        );
    } catch (error) {
        const explicitCode =
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string' &&
            error.code.startsWith('ERR_VALIDATOR_')
                ? error.code
                : null;
        return errorResult('Validator job was rejected.', {
            code: explicitCode ?? (focused ? 'ERR_INVALID_FOCUSED_TEST_FILE' : 'ERR_VALIDATOR_JOB_REJECTED'),
            error: error instanceof Error ? error.message : String(error),
            ...(error && typeof error === 'object' && 'activeJobId' in error
                ? { activeJobId: error.activeJobId ?? null }
                : {}),
        });
    }
}

/**
 * @param {Awaited<
 *     ReturnType<
 *         typeof runBoundedOperationBatch<
 *             Record<string, unknown>,
 *             import('../control-plane/result.js').StructuredCallToolResult
 *         >
 *     >
 * >} execution
 * @param {Record<string, unknown>[]} requests
 */
function compactValidatorBatchResults(execution, requests) {
    return execution.results.map((row) => {
        const request = requests[row.index] ?? {};
        const base = {
            index: row.index,
            validator: request['validator'] ?? null,
            ...(typeof request['testFile'] === 'string' ? { testFile: request['testFile'] } : {}),
            status: row.status,
            durationMs: row.durationMs,
        };
        if (row.status === 'skipped') {
            return { ...base, success: false, skipped: true, code: 'ERR_VALIDATOR_BATCH_SKIPPED', reason: row.reason };
        }
        if ('value' in row && row.value) {
            const structured = row.value.structuredContent ?? {};
            return {
                ...base,
                success: structured['success'] === true,
                ...(structured['completedWithinWait'] === undefined
                    ? {}
                    : { completedWithinWait: structured['completedWithinWait'] }),
                ...(structured['waitMs'] === undefined ? {} : { waitMs: structured['waitMs'] }),
                ...(structured['job'] === undefined ? {} : { job: structured['job'] }),
                ...(structured['failureOutputTail'] === undefined
                    ? {}
                    : { failureOutputTail: structured['failureOutputTail'] }),
                ...(structured['nextAction'] === undefined ? {} : { nextAction: structured['nextAction'] }),
                ...(structured['code'] === undefined ? {} : { code: structured['code'] }),
                ...(structured['error'] === undefined ? {} : { error: structured['error'] }),
                ...(structured['details'] === undefined ? {} : { details: structured['details'] }),
            };
        }
        return {
            ...base,
            success: false,
            code:
                row.status === 'failed'
                    ? (row.code ?? 'ERR_VALIDATOR_BATCH_EXECUTION')
                    : 'ERR_VALIDATOR_BATCH_EXECUTION',
            error:
                row.status === 'failed'
                    ? (row.error ?? 'Validator batch item failed.')
                    : 'Validator batch item failed.',
        };
    });
}

/**
 * @param {import('../control-plane/jobs.js').CopilotValidatorName} validator
 * @param {string} name
 * @param {string} title
 * @param {string} description
 * @returns {import('../registry.js').McpToolDefinition}
 */
function buildValidatorAliasTool(validator, name, title, description) {
    return {
        name,
        title,
        description,
        inputSchema: {
            timeoutMs: z.number().int().min(1000).max(3600000).optional()['describe']('Timeout ms.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ timeoutMs }) => {
            const job = await spawnValidatorJob(validator, timeoutMs === undefined ? {} : { timeoutMs });
            return okResult({ success: true, job }, `Started job ${job.id} (${validator}).`);
        },
    };
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const jobTools = [
    buildValidatorAliasTool(
        'typecheck',
        'run_typecheck_copilot',
        'Run Copilot typecheck',
        'Start the canonical strict typecheck job for src/copilot.',
    ),
    buildValidatorAliasTool(
        'lint',
        'run_lint_copilot',
        'Run Copilot lint',
        'Start the canonical lint job for src/copilot and unit tests.',
    ),
    buildValidatorAliasTool(
        'unit-copilot',
        'run_unit_copilot',
        'Run Copilot unit tests',
        'Start the canonical full unit test job for src/copilot.',
    ),
    {
        name: 'mcp_run_safe_validation_suite',
        title: 'Run safe MCP validation suite',
        description: 'Run a fixed broad validation suite. Escalation-only for cross-cutting risk or release gates.',
        inputSchema: {
            suite: safeValidationSuiteSchema['describe']('Broad suite: mcp-fast, mcp-full, or copilot-fast.'),
            timeoutMs: z.number().int().min(1000).max(3600000).optional()['describe']('Timeout ms.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ suite, timeoutMs }) => {
            const validator = SAFE_VALIDATION_SUITE_TO_VALIDATOR[String(suite)];
            if (!validator) {
                return errorResult('Unsupported validation suite.', {
                    code: 'ERR_UNSUPPORTED_VALIDATION_SUITE',
                    hint: 'Use mcp-fast, mcp-full, or copilot-fast.',
                    suite,
                });
            }
            const job = await spawnValidatorJob(validator, timeoutMs === undefined ? {} : { timeoutMs });
            return okResult({ success: true, suite, job }, `Started job ${job.id} (${suite}).`);
        },
    },
    {
        name: 'run_project_doctor',
        title: 'Run project doctor',
        description: 'Return the Copilot MCP project doctor report.',
        inputSchema: {
            includeScripts: z.boolean().optional()['describe']('Include scripts. Default: true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: projectDoctorTool.handler,
    },
    {
        name: 'run_copilot_validator',
        title: 'Run Copilot validator',
        description:
            'Run one allowlisted validator or batch up to 8 validator requests in one call. Batch defaults sequential to avoid CPU/memory contention.',
        inputSchema: {
            validator: validatorSchema
                .optional()
                .describe(
                    'Single allowlisted validator name; required outside batch mode. Prefer unit-focused for JS/TS causal gates.',
                ),
            testFile: focusedTestFileSchema.optional(),
            timeoutMs: validatorTimeoutMsSchema.optional()['describe']('Optional validator timeout in ms.'),
            waitForCompletion: z
                .boolean()
                .optional()
                ['describe'](
                    'Wait in this same call. Defaults true for typecheck/lint/unit-focused/devcontainer-shell and false for broad suites.',
                ),
            waitMs: validatorWaitMsSchema
                .optional()
                ['describe']('Bounded completion wait. Default 30000ms when waitForCompletion=true.'),
            failureTailBytes: validatorFailureTailBytesSchema
                .optional()
                ['describe'](
                    'Short log tail returned in the same call only when a waited validator fails. Default 4000.',
                ),
            batch: z
                .array(validatorRequestSchema)
                .min(1)
                .max(MAX_VALIDATOR_BATCH_REQUESTS)
                .optional()
                ['describe']('Batch up to 8 validator requests; do not mix with single-validator fields.'),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch failure policy. Default: best-effort.'),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_VALIDATOR_ACCEPTED_INPUT_CONCURRENCY)
                .optional()
                ['describe'](
                    'Compatibility input accepts 1-2 for stale clients, but execution is always serialized at 1 to protect WSL/DevContainer headroom.',
                ),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({
            validator,
            testFile,
            timeoutMs,
            waitForCompletion,
            waitMs,
            failureTailBytes,
            batch,
            batchFailureMode,
            batchConcurrency,
        }) => {
            if (batch !== undefined) {
                if (
                    validator !== undefined ||
                    testFile !== undefined ||
                    timeoutMs !== undefined ||
                    waitForCompletion !== undefined ||
                    waitMs !== undefined ||
                    failureTailBytes !== undefined
                ) {
                    return errorResult('Do not mix validator batch and single-validator fields.', {
                        code: 'ERR_VALIDATOR_BATCH_CONFLICTING_MODE',
                    });
                }
                try {
                    const requests = /** @type {Record<string, unknown>[]} */ (batch);
                    const execution = await runBoundedOperationBatch(
                        requests,
                        async (raw, index) => {
                            const parsed = validatorRequestSchema.safeParse(raw);
                            if (!parsed.success) {
                                return errorResult(`Invalid validator batch item at index ${index}.`, {
                                    code: 'ERR_VALIDATOR_BATCH_INVALID_ITEM',
                                    index,
                                });
                            }
                            return executeValidatorRequest(
                                /** @type {Parameters<typeof executeValidatorRequest>[0]} */ (parsed.data),
                            );
                        },
                        {
                            concurrency: MAX_VALIDATOR_BATCH_CONCURRENCY,
                            failureMode: batchFailureMode ?? 'best-effort',
                            maxItems: MAX_VALIDATOR_BATCH_REQUESTS,
                            maxInputBytes: 64 * 1024,
                            estimateItemBytes: (item) => Buffer.byteLength(JSON.stringify(item), 'utf8') + 64,
                            isFailure: (result) =>
                                result.isError === true || result.structuredContent?.['success'] === false,
                        },
                    );
                    const results = compactValidatorBatchResults(execution, requests);
                    const structured = {
                        success: execution.failedCount === 0 && execution.skippedCount === 0,
                        batch: true,
                        executionId: execution.executionId,
                        failureMode: execution.failureMode,
                        requestCount: execution.requestCount,
                        attemptedCount: execution.attemptedCount,
                        succeededCount: execution.succeededCount,
                        failedCount: execution.failedCount,
                        skippedCount: execution.skippedCount,
                        concurrency: execution.concurrency,
                        requestedConcurrency: batchConcurrency ?? 1,
                        effectiveConcurrency: execution.concurrency,
                        compatibilityNormalized:
                            batchConcurrency !== undefined && batchConcurrency !== execution.concurrency,
                        maxInFlight: execution.maxInFlight,
                        durationMs: execution.durationMs,
                        results,
                        nextAction:
                            execution.failedCount > 0
                                ? 'Fix only failed validator items using their included job summary/tail; successful results remain valid.'
                                : execution.skippedCount > 0
                                  ? 'Retry only skipped validator items if they are still required.'
                                  : 'All requested validators completed or started as requested; no status polling is needed for completed items.',
                    };
                    const result = okResult(
                        structured,
                        `Validator batch: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped.`,
                    );
                    return withResultExecutionHint(result, {
                        logicalOperations: execution.requestCount,
                        failedOperations: execution.failedCount,
                        skippedOperations: execution.skippedCount,
                        mode: `validator-batch:${execution.failureMode}:c${execution.concurrency}`,
                    });
                } catch (error) {
                    return errorResult('Validator batch was rejected.', {
                        code:
                            error && typeof error === 'object' && 'code' in error
                                ? /** @type {{ code?: unknown }} */ (error).code
                                : 'ERR_VALIDATOR_BATCH_REJECTED',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            if (batchFailureMode !== undefined || batchConcurrency !== undefined) {
                return errorResult('batchFailureMode/batchConcurrency require batch mode.', {
                    code: 'ERR_VALIDATOR_BATCH_OPTIONS_WITHOUT_BATCH',
                });
            }
            const parsed = validatorRequestSchema.safeParse({
                validator,
                testFile,
                timeoutMs,
                waitForCompletion,
                waitMs,
                failureTailBytes,
            });
            if (!parsed.success) {
                return errorResult('Single validator request is invalid.', {
                    code: 'ERR_VALIDATOR_REQUEST_INVALID',
                    hint: 'Provide validator, and testFile only when validator=unit-focused.',
                });
            }
            return executeValidatorRequest(/** @type {Parameters<typeof executeValidatorRequest>[0]} */ (parsed.data));
        },
    },
    {
        name: 'job_list',
        title: 'List validator jobs',
        description: 'List active and recent validator jobs, including persisted manifests.',
        inputSchema: {
            status: jobStatusSchema.optional()['describe']('Status filter.'),
            validator: validatorSchema.optional().describe('Validator filter.'),
            limit: z.number().int().min(1).max(200).optional()['describe']('Max jobs. Default: 50.'),
            includeCompleted: z.boolean().optional()['describe']('Include finished jobs. Default: true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ status, validator, limit, includeCompleted }) => {
            if (validator !== undefined && !isCopilotValidatorName(validator)) {
                return errorResult('Unsupported validator filter.', {
                    code: 'ERR_UNSUPPORTED_VALIDATOR',
                    validator,
                    allowedValidators: COPILOT_VALIDATOR_NAMES,
                });
            }
            const jobs = await listJobs({ status, validator, limit, includeCompleted });
            return okResult({
                success: true,
                count: jobs.length,
                jobs,
            });
        },
    },
    {
        name: 'mcp_last_validation_summary',
        title: 'Last MCP validation summary',
        description: 'Return the latest persisted job per validator without starting validation.',
        inputSchema: {
            validator: validatorSchema.optional().describe('Validator filter.'),
            includeOutputTail: z.boolean().optional()['describe']('Include short log tails. Default: false.'),
            tailBytes: z.number().int().min(1000).max(20000).optional()['describe']('Tail bytes.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ validator, includeOutputTail, tailBytes }) => {
            if (validator !== undefined && !isCopilotValidatorName(validator)) {
                return errorResult('Unsupported validator filter.', {
                    code: 'ERR_UNSUPPORTED_VALIDATOR',
                    validator,
                    allowedValidators: COPILOT_VALIDATOR_NAMES,
                });
            }
            const jobs = await listJobs({ validator, includeCompleted: true, limit: 200 });
            const latestByValidator = latestJobsByValidator(jobs);
            const selected = validator
                ? Object.values(latestByValidator).filter((job) => job.validator === validator)
                : Object.values(latestByValidator).sort((left, right) => left.validator.localeCompare(right.validator));
            const summaries = [];
            for (const job of selected) {
                const summary = summarizeJob(job);
                if (includeOutputTail === true) {
                    const output = await readJobOutput(job.id, tailBytes ?? 8000);
                    summary['outputTail'] = output.output;
                }
                summaries.push(summary);
            }
            const effectiveChecks = buildEffectiveValidationChecks(jobs);
            return okResult({
                success: true,
                count: summaries.length,
                validatorsCovered: summaries.map((summary) => summary['validator']),
                summaries,
                effectiveChecks,
                recommendedNextAction: recommendValidationAction(effectiveChecks),
                streamSafety: {
                    preferredFlow: [
                        'mcp_validation_dashboard',
                        'mcp_last_validation_summary',
                        'job_get_summary',
                        'job_get_output tailBytes<=8000 only when needed',
                    ],
                    avoid: ['large job_get_output tails', 'multiple validators back-to-back in ChatGPT web'],
                },
                hint:
                    summaries.length === 0
                        ? 'No persisted validator jobs found. Run mcp_run_safe_validation_suite or run_copilot_validator when allowed.'
                        : 'Use job_get_output with a specific job id for a longer log tail.',
            });
        },
    },
    {
        name: 'mcp_validation_dashboard',
        title: 'MCP validation dashboard',
        description: 'Return compact validation status without starting jobs or long logs.',
        inputSchema: {
            includeRunning: z.boolean().optional()['describe']('Include running jobs. Default: true.'),
            includeLatest: z.boolean().optional()['describe']('Include latest jobs. Default: true.'),
            includeDetails: z.boolean().optional()['describe']('Include job arrays. Default: false.'),
            limit: z.number().int().min(10).max(200).optional()['describe']('Max manifests. Default: 80.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async (input = {}) => {
            const options = /** @type {Record<string, unknown>} */ (input);
            const includeRunning = options['includeRunning'];
            const includeLatest = options['includeLatest'];
            const includeDetails = options['includeDetails'] === true;
            const limit = typeof options['limit'] === 'number' ? options['limit'] : 80;
            const jobs = await listJobs({ includeCompleted: true, limit });
            const running = jobs
                .filter((job) => job.status === 'running' && job.runtimeAttached !== false)
                .map(summarizeJob);
            const orphaned = jobs
                .filter((job) => job.status === 'running' && job.runtimeAttached === false)
                .map(summarizeJob);
            const latest = Object.values(latestJobsByValidator(jobs)).sort((left, right) =>
                left.validator.localeCompare(right.validator),
            );
            const effectiveChecks = buildEffectiveValidationChecks(jobs);
            const base = {
                success: true,
                validatorCapacity: readCopilotValidatorCapacityState(),
                runningCount: running.length,
                orphanedCount: orphaned.length,
                latestCount: latest.length,
                effectiveChecks,
                recommendedNextAction: recommendValidationAction(effectiveChecks),
                failingJobIds: latest
                    .map(summarizeJob)
                    .filter((job) => job['passed'] === false && job['status'] !== 'running')
                    .map((job) => job['id'])
                    .slice(0, 5),
                runningJobIds: running.map((job) => job['id']).slice(0, 5),
                orphanedJobIds: orphaned.map((job) => job['id']).slice(0, 5),
            };
            return okResult(
                includeDetails
                    ? {
                          ...base,
                          runningJobs: includeRunning === false ? [] : running,
                          orphanedJobs: includeRunning === false ? [] : orphaned,
                          latestJobs: includeLatest === false ? [] : latest.map(summarizeJob),
                          streamSafety: {
                              preferredFlow: [
                                  'start validation only when needed',
                                  'mcp_validation_dashboard',
                                  'job_get_summary',
                                  'job_get_output tailBytes<=8000 only on failure',
                              ],
                              avoid: ['large job_get_output tails', 'multiple validators back-to-back in ChatGPT web'],
                          },
                      }
                    : { ...base, detailsAvailable: true },
            );
        },
    },
    {
        name: 'job_get_summary',
        title: 'Get job summary',
        description: 'Return compact status for one validator job; no log output.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ jobId }) => {
            const result = await readJobOutput(jobId, 1000);
            if (!result.job) {
                return errorResult('Job not found.', {
                    code: 'ERR_JOB_NOT_FOUND',
                    hint: 'Use a job id returned by a validator tool, or call mcp_last_validation_summary.',
                    jobId,
                });
            }
            return okResult({
                success: true,
                job: summarizeJob(result.job),
                outputAvailable: Boolean(result.output),
                outputSuppressed: true,
                nextAction:
                    result.job.status === 'running' && result.job.runtimeAttached === false
                        ? 'This persisted running manifest is not attached to the current MCP runtime; inspect the bounded log tail and rerun the focused validator if needed.'
                        : result.job.status === 'failed'
                          ? 'Use job_get_output with a small tailBytes value only if the compact summary is insufficient.'
                          : 'No log read is needed unless debugging is required.',
            });
        },
    },
    {
        name: 'job_get_output',
        title: 'Get job output',
        description: 'Read a bounded validator-job log tail and status.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
            tailBytes: z.number().int().min(1000).max(50000).optional()['describe']('Tail bytes. Default: 8000.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ jobId, tailBytes }) => {
            const effectiveTailBytes = tailBytes ?? 8000;
            const result = await readJobOutput(jobId, effectiveTailBytes);
            if (!result.job) {
                return errorResult('Job not found.', {
                    code: 'ERR_JOB_NOT_FOUND',
                    hint: 'Use the jobId returned by run_copilot_validator in the current MCP process.',
                    jobId,
                });
            }
            return okResult({ success: true, ...result }, result.output);
        },
    },
    {
        name: 'job_cancel',
        title: 'Cancel job',
        description: 'Cancel an attached running validator job.',
        inputSchema: {
            jobId: z.string().min(1)['describe']('Validator job id.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ jobId }) => {
            const result = await cancelJob(jobId);
            if (!result.ok) {
                const code = result.unattached
                    ? 'ERR_JOB_UNATTACHED'
                    : result.job
                      ? 'ERR_JOB_NOT_RUNNING'
                      : 'ERR_JOB_NOT_FOUND';
                return errorResult(result.message, {
                    code,
                    hint: result.unattached
                        ? 'The manifest says running, but this MCP runtime has no verified child-process handle. Inspect the bounded log tail and rerun the focused validator; do not kill an unverified PID.'
                        : 'Use job_cancel only for a running job attached to the current MCP runtime.',
                    jobId,
                    job: result.job,
                });
            }
            return okResult({ success: true, job: result.job }, result.message);
        },
    },
];
