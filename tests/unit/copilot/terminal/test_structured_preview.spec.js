// @ts-check

import { describe, expect, it } from 'vitest';

import { renderTerminalStructuredPreview } from '../../../../src/copilot/terminal/capabilities/index.js';

describe('terminal/capabilities/structured-preview', () => {
    it('renderiza JSON em fallback JS estável quando jq é desativado', () => {
        const preview = renderTerminalStructuredPreview('{"b":2,"a":{"c":3}}', {
            format: 'json',
            forceJs: true,
        });

        expect(preview.renderer).toBe('js');
        expect(preview.fallbackReason).toBe('renderer externo desativado');
        expect(preview.queryApplied).toBe(true);
        expect(preview.output).toContain('"b": 2');
        expect(preview.output).toContain('"a": {');
    });

    it('renderiza YAML em fallback JS via js-yaml quando yq é desativado', () => {
        const preview = renderTerminalStructuredPreview('b: 2\na:\n  c: 3\n', {
            format: 'yaml',
            forceJs: true,
        });

        expect(preview.renderer).toBe('js');
        expect(preview.fallbackReason).toBe('renderer externo desativado');
        expect(preview.output).toContain('b: 2');
        expect(preview.output).toContain('a:');
    });

    it('declara filtro ignorado no fallback JS quando o renderer externo não é usado', () => {
        const preview = renderTerminalStructuredPreview('{"a":{"c":3}}', {
            format: 'json',
            forceJs: true,
            query: '.a',
        });

        expect(preview.queryApplied).toBe(false);
        expect(preview.fallbackReason).toContain('filtro ignorado');
    });

    it('bloqueia filtro iniciado por hífen antes de chamar jq/yq', () => {
        const preview = renderTerminalStructuredPreview('{"a":1}', {
            format: 'json',
            query: '--version',
        });

        expect(preview.renderer).toBe('js');
        expect(preview.queryApplied).toBe(false);
        expect(preview.fallbackReason).toContain('filtro iniciado por hífen bloqueado');
        expect(preview.fallbackReason).toContain('filtro ignorado');
    });

    it('bloqueia caracteres de controle no filtro externo', () => {
        const preview = renderTerminalStructuredPreview('a: 1\n', {
            format: 'yaml',
            query: `.a${String.fromCharCode(1)}`,
        });

        expect(preview.renderer).toBe('js');
        expect(preview.queryApplied).toBe(false);
        expect(preview.fallbackReason).toContain('caracteres de controle');
    });
});
