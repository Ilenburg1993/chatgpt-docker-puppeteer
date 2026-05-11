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
});
