// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    KEEPALIVE_INTERVAL_MS: 100,
    KEEPALIVE_IDLE_THRESHOLD_MS: 50,
}));

/* ── SUT ── */
import { SessionKeepalive } from '../../../src/copilot/agent/session/keepalive.js';

describe('SessionKeepalive', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('start/stop alterna running', () => {
        const ka = new SessionKeepalive({ intervalMs: 500, idleThresholdMs: 100 });
        expect(ka.running).toBe(false);

        ka.start({
            getSession: () => null,
            isIdle: () => false,
            isDialogLoopActive: () => false,
        });
        expect(ka.running).toBe(true);

        ka.stop();
        expect(ka.running).toBe(false);
    });

    it('não envia heartbeat quando dialog loop está ativo', async () => {
        const sendFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 50 });

        ka.start({
            getSession: () => ({ send: sendFn }),
            isIdle: () => true,
            isDialogLoopActive: () => true,
        });

        await vi.advanceTimersByTimeAsync(300);
        ka.stop();

        expect(sendFn).not.toHaveBeenCalled();
    });

    it('não envia heartbeat quando não está idle', async () => {
        const sendFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 50 });

        ka.start({
            getSession: () => ({ send: sendFn }),
            isIdle: () => false,
            isDialogLoopActive: () => false,
        });

        await vi.advanceTimersByTimeAsync(300);
        ka.stop();

        expect(sendFn).not.toHaveBeenCalled();
    });

    it('usa client.ping() como primeiro recurso de keepalive', async () => {
        const pingFn = vi.fn().mockResolvedValue(undefined);
        const sendFn = vi.fn();
        const onKeepalive = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 0 });

        // Força lastActivityAt no passado simulando idle
        ka.start({
            getSession: () => ({ send: sendFn }),
            getClient: () => ({ ping: pingFn }),
            isIdle: () => true,
            isDialogLoopActive: () => false,
            onKeepalive,
        });

        await vi.advanceTimersByTimeAsync(150);
        ka.stop();

        expect(pingFn).toHaveBeenCalled();
        expect(sendFn).not.toHaveBeenCalled();
    });

    it('fallback para session.send() quando ping falha', async () => {
        const pingFn = vi.fn().mockRejectedValue(new Error('ping failed'));
        const sendFn = vi.fn().mockResolvedValue(undefined);
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 0 });

        ka.start({
            getSession: () => ({ send: sendFn }),
            getClient: () => ({ ping: pingFn }),
            isIdle: () => true,
            isDialogLoopActive: () => false,
        });

        await vi.advanceTimersByTimeAsync(150);
        ka.stop();

        expect(pingFn).toHaveBeenCalled();
        expect(sendFn).toHaveBeenCalledWith({ prompt: '[keepalive]' });
    });

    it('ping() reseta lastActivity (evita heartbeat prematuro)', async () => {
        const sendFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 200 });

        ka.start({
            getSession: () => ({ send: sendFn }),
            isIdle: () => true,
            isDialogLoopActive: () => false,
        });

        // A cada 90ms fazemos ping, resetando o idle
        await vi.advanceTimersByTimeAsync(90);
        ka.ping();
        await vi.advanceTimersByTimeAsync(90);
        ka.ping();
        await vi.advanceTimersByTimeAsync(90);
        ka.stop();

        // Nenhum heartbeat porque idle threshold nunca foi atingido
        expect(sendFn).not.toHaveBeenCalled();
    });
});
