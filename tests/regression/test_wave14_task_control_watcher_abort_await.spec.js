import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TaskControlWatcher } from '#agent/task_control_watcher';

test('wave14: TaskControlWatcher emit path awaits sendCommand with retry', async () => {
    let attempts = 0;
    const watcher = new TaskControlWatcher({
        nerv: {
            emitCommand: async () => {
                attempts++;
                if (attempts === 1) {
                    throw new Error('transient failure');
                }
            },
        },
        intervalMs: 999999,
    });

    watcher.abortTimeoutMs = 100;
    watcher.abortMaxRetries = 2;

    const result = await watcher._emitAbortCommand('task-1', 'USER_CANCELLED', 'corr-1');

    assert.equal(result.ok, true, 'abort emission should recover after retry');
    assert.equal(result.attempt, 2, 'success should happen on second attempt');
    assert.equal(attempts, 2, 'watcher should retry once after transient failure');
});

test('wave14: TaskControlWatcher abort emission times out with bounded retries', async () => {
    let attempts = 0;
    const watcher = new TaskControlWatcher({
        nerv: {
            emitCommand: async () => {
                attempts++;
                return await new Promise(() => {});
            },
        },
        intervalMs: 999999,
    });

    watcher.abortTimeoutMs = 20;
    watcher.abortMaxRetries = 1;

    const result = await watcher._emitAbortCommand('task-timeout', 'USER_PAUSED', 'corr-timeout');

    assert.equal(result.ok, false, 'abort emission should fail after retry budget is exhausted');
    assert.equal(result.attempts, 2, 'attempt count should include initial try + retry');
    assert.match(result.error, /timed out/i, 'failure reason should preserve timeout context');
    assert.equal(attempts, 2, 'emitCommand should be called until retry budget is exhausted');
});

test('wave14: source keeps awaited sendCommand and abort timeout/retry env knobs', async () => {
    const filePath = path.join(process.cwd(), 'src/agent/task_control_watcher.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.match(
        content,
        /await\s+this\._withTimeout\(\s*sendCommand\(/s,
        'TaskControlWatcher should await sendCommand via timeout wrapper'
    );

    assert.match(
        content,
        /TASK_CONTROL_ABORT_TIMEOUT_MS/,
        'watcher should read TASK_CONTROL_ABORT_TIMEOUT_MS env knob'
    );

    assert.match(
        content,
        /TASK_CONTROL_ABORT_MAX_RETRIES/,
        'watcher should read TASK_CONTROL_ABORT_MAX_RETRIES env knob'
    );
});
