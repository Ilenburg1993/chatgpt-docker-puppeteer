// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('copilot/services barrel', () => {
    it('exporta SessionService e factory', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.SessionService, 'SessionService deve existir');
        assert.ok(typeof mod.createSessionService === 'function', 'createSessionService deve ser function');
    });

    it('exporta ToolService e factory', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.ToolService, 'ToolService deve existir');
        assert.ok(typeof mod.createToolService === 'function', 'createToolService deve ser function');
    });

    it('exporta AuditService e factory', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.AuditService, 'AuditService deve existir');
        assert.ok(typeof mod.createAuditService === 'function', 'createAuditService deve ser function');
    });

    it('exporta ConversationService e factory', async () => {
        const mod = await import('#copilot/services');
        assert.ok(mod.ConversationService, 'ConversationService deve existir');
        assert.ok(typeof mod.createConversationService === 'function', 'createConversationService deve ser function');
    });

    it('createSessionService cria instância', async () => {
        const { createSessionService } = await import('#copilot/services');
        const svc = createSessionService();
        assert.ok(svc instanceof (await import('#copilot/services')).SessionService);
    });

    it('createToolService cria instância', async () => {
        const { createToolService } = await import('#copilot/services');
        const svc = createToolService();
        assert.ok(svc instanceof (await import('#copilot/services')).ToolService);
    });

    it('createAuditService cria instância', async () => {
        const { createAuditService } = await import('#copilot/services');
        const svc = createAuditService();
        assert.ok(svc instanceof (await import('#copilot/services')).AuditService);
    });

    it('createConversationService cria instância', async () => {
        const { createConversationService } = await import('#copilot/services');
        const svc = createConversationService();
        assert.ok(svc instanceof (await import('#copilot/services')).ConversationService);
    });
});
