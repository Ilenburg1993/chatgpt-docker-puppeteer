// @ts-check

import { describe, expect, it } from 'vitest';

import {
    normalizeCursorOffset,
    windowItems,
    windowTextLines,
} from '../../../../src/copilot/infra/policy/output-window.js';

describe('infra/policy/output-window', () => {
    it('normaliza cursor numérico defensivamente', () => {
        expect(normalizeCursorOffset(undefined)).toBe(0);
        expect(normalizeCursorOffset('2')).toBe(2);
        expect(normalizeCursorOffset('-1')).toBe(0);
        expect(normalizeCursorOffset('abc')).toBe(0);
    });

    it('pagina linhas de texto com nextCursor estável', () => {
        const first = windowTextLines('a\nb\nc\n', { maxResults: 2 });
        const second = windowTextLines('a\nb\nc\n', { maxResults: 2, cursor: first.nextCursor });

        expect(first).toMatchObject({ text: 'a\nb', truncated: true, nextCursor: '2', cursorOffset: 0 });
        expect(second).toMatchObject({ text: 'c', truncated: false, nextCursor: null, cursorOffset: 2 });
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
