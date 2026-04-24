// @ts-check
/**
 * tests/unit/copilot/terminal/test_handlers_system_metrics.spec.js
 *
 * Testes para handlers/system-metrics.js — endpoints de history, git status/log. Foca nos handlers testáveis sem mocks
 * pesados de agent singletons.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    appendThinkingHistoryChunk,
    clearThinkingHistory,
    finalizeThinkingHistoryEntry,
    recordInjectHistory,
} from '../../../../src/copilot/presentation/runtime-ui-state-store.js';
import {
    handleGetHistory,
    handleGetThinkingEntry,
    handleGetThinkingHistory,
    handleGitLog,
    handleGitStatus,
} from '../../../../src/copilot/terminal/handlers/system-metrics.js';

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

beforeEach(() => {
    clearThinkingHistory();
});

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

describe('handlers/system-metrics — thinking history', () => {
    it('lista thinkings capturados com conteúdo resumido', () => {
        appendThinkingHistoryChunk({
            id: 'dialog-r1',
            source: 'dialog',
            title: 'Thinking dialog',
            chunk: 'um pensamento operacional '.repeat(20),
            reasoningId: 'r1',
        });
        finalizeThinkingHistoryEntry('dialog-r1', { durationMs: 120, status: 'completed' });

        const result = handleGetThinkingHistory({ limit: 10 });
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.count).toBe(1);
        expect(body.entries[0]).toMatchObject({
            id: 'dialog-r1',
            source: 'dialog',
            status: 'completed',
            durationMs: 120,
        });
        expect(body.entries[0].contentSnippet.length).toBeLessThanOrEqual(243);
        expect(body.entries[0].content).toBeUndefined();
    });

    it('abre thinking completo por latest, id completo e sufixo curto', () => {
        appendThinkingHistoryChunk({
            id: 'task-abc123456789',
            source: 'task',
            title: 'Task abc123456789',
            chunk: 'thinking completo',
            taskId: 'abc123456789',
        });
        finalizeThinkingHistoryEntry('task-abc123456789', { status: 'completed' });

        for (const id of ['latest', 'task-abc123456789', '123456789']) {
            const result = handleGetThinkingEntry({ id });
            const body = bodyOf(/** @type {{ body: any }} */ (result));

            expect(result.status).toBe(200);
            expect(body.ok).toBe(true);
            expect(body.entry).toMatchObject({
                id: 'task-abc123456789',
                content: 'thinking completo',
                status: 'completed',
            });
        }
    });

    it('retorna 404 para thinking inexistente', () => {
        const result = handleGetThinkingEntry({ id: 'nao-existe' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(404);
        expect(body.ok).toBe(false);
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
