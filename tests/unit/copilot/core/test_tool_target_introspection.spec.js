// @ts-check

import { describe, expect, it } from 'vitest';

import { introspectToolTargets } from '../../../../src/copilot/core/tool-target-introspection.js';

describe('core/tool-target-introspection', () => {
    it('usa returnedLines do resultado como range efetivo de leitura', () => {
        const meta = introspectToolTargets({
            args: {
                path: 'src/copilot/tools/file/read-tools.js',
                startLine: 10,
            },
            result: {
                success: true,
                path: 'src/copilot/tools/file/read-tools.js',
                returnedLines: { start: 10, end: 18 },
            },
        });

        expect(meta.fileTargets).toContain('src/copilot/tools/file/read-tools.js');
        expect(meta.lineRange).toEqual({ start: 10, end: 18 });
        expect(meta.primaryTarget).toBe('src/copilot/tools/file/read-tools.js');
    });

    it('captura alvos de diff e searchPath vindos do resultado sem depender só dos args', () => {
        const meta = introspectToolTargets({
            args: { name: 'buildTool' },
            result: {
                path_a: 'src/copilot/tools/file/read-tools.js',
                path_b: 'src/copilot/tools/file/write-tools.js',
                searchPath: 'src/copilot/tools/file',
            },
        });

        expect(meta.fileTargets).toContain('src/copilot/tools/file/read-tools.js');
        expect(meta.fileTargets).toContain('src/copilot/tools/file/write-tools.js');
        expect(meta.fileTargets).toContain('src/copilot/tools/file');
    });

    it('captura source e destination usados por copy_file e move_file', () => {
        const meta = introspectToolTargets({
            args: {
                source: 'data/live/source.txt',
                destination: 'data/live/destination.txt',
            },
        });

        expect(meta.fileTargets).toEqual(['data/live/source.txt', 'data/live/destination.txt']);
        expect(meta.primaryTarget).toBe('data/live/source.txt');
    });

    it('captura comando seguro, filtros e contagem sem vazar segredo', () => {
        const meta = introspectToolTargets({
            args: {
                command: 'curl -H "Authorization: Bearer sk-super-secret-token-value" https://example.test',
                category: 'code',
                search: 'terminal',
            },
            result: {
                success: true,
                count: 12,
                exitCode: 0,
            },
        });

        expect(meta.commands).toHaveLength(1);
        expect(meta.commands[0]).toContain('Bearer [redacted]');
        expect(meta.commands[0]).not.toContain('sk-super-secret-token-value');
        expect(meta.filters).toContain('category: code');
        expect(meta.searchTerms).toContain('terminal');
        expect(meta.resultCount).toBe(12);
        expect(meta.resultSummary).toBe('sucesso · saída 0 · 12 resultados');
    });
});
