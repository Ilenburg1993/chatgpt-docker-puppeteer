// @ts-check

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Model Gateway readiness module import boundary', () => {
    it('does not load cwd dotenv files merely by being imported as a module', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'mcp-readiness-import-'));
        const sentinelKey = 'MCP_READINESS_IMPORT_DOTENV_SENTINEL';
        const readinessUrl = `${
            pathToFileURL(resolve(process.cwd(), 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs'))
                .href
        }?unit=${Date.now()}`;
        await writeFile(join(directory, '.env'), `${sentinelKey}=must-not-load-on-import\n`, 'utf8');
        try {
            const script = `await import(${JSON.stringify(readinessUrl)}); process.stdout.write(process.env[${JSON.stringify(
                sentinelKey,
            )}] ?? 'absent');`;
            const env = { ...process.env };
            delete env[sentinelKey];
            const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
                cwd: directory,
                env,
                encoding: 'utf8',
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            });
            assert.equal(stdout, 'absent');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
