// @ts-check

import { describe, expect, it } from 'vitest';

import {
    clearFileCache,
    detectLang,
    embedMultiple,
    extractAtReferences,
    getFileCacheStats,
} from '../../../src/copilot/presentation/runtime-file-context.js';

describe('presentation/runtime-file-context.js', () => {
    it('expõe helpers compartilhadas de file-context', () => {
        expect(detectLang('foo.ts')).toBe('ts');
        expect(typeof getFileCacheStats).toBe('function');
        expect(typeof clearFileCache).toBe('function');
    });

    it('extrai @refs e embute blocos em ordem', () => {
        const refs = extractAtReferences('ver @src/a.js e @src/b.ts');
        expect(refs.paths).toEqual(['src/a.js', 'src/b.ts']);

        const embedded = embedMultiple(
            [
                { path: 'a.js', content: 'a', size: 1, lang: 'js' },
                { path: 'b.ts', content: 'b', size: 1, lang: 'ts' },
            ],
            'msg',
        );
        expect(embedded).toContain('a.js');
        expect(embedded).toContain('b.ts');
        expect(embedded.endsWith('msg')).toBe(true);
    });
});
