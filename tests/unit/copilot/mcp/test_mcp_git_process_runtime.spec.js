// @ts-check

import { createMcpGitProcessConfig, execWorkspaceGit } from '#copilot/mcp/public/workspace/git';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'vitest';

/** @param {string} path */
async function readPidWhenPublished(path) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        try {
            const value = Number((await readFile(path, 'utf8')).trim());
            if (Number.isInteger(value) && value > 0) return value;
        } catch {
            // Publication is asynchronous; retry until the bounded deadline.
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`PID file was not published: ${path}`);
}

/** @param {number} pid */
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** @param {number} pid */
async function assertProcessGone(pid) {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && processExists(pid)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(processExists(pid), false, `process ${pid} should be gone before Git execution settles`);
}

/** @param {string} dir @param {string} body */
async function writeFakeGit(dir, body) {
    const gitPath = join(dir, 'git');
    await writeFile(gitPath, `#!/bin/sh\nset -eu\n${body}\n`, 'utf8');
    await chmod(gitPath, 0o755);
    return gitPath;
}

describe('MCP governed Git process runtime', () => {
    it('projects only operational Git authority and excludes arbitrary ambient credentials', () => {
        const config = createMcpGitProcessConfig({
            PATH: '/usr/bin:/bin',
            HOME: '/tmp/mcp-git-home',
            LANG: 'C.UTF-8',
            SSH_AUTH_SOCK: '/tmp/mcp-agent.sock',
            GIT_SSH_COMMAND: 'malicious-ambient-command',
            GIT_ASKPASS: '/tmp/ambient-askpass',
            GITHUB_TOKEN: 'must-not-cross',
            OPENAI_API_KEY: 'must-not-cross',
            FUTURE_UNKNOWN_SECRET: 'must-not-cross',
        });

        assert.equal(config.childEnvironment['PATH'], '/usr/bin:/bin');
        assert.equal(config.childEnvironment['HOME'], '/tmp/mcp-git-home');
        assert.equal(config.childEnvironment['LANG'], 'C.UTF-8');
        assert.equal(config.childEnvironment['SSH_AUTH_SOCK'], '/tmp/mcp-agent.sock');
        assert.equal(config.childEnvironment['GIT_TERMINAL_PROMPT'], '0');
        assert.equal(config.childEnvironment['GIT_SSH_COMMAND'], undefined);
        assert.equal(config.childEnvironment['GIT_ASKPASS'], undefined);
        assert.equal(config.childEnvironment['GITHUB_TOKEN'], undefined);
        assert.equal(config.childEnvironment['OPENAI_API_KEY'], undefined);
        assert.equal(config.childEnvironment['FUTURE_UNKNOWN_SECRET'], undefined);
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.childEnvironment), true);
    });

    it('aborts the physical Git process group and drains descendants before resolving', async () => {
        if (process.platform === 'win32') return;
        const dir = await mkdtemp(join(tmpdir(), 'mcp-git-abort-'));
        const marker = join(dir, 'git-pids');
        try {
            await writeFakeGit(
                dir,
                String.raw`marker="$1"
printf '%s\n' "$$" > "${marker}.parent"
/bin/sleep 30 &
child_pid=$!
printf '%s\n' "$child_pid" > "${marker}.child"
wait "$child_pid"`,
            );
            const config = createMcpGitProcessConfig({
                PATH: `${dir}:/usr/bin:/bin`,
                HOME: dir,
            });
            const controller = new AbortController();
            const execution = execWorkspaceGit([marker], {
                cwd: dir,
                config,
                signal: controller.signal,
                timeoutMs: 10_000,
            });
            const [parentPid, childPid] = await Promise.all([
                readPidWhenPublished(`${marker}.parent`),
                readPidWhenPublished(`${marker}.child`),
            ]);
            controller.abort(new Error('unit-test-caller-abort'));
            const result = await execution;

            assert.equal(result.success, false);
            assert.equal(result.cancelled, true);
            assert.equal(result.timedOut, false);
            assert.match(result.error ?? '', /unit-test-caller-abort/u);
            await assertProcessGone(parentPid);
            await assertProcessGone(childPid);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('turns timeout and output overflow into physical termination instead of background work', async () => {
        if (process.platform === 'win32') return;
        const dir = await mkdtemp(join(tmpdir(), 'mcp-git-bounds-'));
        try {
            await writeFakeGit(dir, '/bin/sleep 30');
            const config = createMcpGitProcessConfig({ PATH: `${dir}:/usr/bin:/bin`, HOME: dir });
            const timedOut = await execWorkspaceGit([], { cwd: dir, config, timeoutMs: 50 });
            assert.equal(timedOut.success, false);
            assert.equal(timedOut.timedOut, true);
            assert.equal(timedOut.cancelled, false);

            await writeFakeGit(
                dir,
                'i=0; while [ "$i" -lt 300 ]; do printf \'0123456789\'; i=$((i + 1)); done; /bin/sleep 30',
            );
            const overflow = await execWorkspaceGit([], {
                cwd: dir,
                config,
                timeoutMs: 5_000,
                maxBufferBytes: 1024,
            });
            assert.equal(overflow.success, false);
            assert.equal(overflow.outputLimitExceeded, true);
            assert.equal(Buffer.byteLength(overflow.stdout, 'utf8') <= 1024, true);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
