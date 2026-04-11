// @ts-check
/**
 * tests/unit/copilot/test_services_l4_facades.spec.js
 *
 * Verifica que services/ re-exporta corretamente os símbolos de L4 (agent, channel, conversation-hub) para que api/ e
 * terminal/ não precisem importar diretamente de L4 (requisito C10).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('services/ re-exports de L4 (C10 facades)', () => {
    it('re-exporta alwaysAliveAgent de #copilot/agent', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.alwaysAliveAgent !== undefined, 'alwaysAliveAgent deve estar disponível via services');
    });

    it('re-exporta conversationHub de #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.conversationHub !== undefined, 'conversationHub deve estar disponível via services');
    });

    it('re-exporta conversationStore de #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.conversationStore !== undefined, 'conversationStore deve estar disponível via services');
    });

    it('re-exporta broadcastGlobal e broadcastToSession de #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/services');
        assert.equal(typeof mod.broadcastGlobal, 'function', 'broadcastGlobal deve ser função');
        assert.equal(typeof mod.broadcastToSession, 'function', 'broadcastToSession deve ser função');
    });

    it('re-exporta llmBridgeClient de #copilot/channel', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.llmBridgeClient !== undefined, 'llmBridgeClient deve estar disponível via services');
    });

    it('re-exporta CHANNEL_VERSION de #copilot/channel', async () => {
        const mod = await import('#copilot/services');
        assert.equal(typeof mod.CHANNEL_VERSION, 'string', 'CHANNEL_VERSION deve ser string');
        assert.ok(mod.CHANNEL_VERSION.length > 0, 'CHANNEL_VERSION não deve ser vazio');
    });

    it('re-exporta funções de snapshot de #copilot/agent', async () => {
        const mod = await import('#copilot/services');
        assert.equal(typeof mod.createSnapshot, 'function', 'createSnapshot deve ser função');
        assert.equal(typeof mod.listSnapshotsAsync, 'function', 'listSnapshotsAsync deve ser função');
        assert.equal(typeof mod.loadSnapshotAsync, 'function', 'loadSnapshotAsync deve ser função');
        assert.equal(typeof mod.saveSnapshotAsync, 'function', 'saveSnapshotAsync deve ser função');
    });

    it('re-exporta setBackgroundCompactionThreshold de #copilot/agent', async () => {
        const mod = await import('#copilot/services');
        assert.equal(
            typeof mod.setBackgroundCompactionThreshold,
            'function',
            'setBackgroundCompactionThreshold deve ser função',
        );
    });
});
