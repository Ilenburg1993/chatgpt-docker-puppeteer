// @ts-check
/**
 * tests/unit/copilot/test_agent_dialog_controller.spec.js
 *
 * F41.5: Testes unitários para agent-dialog-controller.js (F37).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import { dialogStart, dialogResume, ensureDialogLoopAttached } from '../../../src/copilot/agent/dialog/agent-dialog-controller.js';

describe('agent-dialog-controller › dialogStart', () => {
    /** @returns {{ ctx: AgentContext, host: EventEmitter & Record<string, any> }} */
    function setup() {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        const host = Object.assign(emitter, {
            sessionId: 'test-session',
            sendMessage: async () => '',
            sendMessageDialogBoot: async () => '',
            answerPendingQuestion: () => false,
        });
        return { ctx, host };
    }

    it('rejeita quando status não é idle', async () => {
        const { ctx, host } = setup();
        ctx.status = 'busy';

        await assert.rejects(
            () => dialogStart(ctx, host),
            (/** @type {any} */ err) => err.code === 'INVALID_STATE',
        );
    });

    it('rejeita quando utilização de contexto ≥ 95%', async () => {
        const { ctx, host } = setup();
        ctx.status = 'idle';
        ctx.contextState = { tokens: 950, tokenLimit: 1000, utilization: 0.96 };

        await assert.rejects(
            () => dialogStart(ctx, host),
            (/** @type {any} */ err) => err.code === 'CONTEXT_EXHAUSTED',
        );
    });
});

describe('agent-dialog-controller › dialogResume', () => {
    it('rejeita quando status não é idle nem waiting_for_input', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'busy';

        await assert.rejects(
            () => dialogResume(ctx),
            (/** @type {any} */ err) => err.code === 'INVALID_STATE',
        );
    });
});

describe('agent-dialog-controller › ensureDialogLoopAttached', () => {
    it('faz attach do agent host no dialog loop', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        const host = Object.assign(emitter, {
            sessionId: 'test-session',
            sendMessage: async () => '',
            sendMessageDialogBoot: async () => '',
            answerPendingQuestion: () => false,
        });

        assert.equal(ctx.dialogLoopAttached, false);
        ensureDialogLoopAttached(ctx, host);
        assert.equal(ctx.dialogLoopAttached, true);
    });

    it('wiring de eventos é idempotente (não duplica)', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        const host = Object.assign(emitter, {
            sessionId: 'test-session',
            sendMessage: async () => '',
            sendMessageDialogBoot: async () => '',
            answerPendingQuestion: () => false,
        });

        ensureDialogLoopAttached(ctx, host);
        const listenerCount1 = emitter.listenerCount('session.token_budget_warning');

        ensureDialogLoopAttached(ctx, host);
        const listenerCount2 = emitter.listenerCount('session.token_budget_warning');

        assert.equal(listenerCount1, listenerCount2, 'wiring não deve duplicar listeners');
    });
});
