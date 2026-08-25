// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'vitest';

import { maybeStartMcpIndexAutoBuild, readMcpIndexAutoBuildConfig } from '#copilot/mcp/public/indexing/auto-build';
import { createMcpGitProcessConfig } from '#copilot/mcp/public/workspace/git';
import {
    classifyIndexJournalReplayRows,
    parseGitNameStatusZ,
    parseGitStatusZ,
    planIndexStartup,
    readIndexStartupCheckpoint,
    resetMcpIndexAutoBuildStateForTests,
    writeIndexStartupCheckpoint,
} from '#copilot/testing/mcp/indexing/auto-build';

function cleanSnapshot(head = 'abc') {
    return {
        available: true,
        head,
        worktreeChanges: [],
        uncertain: false,
        error: null,
        durationMs: 12,
    };
}

describe('MCP index startup checkpoint', () => {
    beforeEach(() => resetMcpIndexAutoBuildStateForTests());

    it('captures bounded hash-sample and no-change SLO policy in config generation v2', () => {
        const config = readMcpIndexAutoBuildConfig({
            COPILOT_MCP_INDEX_HASH_VERIFY_SAMPLE_FILES: '17',
            COPILOT_MCP_INDEX_NO_CHANGE_SLO_MS: '750',
        });
        assert.equal(config.schemaVersion, 2);
        assert.equal(config.hashVerifySampleFiles, 17);
        assert.equal(config.noChangeSloMs, 750);
        assert.match(config.generationKey, /^v2:/u);
    });
    it('parses scoped porcelain status and marks conflicts uncertain', () => {
        const parsed = parseGitStatusZ(' M src/copilot/a.js\0?? src/copilot/new.md\0 D src/copilot/old.js\0');
        assert.deepEqual(
            parsed.changes.map((entry) => [entry.status, entry.path, entry.deleted]),
            [
                [' M', 'src/copilot/a.js', false],
                ['??', 'src/copilot/new.md', false],
                [' D', 'src/copilot/old.js', true],
            ],
        );
        assert.equal(parsed.uncertain, false);
        assert.equal(parseGitStatusZ('UU src/copilot/conflict.js\0').uncertain, true);
    });

    it('parses commit diff records without rename ambiguity', () => {
        const parsed = parseGitNameStatusZ('M\0src/copilot/a.js\0D\0src/copilot/old.js\0A\0src/copilot/new.js\0');
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(
            parsed.changes.map((entry) => [entry.status, entry.path, entry.deleted]),
            [
                ['M', 'src/copilot/a.js', false],
                ['D', 'src/copilot/old.js', true],
                ['A', 'src/copilot/new.js', false],
            ],
        );
    });

    it('chooses full, incremental and skip modes from explicit evidence', () => {
        const base = {
            scopePath: 'src/copilot',
            head: 'abc',
            schemaVersion: 2,
            completedAtMs: 1_000,
            lastFullReconcileAtMs: 1_000,
            journalSequence: 10,
        };
        assert.equal(
            planIndexStartup({
                checkpoint: null,
                gitSnapshot: cleanSnapshot(),
                schemaVersion: 2,
                indexFiles: 100,
                nowMs: 2_000,
                fullReconcileIntervalMs: 60_000,
            }).mode,
            'full-reconcile',
        );
        assert.equal(
            planIndexStartup({
                checkpoint: base,
                gitSnapshot: cleanSnapshot(),
                schemaVersion: 2,
                indexFiles: 100,
                nowMs: 2_000,
                fullReconcileIntervalMs: 60_000,
            }).mode,
            'skip',
        );
        const dirty = planIndexStartup({
            checkpoint: base,
            gitSnapshot: {
                ...cleanSnapshot(),
                worktreeChanges: [{ status: ' M', path: 'src/copilot/a.js', deleted: false }],
            },
            schemaVersion: 2,
            indexFiles: 100,
            nowMs: 2_000,
            fullReconcileIntervalMs: 60_000,
        });
        assert.equal(dirty.mode, 'incremental');
        assert.equal(dirty.reason, 'worktree-dirty');
        const headChanged = planIndexStartup({
            checkpoint: base,
            gitSnapshot: cleanSnapshot('def'),
            schemaVersion: 2,
            indexFiles: 100,
            nowMs: 2_000,
            fullReconcileIntervalMs: 60_000,
        });
        assert.equal(headChanged.mode, 'incremental');
        assert.equal(headChanged.needsCommittedDiff, true);
        assert.equal(
            planIndexStartup({
                checkpoint: base,
                gitSnapshot: cleanSnapshot(),
                schemaVersion: 2,
                indexFiles: 100,
                nowMs: 61_001,
                fullReconcileIntervalMs: 60_000,
            }).reason,
            'periodic-safety-reconcile',
        );
    });

    it('classifies journal paths without treating journal rows as path authority', () => {
        const classified = classifyIndexJournalReplayRows(
            [
                { filePath: '/workspace/src/copilot/a.js', recursive: 0 },
                { filePath: '/workspace/src/copilot/a.js', recursive: 0 },
                { filePath: '/workspace/src/copilot/subtree', recursive: 1 },
                { filePath: '/workspace/src/copilot/.ai/jobs', recursive: 1 },
                { filePath: '/workspace/src/server/outside.js', recursive: 0 },
                { filePath: 'src/copilot/relative.js', recursive: 0 },
            ],
            '/workspace/src/copilot',
        );
        assert.deepEqual(classified.paths, ['/workspace/src/copilot/a.js']);
        assert.equal(classified.replayablePathCount, 1);
        assert.equal(classified.outsideScopeRows, 1);
        assert.equal(classified.hiddenScopeRows, 1);
        assert.equal(classified.invalidPathRows, 1);
        assert.equal(classified.recursiveScopeInvalidation, true);
        assert.throws(
            () => classifyIndexJournalReplayRows([{ filePath: '/workspace/src/copilot/a.js' }], 'src/copilot'),
            /scopeRoot must already be absolute/,
        );
    });

    it('uses journal replay as additive evidence and fails closed on replay uncertainty', () => {
        const base = {
            scopePath: 'src/copilot',
            head: 'abc',
            schemaVersion: 2,
            completedAtMs: 1_000,
            lastFullReconcileAtMs: 1_000,
            journalSequence: 10,
        };
        const common = {
            checkpoint: base,
            gitSnapshot: cleanSnapshot(),
            schemaVersion: 2,
            indexFiles: 100,
            nowMs: 2_000,
            fullReconcileIntervalMs: 60_000,
        };
        const replay = planIndexStartup({
            ...common,
            journalReplay: {
                available: true,
                gapDetected: false,
                truncated: false,
                replayablePathCount: 2,
                recursiveScopeInvalidation: false,
            },
        });
        assert.equal(replay.mode, 'incremental');
        assert.equal(replay.reason, 'journal-replay');

        for (const [journalReplay, expectedReason] of [
            [
                {
                    available: false,
                    gapDetected: true,
                    truncated: false,
                    replayablePathCount: 0,
                    recursiveScopeInvalidation: false,
                },
                'journal-evidence-unavailable',
            ],
            [
                {
                    available: true,
                    gapDetected: true,
                    truncated: false,
                    replayablePathCount: 0,
                    recursiveScopeInvalidation: false,
                },
                'journal-gap-detected',
            ],
            [
                {
                    available: true,
                    gapDetected: false,
                    truncated: true,
                    replayablePathCount: 1,
                    recursiveScopeInvalidation: false,
                },
                'journal-replay-truncated',
            ],
            [
                {
                    available: true,
                    gapDetected: false,
                    truncated: false,
                    replayablePathCount: 0,
                    recursiveScopeInvalidation: false,
                    invalidPathRows: 1,
                },
                'journal-invalid-path',
            ],
            [
                {
                    available: true,
                    gapDetected: false,
                    truncated: false,
                    replayablePathCount: 1,
                    recursiveScopeInvalidation: true,
                },
                'journal-recursive-invalidation',
            ],
        ]) {
            const plan = planIndexStartup({ ...common, journalReplay: /** @type {any} */ (journalReplay) });
            assert.equal(plan.mode, 'full-reconcile');
            assert.equal(plan.reason, expectedReason);
        }
    });

    it('migrates legacy checkpoint rows with journal sequence zero', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE copilot_mcp_index_startup_checkpoint (
                scope_path TEXT PRIMARY KEY,
                head TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                completed_at_ms INTEGER NOT NULL,
                last_full_reconcile_at_ms INTEGER NOT NULL
            ) STRICT;
            INSERT INTO copilot_mcp_index_startup_checkpoint
                (scope_path, head, schema_version, completed_at_ms, last_full_reconcile_at_ms)
            VALUES ('src/copilot', 'abc', 2, 1000, 1000);
        `);
        const checkpoint = readIndexStartupCheckpoint('src/copilot', adaptBetterSqliteDatabase(db));
        assert.equal(checkpoint?.journalSequence, 0);
        assert.equal(checkpoint?.hashVerificationCursor, '');
        const columns = /** @type {{ name: string }[]} */ (
            db.prepare('PRAGMA table_info(copilot_mcp_index_startup_checkpoint)').all()
        );
        assert.equal(
            columns.some((column) => column.name === 'journal_sequence'),
            true,
        );
        assert.equal(
            columns.some((column) => column.name === 'hash_verification_cursor'),
            true,
        );
        db.close();
    });

    it('does not publish a successful full-reconcile checkpoint after cancellation inside index build', async () => {
        const sqlite = new Database(':memory:');
        const db = adaptBetterSqliteDatabase(sqlite);
        const config = readMcpIndexAutoBuildConfig({
            COPILOT_MCP_INDEX_AUTO_BUILD: 'true',
            COPILOT_MCP_INDEX_AUTO_BUILD_PATH: 'src/copilot/mcp',
            COPILOT_MCP_INDEX_FULL_RECONCILE_INTERVAL_MS: '1',
        });
        const gitConfig = createMcpGitProcessConfig({ PATH: process.env['PATH'], HOME: process.env['HOME'] });
        const controller = new AbortController();
        let buildCalls = 0;
        let reconcileCalls = 0;
        const indexRegistry = {
            status: () => ({ available: true, schemaVersion: 2, files: 0 }),
            filterRefreshDomainPaths: async (paths) => ({ paths, domainSkipped: 0, gitignoredSkipped: 0 }),
            refreshPaths: async () => ({ available: true, failed: 0 }),
            buildDirectory: async (_path, options) => {
                buildCalls += 1;
                assert.equal(options.signal, controller.signal);
                controller.abort(new Error('abort-during-full-index-build'));
                options.signal?.throwIfAborted();
                return { available: true, indexed: 1, failed: 0 };
            },
            reconcileAutoRefreshDomain: async () => {
                reconcileCalls += 1;
                return { available: true };
            },
        };
        const workspace = {
            workspaceRoot: process.cwd(),
            indexRegistry,
            resolveReadPath: async () => ({
                ok: true,
                resolved: `${process.cwd()}/src/copilot/mcp`,
                relative: 'src/copilot/mcp',
            }),
        };
        try {
            const state = await maybeStartMcpIndexAutoBuild({
                workspace: /** @type {any} */ (workspace),
                config,
                gitConfig,
                signal: controller.signal,
                db,
                reason: 'unit-cancellation-proof',
            });
            assert.equal(buildCalls, 1);
            assert.equal(reconcileCalls, 0);
            assert.equal(state.status, 'failed');
            assert.equal(state.reason, 'aborted');
            assert.match(String(state.error?.message ?? ''), /abort-during-full-index-build/u);
            assert.equal(readIndexStartupCheckpoint(config.path, db), null);
        } finally {
            sqlite.close();
        }
    });

    it('uses bounded hash verification on the no-change fast path and full-reconciles on mismatch', async () => {
        const root = await mkdtemp(join(process.cwd(), 'tmp', '.mcp-index-fast-path-'));
        const scopeRoot = join(root, 'scope');
        await mkdir(scopeRoot, { recursive: true });
        await writeFile(join(scopeRoot, 'stable.md'), 'stable\n', 'utf8');
        execFileSync('git', ['init', '-q'], { cwd: root });
        execFileSync('git', ['config', 'user.email', 'mcp-index-test@example.invalid'], { cwd: root });
        execFileSync('git', ['config', 'user.name', 'MCP Index Test'], { cwd: root });
        execFileSync('git', ['add', '.'], { cwd: root });
        execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        const sqlite = new Database(':memory:');
        const db = adaptBetterSqliteDatabase(sqlite);
        const config = readMcpIndexAutoBuildConfig({
            COPILOT_MCP_INDEX_AUTO_BUILD: 'true',
            COPILOT_MCP_INDEX_AUTO_BUILD_PATH: 'scope',
            COPILOT_MCP_INDEX_HASH_VERIFY_SAMPLE_FILES: '1',
            COPILOT_MCP_INDEX_NO_CHANGE_SLO_MS: '1000',
        });
        const gitConfig = createMcpGitProcessConfig({ PATH: process.env['PATH'], HOME: process.env['HOME'] });
        writeIndexStartupCheckpoint(
            {
                scopePath: config.path,
                head,
                schemaVersion: 2,
                mode: 'full-reconcile',
                nowMs: Date.now(),
                journalSequence: 0,
                hashVerificationCursor: '/previous/cursor',
            },
            db,
        );
        let mismatch = false;
        let buildCalls = 0;
        const indexRegistry = {
            status: () => ({ available: true, schemaVersion: 2, files: 1 }),
            filterRefreshDomainPaths: async (paths) => ({ paths, domainSkipped: 0, gitignoredSkipped: 0 }),
            refreshPaths: async () => ({ available: true, failed: 0 }),
            verifyHashSample: async (_scope, options) => ({
                available: true,
                scopeRoot,
                cursor: options.cursor ?? '',
                nextCursor: join(scopeRoot, 'stable.md'),
                maxFiles: options.maxFiles ?? 0,
                candidateCount: 1,
                wrapped: false,
                hashVerifications: 1,
                hashVerificationHits: mismatch ? 0 : 1,
                hashVerificationMisses: mismatch ? 1 : 0,
                metadataMismatches: 0,
                errors: 0,
                mismatchCount: mismatch ? 1 : 0,
                mismatches: mismatch
                    ? [{ filePath: join(scopeRoot, 'stable.md'), reason: 'content-hash-mismatch' }]
                    : [],
                durationMs: 1,
            }),
            buildDirectory: async () => {
                buildCalls += 1;
                return { available: true, indexed: 1, failed: 0, hashVerifications: 0, durationMs: 2 };
            },
            reconcileAutoRefreshDomain: async () => ({ available: true }),
        };
        const workspace = {
            workspaceRoot: root,
            indexRegistry,
            resolveReadPath: async () => ({ ok: true, resolved: scopeRoot, relative: 'scope' }),
        };
        try {
            const skipped = await maybeStartMcpIndexAutoBuild({
                workspace: /** @type {any} */ (workspace),
                config,
                gitConfig,
                db,
                reason: 'unit-fast-path',
            });
            assert.equal(skipped.status, 'skipped');
            assert.equal(skipped.result?.['mode'], 'skip');
            assert.equal(skipped.result?.['hashVerifications'], 1);
            assert.equal(skipped.result?.['noChangeSloMs'], 1000);
            assert.equal(skipped.result?.['noChangeSloMet'], true);
            assert.equal(buildCalls, 0);
            assert.equal(
                readIndexStartupCheckpoint(config.path, db)?.hashVerificationCursor,
                join(scopeRoot, 'stable.md'),
            );

            mismatch = true;
            const reconciled = await maybeStartMcpIndexAutoBuild({
                workspace: /** @type {any} */ (workspace),
                config,
                gitConfig,
                db,
                reason: 'unit-fast-path-mismatch',
            });
            assert.equal(reconciled.status, 'completed');
            assert.equal(reconciled.result?.['mode'], 'full-reconcile');
            assert.equal(reconciled.result?.['fallbackReason'], 'bounded-hash-verification-mismatch');
            assert.equal(buildCalls, 1);
            assert.equal(readIndexStartupCheckpoint(config.path, db)?.hashVerificationCursor, '');
        } finally {
            sqlite.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('persists checkpoint while preserving the last full-reconcile clock on incremental/skip writes', () => {
        const db = new Database(':memory:');
        writeIndexStartupCheckpoint(
            {
                scopePath: 'src/copilot',
                head: 'abc',
                schemaVersion: 2,
                mode: 'full-reconcile',
                nowMs: 1_000,
                journalSequence: 7,
            },
            adaptBetterSqliteDatabase(db),
        );
        writeIndexStartupCheckpoint(
            {
                scopePath: 'src/copilot',
                head: 'abc',
                schemaVersion: 2,
                mode: 'skip',
                nowMs: 1_500,
                journalSequence: 8,
                hashVerificationCursor: '/workspace/src/copilot/b.js',
            },
            adaptBetterSqliteDatabase(db),
        );
        writeIndexStartupCheckpoint(
            {
                scopePath: 'src/copilot',
                head: 'def',
                schemaVersion: 2,
                mode: 'incremental',
                nowMs: 2_000,
                journalSequence: 9,
            },
            adaptBetterSqliteDatabase(db),
        );
        const checkpoint = readIndexStartupCheckpoint('src/copilot', adaptBetterSqliteDatabase(db));
        assert.equal(checkpoint?.head, 'def');
        assert.equal(checkpoint?.completedAtMs, 2_000);
        assert.equal(checkpoint?.lastFullReconcileAtMs, 1_000);
        assert.equal(checkpoint?.journalSequence, 9);
        assert.equal(checkpoint?.hashVerificationCursor, '/workspace/src/copilot/b.js');
        db.close();
    });
});
