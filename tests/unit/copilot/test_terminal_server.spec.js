// @ts-check
/**
 * tests/unit/copilot/test_terminal_server.spec.js
 *
 * Contrato: terminal/index.js
 */

import { beforeAll, describe, expect, it } from 'vitest';

/** @type {typeof import('../../../src/copilot/terminal/index.js')} */
let mod;

beforeAll(async () => {
    mod = await import('../../../src/copilot/terminal/index.js');
});

describe('terminal/index.js — contrato', () => {
    it('importa sem erros', { timeout: 60_000 }, () => {
        expect(mod).toBeTruthy();
    });

    it('exporta startTerminalServer', () => {
        expect(typeof mod.startTerminalServer).toBe('function');
    });
});
