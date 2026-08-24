// @ts-check

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';

import {
    createCloudflareManagedProcessController,
    observeForegroundCloudflared,
} from '#copilot/testing/mcp/cloudflare';

/** @param {string} dir */
function processConfig(dir) {
    return /** @type {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} */ (
        /** @type {unknown} */ ({
            mcpHttpPidFile: path.join(dir, 'mcp-http.pid'),
            mcpHttpLogFile: path.join(dir, 'mcp-http.log'),
            managedTunnelPidFile: path.join(dir, 'cloudflared.pid'),
            managedTunnelLogFile: path.join(dir, 'cloudflared.log'),
        })
    );
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('MCP Cloudflare bound process supervision', () => {
    it('rotates an oversized detached-process log through the controller-bound exact paths', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-log-rotation-'));
        const config = processConfig(dir);
        const controller = createCloudflareManagedProcessController(config);
        try {
            await fs.writeFile(config.mcpHttpLogFile, 'abcdefghij', 'utf8');
            const result = await controller.mcpHttp.rotateLogIfOversized({ maxBytes: 5 });
            assert.equal(result.rotated, true);
            assert.equal(result.previousBytes, 10);
            assert.equal(result.rotatedPath, `${config.mcpHttpLogFile}.1`);
            assert.equal(await fs.readFile(`${config.mcpHttpLogFile}.1`, 'utf8'), 'abcdefghij');
            await assert.rejects(fs.access(config.mcpHttpLogFile), /ENOENT/u);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('publishes durable metadata before PID and terminates the child when the PID publication gate fails', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-detached-rollback-'));
        const config = processConfig(dir);
        const controller = createCloudflareManagedProcessController(config);
        const metadataFile = `${config.mcpHttpPidFile}.json`;
        /** @type {number | null} */
        let spawnedPid = null;

        try {
            await assert.rejects(
                controller.mcpHttp.ensure({
                    name: 'rollback-test',
                    command: process.execPath,
                    args: ['-e', 'setInterval(() => {}, 1000)'],
                    beforePidPublish: async () => {
                        const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
                        spawnedPid = Number(metadata.pid);
                        assert.equal(metadata.schemaVersion, 2);
                        assert.equal(metadata.name, 'rollback-test');
                        await assert.rejects(fs.access(config.mcpHttpPidFile), /ENOENT/u);
                        throw new Error('injected-pid-publish-failure');
                    },
                }),
                /injected-pid-publish-failure/u,
            );

            assert.ok(Number.isInteger(spawnedPid) && Number(spawnedPid) > 0);
            assert.throws(() => process.kill(Number(spawnedPid), 0));
            await assert.rejects(fs.access(config.mcpHttpPidFile), /ENOENT/u);
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

    it('never publishes metadata or PID when the OS rejects detached spawn', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-detached-spawn-error-'));
        const config = processConfig(dir);
        const controller = createCloudflareManagedProcessController(config);
        const metadataFile = `${config.mcpHttpPidFile}.json`;
        try {
            await assert.rejects(
                controller.mcpHttp.ensure({
                    name: 'spawn-error-test',
                    command: `definitely-not-a-command-${Date.now()}`,
                    args: [],
                }),
                /ENOENT|spawn/u,
            );
            await assert.rejects(fs.access(config.mcpHttpPidFile), /ENOENT/u);
            await assert.rejects(fs.access(metadataFile), /ENOENT/u);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('treats foreground exit as non-terminal until the physical close event is observed', async () => {
        class FakeChild extends EventEmitter {
            pid = 424242;
            /** @returns {boolean} */
            kill() {
                return true;
            }
        }
        const fake = new FakeChild();
        const child = /** @type {import('node:child_process').ChildProcess} */ (/** @type {unknown} */ (fake));
        let settled = false;
        const observed = observeForegroundCloudflared(child).then((result) => {
            settled = true;
            return result;
        });

        fake.emit('exit', 0, null);
        await Promise.resolve();
        assert.equal(settled, false);

        fake.emit('close', 0, null);
        const result = await observed;
        assert.equal(settled, true);
        assert.deepEqual(result, { ok: true, exitCode: 0, signal: null, error: null });
    });

    it('does not reintroduce parent credentials when a managed child has no explicit environment', async () => {
        vi.stubEnv('AURELIN_TEST_AMBIENT_SECRET', 'must-not-cross-managed-process-boundary');
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-managed-env-'));
        const config = processConfig(dir);
        const controller = createCloudflareManagedProcessController(config);
        try {
            await controller.mcpHttp.ensure({
                name: 'managed-env-test',
                command: process.execPath,
                args: [
                    '-e',
                    'process.stdout.write(JSON.stringify({secret:process.env.AURELIN_TEST_AMBIENT_SECRET??null,path:Boolean(process.env.PATH)}));setInterval(()=>{},1000)',
                ],
            });
            const deadline = Date.now() + 2_000;
            let output = '';
            while (Date.now() < deadline && !output.includes('"path":true')) {
                output = await controller.mcpHttp.readLogTail(4096);
                if (!output.includes('"path":true')) await new Promise((resolve) => setTimeout(resolve, 25));
            }
            assert.deepEqual(JSON.parse(output.trim()), { secret: null, path: true });
        } finally {
            await controller.mcpHttp.stop();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('reads only the requested tail of a managed log', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-log-tail-'));
        const config = processConfig(dir);
        const controller = createCloudflareManagedProcessController(config);
        try {
            await fs.writeFile(config.managedTunnelLogFile, '0123456789', 'utf8');
            assert.equal(await controller.readCloudflaredLogTail(4), '6789');
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
