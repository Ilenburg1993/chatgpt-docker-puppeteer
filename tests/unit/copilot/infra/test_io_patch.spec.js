// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildSimpleTextDiff,
    buildSimpleTextDiffAroundLineRange,
    computeTextPatch,
} from '../../../../src/copilot/infra/filesystem/patch/index.js';

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

    it('rejeita substituição ambígua e devolve linhas suficientes para retry sem nova leitura', () => {
        try {
            computeTextPatch('same\nmiddle\nsame\n', {
                oldString: 'same',
                newString: 'other',
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_AMBIGUOUS_MATCH',
                details: {
                    occurrenceCount: 2,
                    firstMatchLine: 1,
                    lastMatchLine: 3,
                    occurrenceLines: [1, 3],
                    occurrenceLinesTruncated: false,
                },
            });
        }
    });

    it('devolve recovery evidence bounded quando old_string está stale', () => {
        const content = '\ufeffheader\r\nconst valueName = 2;\r\nfooter\r\n';
        try {
            computeTextPatch(content, {
                oldString: 'const  valueName = 2;\n',
                newString: 'const valueName = 3;',
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_NOT_FOUND',
                details: {
                    newlineStyle: 'crlf',
                    utf8Bom: true,
                    recoveryScan: 'full-bounded',
                    desiredTextPresent: false,
                    convergenceCandidate: false,
                    lineEndingNormalizedOccurrenceCount: 0,
                    whitespaceNormalizedOccurrenceCount: 1,
                    candidateLines: [2],
                },
            });
        }
    });

    it('devolve anchor CRLF literal único para retry exato sem reread', () => {
        const content = 'header\r\nconst valueName = 2;\r\nfooter\r\n';
        try {
            computeTextPatch(content, {
                oldString: 'const valueName = 2;\n',
                newString: 'const valueName = 3;\n',
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_NOT_FOUND',
                details: {
                    newlineStyle: 'crlf',
                    recoveryExactAnchor: true,
                    recoveryRereadRequired: false,
                    recoveryReason: 'line-ending-normalization',
                    recoveryOldString: 'const valueName = 2;\r\n',
                    recoveryOccurrenceLine: 2,
                },
            });
        }
    });

    it('identifica escaping literal de aspas como divergência diagnóstica sem relaxar o exact match', () => {
        const content = 'return fail(`Access to protected real path segment "${blockedHit}" is blocked`);\n';
        try {
            computeTextPatch(content, {
                oldString: 'return fail(`Access to protected real path segment \\"${blockedHit}\\" is blocked`);',
                newString: 'replacement',
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_NOT_FOUND',
                details: {
                    quoteEscapeNormalizedOccurrenceCount: 1,
                    quoteEscapeNormalizedOccurrenceCountExact: true,
                    recoveryExactAnchor: true,
                    recoveryRereadRequired: false,
                    recoveryReason: 'quote-escape-normalization',
                    recoveryOldString:
                        'return fail(`Access to protected real path segment "${blockedHit}" is blocked`);',
                    recoveryOccurrenceLine: 1,
                },
            });
        }
    });

    it('reconhece desired text já presente como candidato de convergência sem mutar', () => {
        const content = 'header\nconst valueName = 2;\nfooter\n';
        try {
            computeTextPatch(content, {
                oldString: 'const valueName = 1;',
                newString: 'const valueName = 2;',
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_NOT_FOUND',
                details: {
                    desiredTextPresent: true,
                    convergenceCandidate: true,
                    desiredOccurrenceCount: 1,
                    desiredOccurrenceCountExact: true,
                    desiredOccurrenceLines: [2],
                },
            });
        }
    });

    it('interrompe a contagem quando expectedOccurrences já divergiu', () => {
        try {
            computeTextPatch('same '.repeat(10_000), {
                oldString: 'same',
                newString: 'other',
                expectedOccurrences: 1,
            });
            throw new Error('patch deveria falhar');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'ERR_PATCH_EXPECTED_OCCURRENCES',
                details: {
                    expectedOccurrences: 1,
                    occurrenceCount: 2,
                    occurrenceCountExact: false,
                },
            });
            expect(/** @type {Error} */ (error).message).toContain('pelo menos 2');
        }
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

    it('calcula linhas físicas CR, CRLF e LF sem materializar prefixos', () => {
        const patch = computeTextPatch('a\rb\r\nc\nb', {
            oldString: 'b',
            newString: 'B\nextra',
            replaceAll: true,
            expectedOccurrences: 2,
        });

        expect(patch.updated).toBe('a\rB\nextra\r\nc\nB\nextra');
        expect(patch.firstMatchLine).toBe(2);
        expect(patch.lastMatchLine).toBe(4);
        expect(patch.lineDelta).toBe(2);
        expect(patch.replacedOccurrences).toBe(2);
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

    it('faz merge de hunks adjacentes com contexto e evita duplicação de cabeçalhos', () => {
        const before = ['L1', 'A', 'L3', 'B', 'L5', 'L6'].join('\n');
        const after = ['L1', 'A*', 'L3', 'B*', 'L5', 'L6'].join('\n');

        const result = buildSimpleTextDiff(before, after, { contextLines: 1 });
        const headerCount = (result.diff.match(/^@@/gm) ?? []).length;

        expect(headerCount).toBe(1);
        expect(result.diff).toContain('-A');
        expect(result.diff).toContain('+A*');
        expect(result.diff).toContain('-B');
        expect(result.diff).toContain('+B*');
    });

    it('não duplica linhas de contexto quando mudanças estão próximas', () => {
        const before = ['x0', 'x1', 'x2', 'x3', 'x4'].join('\n');
        const after = ['x0', 'X1', 'x2', 'X3', 'x4'].join('\n');

        const result = buildSimpleTextDiff(before, after, { contextLines: 1 });
        const lines = result.diff.split('\n');
        const contextX2Count = lines.filter((line) => line === ' x2').length;

        expect(contextX2Count).toBe(1);
    });

    it('gera diff por linhas físicas sem reter arrays completos dos dois textos', () => {
        const result = buildSimpleTextDiff('one\r\ntwo\rthree\nfour', 'one\r\nTWO\rthree\nfour', {
            contextLines: 1,
        });

        expect(result.diff).toBe('@@ 1,3 @@\n one\n-two\n+TWO\n three');
    });

    it('usa linhas físicas compartilhadas no diff otimizado por range', () => {
        const result = buildSimpleTextDiffAroundLineRange('one\r\ntwo\rthree', 'one\r\nTWO\rthree', {
            firstMatchLine: 2,
            lastMatchLine: 2,
            lineDelta: 0,
            replacedOccurrences: 1,
            contextLines: 1,
        });

        expect(result.rangeOptimized).toBe(true);
        expect(result.diff).toBe('@@ 1,3 @@\n one\n-two\n+TWO\n three');
    });
});
