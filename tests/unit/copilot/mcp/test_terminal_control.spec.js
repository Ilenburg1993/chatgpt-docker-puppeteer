// @ts-check

import assert from 'node:assert/strict';
import process from 'node:process';
import { afterEach, describe, it, vi } from 'vitest';

import {
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    getTerminalCapabilities,
    openTerminalSession,
    readMcpTerminalProcessConfig,
    readTerminalSession,
} from '#copilot/mcp/public/process/terminal';

const TERMINAL_TEST_CONFIG = readMcpTerminalProcessConfig(process.env);
const TERMINAL_TEST_RUNTIME = Object.freeze({ workspaceRoot: process.cwd(), config: TERMINAL_TEST_CONFIG });

/** @param {Parameters<typeof executeTerminalCommand>[0]} input */
const executeTerminalCommandForTest = (input) => executeTerminalCommand(input, TERMINAL_TEST_RUNTIME);

/**
 * @param {Parameters<typeof executeTerminalCommandBatch>[0]} commands
 * @param {Parameters<typeof executeTerminalCommandBatch>[2]} [options]
 */
const executeTerminalCommandBatchForTest = (commands, options = {}) =>
    executeTerminalCommandBatch(commands, TERMINAL_TEST_RUNTIME, options);

/** @param {Parameters<typeof openTerminalSession>[0]} input */
const openTerminalSessionForTest = (input) => openTerminalSession(input, TERMINAL_TEST_RUNTIME);

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
    const listed = asRecord(readTerminalSession({ action: 'list', limit: 128 }, TERMINAL_TEST_RUNTIME));
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
        const read = asRecord(
            readTerminalSession({ action: 'read', sessionId, afterSeq, maxBytes: 128 * 1024 }, TERMINAL_TEST_RUNTIME),
        );
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
    vi.unstubAllEnvs();
});

