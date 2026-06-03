// @ts-check

import { describe, expect, it } from 'vitest';

import { __test__ } from '../../../../src/copilot/terminal/commands/gh.js';

describe('terminal/commands/gh', () => {
    it('normaliza ANSI legado e rótulo draft antes de renderizar no terminal', () => {
        const output = __test__.normalizeGhTerminalOutput(
            '\x1b[36m#42\x1b[0m \x1b[33m[DRAFT]\x1b[0m \x1b[1mAjustar UX\x1b[0m  \x1b[90m[open]\x1b[0m',
        );

        expect(output).toBe('#42 Rascunho Ajustar UX  [open]');
        expect(output).not.toContain('\x1b[');
        expect(output).not.toContain('[DRAFT]');
    });
});
