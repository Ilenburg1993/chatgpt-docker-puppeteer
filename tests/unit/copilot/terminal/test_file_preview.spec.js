// @ts-check

import { describe, expect, it } from 'vitest';

import { renderTerminalFilePreview } from '../../../../src/copilot/terminal/capabilities/index.js';

describe('terminal/capabilities/file-preview', () => {
    it('renderiza fallback JS com linhas numeradas quando preview externo é desativado', () => {
        const preview = renderTerminalFilePreview('example.js', 'const value = 1;\nconsole.log(value);', {
            forceJs: true,
            lineLimit: 10,
        });

        expect(preview.renderer).toBe('js');
        expect(preview.fallbackReason).toBe('preview externo desativado');
        expect(preview.output).toContain('1 │ const value = 1;');
        expect(preview.output).toContain('2 │ console.log(value);');
    });

    it('omite conteúdo com NUL antes de chamar preview externo ou fallback textual bruto', () => {
        const preview = renderTerminalFilePreview('binary.bin', `abc${String.fromCharCode(0)}def`, {
            forceJs: true,
        });

        expect(preview.renderer).toBe('js');
        expect(preview.fallbackReason).toContain('NUL detectado');
        expect(preview.output).toContain('preview omitido');
        expect(preview.output).not.toContain(String.fromCharCode(0));
    });

    it('omite conteúdo com muitos caracteres de controle', () => {
        const controls = Array.from({ length: 100 }, () => String.fromCharCode(1)).join('');
        const preview = renderTerminalFilePreview('control.bin', `prefix${controls}suffix`, {
            forceJs: true,
        });

        expect(preview.fallbackReason).toContain('caracteres de controle');
        expect(preview.output).not.toContain(String.fromCharCode(1));
    });
});
