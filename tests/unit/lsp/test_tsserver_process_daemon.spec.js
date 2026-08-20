// @ts-check
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
    TsserverProcessDaemon,
    startTsserverDaemon,
    stopTsserverDaemon,
} from '../../../src/integration/lsp/tsserver-process-daemon.mjs';

/** @param {() => boolean} predicate @param {number} [timeoutMs] */
async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe('TsserverProcessDaemon', () => {
    it('mantém o singleton de produção desligado sem opt-in explícito', async () => {
        const previous = process.env['LSP_ENABLED'];
        delete process.env['LSP_ENABLED'];
        try {
            await assert.rejects(() => startTsserverDaemon(), /LSP_DISABLED_BY_POLICY/u);
        } finally {
            await stopTsserverDaemon();
            if (previous === undefined) delete process.env['LSP_ENABLED'];
            else process.env['LSP_ENABLED'] = previous;
        }
    });

    it('isolates semantic work in a child process and recycles it after idle', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-process-daemon-'));
        const daemon = new TsserverProcessDaemon({ rootDir, timeoutMs: 10_000, idleTtlMs: 50 });
        try {
            await fs.writeFile(
                path.join(rootDir, 'jsconfig.json'),
                JSON.stringify({
                    compilerOptions: { checkJs: true, allowJs: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
                    include: ['**/*.js'],
                }),
                'utf8',
            );
            const filePath = path.join(rootDir, 'sample.js');
            await fs.writeFile(filePath, 'const value = 42;\nvalue;\n', 'utf8');

            const hover = await daemon.execute('hover', { filePath, line: 2, character: 2 });
            assert.ok(isRecord(hover));
            assert.match(String(hover['display']), /value|number/u);
            assert.ok(Number.isInteger(daemon.workerPid));

            const firstPid = daemon.workerPid;
            assert.equal(await waitFor(() => daemon.workerPid === null), true, 'idle worker should exit');

            const secondHover = await daemon.execute('hover', { filePath, line: 2, character: 2 });
            assert.ok(isRecord(secondHover));
            assert.ok(Number.isInteger(daemon.workerPid));
            assert.notEqual(daemon.workerPid, firstPid);
        } finally {
            await daemon.stop();
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('returns remote engine errors without crashing the parent façade', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-process-daemon-'));
        const daemon = new TsserverProcessDaemon({ rootDir, timeoutMs: 10_000, idleTtlMs: 100 });
        try {
            await assert.rejects(
                () => daemon.execute('unknown-operation', {}),
                (error) =>
                    error instanceof Error &&
                    error.code === 'LSP_WORKER_REMOTE_ERROR' &&
                    /UNKNOWN_OPERATION/u.test(error.message),
            );
        } finally {
            await daemon.stop();
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });
});
