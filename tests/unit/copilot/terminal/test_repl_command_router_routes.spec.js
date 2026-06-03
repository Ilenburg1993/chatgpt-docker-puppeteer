// @ts-check

import { describe, expect, it } from 'vitest';

import { CMD_ROUTES } from '../../../../src/copilot/terminal/repl/repl-command-router.js';

function commandNames() {
    return new Set(CMD_ROUTES.flatMap(([names]) => names));
}

describe('terminal/repl-command-router routes', () => {
    it('mantém o cluster de memória anunciado pelo terminal roteado', () => {
        const names = commandNames();

        expect(names.has('remember')).toBe(true);
        expect(names.has('recall')).toBe(true);
        expect(names.has('forget')).toBe(true);
    });
});
