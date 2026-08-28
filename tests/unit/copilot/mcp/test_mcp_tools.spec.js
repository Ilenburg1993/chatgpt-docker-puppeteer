// @ts-check
/**
 * Tests for first-band Copilot MCP tools.
 */

import { adaptBetterSqliteDatabase, createBetterSqliteProvider } from '#copilot/infra/public/testing/database/sqlite';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

import { configureApplicationInfraSqliteProvider, getApplicationInfraRuntime } from '#copilot/boot';
import { ensureIoIndexSchema } from '#copilot/infra/public/testing/indexing/sqlite';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { recordMcpToolMetric } from '#copilot/mcp/public/observability';
import {
    createMcpToolOperationContext,
    getResultExecutionHint,
    okResult,
    withResultExecutionHint,
} from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import {
    MCP_WORKFLOW_POLICY_VERSION,
    buildMcpWorkflowStatusProjection,
    readMcpWorkflowPolicy,
} from '#copilot/mcp/public/workflow-policy';
import { readRepoReadFileResultCacheStats } from '#copilot/mcp/public/workspace/repository/read-cache';
import { summarizeMcpRoundTripRows } from '#copilot/testing/mcp/diagnostics/latency/round-trip';
import { resetMcpMetricsForTests } from '#copilot/testing/mcp/observability';
import {
    readMcpRepoReadCacheConfig,
    resetRepoReadResponseCacheForTest,
} from '#copilot/testing/mcp/workspace/repository/read-cache';

/** @type {import('better-sqlite3').Database | null} */
let testInfraDb = null;
const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-tools-unit-process-host',
    backgroundServices: false,
});
const TEST_WORKSPACE = TEST_PROCESS_HOST.workspace;
const TEST_CANONICAL_TOOLS = Object.freeze(
    getCanonicalMcpTools({
        registryPolicy: TEST_PROCESS_HOST.processConfig.registry.policy,
        toolSurfacePolicy: TEST_PROCESS_HOST.processConfig.registry.surfacePolicy,
        authConfig: TEST_PROCESS_HOST.processConfig.auth.config,
    }),
);
const TEST_TOOL_SURFACE = Object.freeze({
    tools: TEST_CANONICAL_TOOLS,
    names: Object.freeze(TEST_CANONICAL_TOOLS.map((tool) => tool.name)),
});
const TEST_TOOL_CAPABILITIES = Object.freeze({
    ...TEST_PROCESS_HOST.toolCapabilities,
    toolSurface: TEST_TOOL_SURFACE,
});
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-tools-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_tools' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: TEST_WORKSPACE,
        config: TEST_PROCESS_HOST.processConfig.toolConfig,
        capabilities: TEST_TOOL_CAPABILITIES,
    },
);
const TEST_REPO_READ_CACHE_CONFIG = TEST_PROCESS_HOST.processConfig.toolConfig.repositoryReadCache;

/** @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} repositoryReadCache */
function createToolContextWithRepositoryReadCache(repositoryReadCache) {
    return createMcpToolOperationContext(
        {
            mcpReq: {
                id: `mcp-tools-unit-cache-${repositoryReadCache.policyKey}`,
                method: 'tools/call',
                signal: new AbortController().signal,
                _meta: { caller: 'test_mcp_tools' },
                envelope: { protocol: '2026' },
            },
        },
        {
            workspace: TEST_WORKSPACE,
            config: { ...TEST_PROCESS_HOST.processConfig.toolConfig, repositoryReadCache },
            capabilities: TEST_TOOL_CAPABILITIES,
        },
    );
}

/** @type {Awaited<ReturnType<typeof TEST_PROCESS_HOST.acquire>> | null} */
let testProcessHostLease = null;

beforeAll(async () => {
    testInfraDb = new Database(':memory:');
    const db = /** @type {import('better-sqlite3').Database} */ (testInfraDb);
    ensureIoIndexSchema(adaptBetterSqliteDatabase(db));
    configureApplicationInfraSqliteProvider(createBetterSqliteProvider(() => db));
    testProcessHostLease = await TEST_PROCESS_HOST.acquire({ reason: 'mcp-tools-unit' });
});

afterAll(async () => {
    await testProcessHostLease?.release();
    testProcessHostLease = null;
    await TEST_PROCESS_HOST.dispose();
    getApplicationInfraRuntime().database.reset();
    if (testInfraDb?.open) testInfraDb.close();
    testInfraDb = null;
});

/** @param {string} name @param {typeof TOOL_OPERATION_CONTEXT} [operationContext] */
function findTool(name, operationContext = TOOL_OPERATION_CONTEXT) {
    const tool = TEST_CANONICAL_TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return {
        ...tool,
        handler: /** @type {typeof tool.handler} */ ((input) => tool.handler(input, operationContext)),
    };
}

