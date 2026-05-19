// @ts-check

import { describe, expect, it, vi } from 'vitest';

import { normalizeMessageOptions } from '#copilot/sdk';
import { sendSession, sendSessionAndWait } from '#copilot/sdk/session-runtime';

/**
 * @param {Partial<import('@github/copilot-sdk').CopilotSession>} [overrides]
 * @returns {import('@github/copilot-sdk').CopilotSession}
 */
function fakeSession(overrides = {}) {
    return /** @type {import('@github/copilot-sdk').CopilotSession} */ (
        /** @type {unknown} */ ({
            sessionId: 'sess-message-options',
            send: vi.fn(async () => 'msg-1'),
            sendAndWait: vi.fn(async () => ({ type: 'assistant.message', data: { content: 'ok' } })),
            ...overrides,
        })
    );
}

describe('sdk/session/message-options', () => {
    it('normaliza MessageOptions compatível com SDK v24 incluindo headers por turno', () => {
        expect(
            normalizeMessageOptions({
                prompt: 'Oi',
                mode: 'immediate',
                requestHeaders: { 'X-Test': '1' },
                attachments: [
                    { type: 'file', path: 'src/index.js' },
                    {
                        type: 'selection',
                        filePath: 'src/index.js',
                        displayName: 'index.js',
                        selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 3 } },
                        text: '',
                    },
                ],
            }),
        ).toEqual({
            prompt: 'Oi',
            mode: 'immediate',
            requestHeaders: { 'X-Test': '1' },
            attachments: [
                { type: 'file', path: 'src/index.js' },
                {
                    type: 'selection',
                    filePath: 'src/index.js',
                    displayName: 'index.js',
                    selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 3 } },
                    text: '',
                },
            ],
        });
    });

    it('gera feedback claro para campos desconhecidos e tipos inválidos', () => {
        expect(() => normalizeMessageOptions({ prompt: 'Oi', bogus: true })).toThrow('campo(s) desconhecido(s): bogus');
        expect(() => normalizeMessageOptions({ prompt: 'Oi', requestHeaders: { bad: 1 } })).toThrow(
            'requestHeaders.bad deve ser string',
        );
        expect(() => normalizeMessageOptions({ prompt: 'Oi', attachments: [{ type: 'file' }] })).toThrow(
            'attachments[0].path',
        );
    });

    it('sendSession e sendSessionAndWait enviam payload normalizado ao SDK', async () => {
        const session = fakeSession();

        await expect(
            sendSession(session, {
                prompt: 'Enviar',
                requestHeaders: { 'X-Trace': 'abc' },
                attachments: [{ type: 'directory', path: 'src' }],
            }),
        ).resolves.toBe('msg-1');

        expect(session.send).toHaveBeenCalledWith({
            prompt: 'Enviar',
            requestHeaders: { 'X-Trace': 'abc' },
            attachments: [{ type: 'directory', path: 'src' }],
        });

        await expect(sendSessionAndWait(session, { prompt: 'Esperar', mode: 'enqueue' }, 1000)).resolves.toEqual({
            type: 'assistant.message',
            data: { content: 'ok' },
        });
        expect(session.sendAndWait).toHaveBeenCalledWith({ prompt: 'Esperar', mode: 'enqueue' }, 1000);
    });
});
