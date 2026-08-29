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

const DEFAULT_INLINE_WAIT_VALIDATORS = Object.freeze([
    'typecheck',
    'lint',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
    'dependency-outdated',
]);
const COMPATIBILITY_MAINTENANCE_VALIDATORS = Object.freeze(['dependency-outdated']);

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
export function buildEffectiveValidationChecks(jobs) {
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
export function recommendValidationAction(effectiveChecks) {
    const entries = Object.values(effectiveChecks);
    if (entries.some((check) => check['effectiveStatus'] === 'orphaned')) return 'inspect-orphaned-validation-job';
    if (entries.some((check) => check['effectiveStatus'] === 'running')) return 'wait-and-refresh-summary';
    if (entries.some((check) => check['effectiveStatus'] === 'failed')) return 'read-small-tail-for-failing-job';
    if (entries.length === 0) return 'run-validation-only-when-needed';
    return 'none';
}

/**
 * Bounded productivity view over the persisted validator manifests already loaded for a dashboard request. Repeated
 * validator names are pressure only; they are not called duplicate work until validator jobs carry source-state binding.
 *
 * @param {import('./runtime.js').PublicJobRecord[]} jobs
 */
export function summarizeValidationProductivity(jobs) {
    const byValidator = new Map();
    let totalFinishedDurationMs = 0;
    let finishedJobs = 0;
    let passedJobs = 0;
    let failedJobs = 0;
    let cancelledJobs = 0;
    let runningJobs = 0;
    let orphanedJobs = 0;
    let broadSuiteRuns = 0;
    let broadSuiteDurationMs = 0;
    let focusedRuns = 0;
    let focusedDurationMs = 0;

    for (const job of jobs) {
        const summary = summarizeValidationJob(job);
        const durationMs = Number(summary['durationMs'] ?? 0);
        const validator = String(summary['validator'] ?? job.validator);
        const status = String(summary['status'] ?? job.status);
        const metric = byValidator.get(validator) ?? {
            runs: 0,
            passed: 0,
            failed: 0,
            cancelled: 0,
            finishedDurationMs: 0,
            lastDurationMs: 0,
        };
        metric.runs += 1;
        metric.lastDurationMs = durationMs;
        if (status === 'running') {
            runningJobs += 1;
            if (summary['orphaned'] === true) orphanedJobs += 1;
        } else {
            finishedJobs += 1;
            totalFinishedDurationMs += durationMs;
            metric.finishedDurationMs += durationMs;
            if (status === 'completed' && summary['passed'] === true) {
                passedJobs += 1;
                metric.passed += 1;
            } else if (status === 'failed') {
                failedJobs += 1;
                metric.failed += 1;
            } else if (status === 'cancelled') {
                cancelledJobs += 1;
                metric.cancelled += 1;
            }
        }
        if (validator.startsWith('suite-')) {
            broadSuiteRuns += 1;
            if (status !== 'running') broadSuiteDurationMs += durationMs;
        }
        if (validator === 'unit-focused') {
            focusedRuns += 1;
            if (status !== 'running') focusedDurationMs += durationMs;
        }
        byValidator.set(validator, metric);
    }

    const repeatRunPressure = [...byValidator.values()].reduce((sum, metric) => sum + Math.max(0, metric.runs - 1), 0);
    return {
        authority: 'bounded-persisted-validator-job-manifests',
        jobsConsidered: jobs.length,
        finishedJobs,
        passedJobs,
        failedJobs,
        cancelledJobs,
        runningJobs,
        orphanedJobs,
        totalFinishedDurationMs,
        broadSuiteRuns,
        broadSuiteDurationMs,
        focusedRuns,
        focusedDurationMs,
        repeatRunPressure,
        duplicateValidationCount: null,
        duplicateClassification: 'requires-source-state-binding',
        byValidator: Object.fromEntries(
            [...byValidator.entries()].sort((left, right) => left[0].localeCompare(right[0])),
        ),
        caveat: 'Repeat-run pressure counts repeated validator names only. It does not claim duplicate work without source-state identity.',
    };
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
 * @param {import('../config.js').McpValidationProcessConfig} config
 * @param {string} ownerPrincipalKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<ValidationJobOperationResult>}
 */
export async function executeValidatorRequest(request, workspace, config, ownerPrincipalKey, signal) {
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
            config,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(focused && testFile !== undefined ? { testFiles: [testFile] } : {}),
            ...(signal ? { signal } : {}),
            ownerPrincipalKey,
        });
        const shouldWait =
            waitForCompletion !== false &&
            (waitForCompletion === true || waitMs !== undefined || DEFAULT_INLINE_WAIT_VALIDATORS.includes(validator));
        if (!shouldWait) {
            return success(
                { success: true, ...(focused ? { testFile } : {}), job },
                `Started job ${job.id} (${validator}).`,
            );
        }
        const effectiveWaitMs = waitMs ?? 30_000;
        const waitedJob = await waitForJobCompletion(job.id, ownerPrincipalKey, effectiveWaitMs, signal);
        if (!waitedJob) {
            return failure('Validator job disappeared while waiting for completion.', {
                code: 'ERR_VALIDATOR_JOB_WAIT_LOST',
                jobId: job.id,
            });
        }
        const summary = summarizeValidationJob(waitedJob);
        const completedWithinWait = waitedJob.status !== 'running';
        const failed = waitedJob.status === 'failed';
        const compatibilityMaintenance = COMPATIBILITY_MAINTENANCE_VALIDATORS.includes(validator);
        const failureOutput = failed
            ? await readJobOutput(job.id, ownerPrincipalKey, failureTailBytes ?? 4000)
            : { output: '' };
        const maintenanceOutput =
            compatibilityMaintenance && completedWithinWait
                ? await readJobOutput(job.id, ownerPrincipalKey, 50_000)
                : { output: '' };
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
 * @param {import('../config.js').McpValidationProcessConfig} config
 * @param {{ timeoutMs?: number | undefined; signal?: AbortSignal; ownerPrincipalKey: string }} options
 * @returns {Promise<ValidationJobOperationResult>}
 */
