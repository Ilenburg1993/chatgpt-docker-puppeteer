// @ts-check
/**
 * Tests for canonical MCP stateful env/secret management.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

import { buildStatefulProcessEnv, ensureStatefulEnvFile } from '../../../../src/copilot/mcp/scripts/stateful-env.js';

const testEnvPath = 'src/copilot/.ai/mcp/unit-stateful-session.env';
const absoluteTestEnvPath = resolve(process.cwd(), testEnvPath);

describe('MCP stateful env manager', () => {
    it('creates a stable git-ignored secret env file without returning the raw secret', async () => {
        rmSync(absoluteTestEnvPath, { force: true });

        const first = await ensureStatefulEnvFile(testEnvPath);
        const second = await ensureStatefulEnvFile(testEnvPath);
        const text = readFileSync(absoluteTestEnvPath, 'utf8');
        const secretLine = text
            .split(/\r?\n/u)
            .find((line) => line.startsWith('COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET='));

        assert.equal(existsSync(absoluteTestEnvPath), true);
        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(statSync(absoluteTestEnvPath).mode & 0o777, 0o600);
        assert.ok(secretLine);
        assert.equal(JSON.stringify(first).includes(String(secretLine).split('=').slice(1).join('=')), false);

        const env = await buildStatefulProcessEnv(testEnvPath);
        assert.equal(env['COPILOT_MCP_HTTP_STATEFUL_SESSIONS'], 'true');
        assert.equal(env['COPILOT_MCP_HTTP_STATELESS_COMPAT'], 'false');
        assert.equal(env['COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT'], 'true');
        assert.equal(env['COPILOT_MCP_HTTP_MAX_SESSIONS'], '256');
        assert.equal(typeof env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'], 'string');
    });

    it('rejects absolute paths and lexical traversal outside the MCP state root', async () => {
        await assert.rejects(() => ensureStatefulEnvFile('/tmp/copilot-stateful-session.env'), /repo-relative/u);
        await assert.rejects(
            () => ensureStatefulEnvFile('src/copilot/.ai/mcp/../escaped-stateful-session.env'),
            /inside src\/copilot\/\.ai\/mcp/u,
        );
    });

    it('rejects symlink env files even when the link itself is inside the MCP state root', async () => {
        const targetPath = resolve(process.cwd(), 'src/copilot/.ai/mcp/unit-stateful-target.env');
        const linkPath = resolve(process.cwd(), 'src/copilot/.ai/mcp/unit-stateful-link.env');
        rmSync(linkPath, { force: true });
        rmSync(targetPath, { force: true });
        writeFileSync(targetPath, `COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET='${`s`.repeat(40)}'\n`, { mode: 0o600 });
        symlinkSync(targetPath, linkPath);
        try {
            await assert.rejects(
                () => ensureStatefulEnvFile('src/copilot/.ai/mcp/unit-stateful-link.env'),
                (error) => /** @type {{ code?: unknown }} */ (error)?.code === 'ERR_CONFIGURED_FS_SYMLINK',
            );
        } finally {
            rmSync(linkPath, { force: true });
            rmSync(targetPath, { force: true });
        }
    });

    it('upgrades an existing low session limit without rotating the secret', async () => {
        rmSync(absoluteTestEnvPath, { force: true });
        const stableSecret = `unit-${'x'.repeat(40)}`;
        writeFileSync(
            absoluteTestEnvPath,
            [
                `COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET='${stableSecret}'`,
                'COPILOT_MCP_HTTP_SESSION_TTL_MS=600000',
                'COPILOT_MCP_HTTP_MAX_SESSIONS=32',
                '',
            ].join('\n'),
            { mode: 0o644 },
        );

        const result = await ensureStatefulEnvFile(testEnvPath);
        const text = readFileSync(absoluteTestEnvPath, 'utf8');
        const env = await buildStatefulProcessEnv(testEnvPath);

        assert.equal(result.warnings.includes('env-file-upgraded'), true);
        assert.equal(text.includes(stableSecret), true);
        assert.equal(text.includes('COPILOT_MCP_HTTP_MAX_SESSIONS=256'), true);
        assert.equal(statSync(absoluteTestEnvPath).mode & 0o777, 0o600);
        assert.equal(env['COPILOT_MCP_HTTP_MAX_SESSIONS'], '256');
    });
});
