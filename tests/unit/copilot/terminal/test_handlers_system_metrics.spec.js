// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_system_metrics.spec.js
 *
 * Testes para handlers/system-metrics.js — endpoints de history, git status/log. Foca nos handlers testáveis sem mocks
 * pesados de agent singletons.
 */
import { describe, expect, it } from 'vitest';

import {
    handleGetHistory,
    handleGitLog,
    handleGitStatus,
} from '../../../../src/copilot/terminal/handlers/system-metrics.js';
import { recordInjectHistory } from '../../../../src/copilot/terminal/state.js';

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

describe('handlers/system-metrics — handleGetHistory', () => {
    it('retorna status 200 com array de entries', () => {
        // Popula inject history
        recordInjectHistory({
            ts: Date.now(),
            from: 'test-handler',
            message: 'hello',
            replySnippet: 'world',
            durationMs: 50,
            ok: true,
        });

        const result = handleGetHistory({ limit: 10 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.entries.length).toBeGreaterThanOrEqual(1);
    });

    it('respeita parâmetro limit', () => {
        for (let i = 0; i < 5; i++) {
            recordInjectHistory({
                ts: Date.now(),
                from: `batch-${i}`,
                message: `msg-${i}`,
                replySnippet: null,
                durationMs: 10,
                ok: true,
            });
        }

        const result = handleGetHistory({ limit: 2 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(body.entries.length).toBeLessThanOrEqual(2);
    });

    it('usa limit padrão 50 se não especificado', () => {
        const result = handleGetHistory();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
    });
});

describe('handlers/system-metrics — git endpoints (real git)', () => {
    it('handleGitStatus retorna entries do repo', async () => {
        const result = await handleGitStatus();
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.entries)).toBe(true);
    });

    it('handleGitLog retorna commits recentes', async () => {
        const result = await handleGitLog({ n: 5 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));
        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.entries.length).toBeGreaterThanOrEqual(1);
    });
});
