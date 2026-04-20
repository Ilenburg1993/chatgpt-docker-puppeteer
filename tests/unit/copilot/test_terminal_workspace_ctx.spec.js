// @ts-check
/**
 * tests/unit/copilot/test_terminal_workspace_ctx.spec.js
 *
 * Contrato: terminal/workspace-context.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/workspace-context.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/workspace-context.js');
        expect(mod).toBeTruthy();
    });

    it('exporta getWorkspaceContext', async () => {
        const mod = await import('../../../src/copilot/terminal/workspace-context.js');
        expect(typeof mod.getWorkspaceContext).toBe('function');
    });

    it('exporta getWorkspaceContextAsync', async () => {
        const mod = await import('../../../src/copilot/terminal/workspace-context.js');
        expect(typeof mod.getWorkspaceContextAsync).toBe('function');
    });
});
