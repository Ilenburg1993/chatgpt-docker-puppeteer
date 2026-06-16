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

import yamlModule from 'js-yaml';

import { readTerminalExternalToolCapabilities, sanitizeTerminalExternalToolText } from './external-tools.js';

const yaml = /** @type {{
 *     load: (content: string) => unknown;
 *     dump: (value: unknown, options?: { lineWidth?: number; noRefs?: boolean; sortKeys?: boolean }) => string;
 * }} */ (/** @type {unknown} */ (yamlModule));

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
const DEFAULT_STRUCTURED_LINE_LIMIT = 220;

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
 * @param {string} text
 * @param {number} lineLimit
 * @returns {{ output: string; truncated: boolean }}
 */
function limitStructuredPreviewLines(text, lineLimit) {
    const lines = text.split(/\r?\n/u);
    if (lines.length <= lineLimit) return { output: text, truncated: false };
    return {
        output: `${lines.slice(0, lineLimit).join('\n')}\n... (${lines.length - lineLimit} linhas omitidas)`,
        truncated: true,
    };
}

/**
 * @param {string} text
 * @param {number} lineLimit
 * @returns {{ output: string; truncated: boolean }}
 */
function truncateAndLimitStructuredPreview(text, lineLimit) {
    const charLimited = truncateStructuredPreview(text);
    const lineLimited = limitStructuredPreviewLines(charLimited.output, lineLimit);
    return {
        output: lineLimited.output,
        truncated: charLimited.truncated || lineLimited.truncated,
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
 * @param {number} lineLimit
 * @returns {TerminalStructuredPreview}
 */
function renderJsStructuredPreview(content, format, reason, queryApplied, lineLimit = DEFAULT_STRUCTURED_LINE_LIMIT) {
    try {
        const parsed = format === 'json' ? JSON.parse(content) : yaml.load(content);
        const rendered = truncateAndLimitStructuredPreview(
            format === 'json' ? stringifyJson(parsed) : stringifyYaml(parsed),
            lineLimit,
        );
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
 * @param {string} query
 * @returns {string | null}
 */
function validateExternalStructuredQuery(query) {
    if (query.startsWith('-')) return 'filtro iniciado por hífen bloqueado para evitar opção do renderer externo';
    const hasControl = [...query].some((char) => {
        const code = char.charCodeAt(0);
        return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    });
    if (hasControl) {
        return 'filtro contém caracteres de controle';
    }
    return null;
}

/**
 * @param {string} content
 * @param {{ format: TerminalStructuredPreviewFormat; query?: string; forceJs?: boolean; color?: 'auto' | 'always' | 'never'; lineLimit?: number }} options
 * @returns {TerminalStructuredPreview}
 */
export function renderTerminalStructuredPreview(content, options) {
    const format = options.format;
    const query = options.query?.trim() || '.';
    const isDefaultQuery = query === '.';
    const colorMode = options.color ?? (process.stdout.isTTY ? 'always' : 'never');
    const lineLimit = Math.max(1, Math.min(3_000, Math.trunc(options.lineLimit ?? DEFAULT_STRUCTURED_LINE_LIMIT)));
    const jsFallback = (/** @type {string | null} */ reason) =>
        renderJsStructuredPreview(
            content,
            format,
            isDefaultQuery ? reason : `${reason ?? 'renderer externo ausente'}; filtro ignorado`,
            isDefaultQuery,
            lineLimit,
        );

    if (options.forceJs) return jsFallback('renderer externo desativado');
    const unsafeQueryReason = validateExternalStructuredQuery(query);
    if (unsafeQueryReason) return jsFallback(unsafeQueryReason);

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

    const externalOutput =
        colorMode === 'never'
            ? sanitizeTerminalExternalToolText(result.stdout, { max: MAX_STRUCTURED_PREVIEW_CHARS })
            : String(result.stdout ?? '');
    const rendered = truncateAndLimitStructuredPreview(externalOutput, lineLimit);
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
    limitStructuredPreviewLines,
    truncateAndLimitStructuredPreview,
    truncateStructuredPreview,
};
