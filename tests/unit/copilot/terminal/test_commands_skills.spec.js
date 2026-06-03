// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleGetSkills = vi.fn(async () => ({
    body: {
        skills: {
            paths: ['/repo/.github/skills/security/SKILL.md'],
        },
    },
}));
const handleSetSkills = vi.fn(async () => ({ ok: true }));

vi.mock('../../../../src/copilot/terminal/handlers/index.js', () => ({
    handleGetSkills,
    handleSetSkills,
}));

const { cmdSkills } = await import('../../../../src/copilot/terminal/commands/skills.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: vi.fn((/** @type {string} */ line) => lines.push(line)),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/skills', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('lista skills com tema central', async () => {
        const ctx = mockCtx();

        await cmdSkills({ println: ctx.println }, 'list');

        expect(ctx.output()).toContain('Skills');
        expect(ctx.output()).toContain('/repo/.github/skills/security/SKILL.md');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('mostra uso temático para add/remove sem caminho', async () => {
        const add = mockCtx();
        const remove = mockCtx();

        await cmdSkills({ println: add.println }, 'add');
        await cmdSkills({ println: remove.println }, 'remove');

        expect(add.output()).toContain('/skills add <caminho>');
        expect(remove.output()).toContain('/skills remove <caminho>');
        expect(`${add.output()}\n${remove.output()}`).not.toContain('  Uso:');
        expect(`${add.output()}\n${remove.output()}`).not.toContain('\x1b[');
    });

    it('mostra subcomando desconhecido sem linhas soltas', async () => {
        const ctx = mockCtx();

        await cmdSkills({ println: ctx.println }, 'wat');

        expect(ctx.output()).toContain('Subcomando');
        expect(ctx.output()).toContain('/skills [list | add <path> | remove <path> | reload]');
        expect(ctx.output()).not.toContain('  Subcomando desconhecido');
        expect(ctx.output()).not.toContain('\x1b[');
    });
});
