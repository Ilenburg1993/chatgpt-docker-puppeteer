// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    classifyIndexJournalReplayRows,
    parseGitNameStatusZ,
    parseGitStatusZ,
    planIndexStartup,
    readIndexStartupCheckpoint,
    writeIndexStartupCheckpoint,
} from '../../../../src/copilot/mcp/control-plane/index-auto-build-checkpoint.js';

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
        const columns = /** @type {{ name: string }[]} */ (
            db.prepare('PRAGMA table_info(copilot_mcp_index_startup_checkpoint)').all()
        );
        assert.equal(
            columns.some((column) => column.name === 'journal_sequence'),
            true,
        );
        db.close();
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
        db.close();
    });
});
