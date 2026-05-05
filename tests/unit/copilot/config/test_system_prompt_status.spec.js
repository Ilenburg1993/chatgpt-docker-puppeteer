// @ts-check

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * @param {Record<string, string | null | undefined>} env
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<unknown>}
 */
async function withEnv(env, fn) {
    const previous = new Map();
    for (const [key, value] of Object.entries(env)) {
        previous.set(key, process.env[key]);
        if (value == null) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value == null) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

describe('config/system-prompt/status', () => {
    it('expõe status append-first com reload live via sdk-transform por padrão', async () => {
        const { readSystemPromptStatus } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const status = await readSystemPromptStatus();

        expect(status.configuredMode).toBe('append');
        expect(status.effectiveLiveMode).toBe('customize');
        expect(status.liveReloadEnabled).toBe(true);
        expect(status.liveReloadMechanism).toBe('sdk-transform');
        expect(status.reloadBehavior.create).toBe('always');
        expect(status.reloadBehavior.resume).toBe('always');
        expect(status.sectionCount).toBe(10);
        expect(status.sdkCompatibility.supportsCustomizeMode).toBe(true);
        expect(status.revision.digest).toHaveLength(16);
    });

    it('expõe append files do usuário e registra digest/reload limitations', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-system-prompt-status-'));
        const file = join(dir, 'append.md');
        await writeFile(file, 'APPEND STATUS CONTENT', 'utf8');

        await withEnv(
            {
                COPILOT_SYSTEM_PROMPT_APPEND_FILES: file,
                COPILOT_SYSTEM_PROMPT_APPEND_TEXT: 'INLINE STATUS CONTENT',
                COPILOT_SYSTEM_PROMPT_AUTO_RELOAD: 'false',
            },
            async () => {
                const { readSystemPromptStatus } =
                    await import('../../../../src/copilot/config/system-prompt/index.js');
                const status = await readSystemPromptStatus();

                expect(status.appendFiles).toHaveLength(1);
                expect(status.appendFiles[0]?.path).toBe(file);
                expect(status.appendFiles[0]?.exists).toBe(true);
                expect(status.appendTextConfigured).toBe(true);
                expect(status.liveReloadEnabled).toBe(false);
                expect(status.liveReloadMechanism).toBe('static-snapshot');
                expect(status.limitations.join(' ')).toContain('autoReload=false');
                expect(status.userAppendContentBytes).toBeGreaterThan(10);
            },
        );
    });
});
