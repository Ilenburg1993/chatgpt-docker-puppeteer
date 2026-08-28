// @ts-check
/**
 * Tests for MCP validator job command catalog.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext, getResultExecutionHint } from '#copilot/mcp/public/protocol/tools';
import {
    cancelJob,
    normalizeFocusedUnitTestFiles,
    readCopilotValidatorCapacityState,
    readJobOutput,
    resolveFocusedUnitTestCommand,
    resolveValidatorCommand,
} from '#copilot/mcp/public/validation';
import { resolveSafeValidationSuite } from '#copilot/mcp/public/validation/suites';
import { jobTools } from '#copilot/testing/mcp/tools/jobs';
import {
    buildEffectiveValidationChecks,
    pruneCompletedJobRecords,
    readMcpValidationProcessConfig,
    readValidatorResourceSnapshot,
    recommendValidationAction,
    resolveJobTimeoutMs,
    resolveValidatorVitestMaxWorkers,
    summarizeValidationProductivity,
} from '#copilot/testing/mcp/validation';
import {
    runBoundedDevcontainerValidationProcess,
    validateDevcontainerBashFile,
} from '#copilot/testing/mcp/validation/devcontainer-shell';

const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-jobs-unit-process-host',
    backgroundServices: false,
});
const TEST_WORKSPACE = TEST_PROCESS_HOST.workspace;
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-jobs-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_jobs' },
            envelope: { protocol: '2026' },
        },
    },
    { workspace: TEST_WORKSPACE, config: TEST_PROCESS_HOST.processConfig.toolConfig },
);

/** @param {string} name */
function findJobTool(name) {
    const definition = jobTools.find((candidate) => candidate.name === name);
    assert.ok(definition, `missing job tool ${name}`);
    return {
        ...definition,
        handler: /** @type {typeof definition.handler} */ (
            (input) => definition.handler(input, TOOL_OPERATION_CONTEXT)
        ),
    };
}

