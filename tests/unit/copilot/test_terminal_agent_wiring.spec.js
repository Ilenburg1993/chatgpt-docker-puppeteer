// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_wiring.spec.js
 *
 * Contrato: terminal/wiring/terminal-agent-wiring.js
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
} from '../../../src/copilot/terminal/state/turn-materialization-state.js';

describe('terminal/wiring/terminal-agent-wiring.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');
        expect(mod).toBeTruthy();
    });

    it('exporta registerAgentEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');
        expect(typeof mod.registerAgentEventListeners).toBe('function');
    });

    it('não usa ANSI manual nem tags cruas em mensagens públicas de conversa', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js', import.meta.url),
            'utf8',
        );

        expect(src).not.toContain('\\x1b[');
        expect(src).not.toContain('[conversa]');
        expect(src).toContain("terminalThemeRow('Conversa'");
        expect(src).toContain("terminalThemeRow('Recovery'");
    });

    it('descreve reconnect_restart como prompt preservado sem reenvio automático', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        const policy = mod.describeDialogStoppedRestartPolicy('reconnect_restart');

        expect(policy.activityTitle).toBe('Conversa preservada após reconexão');
        expect(policy.activityDetail).toContain('reenvio automático de prompt bloqueado');
        expect(policy.terminalMessage).toContain('reenvio automático do prompt foi bloqueado');
        expect(policy.sse).toEqual(
            expect.objectContaining({
                reconnect: true,
                promptReplayBlocked: true,
                restarting: false,
            }),
        );
    });

    it('restringe restart automático a razões operacionais excepcionais', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        expect(mod.shouldAutoRestartStoppedDialog('watchdog_restart')).toBe(true);
        expect(mod.shouldAutoRestartStoppedDialog('model_stopped')).toBe(true);
        expect(mod.shouldAutoRestartStoppedDialog('recovery_restart')).toBe(false);
        expect(mod.shouldAutoRestartStoppedDialog('unknown')).toBe(false);
    });

    it('deduplica dialog.loop.changed equivalente em janela curta', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        expect(mod.shouldSuppressDialogLoopChangedSse(null, { active: true, at: 1000 })).toBe(false);
        expect(
            mod.shouldSuppressDialogLoopChangedSse({ active: true, at: 1000 }, { active: true, at: 1100 }),
        ).toBe(true);
        expect(
            mod.shouldSuppressDialogLoopChangedSse({ active: true, at: 1000 }, { active: false, at: 1100 }),
        ).toBe(false);
        expect(
            mod.shouldSuppressDialogLoopChangedSse({ active: true, at: 1000 }, { active: true, at: 1500 }),
        ).toBe(false);
    });

    it('preserva dialog.turn_end como lifecycle sem arquivar reply ja materializado', async () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'turn-live', timestamp: 1000 });
        completeTerminalTurnMaterialization({
            directReply:
                'DELTA-CANONICAL-FINAL: resposta completa ja materializada por assistant.message antes do turn_end.',
            directSource: 'sdk/assistant.message',
            timestamp: 1001,
        });
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        const truncatedReply = 'DELTA-CANONICAL-FINAL: resposta completa ja materializada';
        const result = mod.createDialogTurnEndSseEnvelope({
            turnId: 'turn-live',
            reply: truncatedReply,
            durationMs: 1234,
            timestamp: 1002,
        });

        expect(result.replyAlreadyMaterialized).toBe(true);
        expect(result.envelope).toEqual(
            expect.objectContaining({
                reply: '',
                replySuppressed: true,
                replySuppressionReason: 'already_materialized',
                originalReplyChars: truncatedReply.length,
                turnId: 'turn-live',
            }),
        );
        clearTerminalTurnMaterialization();
    });

    it('sinaliza turno vazio apenas quando ocorre logo após input humano', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        expect(
            mod.shouldWarnEmptyDialogTurnAfterUserInput({
                reply: '',
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
            }),
        ).toBe(true);
        expect(
            mod.shouldWarnEmptyDialogTurnAfterUserInput({
                reply: 'ok',
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
            }),
        ).toBe(false);
        expect(
            mod.shouldWarnEmptyDialogTurnAfterUserInput({
                reply: '',
                replyAlreadyMaterialized: true,
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
            }),
        ).toBe(false);
        expect(
            mod.shouldWarnEmptyDialogTurnAfterUserInput({
                reply: '',
                lastUserInputCompletedAt: 1_000,
                now: 20_000,
                windowMs: 5_000,
            }),
        ).toBe(false);
        expect(
            mod.shouldWarnEmptyDialogTurnAfterUserInput({
                reply: '',
                lastUserInputCompletedAt: null,
                now: 2_000,
                windowMs: 5_000,
            }),
        ).toBe(false);
    });

    it('gera chave estavel para recuperação automática pós-pergunta vazia', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        expect(
            mod.createEmptyAfterUserInputAutoRecoveryKey({
                requestId: ' ask-request-123 ',
                turnId: 'turn-ignored',
                answeredAt: 60_000,
            }),
        ).toBe('request:ask-request-123');
        expect(
            mod.createEmptyAfterUserInputAutoRecoveryKey({
                requestId: null,
                turnId: 'turn-7',
                answeredAt: 60_000,
            }),
        ).toBe('turn:turn-7');
        expect(
            mod.createEmptyAfterUserInputAutoRecoveryKey({
                requestId: null,
                turnId: null,
                answeredAt: 60_000,
            }),
        ).toBe('answer-window:2');
    });

    it('tenta recuperação automática pós-pergunta uma única vez por chave', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');
        const attemptedKeys = new Set(['request:already-used']);

        expect(
            mod.shouldAttemptEmptyAfterUserInputAutoRecovery({
                reply: '',
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
                requestId: 'ask-request-123',
                attemptedKeys,
            }),
        ).toEqual({ attempt: true, key: 'request:ask-request-123' });
        expect(
            mod.shouldAttemptEmptyAfterUserInputAutoRecovery({
                reply: '',
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
                requestId: 'already-used',
                attemptedKeys,
            }),
        ).toEqual({ attempt: false, key: 'request:already-used', reason: 'already_attempted' });
        expect(
            mod.shouldAttemptEmptyAfterUserInputAutoRecovery({
                reply: 'ok',
                lastUserInputCompletedAt: 1_000,
                now: 2_000,
                windowMs: 5_000,
                requestId: 'ask-request-123',
                attemptedKeys,
            }),
        ).toEqual({ attempt: false, key: null, reason: 'not_empty_after_recent_user_input' });
    });

    it('liga o ledger de recuperação pós-pergunta ao listener do turn_end', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js', import.meta.url),
            'utf8',
        );

        expect(src).toContain('attemptedKeys: emptyAfterUserInputAutoRecoveryKeys');
    });

    it('devolve o prompt com guarda idle quando turn_end já foi materializado', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js', import.meta.url),
            'utf8',
        );

        expect(src).toContain('if (replyAlreadyMaterialized)');
        expect(src).toContain('scheduleMaterializedTurnEndPromptRedraw()');
        expect(src).toContain("if (phase !== 'idle') return");
        expect(src).toContain('scheduleTerminalPromptRedraw(rl, buildUserPrompt(), { force: true })');
    });
});
