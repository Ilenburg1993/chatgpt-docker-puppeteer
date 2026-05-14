// @ts-check

import { describe, expect, it } from 'vitest';

import { buildSimpleTextDiff, computeTextPatch } from '../../../../src/copilot/infra/io/patch/index.js';

describe('infra/io/patch', () => {
    it('calcula patch textual com substituição única', () => {
        const patch = computeTextPatch('const x = 1;\n', {
            oldString: 'const x = 1;',
            newString: 'const x = 2;',
        });

        expect(patch).toMatchObject({
            updated: 'const x = 2;\n',
            occurrences: 1,
            replacedOccurrences: 1,
        });
        expect(patch.bytesWritten).toBe(Buffer.byteLength('const x = 2;\n', 'utf8'));
    });

    it('rejeita substituição ambígua sem replaceAll', () => {
        expect(() =>
            computeTextPatch('same same', {
                oldString: 'same',
                newString: 'other',
            }),
        ).toThrow('2 vezes');
    });

    it('gera diff simples com contexto', () => {
        const result = buildSimpleTextDiff('a\nb\nc', 'a\nB\nc', { contextLines: 1 });

        expect(result.contextLines).toBe(1);
        expect(result.diff).toContain('-b');
        expect(result.diff).toContain('+B');
    });
});
