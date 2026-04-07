// @ts-check
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bootstrapRagEnv } from '../../../tools/rag/lib/env-bootstrap.mjs';

async function mkTempEnvDir(prefix = 'rag-env-') {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('RAG env bootstrap', () => {
    it('does not fail when .env.local is absent', async () => {
        const tmpDir = await mkTempEnvDir();
        const varName = 'RAG_TEST_ENV_LOCAL_ABSENT';
        try {
            await fs.writeFile(path.join(tmpDir, '.env'), `${varName}=ok\n`, 'utf8');
            delete process.env[varName];

            const result = bootstrapRagEnv({ rootDir: tmpDir, useGlobalFlag: false });
            assert.ok(Array.isArray(result.loaded));
            assert.ok(result.loaded.some((p) => p.endsWith('/.env')));
            assert.strictEqual(process.env[varName], 'ok');
        } finally {
            delete process.env[varName];
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('loads .env.local before .env (local has priority)', async () => {
        const tmpDir = await mkTempEnvDir();
        const varName = 'RAG_TEST_ENV_PRIORITY';
        try {
            await fs.writeFile(path.join(tmpDir, '.env.local'), `${varName}=from_local\n`, 'utf8');
            await fs.writeFile(path.join(tmpDir, '.env'), `${varName}=from_env\n`, 'utf8');
            delete process.env[varName];

            bootstrapRagEnv({ rootDir: tmpDir, useGlobalFlag: false });
            assert.strictEqual(process.env[varName], 'from_local');
        } finally {
            delete process.env[varName];
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('is idempotent with global flag enabled', () => {
        const first = bootstrapRagEnv();
        const second = bootstrapRagEnv();
        assert.ok(first);
        assert.ok(second);
        assert.ok(Array.isArray(second.loaded));
        assert.strictEqual(second.loaded.length, 0);
    });
});
