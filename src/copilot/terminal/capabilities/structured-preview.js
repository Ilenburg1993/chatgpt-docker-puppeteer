// @ts-check
/**
 * Preview estruturado explícito para JSON/YAML no terminal.
 *
 * `jq`/`yq` são enriquecimentos opcionais. O contrato canônico continua em JS: parse seguro, pretty print e fallback
 * legível quando binários externos não existem ou quando o operador usa `--plain`.
 *
 * @module copilot/terminal/capabilities/structured-preview
 */

import { spawnSync } from 'node:child_process';

import yaml from 'js-yaml';

import { readTerminalExternalToolCapabilities } from './external-tools.js';

/**
 * @typedef {'json' | 'yaml'} TerminalStructuredPreviewFormat
 */
/**
 * @typedef {{
 *     output: string;
 *     renderer: 'jq' | 'yq' | 'js';
 *     fallbackReason: string | null;
 *     truncated: boolean;
 *     queryApplied: boolean;
 * }} TerminalStructuredPreview
 */

const MAX_STRUCTURED_PREVIEW_BYTES = 384 * 1024;
const MAX_STRUCTURED_PREVIEW_CHARS = 48_000;

/**
 * @param {string} text
 * @returns {{ output: string; truncated: boolean }}
 */
function truncateStructuredPreview(text) {
    if (text.length <= MAX_STRUCTURED_PREVIEW_CHARS) return { output: text, truncated: false };
    return {
        output: `${text.slice(0, MAX_STRUCTURED_PREVIEW_CHARS)}\n... (${text.length - MAX_STRUCTURED_PREVIEW_CHARS} caracteres omitidos)`,
        truncated: true,
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyYaml(value) {
    return yaml.dump(value, { lineWidth: 120, noRefs: true, sortKeys: false });
}

/**
 * @param {string} content
 * @param {TerminalStructuredPreviewFormat} format
 * @param {string | null} reason
 * @param {boolean} queryApplied
 * @returns {TerminalStructuredPreview}
 */
function renderJsStructuredPreview(content, format, reason, queryApplied) {
    try {
        const parsed = format === 'json' ? JSON.parse(content) : yaml.load(content);
        const rendered = truncateStructuredPreview(format === 'json' ? stringifyJson(parsed) : stringifyYaml(parsed));
        return {
            output: rendered.output,
            renderer: 'js',
            fallbackReason: reason,
            truncated: rendered.truncated,
            queryApplied,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            output: `preview estruturado indisponível: ${message}`,
            renderer: 'js',
            fallbackReason: reason ?? 'parse falhou',
            truncated: false,
            queryApplied: false,
        };
    }
}

/**
 * @param {string} content
 * @param {{ format: TerminalStructuredPreviewFormat; query?: string; forceJs?: boolean; color?: 'auto' | 'always' | 'never' }} options
 * @returns {TerminalStructuredPreview}
 */
export function renderTerminalStructuredPreview(content, options) {
    const format = options.format;
    const query = options.query?.trim() || '.';
    const isDefaultQuery = query === '.';
    const colorMode = options.color ?? (process.stdout.isTTY ? 'always' : 'never');
    const jsFallback = (/** @type {string | null} */ reason) =>
        renderJsStructuredPreview(content, format, isDefaultQuery ? reason : `${reason ?? 'renderer externo ausente'}; filtro ignorado`, isDefaultQuery);

    if (options.forceJs) return jsFallback('renderer externo desativado');

    const toolId = format === 'json' ? 'jq' : 'yq';
    const tool = readTerminalExternalToolCapabilities().find((item) => item.id === toolId && item.available);
    if (!tool?.command) return jsFallback(`${toolId} ausente`);

    const args =
        format === 'json'
            ? [colorMode === 'never' ? '-M' : '-C', query]
            : [
                  colorMode === 'never' ? '--no-colors' : '--colors',
                  '--security-disable-env-ops',
                  '--security-disable-file-ops',
                  '-P',
                  '-p',
                  'yaml',
                  '-o',
                  'yaml',
                  query,
                  '-',
              ];
    const result = spawnSync(tool.command, args, {
        encoding: 'utf8',
        input: content,
        maxBuffer: MAX_STRUCTURED_PREVIEW_BYTES,
        timeout: 2_000,
        windowsHide: true,
    });

    if (result.status !== 0 || result.error) {
        const reason = result.error?.message || String(result.stderr || '').trim() || `${toolId} falhou`;
        return jsFallback(reason);
    }

    const rendered = truncateStructuredPreview(String(result.stdout ?? ''));
    return {
        output: rendered.output,
        renderer: /** @type {'jq' | 'yq'} */ (toolId),
        fallbackReason: null,
        truncated: rendered.truncated,
        queryApplied: true,
    };
}

export const __test__ = {
    renderJsStructuredPreview,
    truncateStructuredPreview,
};
