// @ts-check

import { describe, expect, it } from 'vitest';

import { introspectToolTargets } from '../../../../src/copilot/observability/tool-target-introspection.js';

describe('observability/tool-target-introspection', () => {
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
            toolName: 'copy_file',
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

    it('separa cwd contextual de arquivos afetados e mantém comando como alvo primário', () => {
        const meta = introspectToolTargets({
            args: {
                command: 'git status --short',
                cwd: '/workspaces/chatgpt-docker-puppeteer',
            },
            result: {
                success: true,
                exitCode: 0,
            },
        });

        expect(meta.fileTargets).toEqual([]);
        expect(meta.directoryTargets).toEqual(['/workspaces/chatgpt-docker-puppeteer']);
        expect(meta.commands).toEqual(['git status --short']);
        expect(meta.primaryTarget).toBe('git status --short');
        expect(meta.primaryTargetKind).toBe('command');
    });

    it('não classifica generic source como arquivo sem contexto de tool family', () => {
        const meta = introspectToolTargets({
            toolName: 'event_lookup',
            args: { source: 'model-gateway', destination: 'data/out.txt' },
        });
        expect(meta.fileTargets).not.toContain('model-gateway');
        expect(meta.fileTargets).toContain('data/out.txt');
    });

    it('termina deterministicamente em payloads cíclicos', () => {
        /** @type {Record<string, unknown>} */
        const args = { path: 'src/a.js' };
        args['self'] = args;
        expect(() => introspectToolTargets({ toolName: 'read_file', args })).not.toThrow();
        expect(introspectToolTargets({ toolName: 'read_file', args }).fileTargets).toEqual(['src/a.js']);
    });
});
