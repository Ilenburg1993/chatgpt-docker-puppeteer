// @ts-check
/**
 * Preview Markdown explícito para o terminal.
 *
 * Usa `glow` somente quando disponível e solicitado pelo operador. O fallback preserva Markdown em texto plano com
 * truncamento seguro.
 *
 * @module copilot/terminal/capabilities/markdown-preview
 */

import { spawnSync } from 'node:child_process';

import { readTerminalExternalToolCapabilities } from './external-tools.js';

/**
 * @typedef {{
 *     output: string;
 *     renderer: 'glow' | 'js';
 *     fallbackReason: string | null;
 *     truncated: boolean;
 * }} TerminalMarkdownPreview
 */

const MAX_MARKDOWN_PREVIEW_BYTES = 192 * 1024;
const MAX_MARKDOWN_PREVIEW_CHARS = 24_000;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_PATTERN = new RegExp(
    `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`,
    'gu',
);

/**
 * @param {string} text
 * @param {number} [max=MAX_MARKDOWN_PREVIEW_CHARS]
 * @returns {{ output: string; truncated: boolean }}
 */
function truncateMarkdownPreview(text, max = MAX_MARKDOWN_PREVIEW_CHARS) {
    if (text.length <= max) return { output: text, truncated: false };
    return {
        output: `${text.slice(0, max)}\n... (${text.length - max} caracteres omitidos)`,
        truncated: true,
    };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sanitizeTerminalMarkdownPreviewOutput(text) {
    return text.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r(?!\n)/gu, '\n');
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function renderPlainMarkdownFallback(markdown) {
    return markdown
        .split(/\r?\n/u)
        .map((line) => line.replace(/\t/gu, '    '))
        .join('\n');
}

/**
 * @param {string} markdown
 * @param {{ forceJs?: boolean; width?: number; color?: 'auto' | 'always' | 'never'; style?: string }} [options]
 * @returns {TerminalMarkdownPreview}
 */
export function renderTerminalMarkdownPreview(markdown, options = {}) {
    const width = Math.max(40, Math.min(240, Math.trunc(options.width ?? 100)));
    const jsFallback = (/** @type {string | null} */ reason) => {
        const rendered = truncateMarkdownPreview(renderPlainMarkdownFallback(markdown));
        return {
            output: rendered.output,
            renderer: /** @type {'js'} */ ('js'),
            fallbackReason: reason,
            truncated: rendered.truncated,
        };
    };

    if (options.forceJs) return jsFallback('markdown externo desativado');
    const glow = readTerminalExternalToolCapabilities().find((tool) => tool.id === 'glow' && tool.available);
    if (!glow?.command) return jsFallback('glow ausente');

    const colorMode = options.color ?? (process.stdout.isTTY ? 'always' : 'never');
    const style = options.style ?? (colorMode === 'never' ? 'notty' : 'dark');
    const result = spawnSync(glow.command, ['-w', String(width), '-s', style, '-n', '-'], {
        encoding: 'utf8',
        input: markdown,
        maxBuffer: MAX_MARKDOWN_PREVIEW_BYTES,
        timeout: 2_000,
        windowsHide: true,
    });

    if (result.status !== 0 || result.error) {
        const reason = result.error?.message || String(result.stderr || '').trim() || 'glow falhou';
        return jsFallback(reason);
    }
    const rendered = truncateMarkdownPreview(sanitizeTerminalMarkdownPreviewOutput(String(result.stdout ?? '')));
    return {
        output: rendered.output,
        renderer: 'glow',
        fallbackReason: null,
        truncated: rendered.truncated,
    };
}
