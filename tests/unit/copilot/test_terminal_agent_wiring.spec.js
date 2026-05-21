// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_wiring.spec.js
 *
 * Contrato: terminal/wiring/terminal-agent-wiring.js
 */

import { describe, expect, it } from 'vitest';
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

    it('descreve reconnect_restart como prompt preservado sem reenvio automático', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        const policy = mod.describeDialogStoppedRestartPolicy('reconnect_restart');

        expect(policy.activityTitle).toBe('Dialog loop preservado após reconexão');
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
});
