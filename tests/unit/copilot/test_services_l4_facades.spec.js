// @ts-check
/**
 * tests/unit/copilot/test_services_l4_facades.spec.js
 *
 * Regressão da Fase 1 (M-02): verifica que os consumers usam os módulos de origem reais após a remoção de `services/`.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const SERVICES_DIR = resolve(import.meta.dirname, '../../../src/copilot/services');

describe('M-02 — remoção de services/ e uso de módulos de origem', () => {
    it('services/ não existe mais no runtime', () => {
        assert.equal(existsSync(SERVICES_DIR), false, 'src/copilot/services não deve existir');
    });

    it('expõe AlwaysAliveAgent diretamente via #copilot/agent', async () => {
        const mod = await import('#copilot/agent');
        assert.ok(mod.alwaysAliveAgent !== undefined, 'alwaysAliveAgent deve estar disponível via #copilot/agent');
        assert.equal(typeof mod.getAgent, 'function', 'getAgent deve estar disponível via #copilot/agent');
    });

    it('expõe conversationHub e conversationStore diretamente via #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/conversation-hub');
        assert.ok(mod.conversationHub !== undefined, 'conversationHub deve estar disponível');
        assert.ok(mod.conversationStore !== undefined, 'conversationStore deve estar disponível');
    });

    it('expõe broadcastGlobal e broadcastToSession via #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/conversation-hub');
        assert.equal(typeof mod.broadcastGlobal, 'function', 'broadcastGlobal deve ser função');
        assert.equal(typeof mod.broadcastToSession, 'function', 'broadcastToSession deve ser função');
    });

    it('expõe llmBridgeClient e CHANNEL_VERSION via #copilot/channel', async () => {
        const mod = await import('#copilot/channel');
        assert.ok(mod.llmBridgeClient !== undefined, 'llmBridgeClient deve estar disponível');
        assert.equal(typeof mod.CHANNEL_VERSION, 'string', 'CHANNEL_VERSION deve ser string');
        assert.ok(mod.CHANNEL_VERSION.length > 0, 'CHANNEL_VERSION não deve ser vazio');
    });

    it('expõe snapshots e config helpers diretamente via #copilot/agent', async () => {
        const mod = await import('#copilot/agent');
        assert.equal(typeof mod.createSnapshot, 'function', 'createSnapshot deve ser função');
        assert.equal(typeof mod.listSnapshotsAsync, 'function', 'listSnapshotsAsync deve ser função');
        assert.equal(typeof mod.loadSnapshotAsync, 'function', 'loadSnapshotAsync deve ser função');
        assert.equal(typeof mod.saveSnapshotAsync, 'function', 'saveSnapshotAsync deve ser função');
        assert.equal(
            typeof mod.setBackgroundCompactionThreshold,
            'function',
            'setBackgroundCompactionThreshold deve ser exposto por #copilot/agent',
        );
    });
});
