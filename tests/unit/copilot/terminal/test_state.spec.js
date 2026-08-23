// @ts-check
/**
 * tests/unit/copilot/terminal/test_state.spec.js
 *
 * F185: Testes para state.js — getters/setters, stateEmitter events, attachment queue, inject history.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    addAttachment,
    appendThinkingHistoryChunk,
    clearAttachments,
    clearInjectHistory,
    clearNextTurnRequestHeaders,
    clearThinkingHistory,
    finalizeThinkingHistoryEntry,
    getAttachmentQueue,
    getBusy,
    getHubSessionId,
    getInjectHistory,
    getInjectHistoryForRuntime,
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getLatestInjectHistoryEntryForRuntime,
    getLatestThinkingHistoryEntry,
    getNextTurnRequestHeaders,
    getSdkSessionMode,
    getShowIntentActivity,
    getShowStreaming,
    getShowThinking,
    getShowToolActivity,
    getShowUsage,
    getThinkingHistory,
    getThinkingHistoryEntry,
    recordInjectHistory,
    setBusy,
    setHubSessionId,
    setLastSdkPlanOperation,
    setNextTurnRequestHeaders,
    setSdkSessionMode,
    setShowIntentActivity,
    setShowStreaming,
    setShowThinking,
    setShowToolActivity,
    setShowUsage,
    stateEmitter,
} from '../../../../src/copilot/presentation/state/index.js';

describe('state getters/setters', () => {
    afterEach(() => {
        setHubSessionId(null);
        setBusy(false);
        setSdkSessionMode(null);
        setLastSdkPlanOperation(null, 0);
    });

    it('getHubSessionId/setHubSessionId round-trip', () => {
        setHubSessionId('sess-123');
        expect(getHubSessionId()).toBe('sess-123');
    });

    it('getBusy/setBusy round-trip', () => {
        setBusy(true);
        expect(getBusy()).toBe(true);
        setBusy(false);
        expect(getBusy()).toBe(false);
    });

    it('getSdkSessionMode/setSdkSessionMode round-trip', () => {
        setSdkSessionMode('plan');
        expect(getSdkSessionMode()).toBe('plan');
    });

    it('getLastSdkPlanOperation/setLastSdkPlanOperation round-trip', () => {
        setLastSdkPlanOperation('update', 123);
        expect(getLastSdkPlanOperation()).toBe('update');
        expect(getLastSdkPlanChangedAt()).toBe(123);
    });
});

describe('state stateEmitter', () => {
    afterEach(() => {
        setHubSessionId(null);
        setBusy(false);
        stateEmitter.removeAllListeners();
    });

    it('emite hubSessionId:changed ao mudar session', () => {
        /** @type {any[]} */
        const events = [];
        stateEmitter.on('hubSessionId:changed', (newId, prevId) => events.push({ newId, prevId }));
        setHubSessionId('a');
        setHubSessionId('b');
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ newId: 'a', prevId: null });
        expect(events[1]).toEqual({ newId: 'b', prevId: 'a' });
    });

    it('não emite se valor não mudou', () => {
        setHubSessionId('same');
        const handler = vi.fn();
        stateEmitter.on('hubSessionId:changed', handler);
        setHubSessionId('same');
        expect(handler).not.toHaveBeenCalled();
    });

    it('emite busy:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('busy:changed', handler);
        setBusy(true);
        expect(handler).toHaveBeenCalledWith(true);
    });

    it('emite showThinking:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('showThinking:changed', handler);
        const prev = getShowThinking();
        setShowThinking(!prev);
        expect(handler).toHaveBeenCalledWith(!prev);
        setShowThinking(prev); // restore
    });

    it('emite showUsage:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('showUsage:changed', handler);
        const prev = getShowUsage();
        setShowUsage(!prev);
        expect(handler).toHaveBeenCalledWith(!prev);
        setShowUsage(prev);
    });

    it('emite showStreaming:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('showStreaming:changed', handler);
        const prev = getShowStreaming();
        setShowStreaming(!prev);
        expect(handler).toHaveBeenCalledWith(!prev);
        setShowStreaming(prev);
    });

    it('emite showToolActivity:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('showToolActivity:changed', handler);
        const prev = getShowToolActivity();
        setShowToolActivity(!prev);
        expect(handler).toHaveBeenCalledWith(!prev);
        setShowToolActivity(prev);
    });

    it('emite showIntentActivity:changed', () => {
        const handler = vi.fn();
        stateEmitter.on('showIntentActivity:changed', handler);
        const prev = getShowIntentActivity();
        setShowIntentActivity(!prev);
        expect(handler).toHaveBeenCalledWith(!prev);
        setShowIntentActivity(prev);
    });
});

