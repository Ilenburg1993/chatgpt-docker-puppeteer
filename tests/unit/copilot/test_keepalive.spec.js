// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    KEEPALIVE_INTERVAL_MS: 100,
    KEEPALIVE_IDLE_THRESHOLD_MS: 50,
}));

/* ── SUT ── */
import { SessionKeepalive } from '../../../src/copilot/agent/session/lifecycle/keepalive.js';

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
            performKeepalive: vi.fn(async () => null),
            isIdle: () => false,
            isDialogLoopActive: () => false,
        });
        expect(ka.running).toBe(true);

        ka.stop();
        expect(ka.running).toBe(false);
    });

    it('não envia heartbeat quando dialog loop está ativo', async () => {
        const keepaliveFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 50 });

        ka.start({
            performKeepalive: keepaliveFn,
            isIdle: () => true,
            isDialogLoopActive: () => true,
        });

        await vi.advanceTimersByTimeAsync(300);
        ka.stop();

        expect(keepaliveFn).not.toHaveBeenCalled();
    });

    it('não envia heartbeat quando não está idle', async () => {
        const keepaliveFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 50 });

        ka.start({
            performKeepalive: keepaliveFn,
            isIdle: () => false,
            isDialogLoopActive: () => false,
        });

        await vi.advanceTimersByTimeAsync(300);
        ka.stop();

        expect(keepaliveFn).not.toHaveBeenCalled();
    });

    it('propaga a estratégia usada no keepalive sem conhecer handles crus do SDK', async () => {
        const onKeepalive = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 0 });

        ka.start({
            performKeepalive: vi.fn(/** @returns {Promise<'client.ping'>} */ async () => 'client.ping'),
            isIdle: () => true,
            isDialogLoopActive: () => false,
            onKeepalive,
        });

        await vi.advanceTimersByTimeAsync(150);
        ka.stop();

        expect(onKeepalive).toHaveBeenCalledWith(
            expect.objectContaining({ strategy: 'client.ping', ts: expect.any(Number) }),
        );
    });

    it('não emite callback quando a ação semântica não toca o SDK', async () => {
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 0 });
        const onKeepalive = vi.fn();

        ka.start({
            performKeepalive: vi.fn(async () => null),
            isIdle: () => true,
            isDialogLoopActive: () => false,
            onKeepalive,
        });

        await vi.advanceTimersByTimeAsync(150);
        ka.stop();

        expect(onKeepalive).not.toHaveBeenCalled();
    });

    it('ping() reseta lastActivity (evita heartbeat prematuro)', async () => {
        const keepaliveFn = vi.fn();
        const ka = new SessionKeepalive({ intervalMs: 100, idleThresholdMs: 200 });

        ka.start({
            performKeepalive: keepaliveFn,
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
        expect(keepaliveFn).not.toHaveBeenCalled();
    });
});
