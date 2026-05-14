// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildGrepArgs,
    buildSymbolPattern,
    canUseIndexSearch,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    kindToGlobs,
} from '../../../../src/copilot/infra/io/search/index.js';

describe('infra/io/search', () => {
    it('detecta quando a busca pode usar índice FTS', () => {
        expect(canUseIndexSearch({ pattern: 'alpha' })).toBe(true);
        expect(canUseIndexSearch({ pattern: 'alpha', isRegex: true })).toBe(false);
        expect(canUseIndexSearch({ pattern: 'alpha', includePattern: '*.js' })).toBe(false);
    });

    it('formata linhas do índice removendo marcação de snippet', () => {
        expect(formatIndexSearchRows([{ filePath: '/x/a.md', relativePath: 'a.md', snippet: '[alpha] token' }])).toBe(
            'a.md: alpha token',
        );
    });

    it('monta argumentos de grep fallback', () => {
        expect(buildGrepArgs({ pattern: 'alpha', resolved: 'src', includePattern: '*.js' })).toEqual(
            expect.arrayContaining(['-R', '-n', '-F', '-i', '--exclude-dir=.git', '--include=*.js', 'alpha', 'src']),
        );
    });

    it('monta padrões e globs de busca simbólica', () => {
        expect(buildSymbolPattern('runTask', 'function')).toContain('function\\s+runTask\\b');
        expect(kindToGlobs('type')).toContain('*.d.ts');
        expect(formatIndexSymbolRows([
            {
                filePath: '/x/a.ts',
                relativePath: 'a.ts',
                symbolName: 'runTask',
                symbolKind: 'function',
                exported: 1,
                line: 3,
                docComment: 'Runs task',
            },
        ])).toContain('a.ts:3: function runTask export');
    });
});
