// @ts-check
/**
 * tests/unit/copilot/test_bridges_barrel.spec.js
 *
 * Testa as exportações do barrel de bridges (contrato de API pública).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('bridges/ barrel — exportações', () => {
    it('exporta funções de git bridge', async () => {
        const mod = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof mod.gitStatus, 'function', 'gitStatus deve ser função');
        assert.equal(typeof mod.gitAdd, 'function', 'gitAdd deve ser função');
        assert.equal(typeof mod.gitCommit, 'function', 'gitCommit deve ser função');
        assert.equal(typeof mod.gitLog, 'function', 'gitLog deve ser função');
        assert.equal(typeof mod.gitDiff, 'function', 'gitDiff deve ser função');
        assert.equal(typeof mod.gitPush, 'function', 'gitPush deve ser função');
        assert.equal(typeof mod.gitPull, 'function', 'gitPull deve ser função');
    });

    it('exporta funções de MCP bridge', async () => {
        const mod = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof mod.getMcpStatus, 'function', 'getMcpStatus deve ser função');
        assert.equal(typeof mod.listMcpTools, 'function', 'listMcpTools deve ser função');
        assert.equal(typeof mod.buildMcpTools, 'function', 'buildMcpTools deve ser função');
    });

    it('exporta funções de Nerv bridge', async () => {
        const mod = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof mod.emitNerv, 'function', 'emitNerv deve ser função');
        assert.equal(typeof mod.isMounted, 'function', 'isMounted deve ser função');
        assert.equal(typeof mod.mount, 'function', 'mount deve ser função');
        assert.equal(typeof mod.unmount, 'function', 'unmount deve ser função');
    });

    it('exporta copilotNervBridge objeto', async () => {
        const mod = await import('../../../src/copilot/bridges/index.js');
        assert.ok(mod.copilotNervBridge !== undefined, 'copilotNervBridge deve existir no barrel');
    });
});
