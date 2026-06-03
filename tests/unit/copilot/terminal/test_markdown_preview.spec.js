// @ts-check

import { describe, expect, it } from 'vitest';

import { renderTerminalMarkdownPreview } from '../../../../src/copilot/terminal/capabilities/index.js';

describe('terminal/capabilities/markdown-preview', () => {
    it('renderiza Markdown em fallback JS quando glow é desativado', () => {
        const preview = renderTerminalMarkdownPreview('# Título\n\n- item', { forceJs: true });

        expect(preview.renderer).toBe('js');
        expect(preview.fallbackReason).toBe('markdown externo desativado');
        expect(preview.output).toContain('# Título');
        expect(preview.output).toContain('- item');
    });

    it('normaliza tabs no fallback textual', () => {
        const preview = renderTerminalMarkdownPreview('linha\tcom tab', { forceJs: true });

        expect(preview.output).toContain('linha    com tab');
    });

    it('trunca Markdown muito longo', () => {
        const preview = renderTerminalMarkdownPreview('a'.repeat(30_000), { forceJs: true });

        expect(preview.truncated).toBe(true);
        expect(preview.output).toContain('caracteres omitidos');
    });
});
