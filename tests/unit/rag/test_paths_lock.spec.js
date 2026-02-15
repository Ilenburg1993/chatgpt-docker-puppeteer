import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { acquireIndexLock, releaseIndexLock } from '../../../tools/rag/lib/paths.mjs';

describe('RAG index lock recovery', () => {
    it('recovers lock when pid is no longer alive even if lock is recent', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-lock-'));
        const lockPath = path.join(root, 'index.lock');
        const paths = { lockPath, dbDir: path.join(root, 'db'), indexDir: root };

        try {
            await fs.writeFile(
                lockPath,
                JSON.stringify({ pid: 999999, started_at: Date.now() }, null, 2),
                'utf8'
            );
            const acquired = await acquireIndexLock(paths, { staleAfterMs: 6 * 60 * 60 * 1000 });
            assert.strictEqual(acquired.acquired, true);

            const lockRaw = await fs.readFile(lockPath, 'utf8');
            const lock = JSON.parse(lockRaw);
            assert.strictEqual(lock.pid, process.pid);
        } finally {
            await releaseIndexLock(paths);
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    it('does not recover lock when pid is the current alive process and lock is recent', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-lock-'));
        const lockPath = path.join(root, 'index.lock');
        const paths = { lockPath, dbDir: path.join(root, 'db'), indexDir: root };

        try {
            await fs.writeFile(
                lockPath,
                JSON.stringify({ pid: process.pid, started_at: Date.now() }, null, 2),
                'utf8'
            );
            const acquired = await acquireIndexLock(paths, { staleAfterMs: 6 * 60 * 60 * 1000 });
            assert.strictEqual(acquired.acquired, false);
            assert.strictEqual(acquired.reason, 'LOCKED');
        } finally {
            await releaseIndexLock(paths);
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