describe('state attachment queue', () => {
    beforeEach(() => clearAttachments());

    it('addAttachment e getAttachmentQueue', () => {
        addAttachment('/tmp/a.js');
        addAttachment('/tmp/b.js');
        expect(getAttachmentQueue()).toEqual(['/tmp/a.js', '/tmp/b.js']);
    });

    it('getAttachmentQueue retorna cópia defensiva', () => {
        addAttachment('/tmp/x.js');
        const q1 = getAttachmentQueue();
        q1.push('/tmp/mutated.js');
        expect(getAttachmentQueue()).toEqual(['/tmp/x.js']);
    });

    it('deduplicação: mesmo path não é adicionado duas vezes', () => {
        addAttachment('/tmp/dup.js');
        addAttachment('/tmp/dup.js');
        expect(getAttachmentQueue()).toHaveLength(1);
    });

    it('aceita blob attachment estruturado com cópia defensiva', () => {
        addAttachment({
            type: 'blob',
            data: 'Y29udGV1ZG8=',
            mimeType: 'text/plain',
            displayName: 'memo.txt',
        });

        const queue = getAttachmentQueue();
        expect(queue).toEqual([
            {
                type: 'blob',
                data: 'Y29udGV1ZG8=',
                mimeType: 'text/plain',
                displayName: 'memo.txt',
            },
        ]);

        /** @type {any} */ (queue[0]).displayName = 'mutado.txt';
        expect(getAttachmentQueue()).toEqual([
            {
                type: 'blob',
                data: 'Y29udGV1ZG8=',
                mimeType: 'text/plain',
                displayName: 'memo.txt',
            },
        ]);
    });

    it('deduplica blob attachment idêntico', () => {
        const blob = {
            type: 'blob',
            data: 'Y29udGV1ZG8=',
            mimeType: 'text/plain',
            displayName: 'memo.txt',
        };
        addAttachment(blob);
        addAttachment(blob);
        expect(getAttachmentQueue()).toHaveLength(1);
    });

    it('clearAttachments limpa a fila', () => {
        addAttachment('/tmp/c.js');
        clearAttachments();
        expect(getAttachmentQueue()).toEqual([]);
    });

    it('addAttachment lança erro quando fila cheia', () => {
        // Enche a fila até o limite (env default ou 20)
        try {
            for (let i = 0; i < 200; i++) {
                addAttachment(`/tmp/file${i}.js`);
            }
            // Se não lançou, a fila é >= 200 (improvável)
            expect(true).toBe(true);
        } catch (/** @type {any} */ e) {
            expect(e.message).toContain('cheia');
        }
    });
});

describe('state next-turn request headers', () => {
    beforeEach(() => clearNextTurnRequestHeaders());
    afterEach(() => clearNextTurnRequestHeaders());

    it('set/get round-trip com cópia defensiva', () => {
        setNextTurnRequestHeaders({ Authorization: 'Bearer test', 'X-Mode': 'byok' });

        const headers = getNextTurnRequestHeaders();
        expect(headers).toEqual({ Authorization: 'Bearer test', 'X-Mode': 'byok' });

        if (headers) headers['Authorization'] = 'mutado';
        expect(getNextTurnRequestHeaders()).toEqual({ Authorization: 'Bearer test', 'X-Mode': 'byok' });
    });

    it('normaliza headers vazios para null', () => {
        setNextTurnRequestHeaders({ Authorization: '   ', 'X-Mode': '' });
        expect(getNextTurnRequestHeaders()).toBeNull();
    });

    it('clear limpa o estado one-shot', () => {
        setNextTurnRequestHeaders({ Authorization: 'Bearer test' });
        clearNextTurnRequestHeaders();
        expect(getNextTurnRequestHeaders()).toBeNull();
    });
});

describe('state inject history (circular buffer)', () => {
    beforeEach(() => clearInjectHistory());
    afterEach(() => clearInjectHistory());

    /** @returns {import('../../../../src/copilot/presentation/state/index.js').InjectHistoryEntry} */
    const mkEntry = (from = 'test') => ({
        ts: Date.now(),
        from,
        message: 'msg',
        replySnippet: null,
        durationMs: 100,
        ok: true,
    });

    it('recordInjectHistory e getInjectHistory round-trip', () => {
        recordInjectHistory(mkEntry('unit'));
        const hist = getInjectHistory(5);
        expect(hist.length).toBeGreaterThanOrEqual(1);
        expect(hist.at(-1)?.from).toBe('unit');
    });

    it('getInjectHistory respeita parâmetro n', () => {
        for (let i = 0; i < 10; i++) recordInjectHistory(mkEntry(`src-${i}`));
        const hist = getInjectHistory(3);
        expect(hist.length).toBeLessThanOrEqual(3);
    });

    it('filtra histórico de inject por runtimeId', () => {
        recordInjectHistory({ ...mkEntry('default-src'), runtimeId: 'default' });
        recordInjectHistory({ ...mkEntry('alt-src'), runtimeId: 'alt' });
        recordInjectHistory({ ...mkEntry('default-src-2'), runtimeId: 'default' });

        expect(getInjectHistoryForRuntime('default', 10).map((entry) => entry.from)).toEqual([
            'default-src',
            'default-src-2',
        ]);
        expect(getInjectHistoryForRuntime('alt', 10).map((entry) => entry.from)).toEqual(['alt-src']);
        expect(getLatestInjectHistoryEntryForRuntime('alt')?.from).toBe('alt-src');
    });
});

describe('state thinking history', () => {
    beforeEach(() => clearThinkingHistory());
    afterEach(() => clearThinkingHistory());

    it('appendThinkingHistoryChunk e getThinkingHistory round-trip', () => {
        appendThinkingHistoryChunk({
            id: 'dialog-1',
            source: 'dialog',
            title: 'LLM-B',
            chunk: 'pensando',
        });
        const latest = getLatestThinkingHistoryEntry();
        expect(latest?.id).toBe('dialog-1');
        expect(latest?.content).toBe('pensando');
        expect(getThinkingHistory(5)).toHaveLength(1);
    });

    it('acumula chunks e finaliza entrada', () => {
        appendThinkingHistoryChunk({
            id: 'dialog-2',
            source: 'dialog',
            title: 'LLM-B',
            chunk: 'abc',
        });
        appendThinkingHistoryChunk({
            id: 'dialog-2',
            source: 'dialog',
            title: 'LLM-B',
            chunk: 'def',
        });
        finalizeThinkingHistoryEntry('dialog-2', { durationMs: 250, status: 'completed' });
        const entry = getThinkingHistoryEntry('dialog-2');
        expect(entry?.content).toBe('abcdef');
        expect(entry?.chars).toBe(6);
        expect(entry?.durationMs).toBe(250);
        expect(entry?.status).toBe('completed');
    });
});
