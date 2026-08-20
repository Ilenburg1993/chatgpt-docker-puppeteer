// @ts-check

import { describe, expect, it } from 'vitest';

import { renderTerminalDiffPreview } from '../../../../src/copilot/terminal/capabilities/diff-preview.js';

const SAMPLE_DIFF = [
    'diff --git a/a.txt b/a.txt',
    'index 1111111..2222222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

describe('terminal/capabilities/diff-preview', () => {
    it('renderiza fallback JS legível quando diff externo está desativado', () => {
        const rendered = renderTerminalDiffPreview(SAMPLE_DIFF, { forceJs: true, color: 'never' });

        expect(rendered.renderer).toBe('js');
        expect(rendered.fallbackReason).toBe('diff externo desativado');
        expect(rendered.output).toContain('diff --git a/a.txt b/a.txt');
        expect(rendered.output).toContain('-old');
        expect(rendered.output).toContain('+new');
    });

    it('trunca fallback JS por linhas antes de retornar ao terminal', () => {
        const rendered = renderTerminalDiffPreview(
            `${SAMPLE_DIFF}\n${Array.from({ length: 20 }, (_, i) => `+line ${i}`).join('\n')}`,
            {
                forceJs: true,
                lineLimit: 4,
                color: 'never',
            },
        );

        expect(rendered.renderer).toBe('js');
        expect(rendered.output).toContain('linhas omitidas');
        expect(rendered.output).not.toContain('+line 19');
    });

    it('mantém fallback JS quando saída sem cor é exigida', () => {
        const rendered = renderTerminalDiffPreview(SAMPLE_DIFF, { color: 'never' });

        expect(rendered.renderer).toBe('js');
        expect(rendered.fallbackReason).toMatch(/delta ausente|sem cor/u);
        expect(rendered.output).toContain('diff --git a/a.txt b/a.txt');
    });
});
