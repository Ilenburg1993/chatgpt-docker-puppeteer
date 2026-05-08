// @ts-check
/**
 * tests/unit/copilot/test_terminal_rate_limiter.spec.js
 *
 * Contrato: terminal/rate-limiter-state.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/rate-limiter-state.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/state/rate-limiter-state.js');
        expect(mod).toBeTruthy();
    });

    it('exporta clearRateLimiters', async () => {
        const mod = await import('../../../src/copilot/terminal/state/rate-limiter-state.js');
        expect(typeof mod.clearRateLimiters).toBe('function');
    });

    it('exporta registerClearRateLimiters', async () => {
        const mod = await import('../../../src/copilot/terminal/state/rate-limiter-state.js');
        expect(typeof mod.registerClearRateLimiters).toBe('function');
    });
});
