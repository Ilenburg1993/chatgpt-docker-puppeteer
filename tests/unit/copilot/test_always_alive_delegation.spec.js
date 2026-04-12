// @ts-check
/**
 * tests/unit/copilot/test_always_alive_delegation.spec.js
 *
 * F46: Testes de delegação — verificar que always-alive.js delega corretamente para os módulos extraídos (F35-F39).
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, before } from 'node:test';

describe('always-alive.js › delegação para módulos extraídos', () => {
    /** @type {string} */
    let src;

    before(async () => {
        src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    // ─── F35: AgentContext ────────────────────────────────────────────────

    it('importa AgentContext de agent-context.js', () => {
        assert.ok(src.includes("from './agent-context.js'"), 'deve importar de agent-context.js');
    });

    it('instancia ctx = new AgentContext(this) no constructor', () => {
        assert.ok(src.includes('new AgentContext(this'), 'constructor deve criar AgentContext com this como emitter');
    });

    // ─── F36: AgentLifecycle ──────────────────────────────────────────────

    it('importa agentStart, agentStop, agentTryReconnect de agent-lifecycle.js', () => {
        assert.ok(src.includes("from './lifecycle/agent-lifecycle.js'"));
        assert.ok(src.includes('agentStart'));
        assert.ok(src.includes('agentStop'));
        assert.ok(src.includes('agentTryReconnect'));
    });

    it('start() delega para agentStart(ctx, this)', () => {
        assert.ok(src.includes('agentStart(this.ctx, this)'));
    });

    it('stop() delega para agentStop(ctx, this)', () => {
        assert.ok(src.includes('agentStop(this.ctx, this'));
    });

    // ─── F37: AgentDialogController ───────────────────────────────────────

    it('importa dialogStart, dialogStop, dialogResume, ensureDialogLoopAttached', () => {
        assert.ok(src.includes("from './dialog/agent-dialog-controller.js'"));
        assert.ok(src.includes('dialogStart'));
        assert.ok(src.includes('dialogStop'));
        assert.ok(src.includes('dialogResume'));
        assert.ok(src.includes('dialogEnsureAttached') || src.includes('ensureDialogLoopAttached'));
    });

    // ─── F38: AgentMessaging ──────────────────────────────────────────────

    it('importa sendMessage, sendMessageDialogBoot, steerMessage, answerPendingQuestion', () => {
        assert.ok(src.includes("from './messaging/agent-messaging.js'"));
        assert.ok(src.includes('msgSend') || src.includes('sendMessage'));
        assert.ok(src.includes('msgSendBoot') || src.includes('sendMessageDialogBoot'));
        assert.ok(src.includes('msgSteer') || src.includes('steerMessage'));
        assert.ok(src.includes('msgAnswer') || src.includes('answerPendingQuestion'));
    });

    it('sendMessage() delega para msgSend(ctx, this, ...)', () => {
        assert.ok(src.includes('msgSend(this.ctx, this'));
    });

    // ─── F39: AgentState ──────────────────────────────────────────────────

    it('importa getStatusSnapshot e listenerDiagnostics de agent-state.js', () => {
        assert.ok(src.includes("from './state/agent-state.js'"));
        assert.ok(src.includes('stateSnapshot') || src.includes('getStatusSnapshot'));
        assert.ok(src.includes('stateDiagnostics') || src.includes('listenerDiagnostics'));
    });

    it('getStatusSnapshot() delega para stateSnapshot(ctx, this)', () => {
        assert.ok(src.includes('stateSnapshot(this.ctx, this)'));
    });

    // ─── Getters delegam para ctx ─────────────────────────────────────────

    it('getters leem de this.ctx (não this.#)', () => {
        // O ideal: a maioria dos getters usa this.ctx.field
        const ctxGets = (src.match(/this\.ctx\./g) || []).length;
        const privateGets = (src.match(/this\.#/g) || []).length;
        // Pós-F39: 5 this.# refs vs muitos this.ctx refs
        assert.ok(ctxGets > privateGets, `this.ctx refs (${ctxGets}) deve exceder this.# refs (${privateGets})`);
    });

    it('apenas 3 métodos privados restam (#setStatus, #processQueue, #tryReconnect)', () => {
        const privateMethodDefs = src.match(/^\s+#\w+\s*\(/gm) || [];
        // #setStatus, #processQueue, #tryReconnect
        assert.ok(privateMethodDefs.length <= 3, `max 3 métodos privados, encontrados: ${privateMethodDefs.length}`);
    });
});
