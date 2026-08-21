// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildGrepArgs,
    buildSymbolPattern,
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    formatLiteralIndexSearchRows,
    kindToGlobs,
    normalizeSearchWindow,
    paginateSearchItems,
    paginateSearchText,
} from '#copilot/infra/internal/indexing/search';

describe('infra/io/search', () => {
    it('detecta quando a busca pode usar índice FTS', () => {
        expect(canUseIndexSearch({ pattern: 'alpha' })).toBe(true);
        expect(canUseIndexSearch({ pattern: 'alpha', isRegex: true })).toBe(false);
        expect(canUseIndexSearch({ pattern: 'alpha', includePattern: '*.js' })).toBe(true);
    });

    it('formata linhas do índice com highlight markdown', () => {
        expect(formatIndexSearchRows([{ filePath: '/x/a.md', relativePath: 'a.md', snippet: '[alpha] token' }])).toBe(
            'a.md: **alpha** token',
        );
    });

    it('expande chunks de busca literal em linhas exatas compatíveis com grep', () => {
        const rows = [
            {
                filePath: '/x/a.js',
                relativePath: 'a.js',
                startLine: 201,
                content: 'const first = 1;\nconst needleValue = 2;\nconst NEEDLEVALUE = 3;',
            },
        ];
        expect(formatLiteralIndexSearchRows(rows, 'needleValue', true)).toBe('a.js:202:const needleValue = 2;');
        expect(formatLiteralIndexSearchRows(rows, 'needlevalue', false)).toBe(
            'a.js:202:const needleValue = 2;\na.js:203:const NEEDLEVALUE = 3;',
        );
    });

    it('filtra índice por diretório simples em includePattern e excludePattern', () => {
        const rows = [
            { filePath: '/ws/src/copilot/a.js', relativePath: 'src/copilot/a.js' },
            { filePath: '/ws/src/server/b.js', relativePath: 'src/server/b.js' },
            { filePath: '/ws/node_modules/pkg/c.js', relativePath: 'node_modules/pkg/c.js' },
        ];

        expect(filterIndexRowsByGlob(rows, 'src/copilot', undefined).map((row) => row.relativePath)).toEqual([
            'src/copilot/a.js',
        ]);
        expect(filterIndexRowsByGlob(rows, 'src', 'node_modules').map((row) => row.relativePath)).toEqual([
            'src/copilot/a.js',
            'src/server/b.js',
        ]);
    });

    it('filtra índice com a mesma política de braces usada pelo scanner', () => {
        const rows = [
            { filePath: '/ws/src/a.js', relativePath: 'src/a.js' },
            { filePath: '/ws/src/b.ts', relativePath: 'src/b.ts' },
            { filePath: '/ws/src/c.md', relativePath: 'src/c.md' },
        ];

        expect(filterIndexRowsByGlob(rows, 'src/*.{js,ts}', undefined).map((row) => row.relativePath)).toEqual([
            'src/a.js',
            'src/b.ts',
        ]);
    });

    it('monta argumentos de grep fallback', () => {
        expect(buildGrepArgs({ pattern: 'alpha', resolved: 'src', includePattern: '*.js' })).toEqual(
            expect.arrayContaining(['-R', '-n', '-F', '-i', '--exclude-dir=.git', '--include=*.js', 'alpha', 'src']),
        );
    });

    it('monta padrões e globs de busca simbólica', () => {
        expect(buildSymbolPattern('runTask', 'function')).toContain('function\\s+runTask\\b');
        expect(kindToGlobs('type')).toContain('*.d.ts');
        expect(
            formatIndexSymbolRows([
                {
                    filePath: '/x/a.ts',
                    relativePath: 'a.ts',
                    symbolName: 'runTask',
                    symbolKind: 'function',
                    exported: 1,
                    line: 3,
                    docComment: 'Runs task',
                },
            ]),
        ).toContain('a.ts:3: function runTask export');
    });

    it('normaliza janela de busca e pagina itens com lookahead de comando', () => {
        const window = normalizeSearchWindow({ maxResults: 2, cursor: '1' });

        expect(window).toMatchObject({ maxResults: 2, cursorOffset: 1, commandMaxCount: 4 });
        expect(paginateSearchItems(['a', 'b', 'c', 'd'], window)).toEqual({
            items: ['b', 'c'],
            truncated: true,
            totalItems: 4,
            cursorOffset: 1,
            nextCursor: '3',
        });
    });

    it('pagina saída textual de busca preservando total original', () => {
        const window = normalizeSearchWindow({ maxResults: 1, cursor: 1 });

        expect(paginateSearchText('a\nb\nc\n', window)).toEqual({
            text: 'b',
            truncated: true,
            originalLineCount: 3,
            cursorOffset: 1,
            nextCursor: '2',
        });
    });
});
