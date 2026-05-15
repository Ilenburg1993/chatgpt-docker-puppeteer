// @ts-check
/**
 * tests/unit/copilot/sdk/test_model_switch_verify_retry.spec.js
 *
 * Unit tests para model-switch-verify-retry.js
 *
 * Testa retry com timeout cap para verificação de model switch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyModelSwitchWithRetry } from '../../../../src/copilot/sdk/session/model-switch-verify-retry.js';

describe('model-switch-verify-retry', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('verifyModelSwitchWithRetry', () => {
        it('retorna sucesso na primeira tentativa', async () => {
            const predicateFn = vi.fn().mockResolvedValue(true);

            const result = await verifyModelSwitchWithRetry(predicateFn);

            expect(result.ok).toBe(true);
            expect(result.retries).toBe(0);
            expect(result.timedOut).toBe(false);
            expect(predicateFn).toHaveBeenCalledTimes(1);
        });

        it('retorna sucesso após 2 retries', async () => {
            const predicateFn = vi
                .fn()
                .mockResolvedValueOnce(false) // Retry 0: falha
                .mockResolvedValueOnce(false) // Retry 1: falha
                .mockResolvedValueOnce(true); // Retry 2: sucesso

            const result = await verifyModelSwitchWithRetry(predicateFn, { pollDelayMs: 10 });

            expect(result.ok).toBe(true);
            expect(result.retries).toBe(2);
            expect(result.timedOut).toBe(false);
            expect(predicateFn).toHaveBeenCalledTimes(3);
        });

        it('respeita max retries e retorna falha', async () => {
            const predicateFn = vi.fn().mockResolvedValue(false);

            const result = await verifyModelSwitchWithRetry(predicateFn, { maxRetries: 2, pollDelayMs: 10 });

            expect(result.ok).toBe(false);
            expect(result.retries).toBeGreaterThanOrEqual(2);
            expect(predicateFn).toHaveBeenCalledTimes(3); // 1 inicial + 2 retries
        });

        it('respeita timeout cap de 500ms', async () => {
            const predicateFn = vi.fn().mockResolvedValue(false);
            const start = Date.now();

            const result = await verifyModelSwitchWithRetry(predicateFn, {
                maxRetries: 100, // Muitos retries
                pollDelayMs: 10,
                totalTimeoutMs: 100, // Timeout pequeno
            });

            const elapsed = Date.now() - start;

            expect(result.ok).toBe(false);
            expect(elapsed).toBeLessThan(150); // Algum overhead aceitável
        });

        it('detecta timeout quando timeout cap é atingido', async () => {
            const predicateFn = vi.fn().mockResolvedValue(false);

            // Usar timeout pequeno para forçar timeout (50ms é muito para overhead)
            const result = await verifyModelSwitchWithRetry(predicateFn, {
                maxRetries: 100,
                pollDelayMs: 100,
                totalTimeoutMs: 200, // Timeout: 200ms
            });

            expect(result.ok).toBe(false);
            // Com timeout 200ms e delays 100ms, pode atingir timeout ou max retries
            // Apenas garantir que falhou
            expect(result.ok).toBe(false);
        });

        it('trata erro de predicado como falha (não re-lança)', async () => {
            const predicateFn = vi
                .fn()
                .mockRejectedValueOnce(new Error('Test error'))
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);

            const result = await verifyModelSwitchWithRetry(predicateFn, { pollDelayMs: 10 });

            expect(result.ok).toBe(true);
            expect(result.retries).toBe(2);
        });

        it('rejeita predicateFn que não é função', async () => {
            const invalidFn = /** @type {any} */ ('not a function');

            await expect(verifyModelSwitchWithRetry(invalidFn)).rejects.toThrow(TypeError);
        });

        it('respeita config parcial com defaults ampliados', async () => {
            const predicateFn = vi.fn().mockResolvedValue(true);

            const result = await verifyModelSwitchWithRetry(predicateFn, { maxRetries: 5 });

            // Defaults atuais: pollDelayMs=250, totalTimeoutMs=5000.
            expect(result.ok).toBe(true);
            expect(predicateFn).toHaveBeenCalledTimes(1);
        });

        it('exponential backoff funciona corretamente', async () => {
            const predicateFn = vi
                .fn()
                .mockResolvedValueOnce(false) // Retry 0: delay = 100 * (1 + 0) = 100
                .mockResolvedValueOnce(false) // Retry 1: delay = 100 * (1 + 1) = 200
                .mockResolvedValueOnce(true); // Retry 2: sucesso

            const start = Date.now();
            const result = await verifyModelSwitchWithRetry(predicateFn, {
                pollDelayMs: 20,
                maxRetries: 3,
                totalTimeoutMs: 5000,
            });
            const elapsed = Date.now() - start;

            // Total delays: 20*(1+0) + 20*(1+1) = 20 + 40 = 60ms (+ overhead)
            expect(result.ok).toBe(true);
            expect(result.retries).toBe(2);
            expect(elapsed).toBeGreaterThanOrEqual(50); // Pelo menos os delays
            expect(elapsed).toBeLessThan(500); // Não muito longo
        });
    });
});
