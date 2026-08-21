// @ts-check

import { describe, expect, it } from 'vitest';

import {
    classifyContentKind,
    countLines,
    flattenScanEntries,
    iterateLineChunks,
    makeLineChunks,
    normalizeIndexExtensions,
    normalizeIndexMaxResults,
    normalizeIndexPath,
    normalizeRelativePath,
    sanitizeFtsQuery,
    shouldIndexFile,
} from '../../../../src/copilot/infra/indexing/registry/sqlite/index.js';
import { countPhysicalTextLines, lineNumberAtTextOffset } from '../../../../src/copilot/infra/platform/text-lines.js';

describe('infra/indexing/sqlite', () => {
    it('normaliza paths, extensões e filtros de arquivo', () => {
        const root = normalizeIndexPath('/workspaces/chatgpt-docker-puppeteer/src');
        const file = normalizeIndexPath('/workspaces/chatgpt-docker-puppeteer/src/copilot/index.js');

        expect(root).toContain('/workspaces/chatgpt-docker-puppeteer/src');
        expect(normalizeRelativePath(root, file)).toBe('copilot/index.js');
        expect(normalizeIndexExtensions(['js', '.MD'])).toEqual(['.js', '.md']);
        expect(shouldIndexFile(file, ['.js'])).toBe(true);
        expect(shouldIndexFile(file, ['.md'])).toBe(false);
    });

    it('classifica conteúdo e monta chunks estáveis', () => {
        expect(classifyContentKind('/tmp/app.ts')).toBe('typescript');
        expect(classifyContentKind('/tmp/README.md')).toBe('markdown');
        expect(classifyContentKind('/tmp/data.unknown')).toBe('text');
        expect(countLines('a\nb\nc')).toBe(3);
        expect(countLines('a\rb\r\nc\n')).toBe(4);
        expect(countPhysicalTextLines('')).toBe(1);
        expect(lineNumberAtTextOffset('a\r\nb', 2)).toBe(1);
        expect(lineNumberAtTextOffset('a\r\nb', 3)).toBe(2);

        const chunks = makeLineChunks('a\nb\nc\nd', 2);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({ index: 0, startLine: 1, endLine: 2, content: 'a\nb' });
        expect(chunks[1]?.hash).toMatch(/^[a-f0-9]{64}$/u);
        expect([...iterateLineChunks('a\rb\r\nc\n', 2)]).toMatchObject([
            { index: 0, startLine: 1, endLine: 2, content: 'a\nb' },
            { index: 1, startLine: 3, endLine: 4, content: 'c\n' },
        ]);
    });

    it('normaliza query FTS e maxResults', () => {
        expect(sanitizeFtsQuery('alpha beta!')).toBe('"alpha" "beta"');
        expect(sanitizeFtsQuery('!!!')).toBe('""');
        expect(normalizeIndexMaxResults(1)).toBe(1);
        expect(normalizeIndexMaxResults(999_999)).toBeLessThanOrEqual(500);
    });

    it('achata entradas recursivas de scan', () => {
        const entries = [
            {
                name: 'src',
                absolutePath: '/tmp/src',
                relativePath: 'src',
                type: 'directory',
                children: [
                    {
                        name: 'a.js',
                        absolutePath: '/tmp/src/a.js',
                        relativePath: 'src/a.js',
                        type: 'file',
                        size: 1,
                    },
                ],
            },
        ];

        expect(flattenScanEntries(/** @type {any} */ (entries))).toEqual([
            expect.objectContaining({ absolutePath: '/tmp/src/a.js', type: 'file' }),
        ]);
    });
});
