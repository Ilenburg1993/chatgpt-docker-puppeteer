// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_sse.spec.js
 *
 * Contrato: terminal/dialog/sse.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/dialog/sse.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/sse.js');
        expect(mod).toBeTruthy();
    });

    it('exporta broadcastSse', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/sse.js');
        expect(typeof mod.broadcastSse).toBe('function');
    });

    it('normaliza payloads não serializáveis antes do transporte público', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/sse.js');
        /** @type {Record<string, unknown>} */
        const payload = {
            bigint: 10n,
            chunk: 'x'.repeat(250_000),
        };
        payload['self'] = payload;

        const normalized = mod.normalizeSsePayloadForTransport(payload);

        expect(normalized['bigint']).toBe('10');
        expect(normalized['self']).toBe('[Circular]');
        expect(String(normalized['chunk'])).toContain('[…truncado]');
        expect(() => JSON.stringify(normalized)).not.toThrow();
    });

    it('exporta CRITICAL_EVENTS', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/sse.js');
        expect(mod.CRITICAL_EVENTS).toBeDefined();
    });
});
