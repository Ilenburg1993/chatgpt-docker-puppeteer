// @ts-check
/**
 * Preview explícito de diffs para o terminal.
 *
 * Usa `delta` quando disponível para realce visual, sem pager e sem alterar a estrutura do diff. O fallback JS mantém
 * uma leitura previsível em qualquer ambiente.
 *
 * @module copilot/terminal/capabilities/diff-preview
 */

import { spawnSync } from 'node:child_process';

import { terminalThemeText } from '../state/ui/index.js';
import { readTerminalExternalToolCapabilities } from './external-tools.js';

/**
 * @typedef {{
 *     output: string;
 *     renderer: 'delta' | 'js';
 *     fallbackReason: string | null;
 *     truncated: boolean;
 * }} TerminalDiffPreview
 */

const MAX_DIFF_PREVIEW_BYTES = 384 * 1024;
const MAX_DIFF_PREVIEW_CHARS = 48_000;
const DEFAULT_DIFF_LINE_LIMIT = 220;

/**
 * @param {string} text
 * @param {number} [max=MAX_DIFF_PREVIEW_CHARS]
 * @returns {{ output: string; truncated: boolean }}
 */
function truncateDiffPreviewText(text, max = MAX_DIFF_PREVIEW_CHARS) {
    if (text.length <= max) return { output: text, truncated: false };
    return {
        output: `${text.slice(0, max)}\n... (${text.length - max} caracteres omitidos)`,
        truncated: true,
    };
}

/**
 * @param {string} line
 * @returns {string}
 */
function renderDiffFallbackLine(line) {
    if (line.startsWith('diff --git ')) return terminalThemeText('accent', line);
    if (line.startsWith('@@')) return terminalThemeText('tool', line);
    if (line.startsWith('+') && !line.startsWith('+++')) return terminalThemeText('success', line);
    if (line.startsWith('-') && !line.startsWith('---')) return terminalThemeText('error', line);
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) return terminalThemeText('muted', line);
    return line;
}

/**
 * @param {string} diff
 * @param {number} lineLimit
 * @returns {{ output: string; truncated: boolean }}
 */
function renderJsDiffFallback(diff, lineLimit) {
    const lines = diff.split('\n');
    const visible = lines.slice(0, lineLimit).map(renderDiffFallbackLine);
    const suffix = lines.length > lineLimit ? `\n${terminalThemeText('muted', `... (${lines.length - lineLimit} linhas omitidas)`)}` : '';
    return truncateDiffPreviewText(`${visible.join('\n')}${suffix}`);
}

/**
 * @param {string} diff
 * @param {{ forceJs?: boolean; lineLimit?: number; color?: 'auto' | 'always' | 'never' }} [options]
 * @returns {TerminalDiffPreview}
 */
export function renderTerminalDiffPreview(diff, options = {}) {
    const lineLimit = Math.max(1, Math.min(3_000, Math.trunc(options.lineLimit ?? DEFAULT_DIFF_LINE_LIMIT)));
    const jsFallback = (/** @type {string | null} */ reason) => {
        const rendered = renderJsDiffFallback(diff, lineLimit);
        return {
            output: rendered.output,
            renderer: /** @type {'js'} */ ('js'),
            fallbackReason: reason,
            truncated: rendered.truncated,
        };
    };

    if (options.forceJs) return jsFallback('diff externo desativado');
    const delta = readTerminalExternalToolCapabilities().find((tool) => tool.id === 'delta' && tool.available);
    if (!delta?.command) return jsFallback('delta ausente');

    const colorMode = options.color ?? (process.stdout.isTTY ? 'always' : 'never');
    if (colorMode === 'never') return jsFallback('diff externo desativado sem cor');
    const args = ['--paging=never', '--color-only'];
    if (colorMode !== 'always') args.push('--no-gitconfig');
    args.push('--dark');

    const result = spawnSync(delta.command, args, {
        encoding: 'utf8',
        input: diff,
        maxBuffer: MAX_DIFF_PREVIEW_BYTES,
        timeout: 2_000,
        windowsHide: true,
    });

    if (result.status !== 0 || result.error) {
        const reason = result.error?.message || String(result.stderr || '').trim() || 'delta falhou';
        return jsFallback(reason);
    }

    const rendered = truncateDiffPreviewText(String(result.stdout ?? ''));
    return {
        output: rendered.output,
        renderer: 'delta',
        fallbackReason: null,
        truncated: rendered.truncated,
    };
}

export const __test__ = {
    renderJsDiffFallback,
    truncateDiffPreviewText,
};
