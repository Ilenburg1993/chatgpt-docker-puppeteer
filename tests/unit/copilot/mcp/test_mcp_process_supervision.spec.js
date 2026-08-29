// @ts-check

import { createAttachedChildProcessSupervisor } from '#copilot/infra/public/process/supervision';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { describe, it } from 'vitest';

describe('MCP attached child process supervision', () => {
    it('separates termination request from observed close and cancels escalation after close', async () => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        const supervisor = createAttachedChildProcessSupervisor(child);
        assert.equal(supervisor.snapshot().state, 'running');

        const termination = supervisor.requestTermination({ graceMs: 100 });
        assert.equal(termination.requested, true);
        assert.equal(supervisor.snapshot().state, 'termination-requested');

        const closed = await supervisor.closed;
        assert.equal(closed.pid, child.pid ?? null);
        assert.equal(closed.terminationRequested, true);
        assert.equal(closed.requestedSignal, 'SIGTERM');
        assert.ok(closed.signal === 'SIGTERM' || closed.signal === 'SIGKILL');
        assert.equal(supervisor.snapshot().state, 'closed');
        assert.equal(supervisor.snapshot().forceKillScheduled, false);
    });

    it('reports normal child completion without inventing a termination request', async () => {
        const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        const supervisor = createAttachedChildProcessSupervisor(child);
        const closed = await supervisor.closed;
        assert.equal(closed.exitCode, 0);
        assert.equal(closed.signal, null);
        assert.equal(closed.terminationRequested, false);
        assert.equal(supervisor.snapshot().state, 'closed');

        const lateTermination = supervisor.requestTermination({ graceMs: 0 });
        assert.equal(lateTermination.requested, false);
        assert.equal(lateTermination.alreadyClosed, true);
    });
});
