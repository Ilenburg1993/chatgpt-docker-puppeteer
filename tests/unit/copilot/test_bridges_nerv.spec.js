// @ts-check
/**
 * tests/unit/copilot/test_bridges_nerv.spec.js
 *
 * Testes unitários para src/copilot/bridges/nerv-bridge.js.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

describe('nerv-bridge — estado sem mount', () => {
    beforeEach(async () => {
        const { _resetNervBridgeState } = await import('../../../src/copilot/bridges/nerv-bridge.js');
        _resetNervBridgeState();
    });

    it('isMounted retorna false antes de qualquer mount()', async () => {
        const { isMounted } = await import('../../../src/copilot/bridges/nerv-bridge.js');
        assert.equal(isMounted(), false, 'Sem mount chamado, isMounted deve ser false');
    });

    it('copilotNervBridge expõe API pública esperada', async () => {
        const { copilotNervBridge } = await import('../../../src/copilot/bridges/nerv-bridge.js');
        assert.equal(typeof copilotNervBridge.mount, 'function', 'mount deve ser função');
        assert.equal(typeof copilotNervBridge.unmount, 'function', 'unmount deve ser função');
        assert.equal(typeof copilotNervBridge.isMounted, 'function', 'isMounted deve ser função');
        assert.equal(typeof copilotNervBridge.emitNerv, 'function', 'emitNerv deve ser função');
    });

    it('_resetNervBridgeState funciona sem erros', async () => {
        const { _resetNervBridgeState: reset } = await import('../../../src/copilot/bridges/nerv-bridge.js');
        assert.doesNotThrow(() => reset(), '_resetNervBridgeState não deve lançar');
    });

    it('emitNerv em estado desmontado retorna sem lançar (no-op)', async () => {
        const { emitNerv, _resetNervBridgeState: reset } = await import('../../../src/copilot/bridges/nerv-bridge.js');
        reset();
        assert.doesNotThrow(() => emitNerv('AGENT_START', {}), 'emitNerv sem Nerv montado deve ser no-op');
    });
});
