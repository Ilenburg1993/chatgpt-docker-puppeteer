// @ts-check

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { createCloudflareManagedProcessController } from '../../../../src/copilot/mcp/cloudflare/cli-process.js';

/** @param {string} dir */
function processConfig(dir) {
    return /** @type {import('../../../../src/copilot/mcp/cloudflare/config.js').CloudflareTunnelConfig} */ (
        /** @type {unknown} */ ({
            mcpHttpPidFile: path.join(dir, 'mcp-http.pid'),
            mcpHttpLogFile: path.join(dir, 'mcp-http.log'),
            managedTunnelPidFile: path.join(dir, 'cloudflared.pid'),
            managedTunnelLogFile: path.join(dir, 'cloudflared.log'),
        })
    );
}

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
