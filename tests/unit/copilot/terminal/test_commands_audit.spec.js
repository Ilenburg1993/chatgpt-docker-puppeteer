// @ts-check

import { describe, expect, it, vi } from 'vitest';

const getAuditSummary = vi.fn(async () => [
    {
        type: 'tool.execution',
        ts: '2026-06-05T00:44:45.000Z',
        toolName: 'read_file_content',
        durationMs: 42,
        success: true,
    },
    {
        type: 'hook.fired',
        ts: 1_780_619_485_000,
        data: {
            hookName: 'onPostToolUse',
        },
    },
]);

vi.mock('#copilot/audit', () => ({
    defaultAuditLog: {
        getAuditSummary,
    },
}));

const { cmdAudit } = await import('../../../../src/copilot/terminal/commands/audit.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/audit', () => {
    it('renderiza audit log com tipos humanos e timestamp ISO parseado', async () => {
        const ctx = mockCtx();

        await cmdAudit(ctx, '2');

        expect(getAuditSummary).toHaveBeenCalledWith(null, 2);
        expect(ctx.output()).toContain('Auditoria');
        expect(ctx.output()).toContain('Execução de ferramenta');
        expect(ctx.output()).toContain('Ler arquivo');
        expect(ctx.output()).toContain('concluída');
        expect(ctx.output()).toContain('42ms');
        expect(ctx.output()).toContain('Rotina executada');
        expect(ctx.output()).toContain('onPostToolUse');
        expect(ctx.output()).not.toContain('tool.execution      sem horário · tool.execution');
        expect(ctx.output()).not.toContain('tool.execution');
    });
});
