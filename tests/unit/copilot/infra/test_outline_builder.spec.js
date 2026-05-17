// @ts-check
/**
 * tests/unit/copilot/infra/test_outline_builder.spec.js
 *
 * Testes unitários para src/copilot/infra/parse/outline-builder.js
 * Cobre: buildOutline — seções exports, re-exports, internal, imports e parseError.
 */

import { describe, expect, it } from 'vitest';
import { buildOutline } from '../../../../src/copilot/infra/parse/outline-builder.js';

// Helpers
/**
 * @param {Partial<Parameters<typeof buildOutline>[0]>} overrides
 * @returns {Parameters<typeof buildOutline>[0]}
 */
function makeInput(overrides = {}) {
    return {
        symbols: [],
        imports: [],
        exports: [],
        parseError: null,
        ...overrides,
    };
}

describe('buildOutline — estrutura básica', () => {
    it('retorna array vazio para entrada vazia', () => {
        const lines = buildOutline(makeInput());
        expect(Array.isArray(lines)).toBe(true);
        expect(lines).toHaveLength(0);
    });

    it('retorna parseError quando presente', () => {
        const lines = buildOutline(makeInput({ parseError: 'SyntaxError on line 5' }));
        expect(lines.some((l) => l.includes('SyntaxError on line 5'))).toBe(true);
    });
});

describe('buildOutline — seção Exports', () => {
    it('exibe símbolos exportados', () => {
        const lines = buildOutline(
            makeInput({
                symbols: [
                    { kind: 'function', name: 'myFunc', exported: true, line: 3 },
                    { kind: 'variable', name: 'MY_CONST', exported: true, line: 10 },
                ],
            }),
        );
        expect(lines[0]).toMatch(/── Exports \(2\)/);
        expect(lines.some((l) => l.includes('[function] myFunc (L3)'))).toBe(true);
        expect(lines.some((l) => l.includes('[variable] MY_CONST (L10)'))).toBe(true);
    });

    it('não exibe seção Exports quando vazia', () => {
        const lines = buildOutline(makeInput({ symbols: [{ kind: 'function', name: 'local', exported: false, line: 1 }] }));
        expect(lines.some((l) => l.includes('── Exports'))).toBe(false);
    });
});

describe('buildOutline — seção Re-exports (GAP-4)', () => {
    it('exibe re-exports filtrados de exports', () => {
        const lines = buildOutline(
            makeInput({
                exports: ['namedFn', '* from ./errors.js', '* from ./schemas.js', 'AnotherExport'],
            }),
        );
        const reSection = lines.find((l) => l.includes('── Re-exports'));
        expect(reSection).toBeTruthy();
        expect(reSection).toMatch(/\(2\)/);
        expect(lines.some((l) => l.includes('export * from ./errors.js'))).toBe(true);
        expect(lines.some((l) => l.includes('export * from ./schemas.js'))).toBe(true);
    });

    it('não exibe seção Re-exports quando não há export *', () => {
        const lines = buildOutline(makeInput({ exports: ['namedFn', 'AnotherExport'] }));
        expect(lines.some((l) => l.includes('── Re-exports'))).toBe(false);
    });

    it('funciona corretamente quando exports é undefined', () => {
        const input = makeInput();
        // @ts-ignore — testando omissão intencional
        delete input.exports;
        expect(() => buildOutline(input)).not.toThrow();
        expect(buildOutline(input).some((l) => l.includes('── Re-exports'))).toBe(false);
    });
});

describe('buildOutline — seção Internal', () => {
    it('exibe símbolos não exportados quando ≤ 20', () => {
        const symbols = Array.from({ length: 3 }, (_, i) => ({
            kind: 'function',
            name: `localFn${i}`,
            exported: false,
            line: i + 1,
        }));
        const lines = buildOutline(makeInput({ symbols }));
        expect(lines.some((l) => l.includes('── Internal (3)'))).toBe(true);
    });

    it('omite seção Internal quando > 20 símbolos não exportados', () => {
        const symbols = Array.from({ length: 21 }, (_, i) => ({
            kind: 'variable',
            name: `_v${i}`,
            exported: false,
            line: i + 1,
        }));
        const lines = buildOutline(makeInput({ symbols }));
        expect(lines.some((l) => l.includes('── Internal'))).toBe(false);
    });
});

describe('buildOutline — seção Imports', () => {
    it('exibe imports com specifiers', () => {
        const lines = buildOutline(
            makeInput({
                imports: [
                    { source: '#copilot/core', specifiers: ['toError', 'withIoMeta'] },
                    { source: './utils.js', specifiers: [] },
                ],
            }),
        );
        expect(lines.some((l) => l.includes('── Imports (2)'))).toBe(true);
        expect(lines.some((l) => l.includes("{ toError, withIoMeta } from '#copilot/core'"))).toBe(true);
        expect(lines.some((l) => l.includes("* from './utils.js'"))).toBe(true);
    });

    it('trunca specifiers ao limite de 4', () => {
        const lines = buildOutline(
            makeInput({
                imports: [{ source: './big.js', specifiers: ['a', 'b', 'c', 'd', 'e', 'f'] }],
            }),
        );
        const importLine = lines.find((l) => l.includes('big.js'));
        expect(importLine).toContain('...');
    });
});
