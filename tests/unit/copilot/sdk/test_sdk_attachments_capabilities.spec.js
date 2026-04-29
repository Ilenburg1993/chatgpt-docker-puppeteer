// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    blobAttachment,
    createBlobAttachment,
    createFileAttachment,
    directoryAttachment,
    fileAttachment,
    getSessionCapabilities,
    normalizeAttachments,
    selectionAttachment,
    supportsElicitation,
    waitForElicitationCapability,
    watchCapabilities,
} from '../../../../src/copilot/sdk/index.js';

function fakeSession(capabilities = {}) {
    /** @type {Record<string, ((event: unknown) => void)[]>} */
    const handlers = {};
    return {
        sessionId: 's1',
        capabilities,
        on: vi.fn((eventType, handler) => {
            handlers[eventType] = handlers[eventType] ?? [];
            handlers[eventType].push(handler);
            return () => {
                handlers[eventType] = (handlers[eventType] ?? []).filter((item) => item !== handler);
            };
        }),
        emit(eventType, event) {
            for (const handler of handlers[eventType] ?? []) handler(event);
        },
    };
}

describe('sdk attachment helpers', () => {
    it('cria attachments compatíveis com MessageOptions', () => {
        expect(fileAttachment('/tmp/a.js', { displayName: 'a.js' })).toEqual({
            type: 'file',
            path: '/tmp/a.js',
            displayName: 'a.js',
        });
        expect(directoryAttachment('/tmp/project')).toEqual({ type: 'directory', path: '/tmp/project' });
        expect(blobAttachment('YWJj', 'image/png')).toEqual({ type: 'blob', data: 'YWJj', mimeType: 'image/png' });
        expect(selectionAttachment('/tmp/a.js', { displayName: 'a.js', text: 'const a = 1;' })).toMatchObject({
            type: 'selection',
            filePath: '/tmp/a.js',
            displayName: 'a.js',
        });
        expect(createFileAttachment('/tmp/b.js', { displayName: 'b.js' })).toEqual({
            type: 'file',
            path: '/tmp/b.js',
            displayName: 'b.js',
        });
        expect(createBlobAttachment('ZGF0YQ==', 'text/plain')).toEqual({
            type: 'blob',
            data: 'ZGF0YQ==',
            mimeType: 'text/plain',
        });
    });

    it('normaliza attachment único, lista e vazio', () => {
        const att = fileAttachment('/tmp/a.js');
        expect(normalizeAttachments(att)).toEqual([att]);
        expect(normalizeAttachments([att])).toEqual([att]);
        expect(normalizeAttachments(null)).toEqual([]);
    });

    it('valida strings obrigatórias', () => {
        expect(() => fileAttachment('')).toThrow(TypeError);
        expect(() => blobAttachment('abc', '')).toThrow(TypeError);
    });
});

describe('sdk capability helpers', () => {
    it('lê snapshot e detecta elicitation', () => {
        const session = fakeSession({ ui: { elicitation: true } });
        expect(getSessionCapabilities(/** @type {any} */ (session))).toEqual({ ui: { elicitation: true } });
        expect(supportsElicitation(/** @type {any} */ (session))).toBe(true);
    });

    it('watchCapabilities observa capabilities.changed', () => {
        const session = fakeSession({ ui: { elicitation: false } });
        const spy = vi.fn();
        const unsubscribe = watchCapabilities(/** @type {any} */ (session), spy);

        session.capabilities = { ui: { elicitation: true } };
        session.emit('capabilities.changed', { type: 'capabilities.changed', data: { ui: { elicitation: true } } });

        expect(spy).toHaveBeenCalledWith(
            { ui: { elicitation: true } },
            expect.objectContaining({ type: 'capabilities.changed' }),
        );
        unsubscribe();
    });

    it('waitForElicitationCapability resolve imediatamente quando já disponível', async () => {
        const session = fakeSession({ ui: { elicitation: true } });
        await expect(waitForElicitationCapability(/** @type {any} */ (session))).resolves.toEqual({
            ui: { elicitation: true },
        });
    });

    it('waitForElicitationCapability aguarda evento de capability', async () => {
        const session = fakeSession({ ui: { elicitation: false } });
        const promise = waitForElicitationCapability(/** @type {any} */ (session), { timeoutMs: 1000 });
        session.capabilities = { ui: { elicitation: true } };
        session.emit('capabilities.changed', { type: 'capabilities.changed', data: { ui: { elicitation: true } } });
        await expect(promise).resolves.toEqual({ ui: { elicitation: true } });
    });
});
