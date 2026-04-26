// @ts-check
/**
 * tests/unit/copilot/test_terminal_workspace_ctx.spec.js
 *
 * Contrato: boot/workspace.js (fonte canônica de contexto de workspace).
 */

import { describe, expect, it } from 'vitest';

describe('boot/workspace.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/boot/workspace.js');
        expect(mod).toBeTruthy();
    });

    it('exporta getWorkspaceContext', async () => {
        const mod = await import('../../../src/copilot/boot/workspace.js');
        expect(typeof mod.getWorkspaceContext).toBe('function');
    });

    it('exporta getWorkspaceContextAsync', async () => {
        const mod = await import('../../../src/copilot/boot/workspace.js');
        expect(typeof mod.getWorkspaceContextAsync).toBe('function');
    });
});
