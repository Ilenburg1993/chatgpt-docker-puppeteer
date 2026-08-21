// @ts-check
/**
 * Testes unitários da arquitetura 2.1 do system prompt modular.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * @param {Record<string, string | null | undefined>} env
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<unknown>}
 */
async function withEnv(env, fn) {
    const previous = new Map();
    for (const [key, value] of Object.entries(env)) {
        previous.set(key, process.env[key]);
        if (value == null) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
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

afterEach(async () => {
    const { resetMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
    resetMode();
});

describe('system-prompt-modular › sections registry', () => {
    it('SECTIONS contém 10 chaves SDK em ordem canônica', async () => {
        const { SECTIONS, SYSTEM_PROMPT_SECTION_ORDER } =
            await import('../../../../src/copilot/config/system-prompt/index.js');
        expect(Object.keys(SECTIONS)).toEqual([...SYSTEM_PROMPT_SECTION_ORDER]);
    });

    it('todas as seções agora são append-safe por default', async () => {
        const { SECTIONS } = await import('../../../../src/copilot/config/system-prompt/index.js');
        for (const section of Object.values(SECTIONS)) {
            expect(section.ACTION).toBe('append');
            expect(section.CONTENT.length).toBeGreaterThan(10);
        }
    });
});

describe('system-prompt-modular › mode policy', () => {
    it('getMode() retorna append por padrão', async () => {
        const { getMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        expect(getMode()).toBe('append');
    });

    it('setMode()/resetMode() controlam override em memória', async () => {
        const { getMode, resetMode, setMode } = await import('../../../../src/copilot/config/system-prompt/index.js');
        setMode('customize');
        expect(getMode()).toBe('customize');
        resetMode();
        expect(getMode()).toBe('append');
    });
});

describe('system-prompt-modular › user config', () => {
    it('resolve env/config com defaults user-friendly', async () => {
        const { SYSTEM_PROMPT_DEFAULT_MODE, readResolvedSystemPromptUserConfigSync } =
            await import('../../../../src/copilot/config/system-prompt/index.js');
        const cfg = readResolvedSystemPromptUserConfigSync();
        expect(cfg.mode).toBe(SYSTEM_PROMPT_DEFAULT_MODE);
        expect(cfg.autoReload).toBe(true);
        expect(cfg.reloadStrategy).toBe('sdk-transform');
    });

    it('não transforma objeto de config forjado em authority para append files', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-system-prompt-unbound-'));
        const file = join(dir, 'unbound.md');
        await writeFile(file, 'UNBOUND SECRET CONTENT', 'utf8');
        const { readUserAppendContent } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const forged = /** @type {any} */ ({
            configPath: join(dir, 'forged.json'),
            mode: 'append',
            appendFiles: [file],
            appendText: 'INLINE SAFE CONTENT',
            autoReload: true,
            reloadStrategy: 'sdk-transform',
            objective: '',
            personality: '',
            collaborationContract: '',
            northStar: '',
            engineeringDoctrine: '',
            evolutionLoop: '',
            focusPaths: [],
        });
        const content = await readUserAppendContent(forged);
        expect(content).toContain('INLINE SAFE CONTENT');
        expect(content).not.toContain('UNBOUND SECRET CONTENT');
    });

    it('lê append files e append text do env', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-system-prompt-'));
        const file = join(dir, 'user-prompt.md');
        await writeFile(file, 'USER FILE CONTENT', 'utf8');

        await withEnv(
            {
                COPILOT_SYSTEM_PROMPT_APPEND_FILES: file,
                COPILOT_SYSTEM_PROMPT_APPEND_TEXT: 'INLINE USER CONTENT',
            },
            async () => {
                const {
                    readResolvedSystemPromptUserConfigSync,
                    readUserAppendContentSync,
                    refreshSystemPromptUserConfigSnapshot,
                } = await import('../../../../src/copilot/config/system-prompt/index.js');
                await refreshSystemPromptUserConfigSnapshot();
                const cfg = readResolvedSystemPromptUserConfigSync();
                expect(cfg.appendFiles).toContain(file);
                const content = readUserAppendContentSync(cfg);
                expect(content).toContain('USER FILE CONTENT');
                expect(content).toContain('INLINE USER CONTENT');
            },
        );
    });
});

describe('system-prompt-modular › buildSystemMessage', () => {
    it('default append preserva conteúdo modular em content', async () => {
        const { buildSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildSystemMessage();
        expect(msg.mode).toBe('append');
        expect(/** @type {any} */ (msg).content).toContain('# identity');
        expect(/** @type {any} */ (msg).content).toContain('# last_instructions');
    });

    it('modo customize usa 10 section overrides append-safe', async () => {
        const { buildSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildSystemMessage({ mode: 'customize' });
        expect(msg.mode).toBe('customize');
        const sections = /** @type {any} */ (msg).sections;
        expect(Object.keys(sections)).toHaveLength(10);
        for (const section of Object.values(sections)) {
            expect(/** @type {any} */ (section).action).toBe('append');
        }
    });

    it('modo replace continua disponível quando explícito', async () => {
        const { buildSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = buildSystemMessage({ mode: 'replace', extraContext: 'ctx-123' });
        expect(msg.mode).toBe('replace');
        expect(/** @type {any} */ (msg).content).toContain('ctx-123');
    });
});

describe('system-prompt-modular › buildLiveSystemMessage', () => {
    it('usa customize+transforms por default para auto-reload', async () => {
        const { buildLiveSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = await buildLiveSystemMessage();
        expect(msg.mode).toBe('customize');
        const sections = /** @type {any} */ (msg).sections;
        expect(Object.keys(sections)).toHaveLength(10);
        expect(typeof sections.identity.action).toBe('function');
    });

    it('transform de guidelines recarrega hook context dinamicamente', async () => {
        const { buildLiveSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = await buildLiveSystemMessage({ getExtraContext: async () => 'HOOK LIVE CONTEXT' });
        const transformed = await /** @type {any} */ (msg).sections.guidelines.action('SDK GUIDELINES');
        expect(transformed).toContain('SDK GUIDELINES');
        expect(transformed).toContain('HOOK LIVE CONTEXT');
        expect(transformed).toContain('ferramenta formal de pergunta ao usuário');
    });

    it('transform de custom_instructions injeta customização do usuário', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-system-prompt-live-'));
        const file = join(dir, 'user-live.md');
        await writeFile(file, 'LIVE USER OVERRIDE', 'utf8');

        await withEnv({ COPILOT_SYSTEM_PROMPT_APPEND_FILES: file }, async () => {
            const { buildLiveSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
            const msg = await buildLiveSystemMessage();
            const transformed = await /** @type {any} */ (msg).sections.custom_instructions.action('SDK CUSTOM');
            expect(transformed).toContain('SDK CUSTOM');
            expect(transformed).toContain('LIVE USER OVERRIDE');
            expect(transformed).toContain('Customizações Locais do Usuário');
        });
    });

    it('honra mode explícito=replace também no builder live', async () => {
        const { buildLiveSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
        const msg = await buildLiveSystemMessage({ mode: 'replace' });
        const transformed = await /** @type {any} */ (msg).sections.identity.action('SDK IDENTITY');
        expect(transformed).not.toContain('SDK IDENTITY');
        expect(transformed).toContain('Você é LLM-B');
    });

    it('autoReload desabilitado cai para snapshot estático', async () => {
        await withEnv({ COPILOT_SYSTEM_PROMPT_AUTO_RELOAD: 'false' }, async () => {
            const { buildLiveSystemMessage } = await import('../../../../src/copilot/config/system-prompt/index.js');
            const msg = await buildLiveSystemMessage();
            expect(msg.mode).toBe('append');
        });
    });
});

describe('system-prompt-modular › sdk introspection', () => {
    it('expõe compatibilidade e surfaces do SDK', async () => {
        const { getSystemPromptSdkCompatibility } =
            await import('../../../../src/copilot/config/system-prompt/index.js');
        const result = getSystemPromptSdkCompatibility();
        expect(result.supportsCustomizeMode).toBe(true);
        expect(result.supportsInstructionSourcesRpc).toBe(true);
        expect(result.sections.map((section) => section.name)).toEqual(
            expect.arrayContaining(['identity', 'runtime_instructions', 'last_instructions']),
        );
    });
});