describe('copilot MCP jobs', () => {
    it('resolves only allowlisted validator commands', () => {
        assert.deepEqual(resolveValidatorCommand('typecheck'), {
            command: 'npm',
            args: ['run', 'typecheck:strict:src.copilot'],
        });
        assert.deepEqual(resolveValidatorCommand('lint'), {
            command: 'npm',
            args: ['run', 'lint:copilot'],
        });
        assert.deepEqual(resolveValidatorCommand('unit-copilot'), {
            command: 'npm',
            args: ['run', 'test:copilot:unit'],
        });
        assert.deepEqual(resolveValidatorCommand('unit-mcp'), {
            command: 'npx',
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        });
        assert.deepEqual(
            resolveValidatorCommand('unit-focused', {
                testFiles: ['tests/unit/copilot/mcp/test_mcp_jobs.spec.js'],
            }),
            {
                command: 'npx',
                args: [
                    'vitest',
                    '--config',
                    'vitest.copilot.config.js',
                    'run',
                    'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
                ],
            },
        );
        assert.deepEqual(resolveValidatorCommand('devcontainer-shell'), {
            command: 'node',
            args: ['src/copilot/mcp/scripts/validate-devcontainer-shell.js'],
        });
        assert.deepEqual(resolveValidatorCommand('network-contracts'), {
            command: 'node',
            args: [
                'src/copilot/mcp/scripts/network-summary-contracts.js',
                'validate',
                '.devcontainer/scripts/network/contracts/summary-contracts.jsonc',
            ],
        });
        assert.deepEqual(resolveValidatorCommand('dependency-outdated'), {
            command: 'node',
            args: ['src/copilot/mcp/scripts/dependency-maintenance-runner.js', 'outdated'],
        });
        assert.throws(
            () => Reflect.apply(resolveValidatorCommand, undefined, ['dependency-upgrade']),
            /Unsupported validator/u,
        );
        assert.deepEqual(resolveValidatorCommand('suite-mcp-fast'), {
            command: 'node',
            args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'mcp-fast'],
        });
        assert.deepEqual(resolveValidatorCommand('suite-mcp-full'), {
            command: 'node',
            args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'mcp-full'],
        });
        assert.deepEqual(resolveValidatorCommand('suite-copilot-fast'), {
            command: 'node',
            args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'copilot-fast'],
        });
    });

    it('validates Bash syntax one file per bounded process and attributes syntax failures', async () => {
        const dir = await mkdir(join(process.cwd(), 'src/copilot/.ai/jobs/devcontainer-shell-validator-test'), {
            recursive: true,
        }).then(() => join(process.cwd(), 'src/copilot/.ai/jobs/devcontainer-shell-validator-test'));
        const valid = join(dir, 'valid.sh');
        const invalid = join(dir, 'invalid.sh');
        await Promise.all([
            writeFile(valid, '#!/usr/bin/env bash\necho ok\n', 'utf8'),
            writeFile(invalid, '#!/usr/bin/env bash\nif true; then\n', 'utf8'),
        ]);
        try {
            const [validResult, invalidResult] = await Promise.all([
                validateDevcontainerBashFile(valid, {
                    timeoutMs: 2_000,
                    childEnvironment: TEST_PROCESS_HOST.processConfig.validation.childEnvironment,
                }),
                validateDevcontainerBashFile(invalid, {
                    timeoutMs: 2_000,
                    childEnvironment: TEST_PROCESS_HOST.processConfig.validation.childEnvironment,
                }),
            ]);
            assert.equal(validResult.ok, true);
            assert.equal(validResult.timedOut, false);
            assert.equal(invalidResult.ok, false);
            assert.equal(invalidResult.timedOut, false);
            assert.notEqual(invalidResult.exitCode, 0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('observes physical child close before reporting DevContainer caller cancellation', async () => {
        const controller = new AbortController();
        const pending = runBoundedDevcontainerValidationProcess(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            {
                timeoutMs: 5_000,
                cwd: process.cwd(),
                env: TEST_PROCESS_HOST.processConfig.validation.childEnvironment,
                signal: controller.signal,
            },
        );
        setTimeout(() => controller.abort(new Error('unit-cancel')), 40).unref();
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.cancelled, true);
        assert.equal(result.timedOut, false);
        assert.equal(result.terminationRequested, true);
        assert.equal(result.lifecycleState, 'closed');
    });

    it('observes physical child close before reporting a DevContainer validation timeout', async () => {
        const result = await runBoundedDevcontainerValidationProcess(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            { timeoutMs: 40, cwd: process.cwd(), env: TEST_PROCESS_HOST.processConfig.validation.childEnvironment },
        );

        assert.equal(result.ok, false);
        assert.equal(result.timedOut, true);
        assert.equal(result.terminationRequested, true);
        assert.equal(result.lifecycleState, 'closed');
        assert.ok(result.durationMs < 5_000, `timeout child took ${String(result.durationMs)}ms to close`);
    });

    it('rejects unsupported validators', () => {
        assert.throws(() => resolveValidatorCommand(/** @type {any} */ ('admin-command')), /Unsupported validator/);
    });

    it('keeps focused unit-test execution bounded to explicit canonical Copilot test files', () => {
        assert.deepEqual(
            normalizeFocusedUnitTestFiles([
                'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
                'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
            ]),
            ['tests/unit/copilot/mcp/test_mcp_jobs.spec.js'],
        );
        assert.deepEqual(resolveFocusedUnitTestCommand(['tests/unit/copilot/mcp/test_mcp_jobs.spec.js']), {
            command: 'npx',
            args: [
                'vitest',
                '--config',
                'vitest.copilot.config.js',
                'run',
                'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
            ],
        });
        assert.throws(
            () => normalizeFocusedUnitTestFiles(['tests/unit/copilot/mcp/*.spec.js']),
            /Focused unit-test path/u,
        );
        assert.throws(
            () => normalizeFocusedUnitTestFiles(['tests/unit/copilot/mcp/../test_mcp_jobs.spec.js']),
            /Focused unit-test path/u,
        );
        assert.throws(
            () => normalizeFocusedUnitTestFiles(['src/copilot/mcp/tools/jobs.js']),
            /Focused unit-test path/u,
        );
    });

    it('resolves fixed safe validation suite steps', () => {
        assert.deepEqual(
            resolveSafeValidationSuite('mcp-fast').map((step) => step.name),
            ['typecheck', 'unit-mcp'],
        );
        const mcpFull = resolveSafeValidationSuite('mcp-full');
        assert.deepEqual(
            mcpFull.map((step) => step.name),
            ['typecheck', 'lint-changed', 'docs-contract', 'architecture-contract', 'lint', 'unit-mcp'],
        );
        const mcpFullUnit = mcpFull.find((step) => step.name === 'unit-mcp');
        assert.ok(mcpFullUnit?.args.includes('--reporter=dot'));
        assert.ok(mcpFullUnit?.args.includes('--silent=passed-only'));
        assert.deepEqual(
            resolveSafeValidationSuite('copilot-fast').map((step) => step.name),
            ['typecheck', 'lint', 'docs-contract', 'architecture-contract', 'unit-copilot'],
        );
        assert.throws(
            () => resolveSafeValidationSuite(/** @type {any} */ ('admin-command')),
            /Unsupported validation suite/,
        );
    });

    it('captures a bounded validator resource snapshot without subprocesses', async () => {
        const snapshot = await readValidatorResourceSnapshot();
        assert.match(snapshot.observedAt, /^\d{4}-\d{2}-\d{2}T/u);
        assert.ok(snapshot.mcpProcessRssBytes > 0);
        assert.ok(snapshot.systemTotalBytes > 0);
        assert.ok(snapshot.systemFreeBytes >= 0);
        assert.ok(snapshot.availableParallelism >= 1);
        assert.equal(snapshot.loadAverage.length, 3);
        assert.ok(snapshot.cgroup.memoryCurrentBytes === null || snapshot.cgroup.memoryCurrentBytes >= 0);
        assert.ok(snapshot.cgroup.memoryMaxBytes === null || snapshot.cgroup.memoryMaxBytes >= 0);
    });

    it('bounds validator resource policy for WSL-safe execution', () => {
        assert.equal(resolveValidatorVitestMaxWorkers({}), 2);
        assert.equal(resolveValidatorVitestMaxWorkers({ COPILOT_VALIDATOR_VITEST_MAX_WORKERS: '1' }), 1);
        assert.equal(resolveValidatorVitestMaxWorkers({ COPILOT_VALIDATOR_VITEST_MAX_WORKERS: '99' }), 2);
        const config = readMcpValidationProcessConfig({
            PATH: '/usr/bin:/bin',
            LANG: 'C.UTF-8',
            VITEST: 'true',
            COPILOT_VALIDATOR_VITEST_MAX_WORKERS: '1',
            OPENAI_API_KEY: 'must-not-cross',
        });
        assert.equal(config.inlineAllowed, false);
        assert.equal(config.vitestMaxWorkers, 1);
        assert.equal(config.childEnvironment['VITEST_MAX_WORKERS'], '1');
        assert.equal(config.childEnvironment['OPENAI_API_KEY'], undefined);
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.childEnvironment), true);
        const capacity = readCopilotValidatorCapacityState(config);
        assert.match(capacity.runtimeEpoch, /^[0-9a-f-]{36}$/iu);
        assert.ok(capacity.ownerPid > 0);
        assert.equal(capacity.maxActive, 1);
        assert.equal(capacity.vitestMaxWorkers, 1);
        assert.equal(capacity.activeCount, 0);
    });

    it('normalizes job timeouts inside supported bounds', () => {
        assert.equal(resolveJobTimeoutMs(undefined), 1_200_000);
        assert.equal(resolveJobTimeoutMs(10), 1_000);
        assert.equal(resolveJobTimeoutMs(2_500), 2_500);
        assert.equal(resolveJobTimeoutMs(9_999_999), 3_600_000);
    });

    it('does not misclassify cancelled validation as a failure requiring log-tail inspection', () => {
        const cancelled = /** @type {any} */ ({
            id: randomUUID(),
            validator: 'unit-copilot',
            status: 'cancelled',
            startedAt: 1_000,
            endedAt: 6_000,
            exitCode: null,
            signal: 'SIGTERM',
            command: 'npm',
            args: ['run', 'test:copilot:unit'],
            timeoutMs: 60_000,
            timedOut: false,
            terminationRequested: 'cancel',
            terminationRequestedAt: 5_900,
            logFile: '/tmp/cancelled.log',
            manifestFile: '/tmp/cancelled.json',
            runtimeAttached: null,
            runtimeSameEpoch: false,
            process: null,
            supervisor: null,
            completion: null,
        });
        const effective = buildEffectiveValidationChecks([cancelled]);
        assert.equal(effective['unit-copilot']?.['effectiveStatus'], 'cancelled');
        assert.equal(recommendValidationAction(effective), 'none');

        const failed = /** @type {any} */ ({ ...cancelled, id: randomUUID(), validator: 'lint', status: 'failed' });
        assert.equal(
            recommendValidationAction(buildEffectiveValidationChecks([failed])),
            'read-small-tail-for-failing-job',
        );
    });

    it('summarizes validation wall-time and repeat pressure without claiming duplicates absent source identity', () => {
        const base = {
            exitCode: 0,
            signal: null,
            command: 'npm',
            args: [],
            timeoutMs: 600_000,
            timedOut: false,
            terminationRequested: null,
            terminationRequestedAt: null,
            logFile: '/tmp/job.log',
            manifestFile: '/tmp/job.json',
            runtimeAttached: null,
            runtimeSameEpoch: false,
            process: null,
            supervisor: null,
            completion: null,
        };
        const jobs = /** @type {any[]} */ ([
            { ...base, id: randomUUID(), validator: 'lint', status: 'completed', startedAt: 1_000, endedAt: 2_000 },
            { ...base, id: randomUUID(), validator: 'lint', status: 'completed', startedAt: 3_000, endedAt: 5_000 },
            {
                ...base,
                id: randomUUID(),
                validator: 'suite-mcp-full',
                status: 'completed',
                startedAt: 10_000,
                endedAt: 20_000,
            },
            {
                ...base,
                id: randomUUID(),
                validator: 'unit-focused',
                status: 'completed',
                startedAt: 21_000,
                endedAt: 24_000,
            },
        ]);
        const productivity = summarizeValidationProductivity(jobs);
        assert.equal(productivity.jobsConsidered, 4);
        assert.equal(productivity.finishedJobs, 4);
        assert.equal(productivity.totalFinishedDurationMs, 16_000);
        assert.equal(productivity.broadSuiteRuns, 1);
        assert.equal(productivity.broadSuiteDurationMs, 10_000);
        assert.equal(productivity.focusedRuns, 1);
        assert.equal(productivity.focusedDurationMs, 3_000);
        assert.equal(productivity.repeatRunPressure, 1);
        assert.equal(productivity.duplicateValidationCount, null);
        assert.equal(productivity.duplicateClassification, 'requires-source-state-binding');
        assert.equal(productivity.byValidator['lint']?.runs, 2);
    });

    it('prunes only the oldest completed in-memory jobs', () => {
        /** @type {Map<string, any>} */
        const records = new Map([
            ['old', { id: 'old', status: 'completed', process: null, startedAt: 1, endedAt: 2 }],
            ['running', { id: 'running', status: 'running', process: {}, startedAt: 3, endedAt: null }],
            ['failed', { id: 'failed', status: 'failed', process: null, startedAt: 4, endedAt: 5 }],
            ['new', { id: 'new', status: 'completed', process: null, startedAt: 6, endedAt: 7 }],
        ]);

        assert.equal(pruneCompletedJobRecords(records, 2), 2);
        assert.deepEqual([...records.keys()], ['running', 'new']);
    });

    it('rejects non-UUID job ids before resolving artifact paths', async () => {
        assert.deepEqual(await readJobOutput('../../package'), { job: null, output: '' });
    });

    it('ignores persisted logFile paths and reads only the canonical bounded job log', async () => {
        const id = randomUUID();
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        const manifestFile = join(jobsDir, `${id}.json`);
        const logFile = join(jobsDir, `${id}.log`);
        await mkdir(jobsDir, { recursive: true });
        try {
            await writeFile(
                manifestFile,
                JSON.stringify({
                    id,
                    validator: 'typecheck',
                    status: 'completed',
                    startedAt: 1,
                    endedAt: 2,
                    exitCode: 0,
                    signal: null,
                    command: 'npm',
                    args: [],
                    timeoutMs: 1000,
                    timedOut: false,
                    logFile: '/etc/hosts',
                    manifestFile: '/tmp/forged.json',
                }),
            );
            await writeFile(logFile, 'prefix-safe-log-tail');

            const result = await readJobOutput(id, 13);

            assert.equal(result.job?.logFile, logFile);
            assert.equal(result.job?.manifestFile, manifestFile);
            assert.equal(result.output, 'safe-log-tail');
        } finally {
            await rm(manifestFile, { force: true });
            await rm(logFile, { force: true });
        }
    });

    it('marks persisted running manifests as unattached and refuses unsafe cancellation', async () => {
        const id = randomUUID();
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        const manifestFile = join(jobsDir, `${id}.json`);
        const logFile = join(jobsDir, `${id}.log`);
        await mkdir(jobsDir, { recursive: true });
        try {
            const command = resolveValidatorCommand('typecheck');
            await writeFile(
                manifestFile,
                JSON.stringify({
                    id,
                    validator: 'typecheck',
                    status: 'running',
                    startedAt: Date.now() - 10_000,
                    endedAt: null,
                    exitCode: null,
                    signal: null,
                    command: command.command,
                    args: command.args,
                    timeoutMs: 60_000,
                    timedOut: false,
                }),
            );
            await writeFile(logFile, 'persisted-running-job');

            const observed = await readJobOutput(id);
            assert.equal(observed.job?.status, 'running');
            assert.equal(observed.job?.runtimeAttached, false);

            const cancelled = await cancelJob(id);
            assert.equal(cancelled.ok, false);
            assert.equal(cancelled.unattached, true);
            assert.equal(cancelled.job?.runtimeAttached, false);
            assert.match(cancelled.message, /not attached to the current MCP runtime/u);
        } finally {
            await rm(manifestFile, { force: true });
            await rm(logFile, { force: true });
        }
    });

    it('refuses symbolic-link job logs', async () => {
        const id = randomUUID();
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        const manifestFile = join(jobsDir, `${id}.json`);
        const logFile = join(jobsDir, `${id}.log`);
        await mkdir(jobsDir, { recursive: true });
        try {
            await writeFile(
                manifestFile,
                JSON.stringify({
                    id,
                    validator: 'typecheck',
                    status: 'completed',
                    startedAt: 1,
                    endedAt: 2,
                    exitCode: 0,
                    signal: null,
                    command: 'npm',
                    args: [],
                    timeoutMs: 1000,
                    timedOut: false,
                }),
            );
            await symlink(join(process.cwd(), 'package.json'), logFile);

            const result = await readJobOutput(id);

            assert.equal(result.job?.id, id);
            assert.equal(result.output, '');
        } finally {
            await rm(manifestFile, { force: true });
            await rm(logFile, { force: true });
        }
    });

    it('exposes canonical validator owners without legacy aliases', () => {
        const names = jobTools.map((tool) => tool.name);
        assert.equal(names.includes('run_typecheck_copilot'), false);
        assert.equal(names.includes('run_lint_copilot'), false);
        assert.equal(names.includes('run_unit_copilot'), false);
        assert.equal(names.includes('run_project_doctor'), false);
        assert.ok(names.includes('run_copilot_validator'));
        assert.ok(names.includes('mcp_run_safe_validation_suite'));
        assert.ok(names.includes('mcp_validation_dashboard'));
        assert.equal(names.includes('job_list'), false);
        assert.equal(names.includes('mcp_last_validation_summary'), false);
    });

    it('keeps the exposed validator schema future-proof while enforcing the runtime allowlist server-side', async () => {
        const tool = findJobTool('run_copilot_validator');

        const rejected = await tool.handler({ validator: 'future-unsafe-command' });
        assert.equal(rejected.isError, true);
        assert.equal(rejected.structuredContent?.['code'], 'ERR_UNSUPPORTED_VALIDATOR');
        const details = /** @type {Record<string, unknown>} */ (rejected.structuredContent?.['details']);
        const allowed = /** @type {string[]} */ (details['allowedValidators']);
        assert.ok(allowed.includes('devcontainer-shell'));
        assert.ok(allowed.includes('network-contracts'));
        assert.ok(allowed.includes('unit-focused'));
        assert.equal(allowed.includes('future-unsafe-command'), false);
    });

    it('requires explicit focused files only for validator=unit-focused', async () => {
        const tool = findJobTool('run_copilot_validator');

        const missingFile = await tool.handler({ validator: 'unit-focused' });
        assert.equal(missingFile.isError, true);
        assert.equal(missingFile.structuredContent?.['code'], 'ERR_FOCUSED_TEST_FILE_REQUIRED');

        const unexpectedFile = await tool.handler({
            validator: 'typecheck',
            testFile: 'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
        });
        assert.equal(unexpectedFile.isError, true);
        assert.equal(unexpectedFile.structuredContent?.['code'], 'ERR_UNEXPECTED_FOCUSED_TEST_FILE');
    });

    it('run_copilot_validator blocks nested validator subprocesses inside Vitest', async () => {
        const tool = findJobTool('run_copilot_validator');
        const result = await tool.handler({
            validator: 'unit-focused',
            testFile: 'tests/unit/copilot/infra/test_bulk_executor.spec.js',
        });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_VALIDATOR_NESTED_RUNNER_BLOCKED');
        const details = /** @type {Record<string, unknown>} */ (result.structuredContent?.['details']);
        assert.match(String(details['error'] ?? ''), /test runners/i);
    });

    it('run_copilot_validator batches remain serialized and isolate invalid-path from nested-runner failures', async () => {
        const tool = findJobTool('run_copilot_validator');
        const result = await tool.handler({
            batch: [
                {
                    validator: 'unit-focused',
                    testFile: 'tests/unit/copilot/infra/does-not-exist-validator-batch.spec.js',
                },
                {
                    validator: 'unit-focused',
                    testFile: 'tests/unit/copilot/infra/test_bulk_executor.spec.js',
                },
            ],
            batchConcurrency: 2,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        assert.equal(result.structuredContent?.['succeededCount'], 0);
        assert.equal(result.structuredContent?.['failedCount'], 2);
        assert.equal(result.structuredContent?.['skippedCount'], 0);
        assert.equal(result.structuredContent?.['concurrency'], 1);
        assert.equal(result.structuredContent?.['requestedConcurrency'], 2);
        assert.equal(result.structuredContent?.['effectiveConcurrency'], 1);
        assert.equal(result.structuredContent?.['compatibilityNormalized'], true);
        assert.deepEqual(getResultExecutionHint(result), {
            logicalOperations: 2,
            failedOperations: 2,
            skippedOperations: 0,
            mode: 'validator-batch:best-effort:c1',
        });
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(rows[0]?.['success'], false);
        assert.equal(rows[0]?.['code'], 'ERR_INVALID_FOCUSED_TEST_FILE');
        assert.equal(rows[1]?.['success'], false);
        assert.equal(rows[1]?.['code'], 'ERR_VALIDATOR_NESTED_RUNNER_BLOCKED');
    });

    it('mcp_validation_dashboard preserves filtered list and latest-summary projections', async () => {
        const tool = findJobTool('mcp_validation_dashboard');
        const listed = await tool.handler({ view: 'list', limit: 5 });
        assert.equal(listed.isError, undefined);
        assert.equal(listed.structuredContent?.['success'], true);
        assert.ok(Array.isArray(listed.structuredContent?.['jobs']));

        const latest = await tool.handler({ view: 'latest' });
        assert.equal(latest.isError, undefined);
        assert.equal(latest.structuredContent?.['success'], true);
        assert.ok(Array.isArray(latest.structuredContent?.['summaries']));
        assert.equal(typeof latest.structuredContent?.['effectiveChecks'], 'object');
    });

    it('mcp_validation_dashboard rejects fields from inactive projections', async () => {
        const tool = findJobTool('mcp_validation_dashboard');
        const conflict = await tool.handler({ view: 'list', includeOutputTail: true });
        assert.equal(conflict.isError, true);
        assert.equal(conflict.structuredContent?.['code'], 'ERR_VALIDATION_DASHBOARD_VIEW_FIELDS');
    });
});