export async function startValidatorJobOperation(validator, workspace, config, options) {
    try {
        const job = await spawnValidatorJob(validator, {
            workspace,
            config,
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            ...(options.signal ? { signal: options.signal } : {}),
            ownerPrincipalKey: options.ownerPrincipalKey,
        });
        return success({ success: true, job }, `Started job ${job.id} (${validator}).`);
    } catch (error) {
        return failure('Validator job was rejected.', {
            code: error && typeof error === 'object' && 'code' in error ? error.code : 'ERR_VALIDATOR_JOB_REJECTED',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** @param {{ status?: 'running'|'completed'|'failed'|'cancelled'|undefined; validator?: string|undefined; limit?: number|undefined; includeCompleted?: boolean|undefined }} input @param {string} ownerPrincipalKey */
export async function listValidationJobs(input, ownerPrincipalKey) {
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
        ownerPrincipalKey,
    });
    return success({ success: true, count: jobs.length, jobs });
}

/** @param {{ validator?: string|undefined; includeOutputTail?: boolean|undefined; tailBytes?: number|undefined }} input @param {string} ownerPrincipalKey */
export async function readLastValidationSummary(input, ownerPrincipalKey) {
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
        ownerPrincipalKey,
    });
    const latestByValidator = latestJobsByValidator(jobs);
    const selected = input.validator
        ? Object.values(latestByValidator).filter((job) => job.validator === input.validator)
        : Object.values(latestByValidator).sort((left, right) => left.validator.localeCompare(right.validator));
    const summaries = [];
    for (const job of selected) {
        const summary = summarizeValidationJob(job);
        if (input.includeOutputTail === true) {
            const output = await readJobOutput(job.id, ownerPrincipalKey, input.tailBytes ?? 8000);
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
                'mcp_validation_dashboard view=latest',
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

/** @param {{
 * view?: 'dashboard'|'list'|'latest'|undefined;
 * status?: 'running'|'completed'|'failed'|'cancelled'|undefined;
 * validator?: string|undefined;
 * limit?: number|undefined;
 * includeCompleted?: boolean|undefined;
 * includeOutputTail?: boolean|undefined;
 * tailBytes?: number|undefined;
 * includeRunning?: boolean|undefined;
 * includeLatest?: boolean|undefined;
 * includeDetails?: boolean|undefined;
 * }} input @param {import('../config.js').McpValidationProcessConfig} config @param {string} ownerPrincipalKey */
export async function readValidationDashboard(input, config, ownerPrincipalKey) {
    const view = input.view ?? 'dashboard';
    if (view === 'list') {
        if (
            input.includeOutputTail !== undefined ||
            input.tailBytes !== undefined ||
            input.includeRunning !== undefined ||
            input.includeLatest !== undefined ||
            input.includeDetails !== undefined
        ) {
            return failure('Inactive dashboard/latest fields are not valid with view=list.', {
                code: 'ERR_VALIDATION_DASHBOARD_VIEW_FIELDS',
                view,
            });
        }
        return listValidationJobs({
            status: input.status,
            validator: input.validator,
            limit: input.limit,
            includeCompleted: input.includeCompleted,
        }, ownerPrincipalKey);
    }
    if (view === 'latest') {
        if (
            input.status !== undefined ||
            input.includeCompleted !== undefined ||
            input.includeRunning !== undefined ||
            input.includeLatest !== undefined ||
            input.includeDetails !== undefined ||
            input.limit !== undefined
        ) {
            return failure('Inactive dashboard/list fields are not valid with view=latest.', {
                code: 'ERR_VALIDATION_DASHBOARD_VIEW_FIELDS',
                view,
            });
        }
        return readLastValidationSummary({
            validator: input.validator,
            includeOutputTail: input.includeOutputTail,
            tailBytes: input.tailBytes,
        }, ownerPrincipalKey);
    }
    if (
        input.status !== undefined ||
        input.validator !== undefined ||
        input.includeCompleted !== undefined ||
        input.includeOutputTail !== undefined ||
        input.tailBytes !== undefined
    ) {
        return failure('List/latest-only fields require an explicit mcp_validation_dashboard view.', {
            code: 'ERR_VALIDATION_DASHBOARD_VIEW_FIELDS',
            view,
        });
    }
    const includeDetails = input.includeDetails === true;
    const jobs = await listJobs({ includeCompleted: true, limit: input.limit ?? 80, ownerPrincipalKey });
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
        validatorCapacity: readCopilotValidatorCapacityState(config, ownerPrincipalKey),
        runningCount: running.length,
        orphanedCount: orphaned.length,
        latestCount: latest.length,
        effectiveChecks,
        recommendedNextAction: recommendValidationAction(effectiveChecks),
        productivity: summarizeValidationProductivity(jobs),
        failingJobIds: latest
            .map(summarizeValidationJob)
            .filter((job) => job['status'] === 'failed')
            .map((job) => job['id'])
            .slice(0, 5),
        cancelledJobIds: latest
            .map(summarizeValidationJob)
            .filter((job) => job['status'] === 'cancelled')
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

/** @param {string} jobId @param {string} ownerPrincipalKey */
export async function readValidationJobSummary(jobId, ownerPrincipalKey) {
    const result = await readJobOutput(jobId, ownerPrincipalKey, 1000);
    if (!result.job) {
        return failure('Job not found.', {
            code: 'ERR_JOB_NOT_FOUND',
            hint: 'Use a job id returned by a validator tool, or call mcp_validation_dashboard view=latest.',
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

/** @param {string} jobId @param {string} ownerPrincipalKey @param {number | undefined} tailBytes */
export async function readValidationJobOutput(jobId, ownerPrincipalKey, tailBytes) {
    const result = await readJobOutput(jobId, ownerPrincipalKey, tailBytes ?? 8000);
    if (!result.job) {
        return failure('Job not found.', {
            code: 'ERR_JOB_NOT_FOUND',
            hint: 'Use the jobId returned by run_copilot_validator in the current MCP process.',
            jobId,
        });
    }
    return success({ success: true, ...result }, result.output);
}

/** @param {string} jobId @param {string} ownerPrincipalKey */
export async function cancelValidationJob(jobId, ownerPrincipalKey) {
    const result = await cancelJob(jobId, ownerPrincipalKey);
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
