// @ts-check

import assert from 'node:assert/strict';
import process from 'node:process';
import { afterEach, describe, it } from 'vitest';

import {
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    getTerminalCapabilities,
    openTerminalSession,
    readTerminalSession,
} from '#copilot/mcp/control-plane';

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {unknown[]} */
function asArray(value) {
    assert.ok(Array.isArray(value));
    return value;
}

async function closeAllSessions() {
    const listed = asRecord(readTerminalSession({ action: 'list', limit: 128 }));
    for (const sessionValue of asArray(listed['sessions'])) {
        const session = asRecord(sessionValue);
        const sessionId = String(session['id']);
        if (session['status'] === 'running') {
            await controlTerminalSession({ action: 'close', sessionId, graceMs: 100 });
        }
        await controlTerminalSession({ action: 'forget', sessionId });
    }
}

/**
 * @param {string} sessionId
 * @param {string} expected
 * @param {number} [timeoutMs]
 */
async function waitForSessionText(sessionId, expected, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    let afterSeq = 0;
    let combined = '';
    while (Date.now() < deadline) {
        const read = asRecord(readTerminalSession({ action: 'read', sessionId, afterSeq, maxBytes: 128 * 1024 }));
        for (const eventValue of asArray(read['events'])) {
            const event = asRecord(eventValue);
            combined += String(event['data'] ?? '');
        }
        afterSeq = Number(read['nextSeq'] ?? afterSeq);
        if (combined.includes(expected)) return combined;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return combined;
}

afterEach(async () => {
    await closeAllSessions();
});

describe('MCP terminal control plane', () => {
    it('executes arbitrary shell commands with bounded output', async () => {
        const result = asRecord(
            await executeTerminalCommand({ command: "printf 'terminal-shell-ok'", timeoutMs: 5_000 }),
        );
        assert.equal(result['success'], true);
        assert.equal(result['stdout'], 'terminal-shell-ok');
        assert.equal(result['stderr'], '');
        assert.equal(result['shell'], true);
    });

    it('executes arbitrary argv commands without a shell', async () => {
        const result = asRecord(
            await executeTerminalCommand({
                command: process.execPath,
                args: ['-e', "process.stdout.write('argv-ok')"],
                shell: false,
                timeoutMs: 5_000,
            }),
        );
        assert.equal(result['success'], true);
        assert.equal(result['stdout'], 'argv-ok');
        assert.equal(result['executable'], process.execPath);
    });

    it('batches independent arbitrary commands in one call', async () => {
        const result = asRecord(
            await executeTerminalCommandBatch(
                [{ command: "printf 'one'" }, { command: "printf 'two'" }, { command: "printf 'three'" }],
                { concurrency: 3, failureMode: 'best-effort' },
            ),
        );
        assert.equal(result['success'], true);
        assert.equal(result['succeededCount'], 3);
        assert.equal(result['resultBudgetBytes'], 8 * 1024 * 1024);
        assert.equal(result['perStreamOutputBudgetBytes'], Math.floor((8 * 1024 * 1024) / 6));
        assert.deepEqual(
            asArray(result['results']).map((row) => String(asRecord(row)['stdout'])),
            ['one', 'two', 'three'],
        );
    });

    it('enforces an aggregate retained-output budget across terminal batches', async () => {
        const result = asRecord(
            await executeTerminalCommandBatch(
                [
                    {
                        command: `${process.execPath} -e "process.stdout.write('a'.repeat(400000))"`,
                        maxOutputBytes: 1024 * 1024,
                    },
                    {
                        command: `${process.execPath} -e "process.stdout.write('b'.repeat(400000))"`,
                        maxOutputBytes: 1024 * 1024,
                    },
                ],
                { concurrency: 2, resultBudgetBytes: 1024 * 1024 },
            ),
        );
        assert.equal(result['success'], true);
        assert.equal(result['resultBudgetBytes'], 1024 * 1024);
        assert.equal(result['perStreamOutputBudgetBytes'], 256 * 1024);
        for (const rowValue of asArray(result['results'])) {
            const row = asRecord(rowValue);
            assert.ok(Buffer.byteLength(String(row['stdout'])) <= 256 * 1024);
            assert.equal(row['stdoutTruncated'], true);
            assert.equal(row['stdoutBytesObserved'], 400000);
        }
    });

    it('opens a persistent pipe session and supports write/read/close lifecycle', async () => {
        const opened = asRecord(
            await openTerminalSession({ command: 'cat', shell: false, backend: 'pipe', bufferBytes: 256 * 1024 }),
        );
        assert.equal(opened['success'], true);
        const openedSession = asRecord(opened['session']);
        const sessionId = String(openedSession['id']);
        assert.equal(openedSession['backend'], 'pipe');

        const wrote = asRecord(
            await controlTerminalSession({ action: 'write', sessionId, data: 'persistent-ok', appendNewline: true }),
        );
        assert.equal(wrote['success'], true);

        const output = await waitForSessionText(sessionId, 'persistent-ok');
        assert.ok(output.includes('persistent-ok'));

        const closed = asRecord(await controlTerminalSession({ action: 'close', sessionId, graceMs: 100 }));
        assert.equal(closed['success'], true);
        assert.notEqual(asRecord(closed['session'])['status'], 'running');
    });

    it('reports PTY capability without requiring node-pty at MCP startup', () => {
        const capabilities = asRecord(getTerminalCapabilities());
        assert.equal(capabilities['arbitraryCommands'], true);
        assert.equal(capabilities['persistentSessions'], true);
        assert.equal(typeof capabilities['pty'], 'boolean');
        assert.equal(capabilities['maxSessions'], 128);
    });
});
