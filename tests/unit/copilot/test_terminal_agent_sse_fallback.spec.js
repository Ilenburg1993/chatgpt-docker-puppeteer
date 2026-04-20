// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_sse_fallback.spec.js
 *
 * Contrato: terminal/agent-sse-fallback.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/agent-sse-fallback.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-sse-fallback.js');
        expect(mod).toBeTruthy();
    });

    it('exporta registerUnhandledAgentSseFallback', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-sse-fallback.js');
        expect(typeof mod.registerUnhandledAgentSseFallback).toBe('function');
    });
});
