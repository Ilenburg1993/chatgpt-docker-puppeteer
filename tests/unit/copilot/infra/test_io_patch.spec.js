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

    it('substitui ocorrência específica com occurrenceIndex', () => {
        const patch = computeTextPatch('same middle same end', {
            oldString: 'same',
            newString: 'other',
            occurrenceIndex: 2,
        });

        expect(patch.updated).toBe('same middle other end');
        expect(patch.occurrences).toBe(2);
        expect(patch.replacedOccurrences).toBe(1);
        expect(patch.occurrenceIndex).toBe(2);
    });

    it('rejeita replaceAll junto com occurrenceIndex', () => {
        expect(() =>
            computeTextPatch('same same', {
                oldString: 'same',
                newString: 'other',
                replaceAll: true,
                occurrenceIndex: 1,
            }),
        ).toThrow('Use replace_all ou occurrence_index');
    });

    it('rejeita no-op salvo quando allowNoop=true', () => {
        expect(() =>
            computeTextPatch('same', {
                oldString: 'same',
                newString: 'same',
            }),
        ).toThrow('Patch sem efeito');

        const patch = computeTextPatch('same', {
            oldString: 'same',
            newString: 'same',
            allowNoop: true,
        });
        expect(patch.noop).toBe(true);
    });

    it('gera diff simples com contexto', () => {
        const result = buildSimpleTextDiff('a\nb\nc', 'a\nB\nc', { contextLines: 1 });

        expect(result.contextLines).toBe(1);
        expect(result.diff).toContain('-b');
        expect(result.diff).toContain('+B');
    });
});
