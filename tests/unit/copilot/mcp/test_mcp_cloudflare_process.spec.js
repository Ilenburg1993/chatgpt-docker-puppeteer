// @ts-check

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import {
    ensureDetachedProcess,
    rotateDetachedProcessLogIfOversized,
} from '../../../../src/copilot/mcp/cloudflare/cli-process.js';

describe('MCP Cloudflare detached process supervision', () => {
    it('rotates an oversized detached-process log before a future restart', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-log-rotation-'));
        const logFile = path.join(dir, 'test.log');
        try {
            await fs.writeFile(logFile, 'abcdefghij', 'utf8');
            const result = await rotateDetachedProcessLogIfOversized(logFile, { maxBytes: 5 });
            assert.equal(result.rotated, true);
            assert.equal(result.previousBytes, 10);
            assert.equal(result.rotatedPath, `${logFile}.1`);
            assert.equal(await fs.readFile(`${logFile}.1`, 'utf8'), 'abcdefghij');
            await assert.rejects(fs.access(logFile), /ENOENT/u);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('terminates the detached child when publishing the PID marker fails', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-detached-rollback-'));
        const pidFile = path.join(dir, 'test.pid');
        const metadataFile = `${pidFile}.json`;
        const logFile = path.join(dir, 'test.log');
        /** @type {number | null} */
        let spawnedPid = null;

        try {
            await assert.rejects(
                ensureDetachedProcess({
                    name: 'rollback-test',
                    command: process.execPath,
                    args: ['-e', 'setInterval(() => {}, 1000)'],
                    pidFile,
                    logFile,
                    stateWriter: async (filePath, content) => {
                        if (filePath === pidFile) throw new Error('injected-pid-write-failure');
                        const metadata = JSON.parse(content);
                        spawnedPid = Number(metadata.pid);
                        await fs.writeFile(filePath, content, 'utf8');
                    },
                }),
                /injected-pid-write-failure/u,
            );

            assert.ok(Number.isInteger(spawnedPid) && Number(spawnedPid) > 0);
            assert.throws(() => process.kill(Number(spawnedPid), 0));
            await assert.rejects(fs.access(pidFile), /ENOENT/u);
            await assert.rejects(fs.access(metadataFile), /ENOENT/u);
        } finally {
            if (spawnedPid) {
                try {
                    process.kill(-spawnedPid, 'SIGKILL');
                } catch {
                    // Already terminated by rollback.
                }
            }
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