describe('MCP terminal control plane', () => {
    it('executes arbitrary shell commands with bounded output', async () => {
        const result = asRecord(
            await executeTerminalCommandForTest({ command: "printf 'terminal-shell-ok'", timeoutMs: 5_000 }),
        );
        assert.equal(result['success'], true);
        assert.equal(result['stdout'], 'terminal-shell-ok');
        assert.equal(result['stderr'], '');
        assert.equal(result['shell'], true);
    });

    it('executes arbitrary argv commands without a shell', async () => {
        const result = asRecord(
            await executeTerminalCommandForTest({
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

    it('does not inherit ambient parent credentials into generic child execution', async () => {
        vi.stubEnv('AURELIN_TEST_AMBIENT_SECRET', 'ambient-secret-must-not-cross');
        const result = asRecord(
            await executeTerminalCommandForTest({
                command: process.execPath,
                args: [
                    '-e',
                    'process.stdout.write(JSON.stringify({secret:process.env.AURELIN_TEST_AMBIENT_SECRET??null,path:Boolean(process.env.PATH)}))',
                ],
                shell: false,
                timeoutMs: 5_000,
            }),
        );
        assert.equal(result['success'], true);
        assert.deepEqual(JSON.parse(String(result['stdout'])), { secret: null, path: true });
        const projection = asRecord(result['environmentProjection']);
        assert.equal(projection['inheritance'], 'operational');
        assert.equal(projection['ambientCredentialInheritance'], false);
    });

    it('allows arbitrary environment values when they are injected explicitly', async () => {
        vi.stubEnv('AURELIN_TEST_AMBIENT_SECRET', 'ambient-value');
        const result = asRecord(
            await executeTerminalCommandForTest({
                command: process.execPath,
                args: ['-e', "process.stdout.write(process.env.AURELIN_TEST_AMBIENT_SECRET??'missing')"],
                shell: false,
                env: { AURELIN_TEST_AMBIENT_SECRET: 'explicit-value' },
                timeoutMs: 5_000,
            }),
        );
        assert.equal(result['success'], true);
        assert.equal(result['stdout'], 'explicit-value');
        const projection = asRecord(result['environmentProjection']);
        assert.equal(projection['explicitOverrideCount'], 1);
    });

    it('supports a fully empty inherited environment while retaining explicit overrides', async () => {
        const result = asRecord(
            await executeTerminalCommandForTest({
                command: process.execPath,
                args: [
                    '-e',
                    'process.stdout.write(JSON.stringify({path:process.env.PATH??null,only:process.env.ONLY_EXPLICIT??null}))',
                ],
                shell: false,
                inheritEnv: false,
                env: { ONLY_EXPLICIT: 'yes' },
                timeoutMs: 5_000,
            }),
        );
        assert.equal(result['success'], true);
        assert.deepEqual(JSON.parse(String(result['stdout'])), { path: null, only: 'yes' });
        const projection = asRecord(result['environmentProjection']);
        assert.equal(projection['inheritance'], 'none');
    });

    it('cancels a long-running one-shot process and resolves only after child close is observed', async () => {
        const controller = new AbortController();
        const runtime = {
            workspaceRoot: process.cwd(),
            signal: controller.signal,
            cancellationSource: () => /** @type {const} */ ('caller'),
            config: TERMINAL_TEST_CONFIG,
        };
        const startedAt = Date.now();
        const execution = executeTerminalCommand(
            {
                command: process.execPath,
                args: ['-e', 'setInterval(() => {}, 1000)'],
                shell: false,
                timeoutMs: 30_000,
            },
            runtime,
        );
        setTimeout(() => controller.abort(), 50).unref();

        const result = asRecord(await execution);
        assert.equal(result['success'], false);
        assert.equal(result['cancelled'], true);
        assert.equal(result['cancellationSource'], 'caller');
        assert.equal(result['timedOut'], false);
        assert.ok(result['signal'] === 'SIGTERM' || result['signal'] === 'SIGKILL');
        assert.ok(Date.now() - startedAt < 5_000, 'cancelled child must not survive until its 30s execution timeout');
    });

    it('batches independent arbitrary commands in one call', async () => {
        const result = asRecord(
            await executeTerminalCommandBatchForTest(
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

    it('reports fail-fast skipped commands explicitly instead of leaving sparse batch holes', async () => {
        const result = asRecord(
            await executeTerminalCommandBatchForTest(
                [{ command: 'exit 7' }, { command: "printf 'must-skip-1'" }, { command: "printf 'must-skip-2'" }],
                { concurrency: 1, failureMode: 'fail-fast' },
            ),
        );
        assert.equal(result['success'], false);
        assert.equal(result['requestCount'], 3);
        assert.equal(result['attemptedCount'], 1);
        assert.equal(result['succeededCount'], 0);
        assert.equal(result['failedCount'], 1);
        assert.equal(result['skippedCount'], 2);
        const rows = asArray(result['results']).map(asRecord);
        assert.equal(rows.length, 3);
        assert.equal(rows[0]?.['skipped'], undefined);
        assert.equal(rows[1]?.['skipped'], true);
        assert.equal(rows[2]?.['skipped'], true);
        assert.equal(rows[1]?.['reason'], 'fail-fast-aborted');
        assert.equal(rows[2]?.['reason'], 'fail-fast-aborted');
    });

    it('enforces an aggregate retained-output budget across terminal batches', async () => {
        const result = asRecord(
            await executeTerminalCommandBatchForTest(
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

    it('terminates and drains a persistent pipe child when caller cancellation wins before spawn acceptance', async () => {
        const controller = new AbortController();
        const runtime = {
            workspaceRoot: process.cwd(),
            signal: controller.signal,
            cancellationSource: () => /** @type {const} */ ('caller'),
            config: TERMINAL_TEST_CONFIG,
        };
        const pending = openTerminalSession(
            {
                command: process.execPath,
                args: ['-e', 'setInterval(() => {}, 1000)'],
                shell: false,
                backend: 'pipe',
            },
            runtime,
        );
        controller.abort(new Error('cancel-before-terminal-session-acceptance'));

        const result = asRecord(await pending);
        assert.equal(result['success'], false);
        assert.equal(result['code'], 'MCP_TOOL_CANCELLED');
        assert.match(String(result['error'] ?? ''), /cancel-before-terminal-session-acceptance/u);

        const listed = asRecord(readTerminalSession({ action: 'list', limit: 128 }, TERMINAL_TEST_RUNTIME));
        assert.equal(Number(listed['total'] ?? -1), 0);
    });

    it('transfers lifecycle authority after persistent pipe session spawn acceptance', async () => {
        const controller = new AbortController();
        const runtime = {
            workspaceRoot: process.cwd(),
            signal: controller.signal,
            cancellationSource: () => /** @type {const} */ ('caller'),
            config: TERMINAL_TEST_CONFIG,
        };
        const opened = asRecord(
            await openTerminalSession(
                {
                    command: process.execPath,
                    args: ['-e', 'setInterval(() => {}, 1000)'],
                    shell: false,
                    backend: 'pipe',
                },
                runtime,
            ),
        );
        assert.equal(opened['success'], true);
        const session = asRecord(opened['session']);
        const sessionId = String(session['id']);
        assert.equal(session['status'], 'running');

        controller.abort(new Error('caller-no-longer-owns-accepted-session'));
        await new Promise((resolve) => setTimeout(resolve, 75));

        const status = asRecord(readTerminalSession({ action: 'status', sessionId }, TERMINAL_TEST_RUNTIME));
        assert.equal(status['success'], true);
        assert.equal(asRecord(status['session'])['status'], 'running');

        const closed = asRecord(await controlTerminalSession({ action: 'close', sessionId, graceMs: 250 }));
        assert.equal(closed['success'], true);
        assert.notEqual(asRecord(closed['session'])['status'], 'running');
    });

    it('opens a persistent pipe session and supports write/read/close lifecycle', async () => {
        const opened = asRecord(
            await openTerminalSessionForTest({
                command: 'cat',
                shell: false,
                backend: 'pipe',
                bufferBytes: 256 * 1024,
            }),
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

    it('keeps shell and operational environment bound to the captured generation', async () => {
        const config = readMcpTerminalProcessConfig({
            PATH: '/usr/bin:/bin',
            SHELL: '/bin/sh',
            AURELIN_TEST_AMBIENT_SECRET: 'must-not-cross',
        });
        const runtime = Object.freeze({ workspaceRoot: process.cwd(), config });
        vi.stubEnv('SHELL', '/bin/false');
        vi.stubEnv('AURELIN_TEST_AMBIENT_SECRET', 'late-secret');
        const capabilities = asRecord(getTerminalCapabilities(config));
        assert.equal(capabilities['defaultShell'], '/bin/sh');
        assert.equal(config.operationalEnvironment['AURELIN_TEST_AMBIENT_SECRET'], undefined);
        const result = asRecord(
            await executeTerminalCommand(
                {
                    command: process.execPath,
                    args: ['-e', "process.stdout.write(process.env.AURELIN_TEST_AMBIENT_SECRET??'missing')"],
                    shell: false,
                },
                runtime,
            ),
        );
        assert.equal(result['stdout'], 'missing');
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.operationalEnvironment), true);
    });

    it('reports PTY capability without requiring node-pty at MCP startup', () => {
        const capabilities = asRecord(getTerminalCapabilities(TERMINAL_TEST_CONFIG));
        assert.equal(capabilities['arbitraryCommands'], true);
        assert.equal(capabilities['persistentSessions'], true);
        assert.equal(capabilities['ambientCredentialInheritance'], false);
        assert.equal(capabilities['defaultEnvironmentInheritance'], 'operational-projection');
        assert.equal(capabilities['explicitEnvironmentOverrides'], true);
        assert.equal(typeof capabilities['pty'], 'boolean');
        assert.equal(capabilities['maxSessions'], 128);
    });
});
