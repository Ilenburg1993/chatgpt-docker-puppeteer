// @ts-check
/**
 * tests/unit/copilot/test_agent_dialog_controller.spec.js
 *
 * F41.5: Testes unitários para agent-dialog-controller.js (F37).
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { describe, it } from 'vitest';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import {
    dialogRecoverInputChannel,
    dialogResume,
    dialogStart,
    dialogStop,
    ensureDialogLoopAttached,
} from '../../../src/copilot/agent/dialog/agent-dialog-controller.js';

describe('agent-dialog-controller › dialogStart', () => {
    /** @returns {{ ctx: AgentContext; host: EventEmitter & Record<string, any> }} */
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
        ctx.status = 'processing';

        await assert.rejects(
            () => dialogStart(ctx, /** @type {any} */ (host)),
            (/** @type {any} */ err) => err.code === 'INVALID_STATE',
        );
    });

    it('trata READY pendente como start idempotente sem consumir novo boot', async () => {
        const { ctx, host } = setup();
        ctx.isWaitingForInput = () => true;
        ctx.getPendingQuestionKind = () => 'ready';
        ctx.isDialogLoopActive = () => true;
        ctx.isIdle = () => false;

        let emitted = null;
        host.emit = (event, payload) => {
            emitted = { event, payload };
            return true;
        };
        let started = false;
        ctx.dialogLoop.start = async () => {
            started = true;
        };

        await dialogStart(ctx, /** @type {any} */ (host));

        assert.equal(started, false);
        assert.equal(emitted?.event, 'dialog.loop.changed');
        assert.equal(emitted?.payload?.reason, 'ready_already_waiting');
    });

    it('rejeita quando utilização de contexto ≥ 95%', async () => {
        const { ctx, host } = setup();
        ctx.status = 'idle';
        ctx.contextState = { tokens: 950, tokenLimit: 1000, utilization: 0.96 };

        await assert.rejects(
            () => dialogStart(ctx, /** @type {any} */ (host)),
            (/** @type {any} */ err) => err.code === 'CONTEXT_EXHAUSTED',
        );
    });

    it('usa a API semântica do keepalive ao iniciar o dialog loop', async () => {
        const { ctx, host } = setup();
        ctx.status = 'idle';
        ctx.setSession(/** @type {any} */ ({ sessionId: 'sess-1' }));

        /** @type {string[]} */
        const stopReasons = [];
        ctx.stopKeepalive = (reason = 'manual') => {
            stopReasons.push(reason);
        };
        ctx.dialogLoop.start = async () => {};

        await dialogStart(ctx, /** @type {any} */ (host));

        assert.deepEqual(stopReasons, ['dialog_loop_active']);
    });
});

describe('agent-dialog-controller › dialogResume', () => {
    it('rejeita quando status não é idle nem waiting_for_input', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'processing';

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
        ensureDialogLoopAttached(ctx, /** @type {any} */ (host));
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

        ensureDialogLoopAttached(ctx, /** @type {any} */ (host));
        const listenerCount1 = emitter.listenerCount('session.token_budget_warning');

        ensureDialogLoopAttached(ctx, /** @type {any} */ (host));
        const listenerCount2 = emitter.listenerCount('session.token_budget_warning');

        assert.equal(listenerCount1, listenerCount2, 'wiring não deve duplicar listeners');
    });
});

describe('agent-dialog-controller › dialogStop', () => {
    it('reinicia o keepalive via API semântica do contexto', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        const host = Object.assign(emitter, {
            sessionId: 'test-session',
            sendMessage: async () => '',
            sendMessageDialogBoot: async () => '',
            answerPendingQuestion: () => false,
        });

        ctx.status = 'idle';
        ctx.setSession(/** @type {any} */ ({ sessionId: 'sess-1' }));

        /** @type {{ isIdle?: () => boolean; onKeepalive?: (ts: number) => void } | null} */
        let keepaliveOptions = null;
        ctx.startKeepalive = (options = {}) => {
            keepaliveOptions = options;
            return true;
        };
        ctx.dialogLoop.stop = async () => {};

        await dialogStop(ctx, /** @type {any} */ (host), { authorized: true });

        assert.ok(keepaliveOptions, 'dialogStop deve solicitar restart do keepalive');
        if (!keepaliveOptions) {
            throw new Error('dialogStop não forneceu opções de keepalive');
        }
        const restartOptions = /** @type {{ isIdle?: () => boolean; onKeepalive?: (ts: number) => void }} */ (
            keepaliveOptions
        );
        assert.equal(typeof restartOptions.onKeepalive, 'function');
    });
});

describe('agent-dialog-controller › dialogRecoverInputChannel', () => {
    /** @returns {{ ctx: AgentContext; host: EventEmitter & Record<string, any> }} */
    function setupRecovery() {
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

    it('usa READY pendente como recuperação 0 PR', async () => {
        const { ctx, host } = setupRecovery();
        let recoveryPayload = null;
        host.on('dialog.recovery', (payload) => {
            recoveryPayload = payload;
        });
        ctx.isDialogLoopActive = () => true;
        ctx.isWaitingForInput = () => true;
        ctx.getPendingQuestionKind = () => 'ready';

        const result = await dialogRecoverInputChannel(ctx, /** @type {any} */ (host), {
            reason: 'input_channel_missing',
            traceId: 'r1',
        });

        assert.equal(result.recovered, true);
        assert.equal(result.strategy, 'zero_pr_ready');
        assert.equal(result.prConsumed, false);
        assert.equal(recoveryPayload?.strategy, 'zero_pr_ready');
    });

    it('reinicia com reason recovery_restart quando active+idle fica sem canal de input', async () => {
        const { ctx, host } = setupRecovery();
        let recoveryPayload = null;
        host.on('dialog.recovery', (payload) => {
            recoveryPayload = payload;
        });
        ctx.status = 'idle';
        ctx.isDialogLoopPaused = () => false;
        ctx.isDialogLoopActive = () => true;
        ctx.isWaitingForInput = () => false;
        ctx.isIdle = () => true;
        ctx.hasPendingQuestion = () => false;
        ctx.getContextStateSnapshot = () => null;

        let stopOpts = null;
        ctx.stopDialogLoop = async (opts) => {
            stopOpts = opts;
        };
        let started = false;
        ctx.startDialogLoop = async () => {
            started = true;
        };
        ctx.stopKeepalive = () => {};
        ctx.startKeepalive = () => false;

        const result = await dialogRecoverInputChannel(ctx, /** @type {any} */ (host), {
            reason: 'input_channel_missing',
        });

        assert.equal(result.recovered, true);
        assert.equal(result.strategy, 'restart_with_pr');
        assert.equal(result.prConsumed, true);
        assert.deepEqual(stopOpts, { authorized: true, reason: 'recovery_restart' });
        assert.equal(started, true);
        assert.equal(recoveryPayload?.success, true);
    });
});
