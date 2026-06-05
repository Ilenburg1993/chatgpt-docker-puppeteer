// @ts-check

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CMD_ROUTES } from '../../../../src/copilot/terminal/repl/repl-command-router.js';

const ROUTER_PATH = fileURLToPath(
    new URL('../../../../src/copilot/terminal/repl/repl-command-router.js', import.meta.url),
);

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

    it('não reintroduz ANSI manual nas mensagens públicas do router', async () => {
        const src = await readFile(ROUTER_PATH, 'utf8');

        expect(src).not.toContain('\\x1b[');
        expect(src).not.toContain('[abort]');
        expect(src).not.toContain('[emergency-reset]');
    });
});