describe('copilot MCP tools', () => {
    it('resolves workspace read paths and rejects escapes', async () => {
        const ok = await TEST_WORKSPACE.resolveReadPath('src/copilot/mcp/README.md');
        assert.equal(ok.ok, true);
        if (ok.ok) {
            assert.equal(ok.relative, 'src/copilot/mcp/README.md');
            assert.equal(ok.validatedReadPath, undefined);
        }

        const withCapability = await TEST_WORKSPACE.resolveValidatedReadPath('src/copilot/mcp/README.md');
        assert.equal(withCapability.ok, true);
        if (withCapability.ok) assert.ok(withCapability.validatedReadPath);

        const denied = await TEST_WORKSPACE.resolveReadPath('../package.json');
        assert.equal(denied.ok, false);
        if (!denied.ok) {
            assert.equal(denied.code, 'ERR_PATH_DENIED');
            assert.equal(typeof denied.hint, 'string');
        }
    });

    it('canonical workflow guidance surfaces share one direct-first policy', async () => {
        const policy = readMcpWorkflowPolicy();
        const expectedStatus = buildMcpWorkflowStatusProjection();
        const capabilitiesTool = findTool('mcp_capabilities_summary');
        const session = await capabilitiesTool.handler({ view: 'session' }, TOOL_OPERATION_CONTEXT);
        const status = await capabilitiesTool.handler({ view: 'status' }, TOOL_OPERATION_CONTEXT);
        const capabilities = await capabilitiesTool.handler({}, TOOL_OPERATION_CONTEXT);
        const sessionStructured = /** @type {Record<string, any>} */ (session.structuredContent);
        const statusStructured = /** @type {Record<string, any>} */ (status.structuredContent);
        const capabilityStructured = /** @type {Record<string, any>} */ (capabilities.structuredContent);

        assert.equal(sessionStructured['workflowPolicyVersion'], MCP_WORKFLOW_POLICY_VERSION);
        assert.equal(statusStructured['approvalFrictionProfile']['workflowPolicyVersion'], MCP_WORKFLOW_POLICY_VERSION);
        assert.equal(capabilityStructured['workflowPolicyVersion'], MCP_WORKFLOW_POLICY_VERSION);
        assert.deepEqual(sessionStructured['taskRouting']['validate'], [
            policy.validation.happyPathTool,
            ...policy.validation.pollTools,
        ]);
        assert.equal('planTool' in policy.validation, false);
        assert.deepEqual(statusStructured['approvalFrictionProfile']['planFirstWorkflows'], []);
        assert.deepEqual(
            statusStructured['approvalFrictionProfile']['escalationOnlyPlans'],
            expectedStatus.escalationOnlyPlans,
        );
        const validationWorkflow = sessionStructured['preferredWriteWorkflows'].find(
            (workflow) => workflow['task'] === 'validate',
        );
        assert.ok(validationWorkflow);
        assert.match(String(validationWorkflow['flow'][0]), /run_copilot_validator directly/u);
        assert.match(String(validationWorkflow['flow'][1]), /dryRun=true/u);
    });

    it('execution hints preserve only bounded effective-policy enums outside the MCP wire payload', () => {
        const result = withResultExecutionHint(okResult({ success: true }), {
            logicalOperations: 2,
            executionPolicyClass: 'direct-apply',
            executionFailurePolicyClass: 'fail-fast',
            executionConcurrencyClass: 'parallel-bounded',
        });
        assert.deepEqual(getResultExecutionHint(result), {
            logicalOperations: 2,
            failedOperations: 0,
            skippedOperations: 0,
            executionPolicyClass: 'direct-apply',
            executionFailurePolicyClass: 'fail-fast',
            executionConcurrencyClass: 'parallel-bounded',
        });
        assert.equal(JSON.stringify(result).includes('executionPolicyClass'), false);

        const invalid = withResultExecutionHint(
            okResult({ success: true }),
            /** @type {any} */ ({
                logicalOperations: 1,
                executionPolicyClass: 'arbitrary-policy',
                executionFailurePolicyClass: 'retry-forever',
                executionConcurrencyClass: 'c99',
            }),
        );
        assert.deepEqual(getResultExecutionHint(invalid), {
            logicalOperations: 1,
            failedOperations: 0,
            skippedOperations: 0,
        });
    });

    it('terminal_exec batch exposes logical-operation accounting including fail-fast skips', async () => {
        const tool = findTool('terminal_exec');
        const success = await tool.handler({
            batch: Array.from({ length: 5 }, (_, index) => ({ command: `printf 'batch-${index}'` })),
            batchConcurrency: 2,
            batchFailureMode: 'best-effort',
        });
        const successHint = getResultExecutionHint(success);
        assert.equal(successHint?.logicalOperations, 5);
        assert.equal(successHint?.failedOperations, 0);
        assert.equal(successHint?.skippedOperations, 0);
        assert.equal(successHint?.batchSize, 5);
        assert.equal(successHint?.batchCapacity, 32);
        assert.equal(successHint?.mode, 'terminal-batch:best-effort');

        const failFast = await tool.handler({
            batch: [{ command: 'exit 7' }, { command: "printf 'must-skip-1'" }, { command: "printf 'must-skip-2'" }],
            batchConcurrency: 1,
            batchFailureMode: 'fail-fast',
        });
        const failFastHint = getResultExecutionHint(failFast);
        assert.equal(failFastHint?.logicalOperations, 3);
        assert.equal(failFastHint?.failedOperations, 1);
        assert.equal(failFastHint?.skippedOperations, 2);
        assert.equal(failFastHint?.batchSize, 3);
        assert.equal(failFastHint?.mode, 'terminal-batch:fail-fast');
    });

    it('repo_apply_patch path denial uses the shared failure taxonomy and no-reread recovery semantics', async () => {
        const tool = findTool('repo_apply_patch');
        const result = await tool.handler({
            path: '../package.json',
            old_string: 'not-material',
            new_string: 'not-material-either',
        });
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(result.isError, true);
        assert.equal(structured['code'], 'ERR_PATH_DENIED');
        const details = /** @type {Record<string, unknown>} */ (structured['details']);
        assert.equal(details['failureClass'], 'integrity');
        assert.equal(details['retryability'], 'manual-decision');
        assert.equal(details['recoveryRequired'], false);
        assert.match(String(details['nextAction'] ?? ''), /reread will not bypass/i);
    });

    it('repo_read_file keeps full content only in structuredContent and returns a compact text summary', async () => {
        const tool = findTool('repo_read_file');
        const result = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
        });

        assert.equal(result.isError, undefined);
        assert.ok(result.structuredContent && typeof result.structuredContent === 'object');
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['path'], 'src/copilot/mcp/README.md');
        assert.equal(typeof structured['sha256'], 'string');
        assert.equal(typeof structured['returnedSha256'], 'string');
        assert.ok(String(structured['content'] ?? '').includes('Copilot MCP Server'));
        assert.ok(Array.isArray(result.content));
        const legacyText = String(result.content[0]?.text ?? '');
        assert.match(legacyText, /^Read src\/copilot\/mcp\/README\.md:/u);
        assert.ok(legacyText.includes('structuredContent.content'));
        assert.equal(legacyText.includes('Copilot MCP Server'), false);
        assert.ok(Buffer.byteLength(legacyText, 'utf8') <= 2048);
    });

    it('repo_read_file supports reduced hash payload modes', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const returnedOnly = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
            hashMode: 'returned',
        });
        assert.equal(returnedOnly.isError, undefined);
        assert.equal(returnedOnly.structuredContent?.['hashMode'], 'returned');
        assert.equal(returnedOnly.structuredContent?.['sha256'], undefined);
        assert.equal(typeof returnedOnly.structuredContent?.['returnedSha256'], 'string');

        const noHashes = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
            hashMode: 'none',
        });
        assert.equal(noHashes.isError, undefined);
        assert.equal(noHashes.structuredContent?.['hashMode'], 'none');
        assert.equal(noHashes.structuredContent?.['sha256'], undefined);
        assert.equal(noHashes.structuredContent?.['returnedSha256'], undefined);
        // Uma única entrada rica por path+range serve variantes menos exigentes sem duplicar o corpo em memória.
        assert.equal(readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG).size, 1);
    });

    it('repo_read_file promove uma variante de hash pobre sem duplicar a entrada de resposta', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const args = { path: 'src/copilot/mcp/README.md', startLine: 1, endLine: 8 };

        const none = await tool.handler({ ...args, hashMode: 'none' });
        assert.equal(none.structuredContent?.['sha256'], undefined);
        assert.equal(readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG).size, 1);

        const full = await tool.handler({ ...args, hashMode: 'full' });
        const afterUpgrade = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        assert.equal(typeof full.structuredContent?.['sha256'], 'string');
        assert.equal(typeof full.structuredContent?.['returnedSha256'], 'string');
        assert.equal(afterUpgrade.size, 1);
        assert.equal(afterUpgrade['hashVariantMisses'], 1);

        const returned = await tool.handler({ ...args, hashMode: 'returned' });
        const afterRichHit = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        assert.equal(returned.structuredContent?.['sha256'], undefined);
        assert.equal(typeof returned.structuredContent?.['returnedSha256'], 'string');
        assert.equal(afterRichHit.size, 1);
        assert.equal(afterRichHit['hits'], 1);
    });

    it('repo_read_file batches several reads in one call without duplicating file bodies into legacy text', async () => {
        const tool = findTool('repo_read_file');
        const result = await tool.handler({
            batch: [
                { path: 'src/copilot/mcp/README.md', startLine: 1, endLine: 8, hashMode: 'returned' },
                { path: 'src/copilot/mcp/tools/repo-read.js', startLine: 1, endLine: 8, hashMode: 'none' },
            ],
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        const results = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(results.length, 2);
        assert.ok(String(results[0]?.['content'] ?? '').includes('Copilot MCP Server'));
        assert.ok(String(results[1]?.['content'] ?? '').includes('@module copilot/mcp/tools/repo-read'));
        const legacyText = String(result.content?.[0]?.text ?? '');
        assert.ok(legacyText.includes('Read batch completed'));
        assert.equal(legacyText.includes('Copilot MCP Server'), false);
    });

    it('repo_read_file batch isolates one execution failure and supports more than ten logical reads', async () => {
        const tool = findTool('repo_read_file');
        const batch = Array.from({ length: 12 }, (_, index) => ({
            path: index === 5 ? 'src/copilot/mcp/does-not-exist.js' : 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 2,
            hashMode: 'none',
        }));
        const result = await tool.handler({ batch });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 12);
        assert.equal(result.structuredContent?.['attemptedCount'], 12);
        assert.equal(result.structuredContent?.['succeededCount'], 11);
        assert.equal(result.structuredContent?.['failedCount'], 1);
        assert.equal(result.structuredContent?.['skippedCount'], 0);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(rows.length, 12);
        assert.equal(rows[5]?.['status'], 'failed');
        assert.equal(rows[5]?.['isError'], true);
        assert.ok(String(rows[0]?.['content'] ?? '').includes('Copilot MCP Server'));
        assert.ok(String(rows[11]?.['content'] ?? '').includes('Copilot MCP Server'));
    });

    it('repo_read_file batch bounds aggregate payload instead of risking whole-result rejection', async () => {
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsDir, { recursive: true });
        const fixtureDir = await mkdtemp(join(jobsDir, 'mcp-read-budget-'));
        const file = join(fixtureDir, 'large.txt');
        const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
        await writeFile(file, `${'x'.repeat(80_000)}\n`, 'utf8');
        try {
            const tool = findTool('repo_read_file');
            const result = await tool.handler({
                batch: [
                    { path: relativeFile, hashMode: 'none' },
                    { path: relativeFile, hashMode: 'none' },
                ],
                batchResultBudgetBytes: 64 * 1024,
            });
            assert.equal(result.isError, undefined);
            assert.equal(result.structuredContent?.['succeededCount'], 2);
            assert.equal(result.structuredContent?.['resultBudgetBytes'], 64 * 1024);
            assert.ok(Number(result.structuredContent?.['originalResultBytes']) > 64 * 1024);
            assert.ok(Number(result.structuredContent?.['resultBytes']) <= 64 * 1024);
            assert.ok(Number(result.structuredContent?.['payloadTruncatedCount']) >= 1);
            const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
            assert.equal(rows.length, 2);
            assert.ok(rows.some((row) => row['payloadTruncated'] === true));
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    });

    it('repo_bulk_inspect mixes read/search/stat while isolating one failed operation', async () => {
        const tool = findTool('repo_bulk_inspect');
        const result = await tool.handler({
            operations: [
                {
                    op: 'read',
                    args: { path: 'src/copilot/mcp/README.md', startLine: 1, endLine: 2, hashMode: 'none' },
                },
                {
                    op: 'search',
                    args: { path: 'src/copilot/mcp', pattern: 'MCP', maxResults: 3 },
                },
                {
                    op: 'stat',
                    args: { path: 'src/copilot/mcp/README.md', includeHash: false },
                },
                {
                    op: 'stat',
                    args: { path: 'src/copilot/mcp/does-not-exist.js' },
                },
            ],
            failureMode: 'best-effort',
            concurrency: 4,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['bulkInspect'], true);
        assert.equal(result.structuredContent?.['requestCount'], 4);
        assert.equal(result.structuredContent?.['succeededCount'], 3);
        assert.equal(result.structuredContent?.['failedCount'], 1);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.deepEqual(
            rows.map((row) => row['op']),
            ['read', 'search', 'stat', 'stat'],
        );
        assert.equal(rows[0]?.['success'], true);
        assert.equal(rows[1]?.['success'], true);
        assert.equal(rows[2]?.['success'], true);
        assert.equal(rows[3]?.['isError'], true);
    });

    it('repo_read_file returns identical results for repeated same-window reads through the extracted cache module', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const args = {
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
        };
        const first = await tool.handler(args);
        const afterFirst = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        const second = await tool.handler(args);
        const afterSecond = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);

        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.deepEqual(second.content, first.content);
        assert.equal(afterFirst['misses'], 1);
        assert.equal(afterFirst['sets'], 1);
        assert.equal(typeof afterFirst.bytes, 'number');
        assert.ok(afterFirst.bytes > 0);
        assert.equal(typeof afterFirst.maxBytes, 'number');
        assert.equal(afterSecond['hits'], 1);
        assert.equal(afterSecond['trustWindowHits'], 1);
        assert.equal(afterSecond['fingerprintValidations'], 0);
        assert.equal(afterSecond.size, 1);
        const resolved = await TEST_WORKSPACE.resolveReadPath(args.path);
        assert.equal(resolved.ok, true);
        if (resolved.ok) getApplicationInfraRuntime().coherence.invalidation.invalidatePath(resolved.resolved);
        const afterInvalidation = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        assert.equal(afterInvalidation['busInvalidations'], 1);
        assert.equal(afterInvalidation['clears'], 1);
        assert.equal(afterInvalidation.size, 0);
    });

    it('repo_read_file usa trust window fixa, sem renová-la em hits sucessivos', async () => {
        const cacheConfig = readMcpRepoReadCacheConfig({ COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS: '25' });
        const context = createToolContextWithRepositoryReadCache(cacheConfig);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_000);
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file', context);
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-read-fixed-window-'));
        const filePath = join(tempDir, 'fixed-window.txt');
        const relativePath = relative(process.cwd(), filePath);
        try {
            await writeFile(filePath, 'alpha\n', 'utf8');
            const first = await tool.handler({ path: relativePath });
            assert.equal(first.structuredContent?.['content'], 'alpha\n');

            await writeFile(filePath, 'omega\n', 'utf8');
            vi.setSystemTime(1_010);
            const insideWindow = await tool.handler({ path: relativePath });
            assert.equal(insideWindow.structuredContent?.['content'], 'alpha\n');

            vi.setSystemTime(1_026);
            getApplicationInfraRuntime().coherence.l1.clear();
            const afterFixedWindow = await tool.handler({ path: relativePath });
            const stats = readRepoReadFileResultCacheStats(cacheConfig);
            assert.equal(afterFixedWindow.structuredContent?.['content'], 'omega\n');
            assert.equal(stats['trustWindowMs'], 25);
            assert.equal(stats['trustWindowHits'], 1);
            assert.equal(stats['fingerprintValidations'], 1);
            assert.equal(stats['stale'], 1);
        } finally {
            vi.useRealTimers();
            await rm(tempDir, { recursive: true, force: true });
            resetRepoReadResponseCacheForTest();
        }
    });

    it('repo_read_file invalida cache shaped por fingerprint rico mesmo com size+mtime preservados externamente', async () => {
        const cacheConfig = readMcpRepoReadCacheConfig({ COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS: '0' });
        const context = createToolContextWithRepositoryReadCache(cacheConfig);
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file', context);
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-read-fingerprint-'));
        const filePath = join(tempDir, 'same-size.txt');
        const relativePath = relative(process.cwd(), filePath);
        try {
            await writeFile(filePath, 'alpha\n', 'utf8');
            const originalStats = await stat(filePath);
            const first = await tool.handler({ path: relativePath });
            assert.equal(first.structuredContent?.['content'], 'alpha\n');

            await writeFile(filePath, 'omega\n', 'utf8');
            await utimes(filePath, originalStats.atime, originalStats.mtime);
            getApplicationInfraRuntime().coherence.l1.clear();

            const second = await tool.handler({ path: relativePath });
            const cacheStats = readRepoReadFileResultCacheStats(cacheConfig);
            assert.equal(second.structuredContent?.['content'], 'omega\n');
            assert.equal(cacheStats['trustWindowMs'], 0);
            assert.equal(cacheStats['stale'], 1);
            assert.equal(cacheStats['misses'], 2);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
            resetRepoReadResponseCacheForTest();
        }
    });

    it('repo_read_file coalesces concurrent same-window reads through singleflight', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const args = {
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 20,
        };
        const [first, second] = await Promise.all([tool.handler(args), tool.handler(args)]);
        const stats = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);

        assert.equal(first.isError, undefined);
        assert.equal(second.isError, undefined);
        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.equal(stats['misses'], 1);
        assert.equal(stats['singleflightLeaders'], 1);
        assert.equal(stats['singleflightJoins'], 1);
        assert.equal(stats.size, 1);
    });

    it('repo_file_stats returns metadata and optional content hash', async () => {
        const tool = findTool('repo_file_stats');
        const result = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            includeHash: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['path'], 'src/copilot/mcp/README.md');
        assert.equal(result.structuredContent?.['type'], 'file');
        assert.equal(typeof result.structuredContent?.['sizeBytes'], 'number');
        assert.equal(typeof result.structuredContent?.['sha256'], 'string');
        assert.equal(result.structuredContent?.['hashComputed'], true);
    });

    it('read tools return stable error codes for recoverable client errors', async () => {
        const readTool = findTool('repo_read_file');
        const emptyPath = await readTool.handler({ path: '' });
        assert.equal(emptyPath.isError, true);
        assert.equal(emptyPath.structuredContent?.['success'], false);
        assert.equal(emptyPath.structuredContent?.['code'], 'ERR_EMPTY_PATH');
        assert.equal(typeof emptyPath.structuredContent?.['hint'], 'string');

        const invalidRange = await readTool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 10,
            endLine: 2,
        });
        assert.equal(invalidRange.isError, true);
        assert.equal(invalidRange.structuredContent?.['code'], 'ERR_INVALID_LINE_RANGE');
    });

    it('repo_tree keeps entries in structuredContent and uses compact text summaries for normal and root trees', async () => {
        const treeTool = findTool('repo_tree');
        const tree = await treeTool.handler({ path: '', maxEntries: 5 });
        assert.equal(tree.isError, undefined);
        assert.equal(tree.structuredContent?.['path'], 'src/copilot');
        const treeText = String(tree.content?.[0]?.text ?? '');
        assert.match(treeText, /^Tree src\/copilot:/u);
        assert.ok(treeText.includes('structuredContent.entries'));
        assert.equal(treeText.includes('absolutePath'), false);

        const root = await treeTool.handler({ path: '.', maxEntries: 20 });
        assert.equal(root.isError, undefined);
        assert.equal(root.structuredContent?.['path'], '.');
        const entries = /** @type {unknown[]} */ (root.structuredContent?.['entries']);
        assert.ok(entries.length > 0);
        const rootText = String(root.content?.[0]?.text ?? '');
        assert.match(rootText, /^Tree \.:/u);
        assert.equal(rootText.includes('absolutePath'), false);
    });

    it('repo_tree path="." redacts protected hidden path metadata', async () => {
        const rootTool = findTool('repo_tree');
        const root = await rootTool.handler({ path: '.', maxEntries: 200, showHidden: true });
        assert.equal(root.isError, undefined);
        assert.equal(root.structuredContent?.['securityPolicy']?.['listProtectedPaths'], 'redacted');
        assert.ok(Number(root.structuredContent?.['blockedEntriesCount'] ?? 0) > 0);
        const entries = /** @type {{ name?: string; path?: string }[]} */ (root.structuredContent?.['entries']);
        assert.equal(
            entries.some((entry) => entry.name === '.env.local' || entry.path === '.env.local'),
            false,
        );
    });

    it('repo_root_redaction_status audits root redaction without returning hidden names', async () => {
        const tool = findTool('repo_root_redaction_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['path'], '.');
        assert.equal(result.structuredContent?.['policy']?.['hiddenNamesReturned'], false);
        assert.equal(result.structuredContent?.['policy']?.['protectedNamesReturned'], false);
        assert.equal(typeof result.structuredContent?.['hiddenInspectableTopLevelCount'], 'number');
        assert.equal(typeof result.structuredContent?.['protectedOrRedactedTopLevelCount'], 'number');
        assert.equal('entries' in (result.structuredContent ?? {}), false);
    });

    it('mcp_connection_readiness view=current-url returns saved URL status without client URL input', async () => {
        const tool = findTool('mcp_connection_readiness');
        const result = await tool.handler({ view: 'current-url' }, TOOL_OPERATION_CONTEXT);
        assert.equal(result.isError, undefined);
        assert.ok('currentUrl' in (result.structuredContent ?? {}));
        assert.ok('validation' in (result.structuredContent ?? {}));
        assert.equal(result.structuredContent?.['chatgptForm']?.['authentication'], 'OAuth');
        assert.ok(Array.isArray(result.structuredContent?.['recovery']));
        if (
            result.structuredContent?.['source'] === 'permanent-config' &&
            result.structuredContent?.['validation']?.['ok'] === true
        ) {
            assert.deepEqual(result.structuredContent?.['recovery'], []);
            assert.equal(result.structuredContent?.['permanentTunnel']?.['ready'], true);
            assert.equal(result.structuredContent?.['temporaryTunnel']?.['ignoredForOperationalReadiness'], true);
        }
    });

    it('repo_search_text accepts expanded context and returns patch-ready file metadata', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            pattern: 'Copilot MCP Server',
            path: 'src/copilot/mcp/README.md',
            contextLines: 32,
            maxResults: 5,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['contextLines'], 32);
        assert.equal(structured['cursor'], null);
        assert.ok('nextCursor' in structured);
        const metadata = /** @type {Record<string, unknown>} */ (structured['searchTargetMetadata']);
        assert.equal(metadata['type'], 'file');
        assert.equal(metadata['hashComputed'], true);
        assert.match(String(metadata['sha256'] ?? ''), /^[a-f0-9]{64}$/u);
    });

    it('repo_search_text accepts query as a client-friendly alias for pattern', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            query: 'Copilot MCP Server',
            path: 'src/copilot/mcp',
            maxResults: 5,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['pattern'], 'Copilot MCP Server');
        assert.equal(structured['query'], 'Copilot MCP Server');
        assert.ok(Number(structured['returnedMatchCount'] ?? 0) > 0);
    });

    it('repo_search_text batches several searches and keeps heavy outputs only in structured results', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            batch: [
                { query: 'repo_read_file', path: 'src/copilot/mcp/tools', maxResults: 5 },
                { query: 'repo_apply_patch', path: 'src/copilot/mcp/tools', maxResults: 5 },
            ],
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        const results = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(results.length, 2);
        assert.ok(Number(results[0]?.['returnedMatchCount'] ?? 0) > 0);
        assert.ok(Number(results[1]?.['returnedMatchCount'] ?? 0) > 0);
        const legacyText = String(result.content?.[0]?.text ?? '');
        assert.ok(legacyText.includes('Search batch completed'));
        assert.equal(legacyText.includes('repo_read_file.js'), false);
    });

    it('repo_search_text returns counts and keeps matched output out of the compact legacy summary', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            pattern: 'repo_read_file_chunks',
            path: 'src/copilot/mcp/tools/repo-read.js',
            contextLines: 2,
            maxResults: 20,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.ok(Number(structured['returnedMatchCount'] ?? 0) > 0);
        assert.ok(Number(structured['returnedLineCount'] ?? 0) >= Number(structured['returnedMatchCount'] ?? 0));
        assert.ok(Number(structured['totalMatchCount'] ?? 0) >= Number(structured['returnedMatchCount'] ?? 0));
        assert.equal(structured['countsPostSanitization'], true);
        assert.ok(String(structured['output'] ?? '').includes('repo_read_file_chunks'));
        const legacyText = String(result.content?.[0]?.text ?? '');
        assert.match(legacyText, /^Search /u);
        assert.ok(legacyText.includes('structuredContent.output'));
        assert.equal(legacyText.includes('/workspaces/chatgpt-docker-puppeteer/'), false);
        assert.ok(Buffer.byteLength(legacyText, 'utf8') <= 2048);
    });

    it('repo_find_symbol_usages mirrors LLM-B symbol usage search semantics', async () => {
        const tool = findTool('repo_find_symbol_usages');
        const result = await tool.handler({
            symbol: 'repoReadTools',
            path: 'src/copilot/mcp/tools/repo-read.js',
            maxResults: 20,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Number(result.structuredContent?.['matchCount'] ?? 0) >= 1);
        assert.ok(Array.isArray(result.structuredContent?.['matches']));
        assert.ok(String(result.structuredContent?.['output'] ?? '').includes('repoReadTools'));
    });

    it('repo_read_file_chunks pages large-file reads with cursor metadata', async () => {
        const tool = findTool('repo_read_file_chunks');
        const result = await tool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 20,
            endLine: 45,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['path'], 'src/copilot/mcp/tools/repo-read.js');
        assert.ok(Array.isArray(structured['chunks']));
        assert.equal(structured['chunkLines'], 20);
        assert.equal(structured['nextCursor'], '46');
        assert.equal(structured['cursor'], null);
    });

    it('repo_read_file_chunks returns identical results for repeated same-window chunk reads through the extracted cache module', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file_chunks');
        const args = {
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 10,
            startLine: 1,
            endLine: 20,
        };
        const first = await tool.handler(args);
        const afterFirst = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        const second = await tool.handler(args);
        const afterSecond = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        assert.equal(first.isError, undefined);
        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.deepEqual(second.content, first.content);
        assert.equal(afterFirst['chunkMisses'], 1);
        assert.equal(afterFirst['chunkSets'], 1);
        assert.equal(typeof afterFirst.chunkBytes, 'number');
        assert.ok(afterFirst.chunkBytes > 0);
        assert.equal(afterSecond['chunkHits'], 1);
        assert.equal(afterSecond.chunkSize, 1);
        const resolved = await TEST_WORKSPACE.resolveReadPath(args.path);
        assert.equal(resolved.ok, true);
        if (resolved.ok) getApplicationInfraRuntime().coherence.invalidation.invalidatePath(resolved.resolved);
        const afterInvalidation = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);
        assert.equal(afterInvalidation['busInvalidations'], 1);
        assert.equal(afterInvalidation['chunkClears'], 1);
        assert.equal(afterInvalidation.chunkSize, 0);
    });

    it('repo_read_file_chunks keeps cursor presentation caller-local across canonical cache hits', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file_chunks');
        const base = {
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 10,
            endLine: 20,
        };
        const byStartLine = await tool.handler({ ...base, startLine: 1 });
        const byCursor = await tool.handler({ ...base, cursor: '1' });
        const stats = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);

        assert.equal(byStartLine.isError, undefined);
        assert.equal(byCursor.isError, undefined);
        assert.equal(byStartLine.structuredContent?.['cursor'], null);
        assert.equal(byCursor.structuredContent?.['cursor'], '1');
        assert.deepEqual(byCursor.structuredContent?.['chunks'], byStartLine.structuredContent?.['chunks']);
        assert.equal(stats['chunkMisses'], 1);
        assert.equal(stats['chunkHits'], 1);
        assert.equal(stats.chunkSize, 1);
    });

    it('repo_read_file_chunks coalesces concurrent same-window chunk reads through singleflight', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file_chunks');
        const args = {
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 10,
            startLine: 1,
            endLine: 30,
        };
        const [first, second] = await Promise.all([
            tool.handler(args),
            tool.handler({ path: args.path, chunkLines: args.chunkLines, cursor: '1', endLine: args.endLine }),
        ]);
        const stats = readRepoReadFileResultCacheStats(TEST_REPO_READ_CACHE_CONFIG);

        assert.equal(first.isError, undefined);
        assert.equal(second.isError, undefined);
        assert.equal(first.structuredContent?.['cursor'], null);
        assert.equal(second.structuredContent?.['cursor'], '1');
        assert.deepEqual(second.structuredContent?.['chunks'], first.structuredContent?.['chunks']);
        assert.equal(stats['chunkMisses'], 1);
        assert.equal(stats['chunkSingleflightLeaders'], 1);
        assert.equal(stats['chunkSingleflightJoins'], 1);
        assert.equal(stats.chunkSize, 1);
    });

    it('repo_read_file_chunks separates returned lines from scanned line metadata', async () => {
        const tool = findTool('repo_read_file_chunks');
        const result = await tool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 1,
            startLine: 1,
            endLine: 3,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['returnedLineCount'], 3);
        assert.equal(structured['returnedChunkCount'], 3);
        assert.equal(structured['fileTotalLinesKnown'], false);
        assert.equal(structured['fileTotalLines'], null);
        assert.equal(structured['nextCursor'], '4');
        assert.ok(Number(structured['lastScannedLine'] ?? 0) >= 3);
    });

    it('repo_symbol_search and repo_file_outline expose IO navigation primitives', async () => {
        const symbolTool = findTool('repo_symbol_search');
        const symbolResult = await symbolTool.handler({
            name: 'repoReadTools',
            path: 'src/copilot/mcp',
            maxResults: 5,
        });
        assert.equal(symbolResult.isError, undefined);
        assert.equal(symbolResult.structuredContent?.['success'], true);
        assert.ok(Number(symbolResult.structuredContent?.['matchCount'] ?? 0) >= 1);

        const outlineTool = findTool('repo_file_outline');
        const outlineResult = await outlineTool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            includeTopComments: true,
        });
        assert.equal(outlineResult.isError, undefined);
        assert.equal(outlineResult.structuredContent?.['success'], true);
        assert.ok(Array.isArray(outlineResult.structuredContent?.['symbols']));
        assert.ok(Array.isArray(outlineResult.structuredContent?.['outline']));
        const exports = /** @type {string[]} */ (outlineResult.structuredContent?.['exports'] ?? []);
        assert.ok(exports.includes('repoReadTools'));

        const boundedOutline = await outlineTool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            maxItems: 1,
            maxBytes: 512,
        });
        assert.equal(boundedOutline.structuredContent?.['truncated'], true);
        assert.equal(boundedOutline.structuredContent?.['maxItems'], 1);
        assert.ok(Number(boundedOutline.structuredContent?.['returnedContentBytes'] ?? Infinity) <= 512);
        assert.ok(/** @type {unknown[]} */ (boundedOutline.structuredContent?.['symbols'] ?? []).length <= 1);
    });

    it('mcp_smoke_workspace runs read-only end-to-end checks', async () => {
        const tool = findTool('mcp_smoke_workspace');
        const result = await tool.handler({ issuer: 'http://not-https.example.com' });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Array.isArray(result.structuredContent?.['checks']));
    });

    it('repo_index tools expose shared IO index build, status, search, symbols and imports', async () => {
        const buildTool = findTool('repo_index_build');
        const build = await buildTool.handler({
            path: 'src/copilot/mcp/tools',
            include: ['repo-index.js', 'repo-read.js', 'repo-write.js'],
            maxFiles: 5,
            pruneMissing: false,
        });
        assert.equal(build.isError, undefined);
        assert.equal(build.structuredContent?.['success'], true);

        const statusTool = findTool('repo_index_status');
        const status = await statusTool.handler({});
        assert.equal(status.isError, undefined);
        assert.equal(status.structuredContent?.['success'], true);
        assert.equal(typeof status.structuredContent?.['stats'], 'object');
        assert.equal(typeof status.structuredContent?.['autoBuild'], 'object');

        const searchTool = findTool('repo_index_search');
        const search = await searchTool.handler({ query: 'repoIndexTools', maxResults: 5 });
        assert.equal(search.isError, undefined);
        assert.equal(search.structuredContent?.['success'], true);
        assert.equal(search.structuredContent?.['available'], true);
        assert.ok(String(search.structuredContent?.['output'] ?? '').includes('repo-index.js'));

        const symbolTool = findTool('repo_symbol_search');
        const symbol = await symbolTool.handler({ name: 'repoIndexTools', exactMatch: true, maxResults: 5 });
        assert.equal(symbol.isError, undefined);
        assert.equal(symbol.structuredContent?.['success'], true);
        assert.equal(symbol.structuredContent?.['engine'], 'fts5-index');
        assert.ok(Number(symbol.structuredContent?.['matchCount'] ?? 0) >= 1);

        const importsTool = findTool('repo_find_imports');
        const imports = await importsTool.handler({ source: 'zod', exactSource: true, maxResults: 5 });
        assert.equal(imports.isError, undefined);
        assert.equal(imports.structuredContent?.['success'], true);
        assert.ok(String(imports.structuredContent?.['output'] ?? '').includes("from 'zod'"));

        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const orphanImports = await orphanImportsTool.handler({
            path: 'src/copilot/mcp/tools/repo-index.js',
            maxResults: 5,
        });
        assert.equal(orphanImports.isError, undefined);
        assert.equal(orphanImports.structuredContent?.['success'], true);
        assert.equal(orphanImports.structuredContent?.['totalOrphans'], 0);
        assert.equal(orphanImports.structuredContent?.['trueOrphanCount'], 0);
        assert.equal(orphanImports.structuredContent?.['protectedCount'], 0);
        assert.equal(orphanImports.structuredContent?.['aliasResolutionGapCount'], 0);
        assert.equal(typeof orphanImports.structuredContent?.['checkedImports'], 'number');

        const orphanImportsDir = await orphanImportsTool.handler({
            path: 'src/copilot/mcp/tools',
            maxFiles: 30,
            maxResults: 20,
        });
        assert.equal(orphanImportsDir.isError, undefined);
        assert.equal(orphanImportsDir.structuredContent?.['success'], true);
        assert.equal(orphanImportsDir.structuredContent?.['totalOrphans'], 0);
        assert.ok(Number(orphanImportsDir.structuredContent?.['checkedImports'] ?? 0) > 0);
        assert.ok(Number(orphanImportsDir.structuredContent?.['scannedFiles'] ?? 0) > 1);

        // Import-target existence is memoized only inside one orphan-import audit; no process-global TTL cache survives the call.
        const indexingRepositorySource = await readFile(
            join(process.cwd(), 'src/copilot/mcp/indexing/repository/orphan-imports.js'),
            'utf8',
        );
        assert.doesNotMatch(indexingRepositorySource, /createTtlCache|repo-index-import-target-exists/u);
        assert.match(indexingRepositorySource, /const targetExistsMemo = new Map\(\)/u);
    });

    it('repo_find_orphan_imports resolves package imports and classifies protected targets', async () => {
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-package-imports-'));
        const importerPath = join(tempDir, 'importer.js');
        const relativeImporterPath = relative(process.cwd(), importerPath);

        try {
            await writeFile(
                importerPath,
                [
                    "import '#copilot/sdk/agents';",
                    "import '#copilot/sdk/session-runtime';",
                    "await import('#copilot/infra/public/cache/keys');",
                    'export const value = 1;',
                    '',
                ].join('\n'),
            );

            const aliases = await orphanImportsTool.handler({
                path: relativeImporterPath,
                includeDynamic: true,
                maxResults: 20,
            });
            assert.equal(aliases.isError, undefined);
            assert.equal(aliases.structuredContent?.['success'], true);
            assert.equal(aliases.structuredContent?.['trueOrphanCount'], 0);
            assert.equal(aliases.structuredContent?.['protectedCount'], 0);
            assert.equal(aliases.structuredContent?.['aliasResolutionGapCount'], 0);
            assert.equal(aliases.structuredContent?.['checkedImports'], 3);

            const protectedResult = await orphanImportsTool.handler({
                path: 'src/copilot/model-gateway/registry/env-byok-compat-importer.js',
                maxResults: 20,
            });
            assert.equal(protectedResult.isError, undefined);
            assert.equal(protectedResult.structuredContent?.['success'], true);
            assert.equal(protectedResult.structuredContent?.['trueOrphanCount'], 0);
            assert.ok(Number(protectedResult.structuredContent?.['protectedCount'] ?? 0) >= 1);
            assert.ok(String(protectedResult.structuredContent?.['output'] ?? '').includes('protected/unverifiable'));
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_find_orphan_imports clears cached import targets after invalidation', async () => {
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-orphan-cache-'));
        const importerPath = join(tempDir, 'importer.js');
        const targetPath = join(tempDir, 'target.js');
        const relativeImporterPath = relative(process.cwd(), importerPath);
        const relativeTargetPath = relative(process.cwd(), targetPath);

        try {
            await writeFile(importerPath, "import './target.js';\nexport const value = 1;\n");
            await writeFile(targetPath, 'export const target = 1;\n');

            const first = await orphanImportsTool.handler({
                path: relativeImporterPath,
                maxResults: 20,
            });
            assert.equal(first.isError, undefined);
            assert.equal(first.structuredContent?.['success'], true);
            assert.equal(first.structuredContent?.['totalOrphans'], 0);

            await rm(targetPath);
            getApplicationInfraRuntime().coherence.invalidation.invalidatePath(relativeTargetPath);

            const second = await orphanImportsTool.handler({
                path: relativeImporterPath,
                maxResults: 20,
            });
            assert.equal(second.isError, undefined);
            assert.equal(second.structuredContent?.['success'], true);
            assert.equal(second.structuredContent?.['totalOrphans'], 1);
            assert.equal(second.structuredContent?.['checkedImports'], 1);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_find_orphan_imports respects recursive and depth options for indexed directories', async () => {
        const buildTool = findTool('repo_index_build');
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-orphan-depth-'));
        const nestedDir = join(tempDir, 'nested');
        const relativeTempDir = relative(process.cwd(), tempDir);

        try {
            await mkdir(nestedDir, { recursive: true });
            await writeFile(join(tempDir, 'root.js'), "import './missing-root.js';\nexport const root = 1;\n");
            await writeFile(join(nestedDir, 'child.js'), "import './missing-child.js';\nexport const child = 1;\n");

            const build = await buildTool.handler({
                path: relativeTempDir,
                include: ['**/*.js'],
                maxFiles: 10,
                pruneMissing: false,
            });
            assert.equal(build.isError, undefined);
            assert.equal(build.structuredContent?.['success'], true);

            const shallow = await orphanImportsTool.handler({
                path: relativeTempDir,
                recursive: false,
                maxResults: 10,
            });
            assert.equal(shallow.isError, undefined);
            assert.equal(shallow.structuredContent?.['success'], true);
            assert.equal(shallow.structuredContent?.['totalOrphans'], 1);
            assert.equal(shallow.structuredContent?.['skippedByDepth'], 1);
            assert.ok(String(shallow.structuredContent?.['output'] ?? '').includes('root.js'));
            assert.ok(!String(shallow.structuredContent?.['output'] ?? '').includes('nested/child.js'));

            const depthTwo = await orphanImportsTool.handler({
                path: relativeTempDir,
                depth: 2,
                maxResults: 10,
            });
            assert.equal(depthTwo.isError, undefined);
            assert.equal(depthTwo.structuredContent?.['success'], true);
            assert.equal(depthTwo.structuredContent?.['totalOrphans'], 2);
            assert.ok(String(depthTwo.structuredContent?.['output'] ?? '').includes('nested/child.js'));
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_diff_files returns a canonical unified diff', async () => {
        const tool = findTool('repo_diff_files');
        const result = await tool.handler({
            pathA: 'src/copilot/mcp/tools/repo-read.js',
            pathB: 'src/copilot/mcp/tools/meta.js',
            contextLines: 1,
            includeDiffPreview: true,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['identical'], false);
        assert.equal(typeof result.structuredContent?.['diff'], 'string');
    });

    it('mcp_capabilities_summary is compact by default and preserves an opt-in full manifest', async () => {
        const tool = findTool('mcp_capabilities_summary');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const groupCounts = /** @type {Record<string, unknown>} */ (structured['groupCounts']);
        assert.ok(Number(groupCounts['read'] ?? 0) > 0);
        assert.ok(Number(groupCounts['runtime'] ?? 0) > 0);
        assert.equal(structured['detailsAvailable'], true);
        assert.equal('read' in structured, false);
        assert.equal('advertisedTools' in structured, false);
        assert.ok(Buffer.byteLength(JSON.stringify(structured), 'utf8') < 8 * 1024);
        const authProfile = /** @type {Record<string, unknown>} */ (structured['authProfile']);
        assert.equal(authProfile['initialScopeProfile'], 'max-autonomy');
        assert.equal(authProfile['stepUpPreferred'], false);
        assert.equal(authProfile['broadInitialGrant'], true);
        assert.ok(/** @type {string[]} */ (authProfile['initialScopes']).includes('repo:admin'));
        assert.equal(structured['executionLimitsVersion'], 2);
        const executionLimits = /** @type {Record<string, Record<string, unknown>>} */ (structured['executionLimits']);
        assert.equal(executionLimits['repoRead']?.['maxBatchRequests'], 64);
        assert.equal(executionLimits['repoRead']?.['maxSearchContextLines'], 48);
        assert.equal(executionLimits['repoPatch']?.['maxBatchOperations'], 128);
        assert.equal(executionLimits['repoPatch']?.['maxBatchTargets'], 64);
        assert.equal(executionLimits['repoPatch']?.['maxBatchInputBytes'], 3 * 1024 * 1024);
        assert.equal(executionLimits['repoPatch']?.['defaultApplyMode'], 'per-target-fast');
        assert.equal(executionLimits['repoPatch']?.['defaultFailureMode'], 'best-effort');
        assert.equal(executionLimits['validator']?.['maxBatchConcurrency'], 1);

        const detailedResult = await tool.handler({ includeDetails: true });
        const detailed = /** @type {Record<string, unknown>} */ (detailedResult.structuredContent);
        assert.ok(Array.isArray(detailed['read']));
        assert.ok(/** @type {string[]} */ (detailed['read']).includes('repo_tree'));
        assert.equal(/** @type {string[]} */ (detailed['read']).includes('repo_root_tree'), false);
        assert.ok(/** @type {string[]} */ (detailed['read']).includes('repo_symbol_search'));
        assert.ok(Array.isArray(detailed['index']));
        assert.ok(/** @type {string[]} */ (detailed['index']).includes('repo_index_status'));
        assert.equal(/** @type {string[]} */ (detailed['index']).includes('repo_index_find_symbol'), false);
        assert.equal(/** @type {string[]} */ (detailed['runtime']).includes('mcp_session_profile'), false);
        assert.ok(/** @type {string[]} */ (detailed['connection']).includes('mcp_connection_readiness'));
        assert.ok(/** @type {string[]} */ (detailed['validation']).includes('mcp_validation_dashboard'));
        assert.ok(Array.isArray(detailed['advertisedTools']));
        assert.equal(typeof detailed['annotationProfile'], 'object');
        assert.ok(Array.isArray(detailed['ioGuidance']));
        const ioGuidance = /** @type {string[]} */ (detailed['ioGuidance']);
        assert.ok(ioGuidance.length > /** @type {string[]} */ (structured['ioGuidance']).length);
        assert.ok(ioGuidance.some((entry) => entry.includes('up to 64 independent operations')));
        assert.ok(ioGuidance.some((entry) => entry.includes('up to 128 exact-string patches across up to 64 targets')));
        assert.ok(ioGuidance.some((entry) => entry.includes('intentionally capped at 1')));
        assert.equal(
            ioGuidance.some((entry) => entry.includes('use 2 only for genuinely independent gates')),
            false,
        );
    });

    it('mcp_capabilities_summary view=status exposes semantic contract and approval planning metadata', async () => {
        const tool = findTool('mcp_capabilities_summary');
        const result = await tool.handler({ view: 'status' }, TOOL_OPERATION_CONTEXT);
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['totalTools'], getCanonicalMcpTools().length);
        assert.ok(Number(structured['readOnlyCount'] ?? 0) > 0);
        assert.ok(Number(structured['boundedWriteCount'] ?? 0) > 0);
        assert.ok(Number(structured['destructiveCount'] ?? 0) > 0);
        assert.ok(Number(structured['openWorldCount'] ?? 0) >= 4);
        assert.ok(/** @type {string[]} */ (structured['openWorldTools']).includes('git_publish_changes'));
        assert.ok(/** @type {string[]} */ (structured['destructiveTools']).includes('git_publish_changes'));
        assert.ok(/** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('repo_apply_patch'));
        assert.ok(
            /** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('repo_apply_patch_batch'),
        );
        assert.equal(/** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('job_cancel'), false);
        assert.ok(/** @type {string[]} */ (structured['destructiveTools']).includes('repo_remove_file'));
        const approvalFrictionProfile = /** @type {Record<string, unknown>} */ (structured['approvalFrictionProfile']);
        assert.equal('rememberApprovalCandidates' in approvalFrictionProfile, false);
        assert.ok(/** @type {string[]} */ (approvalFrictionProfile['neverRememberApproval']).includes('job_cancel'));
        assert.ok(
            /** @type {string[][]} */ (approvalFrictionProfile['directBatchWorkflows']).some(
                (workflow) => workflow[0] === 'repo_apply_patch_batch' && String(workflow[1]).includes('dryRun=true'),
            ),
        );
        assert.deepEqual(approvalFrictionProfile['planFirstWorkflows'], []);
        assert.ok(
            /** @type {string[][]} */ (approvalFrictionProfile['directBatchWorkflows']).some(
                (workflow) => workflow[0] === 'run_copilot_validator' && String(workflow[1]).includes('dryRun=true'),
            ),
        );
        assert.deepEqual(approvalFrictionProfile['escalationOnlyPlans'], []);
        assert.ok(
            /** @type {string[]} */ (approvalFrictionProfile['firstRememberApprovalWave']).includes(
                'run_copilot_validator',
            ),
        );
        assert.equal(
            /** @type {string[]} */ (approvalFrictionProfile['firstRememberApprovalWave']).includes(
                'mcp_run_safe_validation_suite',
            ),
            false,
        );
        assert.equal('tools' in structured, false);
        const metadataCoverage = /** @type {Record<string, unknown>} */ (structured['metadataCoverage']);
        assert.equal(metadataCoverage['outputSchemaPolicy'], 'semantic-specific-or-intentional-untyped');
        const specificOutputSchemaCount = getCanonicalMcpTools().filter(
            (tool) => tool.outputSchema !== undefined,
        ).length;
        assert.equal(metadataCoverage['specificOutputSchemaCount'], specificOutputSchemaCount);
        assert.equal(
            metadataCoverage['intentionalUntypedOutputCount'],
            getCanonicalMcpTools().length - specificOutputSchemaCount,
        );
        assert.equal(metadataCoverage['outputContractCoverageCount'], getCanonicalMcpTools().length);
        assert.equal(metadataCoverage['outputContractComplete'], true);
        assert.equal(metadataCoverage['securityMetadataCount'], getCanonicalMcpTools().length);
        assert.equal(metadataCoverage['securityComplete'], true);
        assert.equal(structured['detailsTool'], 'mcp_capabilities_summary');
        assert.equal(structured['executionLimitsVersion'], 2);
        const executionLimits = /** @type {Record<string, Record<string, unknown>>} */ (structured['executionLimits']);
        assert.equal(executionLimits['repoPatch']?.['maxBatchOperations'], 128);
        assert.equal(executionLimits['repoPatch']?.['defaultApplyMode'], 'per-target-fast');
        assert.equal(executionLimits['toolsList']?.['maxEnvelopeBytes'], 400 * 1024);
        assert.equal(executionLimits['terminal']?.['maxBatchCommands'], 32);
        assert.equal(executionLimits['terminal']?.['maxBatchConcurrency'], 16);
        assert.equal(executionLimits['terminal']?.['maxSessions'], 128);
        assert.equal(executionLimits['validator']?.['maxBatchConcurrency'], 1);
        assert.equal(executionLimits['validator']?.['acceptedInputMaxConcurrency'], 2);
        const descriptorObservation = /** @type {Record<string, unknown>} */ (structured['descriptorObservation']);
        assert.equal(descriptorObservation['scope'], 'origin-mcp-descriptor-observation');
        assert.equal(typeof descriptorObservation['runtimeEpoch'], 'string');
        assert.equal(typeof descriptorObservation['status'], 'string');
        const chatgptSnapshot = /** @type {Record<string, unknown>} */ (descriptorObservation['chatgptActionSnapshot']);
        assert.equal(chatgptSnapshot['observableFromOrigin'], false);
        const hostApprovalProfile = /** @type {Record<string, unknown>} */ (structured['hostApprovalProfile']);
        assert.equal(hostApprovalProfile['oauthInitialScopeProfile'], 'max-autonomy');
        assert.equal(hostApprovalProfile['oauthStepUpPreferred'], false);
        assert.equal(hostApprovalProfile['oauthBroadInitialGrantCompatibility'], true);
        assert.match(String(hostApprovalProfile['preferredStrategy']), /direct bounded one-shot/u);
        const publicationWorkflow = /** @type {Record<string, unknown>} */ (structured['publicationWorkflow']);
        assert.equal(publicationWorkflow['preferred'], 'git_publish_changes');
        assert.match(String(publicationWorkflow['happyPath']), /one governed git_publish_changes call/u);
        assert.ok(
            /** @type {string[]} */ (publicationWorkflow['granularFallbackOnlyFor']).includes(
                'preexisting-staged-index',
            ),
        );
        const wirePayloadAudit = /** @type {Record<string, unknown>} */ (structured['wirePayloadAudit']);
        assert.equal(wirePayloadAudit['detailsTool'], 'mcp_tool_payload_audit');
        assert.equal('fieldTotals' in wirePayloadAudit, false);
        assert.equal('topTools' in wirePayloadAudit, false);
        assert.equal('recommendations' in wirePayloadAudit, false);
        assert.ok(Array.isArray(wirePayloadAudit['largestDescriptors']));
        assert.ok(/** @type {unknown[]} */ (wirePayloadAudit['largestDescriptors']).length <= 3);
        assert.ok(Buffer.byteLength(JSON.stringify(structured)) < 8 * 1024);
    });

    it('mcp_capabilities_summary view=session returns the recommended ChatGPT autonomy profile', async () => {
        const tool = findTool('mcp_capabilities_summary');
        const result = await tool.handler({ view: 'session' }, TOOL_OPERATION_CONTEXT);
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['profile'], 'chatgpt-max-autonomy-permanent-cloudflare-oauth');
        const recommendedFirstCalls = /** @type {string[]} */ (structured['recommendedFirstCalls']);
        assert.deepEqual(recommendedFirstCalls, ['repo_status']);
        assert.ok(recommendedFirstCalls.length <= 3);
        assert.equal(recommendedFirstCalls.includes('mcp_cloudflare_edge_snapshot view=remote'), false);
        const diagnosticsOnDemand = /** @type {Record<string, unknown>} */ (structured['diagnosticsOnDemand']);
        assert.ok(
            /** @type {string[]} */ (diagnosticsOnDemand['cloudflare']).includes(
                'mcp_cloudflare_edge_snapshot view=remote',
            ),
        );
        const approvalGuidance = /** @type {Record<string, unknown>} */ (structured['approvalGuidance']);
        assert.ok(
            /** @type {string[]} */ (approvalGuidance['avoidUnlessExplicitlyNeeded']).includes('repo_remove_file'),
        );
        const tunnelGuidance = /** @type {Record<string, unknown>} */ (structured['tunnelGuidance']);
        assert.equal(tunnelGuidance['mode'], 'Cloudflare named permanent tunnel');
        assert.equal(tunnelGuidance['expectedUrlShape'], 'https://mcp.aurelin.org/mcp');
        assert.ok(Buffer.byteLength(JSON.stringify(structured)) < 10 * 1024);
        assert.equal('capabilities' in structured, false);
        assert.equal('smokePrompts' in structured, false);
    });

    it('consolidates fixed-external Cloudflare reads behind closed snapshot views', async () => {
        const tool = findTool('mcp_cloudflare_edge_snapshot');
        const retired = [
            'mcp_cloudflare_config_audit',
            'mcp_cloudflare_plan_capabilities_audit',
            'mcp_cloudflare_edge_audit',
            'mcp_cloudflare_edge_policy_diff',
            'mcp_cloudflare_edge_policy_plan',
            'mcp_cloudflare_post_change_gates',
            'mcp_cloudflare_remote_audit',
            'mcp_cloudflare_skip_audit',
            'mcp_cloudflare_mcp_passthrough_diff',
            'mcp_cloudflare_mcp_passthrough_apply',
            'mcp_cloudflare_transport_benchmark_plan',
        ];
        for (const name of retired) assert.equal(TEST_TOOL_SURFACE.names.includes(name), false, name);

        const remoteConflict = await tool.handler({ view: 'remote', includeDetails: true });
        assert.equal(remoteConflict.isError, true);
        assert.equal(remoteConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_READ_VIEW_FIELDS');

        const diffConflict = await tool.handler({ view: 'policy-diff', forceRefresh: true });
        assert.equal(diffConflict.isError, true);
        assert.equal(diffConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_READ_VIEW_FIELDS');

        const postChangeConflict = await tool.handler({ view: 'post-change', cacheTtlMs: 1000 });
        assert.equal(postChangeConflict.isError, true);
        assert.equal(postChangeConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_READ_VIEW_FIELDS');
    });

    it('keeps Cloudflare mutation targets and local views closed after W8 consolidation', async () => {
        const applyTool = findTool('mcp_cloudflare_edge_policy_apply');
        const applyConflict = await applyTool.handler({
            target: 'passthrough',
            phases: ['http_request_cache_settings'],
        });
        assert.equal(applyConflict.isError, true);
        assert.equal(applyConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_APPLY_TARGET_FIELDS');

        const localTool = findTool('mcp_cloudflare_metrics_snapshot');
        const metricsConflict = await localTool.handler({ view: 'metrics', includeMetricsBaseline: true });
        assert.equal(metricsConflict.isError, true);
        assert.equal(metricsConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_LOCAL_VIEW_FIELDS');

        const transportConflict = await localTool.handler({ view: 'transport-plan', includeMetricNames: true });
        assert.equal(transportConflict.isError, true);
        assert.equal(transportConflict.structuredContent?.['code'], 'ERR_CLOUDFLARE_LOCAL_VIEW_FIELDS');
    });

    it('mcp_latency_dashboard ranks result payload size separately from handler latency', async () => {
        resetMcpMetricsForTests();
        recordMcpToolMetric('large-single-result', {
            durationMs: 2,
            isError: false,
            resultSize: { strategy: 'stringify', bytes: 100_000 },
        });
        for (let index = 0; index < 3; index += 1) {
            recordMcpToolMetric('chatty-result', {
                durationMs: 1,
                isError: false,
                resultSize: { strategy: 'hint', bytes: 50_000 },
            });
        }
        const tool = findTool('mcp_latency_dashboard');
        const result = await tool.handler({ minSampleCalls: 1, maxRows: 5, includeTools: true });
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const largest = /** @type {Record<string, unknown>[]} */ (structured['largestResultPayloads']);
        const volume = /** @type {Record<string, unknown>[]} */ (structured['highestResultVolume']);
        assert.equal(largest[0]?.['name'], 'large-single-result');
        assert.equal(largest[0]?.['averageBytes'], 100_000);
        assert.equal(volume[0]?.['name'], 'chatty-result');
        assert.equal(volume[0]?.['totalBytes'], 150_000);
        const summary = /** @type {Record<string, unknown>} */ (structured['summary']);
        assert.equal(summary['largestAverageResultBytes'], 100_000);
        resetMcpMetricsForTests();
    });

    it('mcp_latency_dashboard defaults to a compact decision view', async () => {
        resetMcpMetricsForTests();
        recordMcpToolMetric('hot-reader', {
            durationMs: 12,
            isError: false,
            phases: { handler: 10, authorization: 2 },
            resultSize: { strategy: 'hint', bytes: 8_000 },
            execution: { logicalOperations: 6, mode: 'read-batch:best-effort' },
        });
        const tool = findTool('mcp_latency_dashboard');
        const result = await tool.handler({ minSampleCalls: 1 });
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const summary = /** @type {Record<string, unknown>} */ (structured['summary']);
        assert.equal('slowestTools' in structured, false);
        assert.equal('highestCumulativeCost' in structured, false);
        assert.equal('largestResultPayloads' in structured, false);
        const highestCumulativeCost = /** @type {Record<string, unknown>} */ (summary['highestCumulativeCost']);
        const largestResultPayload = /** @type {Record<string, unknown>} */ (summary['largestResultPayload']);
        assert.equal(highestCumulativeCost['name'], 'hot-reader');
        assert.equal(largestResultPayload['name'], 'hot-reader');
        const roundTrips = /** @type {Record<string, unknown>} */ (structured['roundTripAccounting']);
        assert.equal('topCompressedTools' in roundTrips, false);
        const indexedRoundTrips = /** @type {Record<string, unknown>} */ (structured['roundTripAnalytics']);
        assert.equal(typeof indexedRoundTrips['available'], 'boolean');
        assert.equal(typeof indexedRoundTrips['authority'], 'string');
        assert.equal(typeof indexedRoundTrips['sourceIntegrity'], 'object');
        assert.ok(Array.isArray(indexedRoundTrips['topTransitions']));
        assert.equal('roundTripTrends' in structured, false);
        assert.equal(roundTrips['logicalOperations'], 6);
        assert.ok(Buffer.byteLength(JSON.stringify(structured)) < 6 * 1024);
        resetMcpMetricsForTests();
    });

    it('mcp_latency_dashboard keeps effective execution-policy evidence in compact form', async () => {
        resetMcpMetricsForTests();
        const syntheticSnapshot = {
            available: true,
            sourceIntegrity: { status: 'materialized', lagBytes: 0, cursor: null },
            ...summarizeMcpRoundTripRows(
                [
                    {
                        id: 1,
                        ts_ms: 1_000,
                        event: 'tool_call_completed',
                        tool: 'repo_apply_patch_batch',
                        call_id: 'policy-a',
                        execution_policy_class: 'direct-apply',
                        execution_failure_policy_class: 'fail-fast',
                        execution_concurrency_class: 'parallel-bounded',
                    },
                ],
                { windowMs: 3_600_000, top: 5, includeSynthetic: false },
            ),
        };
        const context = createMcpToolOperationContext(
            {
                mcpReq: {
                    id: 'mcp-tools-unit-policy-dashboard',
                    method: 'tools/call',
                    signal: new AbortController().signal,
                    _meta: { caller: 'test_mcp_tools' },
                    envelope: { protocol: '2026' },
                },
            },
            {
                workspace: TEST_WORKSPACE,
                config: TEST_PROCESS_HOST.processConfig.toolConfig,
                capabilities: {
                    ...TEST_TOOL_CAPABILITIES,
                    roundTripAnalytics: {
                        ...TEST_TOOL_CAPABILITIES.roundTripAnalytics,
                        readSnapshot: () => syntheticSnapshot,
                    },
                },
            },
        );
        const result = await findTool('mcp_latency_dashboard', context).handler({ minSampleCalls: 1 });
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const roundTrips = /** @type {Record<string, unknown>} */ (structured['roundTripAnalytics']);
        const policies = /** @type {Record<string, unknown>} */ (roundTrips['executionPolicies']);
        assert.equal(policies['eligible'], 1);
        assert.equal(policies['observed'], 1);
        assert.equal(policies['coverage'], 1);
        assert.deepEqual(policies['policy'], { 'direct-apply': 1 });
        assert.deepEqual(policies['failure'], { 'fail-fast': 1 });
        assert.deepEqual(policies['concurrency'], { 'parallel-bounded': 1 });
        assert.equal('byTool' in policies, false);
        assert.equal('byRuntimeCohort' in policies, false);
        const dashboardBytes = Buffer.byteLength(JSON.stringify(structured));
        assert.ok(dashboardBytes < 6 * 1024, `dashboardBytes=${String(dashboardBytes)}`);
        resetMcpMetricsForTests();
    });

    it('mcp_post_restart_readiness reports compact permanent tunnel readiness', async () => {
        const tool = findTool('mcp_post_restart_readiness');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok('ready' in (result.structuredContent ?? {}));
        assert.equal(result.structuredContent?.['connectorUrl'], 'https://mcp.aurelin.org/mcp');
        assert.ok(Array.isArray(result.structuredContent?.['nextActions']));
    });

    it('dependency upgrade requires explicit confirmation without executing npm', async () => {
        const tool = findTool('mcp_dependency_upgrade');
        const result = await tool.handler({ confirmUpgrade: false });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['code'], 'ERR_DEPENDENCY_UPGRADE_CONFIRM_REQUIRED');
    });

    it('mcp maintenance composite exposes canonical plan metadata through dry-run and batches safe work', async () => {
        const applyTool = findTool('mcp_maintenance_apply_safe_fixes');
        const dryRun = await applyTool.handler({
            fixes: ['workspace-status', 'summarize-tools', 'ai-artifacts-report', 'run-mcp-smoke', 'refresh-index'],
            dryRun: true,
        });
        assert.equal(dryRun.isError, undefined);
        assert.equal(dryRun.structuredContent?.['success'], true);
        assert.equal(dryRun.structuredContent?.['dryRun'], true);
        assert.equal(dryRun.structuredContent?.['defaultDryRun'], true);
        assert.ok(Array.isArray(dryRun.structuredContent?.['items']));
        const items = /** @type {{ fix?: string; risk?: string }[]} */ (dryRun.structuredContent?.['items']);
        assert.ok(items.some((item) => item.fix === 'ai-artifacts-report' && item.risk === 'read-only'));
        const results = /** @type {{ fix?: string; dryRun?: boolean; plannedPath?: string }[]} */ (
            dryRun.structuredContent?.['results']
        );
        assert.ok(results.some((result) => result.fix === 'refresh-index' && result.plannedPath === 'src/copilot'));
        assert.ok(results.some((result) => result.fix === 'ai-artifacts-report'));
        assert.ok(results.every((result) => result.dryRun === true));
    });

    it('delegate_to_repo_autonomy_runner dry-runs fixed autonomy missions', async () => {
        const tool = findTool('delegate_to_repo_autonomy_runner');
        const result = await tool.handler({ mission: 'diagnose-mcp', dryRun: true });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['dryRun'], true);
        assert.equal(result.structuredContent?.['executed'], false);
        assert.equal(result.structuredContent?.['constraints']?.['arbitraryShell'], false);
        const plan = /** @type {{ step?: string }[]} */ (result.structuredContent?.['plan']);
        assert.ok(plan.some((step) => step.step === 'mcp_smoke_workspace'));

        const focused = await tool.handler({
            mission: 'validate-focused',
            testFile: 'tests/unit/copilot/mcp/test_mcp_tools.spec.js',
            dryRun: true,
        });
        assert.equal(focused.isError, undefined);
        assert.equal(focused.structuredContent?.['testFile'], 'tests/unit/copilot/mcp/test_mcp_tools.spec.js');
        const focusedPlan = /** @type {{ step?: string }[]} */ (focused.structuredContent?.['plan']);
        assert.ok(focusedPlan.some((step) => step.step === 'run_copilot_validator'));
        assert.equal(
            focusedPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'),
            false,
        );

        const missingFocusedFile = await tool.handler({ mission: 'validate-focused', dryRun: true });
        assert.equal(missingFocusedFile.isError, true);
        assert.equal(missingFocusedFile.structuredContent?.['code'], 'ERR_FOCUSED_TEST_FILE_REQUIRED');

        const cacheBenchmark = await tool.handler({ mission: 'benchmark-io-cache', dryRun: true });
        assert.equal(cacheBenchmark.isError, undefined);
        assert.equal(cacheBenchmark.structuredContent?.['executed'], false);
        const cacheBenchmarkPlan = /** @type {{ step?: string }[]} */ (cacheBenchmark.structuredContent?.['plan']);
        assert.ok(cacheBenchmarkPlan.some((step) => step.step === 'scheduled_io_cache_benchmark_runner'));
        assert.equal(
            cacheBenchmarkPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'),
            false,
        );

        const benchmark = await tool.handler({ mission: 'benchmark-transport', dryRun: true });
        assert.equal(benchmark.isError, undefined);
        assert.equal(benchmark.structuredContent?.['executed'], false);
        const benchmarkPlan = /** @type {{ step?: string }[]} */ (benchmark.structuredContent?.['plan']);
        assert.ok(benchmarkPlan.some((step) => step.step === 'scheduled_transport_benchmark_runner'));
        assert.ok(benchmarkPlan.some((step) => step.step === 'mcp_cloudflare_metrics_snapshot view=transport-plan'));
        assert.equal(
            benchmarkPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'),
            false,
        );
    });

    it('mcp_apps_sdk_readiness reports that CSP is widget-only for this repo MCP', async () => {
        const tool = findTool('mcp_apps_sdk_readiness');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        const appsSdk = /** @type {Record<string, unknown>} */ (result.structuredContent?.['appsSdk']);
        const companyKnowledge = /** @type {Record<string, unknown>} */ (
            result.structuredContent?.['companyKnowledge']
        );
        assert.equal(appsSdk['cspApplicable'], true);
        assert.equal(appsSdk['hasWidgetResource'], true);
        assert.equal(appsSdk['hasCsp'], true);
        assert.equal(appsSdk['hasWidgetDomain'], true);
        assert.equal(appsSdk['widgetDomainAliasesMatch'], true);
        assert.equal(appsSdk['hasStandardResourceUri'], true);
        assert.equal(appsSdk['hasLegacyOutputTemplate'], true);
        assert.equal(appsSdk['submissionReady'], true);
        assert.equal(companyKnowledge['searchFetchToolsDetected'], true);
        assert.deepEqual(companyKnowledge['toolNames'], ['search', 'fetch']);
        assert.equal(typeof result.structuredContent?.['promptFrictionImpact'], 'string');
    });

    it('mcp_host_block_diagnostics uses hard evidence before heuristic host-block labels', async () => {
        const tool = findTool('mcp_host_block_diagnostics');
        const result = await tool.handler({
            toolName: 'repo_tree',
            argsShape: 'path="." showHidden=true',
            hostMessage: 'Blocked by host before MCP call',
            mcpReachedServer: false,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['classification']?.['code'], 'CHATGPT_HOST_PRECALL_BLOCK');
        assert.equal(result.structuredContent?.['classification']?.['layer'], 'chatgpt-host');
        assert.equal(result.structuredContent?.['classification']?.['confidence'], 'high');
        assert.equal(result.structuredContent?.['observed']?.['mcpReachedServer'], false);
        assert.equal(typeof result.structuredContent?.['auditTemplate'], 'object');
    });

    it('mcp_host_block_diagnostics recommends administrative Refresh without claiming to observe the ChatGPT snapshot', async () => {
        const tool = findTool('mcp_host_block_diagnostics');
        const result = await tool.handler({
            toolName: 'repo_apply_patch_batch',
            operationKind: 'bounded-write',
            argsShape: 'batchConcurrency/maxOperations field rejected by projected schema',
            hostMessage: 'Input did not match tool schema',
            mcpReachedServer: false,
            schemaErrorPresent: true,
            mcpAuditEventPresent: false,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['classification']?.['code'], 'LIKELY_STALE_CHATGPT_ACTION_SNAPSHOT');
        assert.equal(result.structuredContent?.['classification']?.['layer'], 'chatgpt-host-schema');
        const projection = /** @type {Record<string, unknown>} */ (result.structuredContent?.['projectionDiagnosis']);
        assert.equal(projection['status'], 'refresh-review-recommended');
        assert.equal(projection['hostRefreshRecommended'], true);
        const descriptorObservation = /** @type {Record<string, unknown>} */ (projection['descriptorObservation']);
        assert.equal(descriptorObservation['scope'], 'origin-mcp-descriptor-observation');
        const snapshot = /** @type {Record<string, unknown>} */ (descriptorObservation['chatgptActionSnapshot']);
        assert.equal(snapshot['observableFromOrigin'], false);
        assert.equal(projection['executionLimitsVersion'], 2);
        const limits = /** @type {Record<string, Record<string, unknown>>} */ (projection['executionLimits']);
        assert.equal(limits['repoPatch']?.['maxBatchOperations'], 128);
        assert.equal(limits['validator']?.['maxBatchConcurrency'], 1);
        const nextSteps = /** @type {string[]} */ (result.structuredContent?.['nextSteps']);
        assert.ok(nextSteps.some((step) => step.includes('Do not add a plan call')));
    });

    it('mcp_host_block_diagnostics separates OAuth reauth from host precall blocks', async () => {
        const tool = findTool('mcp_host_block_diagnostics');
        const result = await tool.handler({
            toolName: 'repo_status',
            mcpReachedServer: true,
            httpStatus: 401,
            wwwAuthenticatePresent: true,
            hostMessage: 'Server returned 401: Reauthentication required',
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['classification']?.['code'], 'MCP_AUTH_CHALLENGE_OR_REAUTH');
        assert.equal(result.structuredContent?.['classification']?.['layer'], 'mcp-oauth-auth');
        assert.equal(result.structuredContent?.['classification']?.['confidence'], 'high');
        assert.equal(result.structuredContent?.['observed']?.['mcpReachedServer'], true);
        assert.equal(result.structuredContent?.['observed']?.['httpStatus'], 401);
    });

    it('mcp_connection_readiness view=auth-profile exposes OAuth readiness metadata without requiring enforcement', async () => {
        const tool = findTool('mcp_connection_readiness');
        const result = await tool.handler({ view: 'auth-profile', scopes: ['repo:read'] }, TOOL_OPERATION_CONTEXT);
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(typeof result.structuredContent?.['protectedResourceMetadataUrl'], 'string');
        assert.match(String(result.structuredContent?.['challengePreview'] ?? ''), /Bearer/);
        assert.equal(typeof result.structuredContent?.['protectedResourceMetadata'], 'object');
        assert.equal(typeof result.structuredContent?.['environmentTemplates'], 'object');
    });

    it('mcp_connection_readiness preserves profile/url-check projections and rejects cross-view fields', async () => {
        const tool = findTool('mcp_connection_readiness');

        const chatgpt = await tool.handler({ view: 'profile', client: 'chatgpt' }, TOOL_OPERATION_CONTEXT);
        assert.equal(chatgpt.isError, undefined);
        assert.equal(chatgpt.structuredContent?.['profile']?.['name'], 'Repo DevContainer MCP');

        const claude = await tool.handler({ view: 'profile', client: 'claude' }, TOOL_OPERATION_CONTEXT);
        assert.equal(claude.isError, undefined);
        assert.equal(typeof claude.structuredContent?.['profile']?.['claudeFormFields'], 'object');

        const checked = await tool.handler(
            { view: 'url-check', publicMcpUrl: 'https://example.com' },
            TOOL_OPERATION_CONTEXT,
        );
        assert.equal(checked.isError, undefined);
        assert.equal(checked.structuredContent?.['normalizedUrl'], 'https://example.com/mcp');
        assert.equal(checked.structuredContent?.['validation']?.['ok'], true);

        const missingUrl = await tool.handler({ view: 'url-check' }, TOOL_OPERATION_CONTEXT);
        assert.equal(missingUrl.isError, true);
        assert.equal(missingUrl.structuredContent?.['code'], 'ERR_CONNECTION_URL_REQUIRED');

        const conflict = await tool.handler(
            { view: 'current-url', publicMcpUrl: 'https://example.com/mcp' },
            TOOL_OPERATION_CONTEXT,
        );
        assert.equal(conflict.isError, true);
        assert.equal(conflict.structuredContent?.['code'], 'ERR_CONNECTION_VIEW_FIELDS');
    });

    it('mcp_capabilities_summary rejects summary-only fields on session/status projections', async () => {
        const tool = findTool('mcp_capabilities_summary');
        const sessionConflict = await tool.handler({ view: 'session', includeDetails: true }, TOOL_OPERATION_CONTEXT);
        assert.equal(sessionConflict.isError, true);
        assert.equal(sessionConflict.structuredContent?.['code'], 'ERR_CAPABILITIES_VIEW_FIELDS');

        const statusConflict = await tool.handler({ view: 'status', includeDetails: false }, TOOL_OPERATION_CONTEXT);
        assert.equal(statusConflict.isError, true);
        assert.equal(statusConflict.structuredContent?.['code'], 'ERR_CAPABILITIES_VIEW_FIELDS');
    });

    it('mcp_oauth_friction_audit reports metadata alignment and approval boundaries', async () => {
        const tool = findTool('mcp_oauth_friction_audit');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        // The tool returns an okResult wrapper with structuredContent-like fields in this test harness
        // Support both shapes for compatibility.
        const structured = result.structuredContent ?? result;
        assert.equal(structured['success'], true);
        assert.equal(typeof structured['reauthRisk'], 'string');
        assert.equal(typeof structured['approvalImpact'], 'string');
        const metadataAlignment = /** @type {Record<string, unknown>} */ (structured['metadataAlignment']);
        assert.equal(typeof metadataAlignment['resourceMatchesAudience'], 'boolean');
        const toolScopes = /** @type {Record<string, unknown>} */ (structured['toolScopes']);
        assert.ok(Array.isArray(toolScopes['publicDiagnosticTools']));
        assert.deepEqual(toolScopes['scopeClassesAdvertised'], [
            'repo:read',
            'repo:write',
            'repo:validate',
            'repo:admin',
        ]);
        assert.ok(Number(toolScopes['externalToolCount'] ?? 0) > 0);
        assert.ok(Number(toolScopes['credentialBoundToolCount'] ?? 0) > 0);
        const oauth = /** @type {Record<string, unknown>} */ (structured['oauth']);
        assert.equal(oauth['initialScopeProfile'], 'max-autonomy');
        assert.equal(oauth['stepUpPreferred'], false);
    });

    it('mcp_oauth_issuer_diagnostics reports missing issuer without network calls', async () => {
        const tool = findTool('mcp_oauth_issuer_diagnostics');
        const result = await tool.handler({ issuer: 'http://not-https.example.com' }, TOOL_OPERATION_CONTEXT);
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['ready'], false);
        assert.equal(result.structuredContent?.['issuer'], null);
        assert.ok(Array.isArray(result.structuredContent?.['checkedUrls']));
    });

    it('patch batch preserves global preflight safety and supports per-target-fast partial progress', async () => {
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsDir, { recursive: true });
        const fixtureDir = await mkdtemp(join(jobsDir, 'mcp-patch-bulk-'));
        const fileA = join(fixtureDir, 'a.txt');
        const fileB = join(fixtureDir, 'b.txt');
        const relativeA = relative(process.cwd(), fileA).replaceAll('\\', '/');
        const relativeB = relative(process.cwd(), fileB).replaceAll('\\', '/');
        await Promise.all([writeFile(fileA, 'alpha\n', 'utf8'), writeFile(fileB, 'beta\n', 'utf8')]);
        try {
            const applyTool = findTool('repo_apply_patch_batch');
            const twelveNoops = Array.from({ length: 12 }, () => ({
                old_string: 'alpha',
                new_string: 'alpha',
                allowNoop: true,
            }));
            const largePlan = await applyTool.handler({
                targets: [{ path: relativeA, operations: twelveNoops }],
                dryRun: true,
                targetConcurrency: 4,
            });
            assert.equal(largePlan.isError, undefined);
            assert.equal(largePlan.structuredContent?.['success'], true);
            assert.equal(largePlan.structuredContent?.['operationCount'], 12);
            assert.equal(largePlan.structuredContent?.['targetCount'], 1);
            assert.equal(largePlan.structuredContent?.['concurrency'], 1);
            assert.deepEqual(getResultExecutionHint(largePlan), {
                logicalOperations: 12,
                failedOperations: 0,
                skippedOperations: 0,
                mode: 'patch-dry-run:best-effort',
                executionPolicyClass: 'dry-run',
                executionFailurePolicyClass: 'best-effort',
                executionConcurrencyClass: 'sequential',
                batchSize: 12,
                batchCapacity: 128,
            });
            const mixedTargets = [
                { path: relativeA, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] },
                { path: relativeB, operations: [{ old_string: 'does-not-exist', new_string: 'BETA' }] },
            ];
            const conservative = await applyTool.handler({
                targets: mixedTargets,
                dryRun: false,
                confirmBatch: true,
                applyMode: 'global-preflight',
            });
            assert.equal(conservative.isError, undefined);
            assert.equal(conservative.structuredContent?.['success'], false);
            assert.equal(conservative.structuredContent?.['preflightBlockedApply'], true);
            assert.deepEqual(getResultExecutionHint(conservative), {
                logicalOperations: 2,
                failedOperations: 1,
                skippedOperations: 0,
                mode: 'patch-apply:global-preflight-blocked',
                executionPolicyClass: 'preflight-blocked',
                executionFailurePolicyClass: 'best-effort',
                executionConcurrencyClass: 'parallel-bounded',
                batchSize: 2,
                batchCapacity: 128,
            });
            assert.equal(await readFile(fileA, 'utf8'), 'alpha\n');
            assert.equal(await readFile(fileB, 'utf8'), 'beta\n');

            const fast = await applyTool.handler({
                targets: mixedTargets,
                dryRun: false,
                confirmBatch: true,
                targetConcurrency: 2,
            });
            assert.equal(fast.isError, undefined);
            assert.equal(fast.structuredContent?.['success'], false);
            assert.equal(fast.structuredContent?.['partial'], true);
            assert.equal(fast.structuredContent?.['applyMode'], 'per-target-fast');
            assert.equal(fast.structuredContent?.['failureMode'], 'best-effort');
            assert.equal(fast.structuredContent?.['preflightElided'], true);
            assert.equal(fast.structuredContent?.['appliedCount'], 1);
            assert.equal(fast.structuredContent?.['failedCount'], 1);
            assert.equal(fast.structuredContent?.['skippedCount'], 0);
            assert.deepEqual(getResultExecutionHint(fast), {
                logicalOperations: 2,
                failedOperations: 1,
                skippedOperations: 0,
                mode: 'patch-apply:per-target-fast:best-effort',
                executionPolicyClass: 'direct-apply',
                executionFailurePolicyClass: 'best-effort',
                executionConcurrencyClass: 'parallel-bounded',
                batchSize: 2,
                batchCapacity: 128,
            });
            const failureSummary = /** @type {Record<string, unknown>} */ (fast.structuredContent?.['failureSummary']);
            assert.deepEqual(failureSummary['causalByCode'], { ERR_PATCH_NOT_FOUND: 1 });
            assert.deepEqual(failureSummary['failureClassCounts'], { 'stale-context': 1 });
            assert.deepEqual(failureSummary['retryabilityCounts'], { 'caller-refresh': 1 });
            assert.equal(failureSummary['recoveryRequiredTargetCount'], 1);
            const failures = /** @type {Record<string, unknown>[]} */ (fast.structuredContent?.['failures']);
            assert.equal(failures.length, 1);
            assert.equal(failures[0]?.['failureClass'], 'stale-context');
            assert.equal(failures[0]?.['failureScope'], 'target');
            assert.equal(failures[0]?.['retryability'], 'caller-refresh');
            const failureDetails = /** @type {Record<string, unknown>} */ (failures[0]?.['details']);
            assert.equal(typeof failureDetails['currentHash'], 'string');
            assert.equal(failureDetails['currentBytes'], Buffer.byteLength('beta\n', 'utf8'));
            assert.equal(await readFile(fileA, 'utf8'), 'ALPHA\n');
            assert.equal(await readFile(fileB, 'utf8'), 'beta\n');

            const atomic = await applyTool.handler({
                targets: [{ path: relativeA, operations: [{ old_string: 'ALPHA', new_string: 'alpha' }] }],
                dryRun: false,
                confirmBatch: true,
                applyMode: 'global-preflight',
            });
            assert.equal(atomic.structuredContent?.['success'], true);
            assert.deepEqual(getResultExecutionHint(atomic), {
                logicalOperations: 1,
                failedOperations: 0,
                skippedOperations: 0,
                mode: 'patch-apply:global-preflight:fail-fast',
                executionPolicyClass: 'atomic-preflight-elided-apply',
                executionFailurePolicyClass: 'fail-fast',
                executionConcurrencyClass: 'sequential',
                batchSize: 1,
                batchCapacity: 128,
            });

            const gated = await applyTool.handler({
                targets: [
                    { path: relativeA, operations: [{ old_string: 'alpha', new_string: 'ALPHA2' }] },
                    { path: relativeB, operations: [{ old_string: 'beta', new_string: 'BETA2' }] },
                ],
                dryRun: false,
                confirmBatch: true,
                applyMode: 'global-preflight',
            });
            assert.equal(gated.structuredContent?.['success'], true);
            assert.deepEqual(getResultExecutionHint(gated), {
                logicalOperations: 2,
                failedOperations: 0,
                skippedOperations: 0,
                mode: 'patch-apply:global-preflight:fail-fast',
                executionPolicyClass: 'preflight-gated-apply',
                executionFailurePolicyClass: 'fail-fast',
                executionConcurrencyClass: 'sequential',
                batchSize: 2,
                batchCapacity: 128,
            });

            await writeFile(fileB, 'desired-state-value\n', 'utf8');
            const singlePatch = findTool('repo_apply_patch');
            const converged = await singlePatch.handler({
                path: relativeB,
                old_string: 'stale-state-value',
                new_string: 'desired-state-value',
            });
            assert.equal(converged.isError, true);
            const convergedEnvelope = /** @type {Record<string, unknown>} */ (converged.structuredContent?.['details']);
            assert.equal(convergedEnvelope['failureClass'], 'already-converged-candidate');
            assert.equal(convergedEnvelope['retryability'], 'manual-decision');
            assert.equal(convergedEnvelope['mutationState'], 'already-converged-candidate');
            assert.equal(convergedEnvelope['recoveryRequired'], false);
            const convergedEvidence = /** @type {Record<string, unknown>} */ (convergedEnvelope['details']);
            assert.equal(convergedEvidence['desiredTextPresent'], true);
            assert.equal(convergedEvidence['convergenceCandidate'], true);
            assert.equal(convergedEvidence['desiredOccurrenceCount'], 1);
            assert.equal(typeof convergedEvidence['currentHash'], 'string');
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    });

    it('patch batch can run allowlisted post-validation in the same call and rejects invalid validation config before writes', async () => {
        const jobsDir = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsDir, { recursive: true });
        const fixtureDir = await mkdtemp(join(jobsDir, 'mcp-patch-post-validate-'));
        const file = join(fixtureDir, 'target.txt');
        const relativeFile = relative(process.cwd(), file).replaceAll('\\', '/');
        await writeFile(file, 'alpha\n', 'utf8');
        try {
            const applyTool = findTool('repo_apply_patch_batch');
            const invalid = await applyTool.handler({
                targets: [{ path: relativeFile, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] }],
                confirmBatch: true,
                postValidate: [
                    {
                        validator: 'typecheck',
                        testFile: 'tests/unit/copilot/mcp/test_mcp_metrics.spec.js',
                    },
                ],
            });
            assert.equal(invalid.isError, true);
            assert.equal(invalid.structuredContent?.['code'], 'ERR_POST_PATCH_VALIDATION_CONFIG');
            assert.equal(await readFile(file, 'utf8'), 'alpha\n');

            const recursive = await applyTool.handler({
                targets: [{ path: relativeFile, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] }],
                confirmBatch: true,
                postValidate: [
                    {
                        validator: 'unit-focused',
                        testFile: 'tests/unit/copilot/mcp/test_mcp_metrics.spec.js',
                    },
                ],
            });
            assert.equal(recursive.isError, true);
            assert.equal(recursive.structuredContent?.['code'], 'ERR_POST_PATCH_VALIDATION_RECURSION_GUARD');
            assert.equal(await readFile(file, 'utf8'), 'alpha\n');
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    });

    it('canonical owners preserve read-only previews without separate plan tools', async () => {
        const patchPreviewTool = findTool('repo_apply_patch');
        const patchPreview = await patchPreviewTool.handler({
            path: 'src/copilot/mcp/README.md',
            old_string: '# Copilot MCP Server',
            new_string: '# Copilot MCP Server',
            allowNoop: true,
            dryRun: true,
        });
        assert.equal(patchPreview.isError, undefined);
        assert.equal(patchPreview.structuredContent?.['success'], true);
        assert.equal(patchPreview.structuredContent?.['plannedTool'], 'repo_apply_patch');
        assert.equal(patchPreview.structuredContent?.['dryRun'], true);
        assert.equal(typeof patchPreview.structuredContent?.['previousHash'], 'string');
        assert.equal(
            patchPreview.structuredContent?.['applyPreconditionHash'],
            patchPreview.structuredContent?.['previousHash'],
        );

        const applyPatchBatchTool = findTool('repo_apply_patch_batch');
        const applyPatchBatchDryRun = await applyPatchBatchTool.handler({
            targets: [
                {
                    path: 'src/copilot/mcp/README.md',
                    operations: [
                        {
                            old_string: 'Copilot MCP Server',
                            new_string: 'Copilot MCP Server',
                            allowNoop: true,
                        },
                    ],
                },
            ],
            dryRun: true,
        });
        assert.equal(applyPatchBatchDryRun.isError, undefined);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['success'], true);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['dryRun'], true);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['operationCount'], 1);
        assert.deepEqual(applyPatchBatchDryRun.structuredContent?.['applied'], []);

        const applyPatchBatchWithoutConfirm = await applyPatchBatchTool.handler({
            targets: [
                {
                    path: 'src/copilot/mcp/README.md',
                    operations: [
                        {
                            old_string: 'Copilot MCP Server',
                            new_string: 'Copilot MCP Server',
                            allowNoop: true,
                        },
                    ],
                },
            ],
            dryRun: false,
        });
        assert.equal(applyPatchBatchWithoutConfirm.isError, true);
        assert.equal(applyPatchBatchWithoutConfirm.structuredContent?.['code'], 'ERR_PATCH_BATCH_CONFIRM_REQUIRED');

        const applyPatchBatchConfirmedWithoutExplicitFalse = await applyPatchBatchTool.handler({
            targets: [
                {
                    path: 'src/copilot/mcp/README.md',
                    operations: [
                        {
                            old_string: 'Copilot MCP Server',
                            new_string: 'Copilot MCP Server',
                            allowNoop: true,
                        },
                    ],
                },
            ],
            confirmBatch: true,
        });
        assert.equal(applyPatchBatchConfirmedWithoutExplicitFalse.isError, undefined);
        assert.equal(applyPatchBatchConfirmedWithoutExplicitFalse.structuredContent?.['success'], true);
        assert.equal(applyPatchBatchConfirmedWithoutExplicitFalse.structuredContent?.['dryRun'], false);

        const createPreview = await findTool('repo_create_file').handler({
            path: 'src/copilot/.ai/jobs/plan-only-created.txt',
            content: 'planned\n',
            dryRun: true,
        });
        assert.equal(createPreview.isError, undefined);
        assert.equal(createPreview.structuredContent?.['plannedTool'], 'repo_create_file');
        assert.equal(createPreview.structuredContent?.['dryRun'], true);
        assert.equal(createPreview.structuredContent?.['destinationExists'], false);

        const indexPreview = await findTool('repo_index_build').handler({
            path: 'src/copilot/mcp',
            maxFiles: 100,
            dryRun: true,
        });
        assert.equal(indexPreview.isError, undefined);
        assert.equal(indexPreview.structuredContent?.['plannedTool'], 'repo_index_build');
        assert.equal(indexPreview.structuredContent?.['dryRun'], true);
        assert.equal(indexPreview.structuredContent?.['plannedOptions']?.['maxFiles'], 100);

        const validator = findTool('run_copilot_validator');
        const inspectFirstPlan = await validator.handler({ dryRun: true });
        assert.equal(inspectFirstPlan.isError, undefined);
        assert.equal(inspectFirstPlan.structuredContent?.['recommendation'], 'no-validator-yet');
        assert.equal(inspectFirstPlan.structuredContent?.['plannedTool'], null);

        const focusedPlan = await validator.handler({
            validator: 'unit-focused',
            testFile: 'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
            dryRun: true,
        });
        assert.equal(focusedPlan.isError, undefined);
        assert.equal(focusedPlan.structuredContent?.['plannedTool'], 'run_copilot_validator');
        assert.equal(focusedPlan.structuredContent?.['validator'], 'unit-focused');
        assert.equal(focusedPlan.structuredContent?.['breadth'], 'file-scoped');
        assert.equal(typeof focusedPlan.structuredContent?.['command'], 'string');

        const broadPlan = await validator.handler({ validator: 'suite-mcp-fast', dryRun: true });
        assert.equal(broadPlan.isError, undefined);
        assert.equal(broadPlan.structuredContent?.['plannedTool'], 'run_copilot_validator');
        assert.equal(broadPlan.structuredContent?.['validator'], 'suite-mcp-fast');
        assert.equal(broadPlan.structuredContent?.['broadValidation'], true);
    });

    it('repo_apply_patch_batch supports sequential atomic patches to the same file', async () => {
        const jobsRoot = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsRoot, { recursive: true });
        const tempDir = await mkdtemp(join(jobsRoot, 'same-file-patch-batch-'));
        const absolutePath = join(tempDir, 'sample.txt');
        const repoPath = relative(process.cwd(), absolutePath).replaceAll('\\', '/');
        await writeFile(absolutePath, 'alpha\nomega\n', 'utf8');
        try {
            const tool = findTool('repo_apply_patch_batch');
            const operations = [
                { old_string: 'alpha', new_string: 'beta' },
                { old_string: 'beta', new_string: 'gamma' },
            ];
            const targets = [{ path: repoPath, operations }];
            const dryRun = await tool.handler({ targets, resultMode: 'detailed' });
            assert.equal(dryRun.isError, undefined);
            assert.equal(dryRun.structuredContent?.['success'], true);
            const planned = /** @type {Record<string, unknown>[]} */ (dryRun.structuredContent?.['operations']);
            assert.equal(planned.length, 2);
            assert.equal(planned[0]?.['groupedSameFile'], true);
            assert.equal(planned[1]?.['groupedSameFile'], true);

            const applied = await tool.handler({
                targets,
                dryRun: false,
                confirmBatch: true,
                resultMode: 'detailed',
            });
            assert.equal(applied.isError, undefined);
            assert.equal(applied.structuredContent?.['success'], true);
            assert.equal(applied.structuredContent?.['appliedCount'], 2);
            const appliedRows = /** @type {Record<string, unknown>[]} */ (applied.structuredContent?.['applied']);
            assert.equal(appliedRows[0]?.['groupedSameFile'], true);
            assert.equal(appliedRows[1]?.['groupedSameFile'], true);
            assert.equal(await readFile(absolutePath, 'utf8'), 'gamma\nomega\n');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_apply_patch_batch distinguishes virtual same-file state from disk baseline on failure', async () => {
        const jobsRoot = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsRoot, { recursive: true });
        const tempDir = await mkdtemp(join(jobsRoot, 'same-file-patch-failure-'));
        const absolutePath = join(tempDir, 'sample.txt');
        const repoPath = relative(process.cwd(), absolutePath).replaceAll('\\', '/');
        const initial = 'alpha beta gamma\n';
        await writeFile(absolutePath, initial, 'utf8');
        try {
            const tool = findTool('repo_apply_patch_batch');
            const result = await tool.handler({
                targets: [
                    {
                        path: repoPath,
                        operations: [
                            { old_string: 'alpha', new_string: 'ALPHA' },
                            { old_string: 'missing', new_string: 'MISSING' },
                        ],
                    },
                ],
                dryRun: false,
                confirmBatch: true,
                resultMode: 'detailed',
            });
            assert.equal(result.isError, undefined);
            assert.equal(result.structuredContent?.['success'], false);
            assert.equal(result.structuredContent?.['partial'], false);
            const failures = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['failures']);
            assert.equal(failures.length, 2);
            const causal = failures.find((row) => row['causalFailure'] === true);
            const aborted = failures.find((row) => row['causalFailure'] === false);
            assert.equal(causal?.['failureClass'], 'virtual-batch-context');
            assert.equal(causal?.['retryability'], 'manual-decision');
            assert.equal(causal?.['recoveryRequired'], false);
            assert.equal(aborted?.['failureClass'], 'dependency-abort');
            const details = /** @type {Record<string, unknown>} */ (causal?.['details']);
            assert.equal(details['currentStateKind'], 'virtual-batch');
            assert.equal(details['currentBytes'], Buffer.byteLength('ALPHA beta gamma\n', 'utf8'));
            assert.equal(details['diskBaselineBytes'], Buffer.byteLength(initial, 'utf8'));
            assert.equal(typeof details['currentHash'], 'string');
            assert.equal(typeof details['diskBaselineHash'], 'string');
            assert.notEqual(details['currentHash'], details['diskBaselineHash']);
            assert.match(String(causal?.['nextAction']), /in-memory virtual state/u);
            assert.equal(await readFile(absolutePath, 'utf8'), initial);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('mcp_validation_dashboard view=latest reads persisted validator history without starting jobs', async () => {
        const tool = findTool('mcp_validation_dashboard');
        const result = await tool.handler({ view: 'latest' });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(typeof result.structuredContent?.['count'], 'number');
        assert.ok(Array.isArray(result.structuredContent?.['summaries']));
        assert.equal(typeof result.structuredContent?.['effectiveChecks'], 'object');
    });

    it('mcp_tunnel_status reports effective OAuth auth and connector smoke freshness', async () => {
        const tool = findTool('mcp_tunnel_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['chatgpt']?.['authentication'], 'OAuth');
        assert.ok('temporaryFallback' in (result.structuredContent ?? {}));
        const permanentTunnel = /** @type {Record<string, unknown>} */ (result.structuredContent?.['permanentTunnel']);
        assert.equal(typeof permanentTunnel['lastSmokeFresh'], 'boolean');
        assert.equal(permanentTunnel['lastSmokeStaleAfterMinutes'], 60);
        assert.ok(
            ['fix-permanent-url', 'run-connector-smoke', 'refresh-connector-smoke', 'use-permanent-hostname'].includes(
                String(permanentTunnel['recommendedAction']),
            ),
        );
    });

    it('project_doctor returns canonical validators', async () => {
        const tool = findTool('project_doctor');
        const result = await tool.handler({ includeScripts: false });

        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const validators = /** @type {Record<string, unknown>} */ (structured['validators']);
        assert.equal(validators['typecheck'], 'npm run typecheck:strict:src.copilot');
        assert.equal(validators['lint'], 'npm run lint:copilot');
        assert.equal(validators['unitMcp'], 'npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp');
        assert.equal(validators['unit'], 'npm run test:copilot:unit');
        assert.equal(validators['mcpFullSuite'], 'npm run copilot:mcp:safe-suite -- mcp-full');
    });
});
