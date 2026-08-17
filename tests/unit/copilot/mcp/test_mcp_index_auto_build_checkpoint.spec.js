// @ts-check

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';

import {
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
            gitSnapshot: { ...cleanSnapshot(), worktreeChanges: [{ status: ' M', path: 'src/copilot/a.js', deleted: false }] },
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

    it('persists checkpoint while preserving the last full-reconcile clock on incremental/skip writes', () => {
        const db = new Database(':memory:');
        writeIndexStartupCheckpoint(
            { scopePath: 'src/copilot', head: 'abc', schemaVersion: 2, mode: 'full-reconcile', nowMs: 1_000 },
            db,
        );
        writeIndexStartupCheckpoint(
            { scopePath: 'src/copilot', head: 'def', schemaVersion: 2, mode: 'incremental', nowMs: 2_000 },
            db,
        );
        const checkpoint = readIndexStartupCheckpoint('src/copilot', db);
        assert.equal(checkpoint?.head, 'def');
        assert.equal(checkpoint?.completedAtMs, 2_000);
        assert.equal(checkpoint?.lastFullReconcileAtMs, 1_000);
        db.close();
    });
});
