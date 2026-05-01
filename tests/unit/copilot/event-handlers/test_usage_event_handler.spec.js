// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    onSessionEvent: vi.fn(),
    log: vi.fn(),
}));

vi.mock('#copilot/events', () => ({
    SESSION_EVENTS: {
        ASSISTANT_USAGE: 'assistant.usage',
    },
}));

vi.mock('../../../../src/copilot/sdk/session/events.js', () => ({
    onSessionEvent: mocks.onSessionEvent,
}));

vi.mock('#copilot/observability', () => ({
    log: mocks.log,
}));

describe('event-handlers/usage wireUsageEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enriquece prInfo com configuredModel/sessionId e sinaliza mismatch', async () => {
        /** @type {(evt: any) => void} */
        let usageHandler = () => {};
        mocks.onSessionEvent.mockImplementation((_session, _eventType, handler) => {
            usageHandler = handler;
            return () => {};
        });

        const { wireUsageEvent } = await import('../../../../src/copilot/event-handlers/usage.js');

        const emit = vi.fn();
        const onPrInfo = vi.fn();
        const session = {
            sessionId: 'sdk-123',
            model: 'gpt-5.4',
        };

        wireUsageEvent(/** @type {any} */ (session), { emit, onPrInfo });

        usageHandler({
            data: {
                model: 'claude-haiku-4.5',
                cost: 0.33,
                quotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
            },
        });

        expect(onPrInfo).toHaveBeenCalledTimes(1);
        expect(onPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                modelMismatch: true,
                sessionId: 'sdk-123',
                cost: 0.33,
                quotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
                ts: expect.any(Number),
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'pr.consumed',
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                modelMismatch: true,
            }),
        );
        expect(mocks.log).toHaveBeenCalledWith('INFO', expect.stringContaining('[MODEL_MISMATCH]'));
    });

    it('não marca mismatch quando billedModel e configuredModel coincidem', async () => {
        /** @type {(evt: any) => void} */
        let usageHandler = () => {};
        mocks.onSessionEvent.mockImplementation((_session, _eventType, handler) => {
            usageHandler = handler;
            return () => {};
        });

        const { wireUsageEvent } = await import('../../../../src/copilot/event-handlers/usage.js');

        const emit = vi.fn();
        const onPrInfo = vi.fn();
        const session = {
            sessionId: 'sdk-456',
            model: 'gpt-5.4',
        };

        wireUsageEvent(/** @type {any} */ (session), { emit, onPrInfo });

        usageHandler({
            data: {
                model: 'gpt-5.4',
                cost: 0.1,
            },
        });

        expect(onPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-5.4',
                configuredModel: 'gpt-5.4',
                sessionId: 'sdk-456',
                cost: 0.1,
            }),
        );
        expect(onPrInfo.mock.calls[0]?.[0]?.modelMismatch ?? false).toBe(false);
        const logLine = String(mocks.log.mock.calls[0]?.[1] ?? '');
        expect(logLine.includes('[MODEL_MISMATCH]')).toBe(false);
    });
});
