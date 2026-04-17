// @ts-check
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

const SERVICES_DIR = resolve(import.meta.dirname, '../../../../src/copilot/services');

describe('M-02 — contratos após remoção de services/', () => {
    it('não expõe mais #copilot/services', async () => {
        await assert.rejects(
            () => import('#copilot/services'),
            /Cannot find module|Package import specifier|ERR_PACKAGE_IMPORT_NOT_DEFINED|ERR_MODULE_NOT_FOUND/,
        );
    });

    it('removeu o diretório src/copilot/services', () => {
        assert.equal(existsSync(SERVICES_DIR), false, 'src/copilot/services não deve existir');
    });

    it('expõe operações de sessão diretamente via #copilot/sdk', async () => {
        const mod = await import('#copilot/sdk');
        assert.ok(typeof mod.getClient === 'function', 'getClient deve existir');
        assert.ok(typeof mod.getClientState === 'function', 'getClientState deve existir');
        assert.ok(typeof mod.stopClient === 'function', 'stopClient deve existir');
        assert.ok(typeof mod.createClientSession === 'function', 'createClientSession deve existir');
        assert.ok(typeof mod.resumeClientSession === 'function', 'resumeClientSession deve existir');
        assert.ok(typeof mod.getClientSession === 'function', 'getClientSession deve existir');
        assert.ok(typeof mod.listActiveClientSessions === 'function', 'listActiveClientSessions deve existir');
        assert.ok(typeof mod.incrementSessionMessageCount === 'function', 'incrementSessionMessageCount deve existir');
        assert.ok(typeof mod.approveAll === 'function', 'approveAll deve existir');
        assert.ok(typeof mod.pickDefined === 'function', 'pickDefined deve existir');
    });

    it('expõe ferramentas diretamente via #copilot/tools', async () => {
        const mod = await import('#copilot/tools');
        assert.ok(typeof mod.getAllTools === 'function', 'getAllTools deve existir');
        assert.ok(Array.isArray(mod.getAllTools()), 'getAllTools deve retornar array');
    });

    it('expõe auditoria diretamente via #copilot/audit', async () => {
        const mod = await import('#copilot/audit');
        assert.ok(mod.defaultAuditLog, 'defaultAuditLog deve existir');
        assert.ok(typeof mod.getAuditTail === 'function', 'getAuditTail deve existir');
    });

    it('expõe conversation store diretamente via #copilot/conversation-hub', async () => {
        const mod = await import('#copilot/conversation-hub');
        assert.ok(mod.CONVERSATION_STORE, 'CONVERSATION_STORE deve existir');
        assert.ok(mod.conversationStore, 'conversationStore deve existir');
    });
});
