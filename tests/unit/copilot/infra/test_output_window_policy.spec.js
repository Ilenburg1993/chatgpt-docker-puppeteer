// @ts-check

import { describe, expect, it } from 'vitest';

import {
    limitTextLines,
    normalizeCursorOffset,
    windowItems,
    windowTextLines,
} from '../../../../src/copilot/infra/policy/output-window.js';

describe('infra/policy/output-window', () => {
    it('normaliza cursor numérico defensivamente por padrão', () => {
        expect(normalizeCursorOffset(undefined)).toBe(0);
        expect(normalizeCursorOffset('2')).toBe(2);
        expect(normalizeCursorOffset('-1')).toBe(0);
        expect(normalizeCursorOffset('abc')).toBe(0);
    });

    it('rejeita cursor inválido em modo estrito', () => {
        expect(() => normalizeCursorOffset('abc', { strict: true })).toThrow('Cursor de paginação inválido');
        expect(() => windowTextLines('a\nb', { maxResults: 1, cursor: 'abc', strictCursor: true })).toThrow(
            'Cursor de paginação inválido',
        );
        expect(() => windowItems(['a', 'b'], { maxResults: 1, cursor: '-1', strictCursor: true })).toThrow(
            'Cursor de paginação inválido',
        );
    });

    it('pagina linhas de texto com nextCursor estável', () => {
        const first = windowTextLines('a\nb\nc\n', { maxResults: 2 });
        const second = windowTextLines('a\nb\nc\n', { maxResults: 2, cursor: first.nextCursor });

        expect(first).toMatchObject({ text: 'a\nb', truncated: true, nextCursor: '2', cursorOffset: 0 });
        expect(second).toMatchObject({ text: 'c', truncated: false, nextCursor: null, cursorOffset: 2 });
    });

    it('preserva semântica LF, newline terminal e cursores além do fim sem arrays proporcionais', () => {
        expect(limitTextLines('a\r\nb\r\n', 1)).toEqual({
            text: 'a\r',
            truncated: true,
            originalLineCount: 2,
        });
        expect(limitTextLines('a\nb\n', null)).toEqual({
            text: 'a\nb\n',
            truncated: false,
            originalLineCount: 2,
        });
        expect(windowTextLines('a\nb\n', { maxResults: null })).toMatchObject({
            text: 'a\nb',
            originalLineCount: 2,
        });
        expect(windowTextLines('a\nb', { maxResults: 2, cursor: 9 })).toMatchObject({
            text: '',
            truncated: false,
            originalLineCount: 2,
            cursorOffset: 9,
        });
        expect(windowTextLines('', { maxResults: 2 })).toMatchObject({
            text: '',
            originalLineCount: 0,
            nextCursor: null,
        });
    });

    it('pagina arrays mantendo total e offset', () => {
        const page = windowItems(['a', 'b', 'c', 'd'], { maxResults: 2, cursor: '1' });

        expect(page).toEqual({
            items: ['b', 'c'],
            truncated: true,
            totalItems: 4,
            cursorOffset: 1,
            nextCursor: '3',
        });
    });
});
