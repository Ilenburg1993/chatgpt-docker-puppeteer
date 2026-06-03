// @ts-check
/**
 * Preview read-only de arquivos para o terminal.
 *
 * `bat`/`batcat` enriquecem o output quando disponíveis, mas o fallback JS é canônico e suficiente. Este módulo não
 * altera arquivos e não abre pager/TUI.
 *
 * @module copilot/terminal/capabilities/file-preview
 */

import { spawnSync } from 'node:child_process';

import { readTerminalExternalToolCapabilities } from './external-tools.js';

/**
 * @typedef {{
 *     output: string;
 *     renderer: 'bat' | 'js';
 *     fallbackReason: string | null;
 *     truncated: boolean;
 * }} TerminalFilePreview
 */

const MAX_PREVIEW_BYTES = 128 * 1024;
const MAX_PREVIEW_CHARS = 16_000;
const DEFAULT_LINE_LIMIT = 220;

/**
 * @param {string} text
 * @param {number} [max=MAX_PREVIEW_CHARS]
 * @returns {{ output: string; truncated: boolean }}
 */
function truncatePreviewText(text, max = MAX_PREVIEW_CHARS) {
    if (text.length <= max) return { output: text, truncated: false };
    return {
        output: `${text.slice(0, max)}\n... (${text.length - max} caracteres omitidos)`,
        truncated: true,
    };
}

/**
 * @param {string} text
 * @param {number} lineLimit
 * @returns {{ output: string; truncated: boolean }}
 */
function renderJsPreview(text, lineLimit) {
    const lines = text.split(/\r?\n/u);
    const limited = lines.slice(0, lineLimit);
    const output = limited.map((line, index) => `${String(index + 1).padStart(4, ' ')} │ ${line}`).join('\n');
    const truncated = lines.length > lineLimit;
    const suffix = truncated ? `\n... (${lines.length - lineLimit} linha(s) omitida(s))` : '';
    return truncatePreviewText(`${output}${suffix}`);
}

/**
 * @param {string} content
 * @returns {string | null}
 */
function detectUnsafePreviewContent(content) {
    if (content.includes('\u0000')) return 'conteúdo parece binário (NUL detectado)';
    if (content.includes('\uFFFD')) return 'conteúdo contém bytes inválidos para texto';
    const sample = content.slice(0, 8_000);
    const controlChars = [...sample].filter((char) => {
        const code = char.charCodeAt(0);
        return (code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    }).length;
    if (controlChars === 0) return null;
    const ratio = controlChars / Math.max(1, sample.length);
    return ratio > 0.005 ? 'conteúdo contém muitos caracteres de controle' : null;
}

/**
 * @param {string} reason
 * @returns {TerminalFilePreview}
 */
function renderUnsafePreview(reason) {
    return {
        output: `preview omitido: ${reason}. Use uma ferramenta binária explícita se precisar inspecionar bytes.`,
        renderer: 'js',
        fallbackReason: reason,
        truncated: false,
    };
}

/**
 * @param {string | null | undefined} path
 * @param {string} content
 * @param {{ lineLimit?: number; forceJs?: boolean; color?: 'auto' | 'always' | 'never' }} [options]
 * @returns {TerminalFilePreview}
 */
export function renderTerminalFilePreview(path, content, options = {}) {
    const lineLimit = Math.max(1, Math.min(2_000, Math.trunc(options.lineLimit ?? DEFAULT_LINE_LIMIT)));
    const unsafeReason = detectUnsafePreviewContent(content);
    if (unsafeReason) return renderUnsafePreview(unsafeReason);
    const jsFallback = (/** @type {string | null} */ reason) => {
        const rendered = renderJsPreview(content, lineLimit);
        return {
            output: rendered.output,
            renderer: /** @type {'js'} */ ('js'),
            fallbackReason: reason,
            truncated: rendered.truncated,
        };
    };

    if (options.forceJs) return jsFallback('preview externo desativado');
    const filePath = typeof path === 'string' && path.trim().length > 0 ? path : null;
    if (!filePath) return jsFallback('arquivo sem caminho materializado');

    const bat = readTerminalExternalToolCapabilities().find((tool) => tool.id === 'bat' && tool.available);
    if (!bat?.command) return jsFallback('bat/batcat ausente');

    const colorMode = options.color ?? (process.stdout.isTTY ? 'always' : 'never');
    const result = spawnSync(
        bat.command,
        [
            '--paging=never',
            `--color=${colorMode}`,
            '--style=numbers,changes',
            '--wrap=never',
            '--line-range',
            `: ${lineLimit}`.replace(/\s+/gu, ''),
            filePath,
        ],
        {
            encoding: 'utf8',
            maxBuffer: MAX_PREVIEW_BYTES,
            timeout: 2_000,
            windowsHide: true,
        },
    );

    if (result.status !== 0 || result.error) {
        const reason = result.error?.message || String(result.stderr || '').trim() || 'bat falhou';
        return jsFallback(reason);
    }
    const rendered = truncatePreviewText(String(result.stdout ?? ''));
    return {
        output: rendered.output,
        renderer: 'bat',
        fallbackReason: null,
        truncated: rendered.truncated,
    };
}
