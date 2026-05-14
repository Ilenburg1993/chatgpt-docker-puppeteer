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

    it('exporta fases canônicas consumidas pelo boot runner', () => {
        expect(typeof mod.createTerminalBootContext).toBe('function');
        expect(typeof mod.runTerminalInitPhase).toBe('function');
        expect(typeof mod.runTerminalReplPhase).toBe('function');
        expect(mod).not.toHaveProperty('startTerminalServer');
    });
});
