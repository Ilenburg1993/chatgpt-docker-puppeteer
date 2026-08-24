// @ts-check
/**
 * Application operations over the allowlisted validator job manager.
 *
 * The lower-level runtime owns process/artifact lifecycle. This layer owns validator request semantics, waiting,
 * persisted-status interpretation and compact reports. MCP schemas/batching/result envelopes stay in tools/jobs.js.
 *
 * @module copilot/mcp/validation/jobs/operations
 */

import {
    cancelJob,
    COPILOT_VALIDATOR_NAMES,
    isCopilotValidatorName,
    listJobs,
    readCopilotValidatorCapacityState,
    readJobOutput,
    spawnValidatorJob,
    waitForJobCompletion,
} from './runtime.js';

const DEFAULT_INLINE_WAIT_VALIDATORS = new Set([
    'typecheck',
    'lint',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
    'dependency-outdated',
]);
const COMPATIBILITY_MAINTENANCE_VALIDATORS = new Set(['dependency-outdated']);

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
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} ValidationJobOperationResult
 */

/** @param {Record<string, unknown>} structured @param {string} [text] @returns {ValidationJobOperationResult} */
function success(structured, text) {
    return text === undefined ? { ok: true, structured } : { ok: true, structured, text };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {ValidationJobOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

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

/** @param {ReturnType<typeof compactValidatorResourceSnapshot>} before @param {ReturnType<typeof compactValidatorResourceSnapshot>} after */
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

/** @param {import('./runtime.js').PublicJobRecord} job @returns {Record<string, unknown>} */
export function summarizeValidationJob(job) {
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

/** @param {import('./runtime.js').PublicJobRecord[]} jobs */
function latestJobsByValidator(jobs) {
    /** @type {Record<string, import('./runtime.js').PublicJobRecord>} */
    const latest = {};
    for (const job of jobs) {
        const current = latest[job.validator];
        if (!current || job.startedAt > current.startedAt) latest[job.validator] = job;
    }
    return latest;
}

/** @param {import('./runtime.js').PublicJobRecord[]} jobs */
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

/** @param {Record<string, Record<string, unknown>>} effectiveChecks */
function recommendValidationAction(effectiveChecks) {
    const entries = Object.values(effectiveChecks);
    if (entries.some((check) => check['effectiveStatus'] === 'orphaned')) return 'inspect-orphaned-validation-job';
    if (entries.some((check) => check['effectiveStatus'] === 'running')) return 'wait-and-refresh-summary';
    if (entries.some((check) => check['passed'] === false)) return 'read-small-tail-for-failing-job';
    if (entries.length === 0) return 'run-validation-only-when-needed';
    return 'none';
}

/**
 * @param {{
 *     validator: string;
 *     testFile?: string | undefined;
 *     timeoutMs?: number | undefined;
 *     waitForCompletion?: boolean | undefined;
 *     waitMs?: number | undefined;
 *     failureTailBytes?: number | undefined;
 * }} request
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @returns {Promise<ValidationJobOperationResult>}
 */
export async function executeValidatorRequest(request, workspace) {
    const { validator, testFile, timeoutMs, waitForCompletion, waitMs, failureTailBytes } = request;
    if (!isCopilotValidatorName(validator)) {
        return failure('Unsupported validator.', {
            code: 'ERR_UNSUPPORTED_VALIDATOR',
            validator,
            allowedValidators: COPILOT_VALIDATOR_NAMES,
            hint: 'Choose one validator from allowedValidators; arbitrary commands are never accepted.',
        });
    }
    const focused = validator === 'unit-focused';
    if (focused && !testFile) {
        return failure('unit-focused requires testFile.', {
            code: 'ERR_FOCUSED_TEST_FILE_REQUIRED',
            hint: 'Pass one explicit tests/unit/copilot/**/*.spec.js path.',
        });
    }
    if (!focused && testFile) {
        return failure('testFile is valid only with unit-focused.', {
            code: 'ERR_UNEXPECTED_FOCUSED_TEST_FILE',
            hint: 'Remove testFile or choose unit-focused.',
        });
    }
    try {
        const job = await spawnValidatorJob(validator, {
            workspace,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(focused && testFile !== undefined ? { testFiles: [testFile] } : {}),
        });
        const shouldWait =
            waitForCompletion !== false &&
            (waitForCompletion === true || waitMs !== undefined || DEFAULT_INLINE_WAIT_VALIDATORS.has(validator));
        if (!shouldWait) {
            return success(
                { success: true, ...(focused ? { testFile } : {}), job },
                `Started job ${job.id} (${validator}).`,
            );
        }
        const effectiveWaitMs = waitMs ?? 30_000;
        const waitedJob = await waitForJobCompletion(job.id, effectiveWaitMs);
        if (!waitedJob) {
            return failure('Validator job disappeared while waiting for completion.', {
                code: 'ERR_VALIDATOR_JOB_WAIT_LOST',
                jobId: job.id,
            });
        }
        const summary = summarizeValidationJob(waitedJob);
        const completedWithinWait = waitedJob.status !== 'running';
        const failed = waitedJob.status === 'failed';
        const compatibilityMaintenance = COMPATIBILITY_MAINTENANCE_VALIDATORS.has(validator);
        const failureOutput = failed ? await readJobOutput(job.id, failureTailBytes ?? 4000) : { output: '' };
        const maintenanceOutput =
            compatibilityMaintenance && completedWithinWait ? await readJobOutput(job.id, 50_000) : { output: '' };
        return success(
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
        return failure('Validator job was rejected.', {
            code: explicitCode ?? (focused ? 'ERR_INVALID_FOCUSED_TEST_FILE' : 'ERR_VALIDATOR_JOB_REJECTED'),
            error: error instanceof Error ? error.message : String(error),
            ...(error && typeof error === 'object' && 'activeJobId' in error
                ? { activeJobId: error.activeJobId ?? null }
                : {}),
        });
    }
}

/**
 * @param {import('./runtime.js').CopilotValidatorName} validator
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {{ timeoutMs?: number | undefined }} [options]
 * @returns {Promise<ValidationJobOperationResult>}
 */
export async function startValidatorJobOperation(validator, workspace, options = {}) {
    try {
        const job = await spawnValidatorJob(validator, {
            workspace,
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
        return success({ success: true, job }, `Started job ${job.id} (${validator}).`);
    } catch (error) {
        return failure('Validator job was rejected.', {
            code: error && typeof error === 'object' && 'code' in error ? error.code : 'ERR_VALIDATOR_JOB_REJECTED',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** @param {{ status?: 'running'|'completed'|'failed'|'cancelled'|undefined; validator?: string|undefined; limit?: number|undefined; includeCompleted?: boolean|undefined }} input */
export async function listValidationJobs(input) {
    if (input.validator !== undefined && !isCopilotValidatorName(input.validator)) {
        return failure('Unsupported validator filter.', {
            code: 'ERR_UNSUPPORTED_VALIDATOR',
            validator: input.validator,
            allowedValidators: COPILOT_VALIDATOR_NAMES,
        });
    }
    const jobs = await listJobs({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.validator === undefined ? {} : { validator: input.validator }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.includeCompleted === undefined ? {} : { includeCompleted: input.includeCompleted }),
    });
    return success({ success: true, count: jobs.length, jobs });
}

/** @param {{ validator?: string|undefined; includeOutputTail?: boolean|undefined; tailBytes?: number|undefined }} input */
export async function readLastValidationSummary(input) {
    if (input.validator !== undefined && !isCopilotValidatorName(input.validator)) {
        return failure('Unsupported validator filter.', {
            code: 'ERR_UNSUPPORTED_VALIDATOR',
            validator: input.validator,
            allowedValidators: COPILOT_VALIDATOR_NAMES,
        });
    }
    const jobs = await listJobs({
        ...(input.validator === undefined ? {} : { validator: input.validator }),
        includeCompleted: true,
        limit: 200,
    });
    const latestByValidator = latestJobsByValidator(jobs);
    const selected = input.validator
        ? Object.values(latestByValidator).filter((job) => job.validator === input.validator)
        : Object.values(latestByValidator).sort((left, right) => left.validator.localeCompare(right.validator));
    const summaries = [];
    for (const job of selected) {
        const summary = summarizeValidationJob(job);
        if (input.includeOutputTail === true) {
            const output = await readJobOutput(job.id, input.tailBytes ?? 8000);
            summary['outputTail'] = output.output;
        }
        summaries.push(summary);
    }
    const effectiveChecks = buildEffectiveValidationChecks(jobs);
    return success({
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
}

/** @param {{ includeRunning?: boolean|undefined; includeLatest?: boolean|undefined; includeDetails?: boolean|undefined; limit?: number|undefined }} input */
export async function readValidationDashboard(input) {
    const includeDetails = input.includeDetails === true;
    const jobs = await listJobs({ includeCompleted: true, limit: input.limit ?? 80 });
    const running = jobs
        .filter((job) => job.status === 'running' && job.runtimeAttached !== false)
        .map(summarizeValidationJob);
    const orphaned = jobs
        .filter((job) => job.status === 'running' && job.runtimeAttached === false)
        .map(summarizeValidationJob);
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
            .map(summarizeValidationJob)
            .filter((job) => job['passed'] === false && job['status'] !== 'running')
            .map((job) => job['id'])
            .slice(0, 5),
        runningJobIds: running.map((job) => job['id']).slice(0, 5),
        orphanedJobIds: orphaned.map((job) => job['id']).slice(0, 5),
    };
    return success(
        includeDetails
            ? {
                  ...base,
                  runningJobs: input.includeRunning === false ? [] : running,
                  orphanedJobs: input.includeRunning === false ? [] : orphaned,
                  latestJobs: input.includeLatest === false ? [] : latest.map(summarizeValidationJob),
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
}

/** @param {string} jobId */
export async function readValidationJobSummary(jobId) {
    const result = await readJobOutput(jobId, 1000);
    if (!result.job) {
        return failure('Job not found.', {
            code: 'ERR_JOB_NOT_FOUND',
            hint: 'Use a job id returned by a validator tool, or call mcp_last_validation_summary.',
            jobId,
        });
    }
    return success({
        success: true,
        job: summarizeValidationJob(result.job),
        outputAvailable: Boolean(result.output),
        outputSuppressed: true,
        nextAction:
            result.job.status === 'running' && result.job.runtimeAttached === false
                ? 'This persisted running manifest is not attached to the current MCP runtime; inspect the bounded log tail and rerun the focused validator if needed.'
                : result.job.status === 'failed'
                  ? 'Use job_get_output with a small tailBytes value only if the compact summary is insufficient.'
                  : 'No log read is needed unless debugging is required.',
    });
}

/** @param {string} jobId @param {number | undefined} tailBytes */
export async function readValidationJobOutput(jobId, tailBytes) {
    const result = await readJobOutput(jobId, tailBytes ?? 8000);
    if (!result.job) {
        return failure('Job not found.', {
            code: 'ERR_JOB_NOT_FOUND',
            hint: 'Use the jobId returned by run_copilot_validator in the current MCP process.',
            jobId,
        });
    }
    return success({ success: true, ...result }, result.output);
}

/** @param {string} jobId */
export async function cancelValidationJob(jobId) {
    const result = await cancelJob(jobId);
    if (!result.ok) {
        const code = result.unattached
            ? 'ERR_JOB_UNATTACHED'
            : result.job
              ? 'ERR_JOB_NOT_RUNNING'
              : 'ERR_JOB_NOT_FOUND';
        return failure(result.message, {
            code,
            hint: result.unattached
                ? 'The manifest says running, but this MCP runtime has no verified child-process handle. Inspect the bounded log tail and rerun the focused validator; do not kill an unverified PID.'
                : 'Use job_cancel only for a running job attached to the current MCP runtime.',
            jobId,
            job: result.job,
        });
    }
    return success({ success: true, job: result.job }, result.message);
}
