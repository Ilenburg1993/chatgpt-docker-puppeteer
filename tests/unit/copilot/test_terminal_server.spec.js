// @ts-check
/**
 * tests/unit/copilot/test_terminal_server.spec.js
 *
 * Contrato: terminal/index.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
describe('terminal/index.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/index.js');
        assert.ok(mod, 'módulo deve carregar');
    });

    it('exporta startTerminalServer', async () => {
        const mod = await import('../../../src/copilot/terminal/index.js');
        assert.equal(typeof mod.startTerminalServer !== 'undefined', true, 'startTerminalServer deve estar exportado');
    });
});
