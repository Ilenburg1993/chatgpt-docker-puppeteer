// @ts-check

import { describe, expect, it } from 'vitest';
import {
    HUB_TURN_TIMEOUT_MAX_MS,
    HUB_TURN_TIMEOUT_MIN_MS,
    resolveHubTurnTimeout,
} from '../../../../src/copilot/config/hub-timeout-policy.js';

describe('conversation-hub timeout policy', () => {
    it('retorna watchdog-only quando explicitTimeoutMs=0', () => {
        const decision = resolveHubTurnTimeout({
            defaultTimeoutMs: 120_000,
            explicitTimeoutMs: 0,
        });

        expect(decision.timeoutMs).toBeNull();
        expect(decision.strategy).toBe('watchdog_only');
    });

    it('faz clamp de timeout explícito para o máximo permitido', () => {
        const decision = resolveHubTurnTimeout({
            defaultTimeoutMs: 120_000,
            explicitTimeoutMs: HUB_TURN_TIMEOUT_MAX_MS * 10,
        });

        expect(decision.timeoutMs).toBe(HUB_TURN_TIMEOUT_MAX_MS);
        expect(decision.strategy).toBe('explicit');
    });

    it('usa timeout adaptativo para payloads grandes e modo estruturado', () => {
        const decision = resolveHubTurnTimeout({
            defaultTimeoutMs: 120_000,
            payloadChars: 18_000,
            useStructured: true,
            responseType: 'plan',
            priority: 'high',
        });

        expect(decision.strategy).toBe('adaptive');
        expect(typeof decision.timeoutMs).toBe('number');
        expect((decision.timeoutMs ?? 0) > 120_000).toBe(true);
    });

    it('fallback para baseline quando timeout explícito é inválido', () => {
        const decision = resolveHubTurnTimeout({
            defaultTimeoutMs: 120_000,
            explicitTimeoutMs: Number.NaN,
        });

        expect(decision.strategy).toBe('adaptive');
        expect((decision.timeoutMs ?? 0) >= HUB_TURN_TIMEOUT_MIN_MS).toBe(true);
    });
});
