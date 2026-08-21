// @ts-check

import { describe, expect, it } from 'vitest';

import { makeBytesKey, makeTextKey, normalizeIoCacheKey } from '#copilot/infra/internal/cache';

describe('infra/cache/memory keys', () => {
    it('normaliza paths e cria chaves estáveis para bytes/texto', () => {
        const normalized = normalizeIoCacheKey('src/foo/../bar.js');

        expect(normalized).toContain('src');
        expect(makeBytesKey(normalized)).toBe(`${normalized}::read:bytes`);
        expect(makeTextKey(normalized, undefined, undefined)).toBe(`${normalized}::read:text`);
        expect(makeTextKey(normalized, 2, 4)).toBe(`${normalized}::read:text:2:4`);
    });
});
