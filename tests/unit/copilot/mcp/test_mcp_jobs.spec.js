// @ts-check
/**
 * Tests for MCP validator job command catalog.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import {
    cancelJob,
    getResultExecutionHint,
    normalizeFocusedUnitTestFiles,
    pruneCompletedJobRecords,
    readJobOutput,
    resolveFocusedUnitTestCommand,
    resolveJobTimeoutMs,
    resolveValidatorCommand,
} from '#copilot/mcp/control-plane';
import { resolveSafeValidationSuite } from '#copilot/mcp/scripts';
import { jobTools } from '#copilot/mcp/tools';

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
        assert.deepEqual(
            resolveSafeValidationSuite('mcp-full').map((step) => step.name),
            ['typecheck', 'lint', 'docs-contract', 'architecture-contract', 'unit-mcp'],
        );
        assert.deepEqual(
            resolveSafeValidationSuite('copilot-fast').map((step) => step.name),
            ['typecheck', 'lint', 'docs-contract', 'architecture-contract', 'unit-copilot'],
        );
        assert.throws(
            () => resolveSafeValidationSuite(/** @type {any} */ ('admin-command')),
            /Unsupported validation suite/,
        );
    });

    it('normalizes job timeouts inside supported bounds', () => {
        assert.equal(resolveJobTimeoutMs(undefined), 1_200_000);
        assert.equal(resolveJobTimeoutMs(10), 1_000);
        assert.equal(resolveJobTimeoutMs(2_500), 2_500);
        assert.equal(resolveJobTimeoutMs(9_999_999), 3_600_000);
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

    it('exposes canonical validator alias tools', () => {
        const names = jobTools.map((tool) => tool.name);
        assert.ok(names.includes('run_typecheck_copilot'));
        assert.ok(names.includes('run_lint_copilot'));
        assert.ok(names.includes('run_unit_copilot'));
        assert.ok(names.includes('run_project_doctor'));
        assert.ok(names.includes('mcp_run_safe_validation_suite'));
        assert.ok(names.includes('job_list'));
    });

    it('requires explicit focused files only for validator=unit-focused', async () => {
        const tool = jobTools.find((candidate) => candidate.name === 'run_copilot_validator');
        assert.ok(tool);

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

    it('run_copilot_validator defaults focused validation to bounded inline completion without a follow-up poll', async () => {
        const tool = jobTools.find((candidate) => candidate.name === 'run_copilot_validator');
        assert.ok(tool);
        const result = await tool.handler({
            validator: 'unit-focused',
            testFile: 'tests/unit/copilot/infra/test_bulk_executor.spec.js',
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['completedWithinWait'], true);
        const job = /** @type {Record<string, unknown>} */ (result.structuredContent?.['job']);
        assert.equal(job['status'], 'completed');
        assert.equal(job['passed'], true);
        assert.match(String(result.structuredContent?.['nextAction'] ?? ''), /No job_get_summary/u);
    }, 45_000);

    it('run_copilot_validator batches focused gates and isolates one invalid item', async () => {
        const tool = jobTools.find((candidate) => candidate.name === 'run_copilot_validator');
        assert.ok(tool);
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
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        assert.equal(result.structuredContent?.['succeededCount'], 1);
        assert.equal(result.structuredContent?.['failedCount'], 1);
        assert.equal(result.structuredContent?.['skippedCount'], 0);
        assert.equal(result.structuredContent?.['concurrency'], 1);
        assert.deepEqual(getResultExecutionHint(result), {
            logicalOperations: 2,
            failedOperations: 1,
            skippedOperations: 0,
            mode: 'validator-batch:best-effort:c1',
        });
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(rows[0]?.['success'], false);
        assert.equal(rows[0]?.['code'], 'ERR_INVALID_FOCUSED_TEST_FILE');
        assert.equal(rows[1]?.['success'], true);
        const validJob = /** @type {Record<string, unknown>} */ (rows[1]?.['job']);
        assert.equal(validJob['passed'], true);
    }, 45_000);

    it('job_list returns a structured job array', async () => {
        const tool = jobTools.find((candidate) => candidate.name === 'job_list');
        assert.ok(tool);
        const result = await tool.handler({ limit: 5 });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Array.isArray(result.structuredContent?.['jobs']));
    });
});
