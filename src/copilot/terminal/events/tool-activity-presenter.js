// @ts-check
/**
 * Presenter puro para narrativa de tools no terminal.
 *
 * O SDK envia eventos de tool em formatos diferentes conforme origem. Este módulo concentra a heurística visual: nome
 * legível, caminho provável, intenção operacional e preview seguro para stdout.
 *
 * @module copilot/terminal/tool-activity-presenter
 */

import { resolveToolName } from '#copilot/config';

const FILE_OPERATION_PATTERNS = /** @type {const} */ ([
    { match: /\b(read|view|open|cat|show)\b/i, operation: 'read', label: 'lendo arquivo' },
    { match: /\b(write|create|save)\b/i, operation: 'write', label: 'escrevendo arquivo' },
    { match: /\b(edit|patch|apply|update|replace)\b/i, operation: 'edit', label: 'editando arquivo' },
    { match: /\b(delete|remove|rm)\b/i, operation: 'delete', label: 'removendo arquivo' },
    { match: /\b(list|ls|glob|find|search)\b/i, operation: 'list', label: 'inspecionando arquivos' },
]);

/**
 * @typedef {'read' | 'write' | 'edit' | 'delete' | 'list' | 'run' | 'unknown'} TerminalToolOperation
 *
 * @typedef {{
 *     toolName: string;
 *     canonicalToolName: string | null;
 *     displayToolName: string;
 *     operation: TerminalToolOperation;
 *     label: string;
 *     path: string | null;
 *     target: string | null;
 *     detail: string;
 *     startLine: string;
 *     progressLinePrefix: string;
 *     completeLine: (success: boolean, durationLabel: string) => string;
 * }} TerminalToolActivityPresentation
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} args
 * @returns {string | null}
 */
function inferPath(args) {
    const data = objectOrNull(args);
    if (!data) return null;
    for (const key of ['path', 'filePath', 'filepath', 'filename', 'targetPath', 'uri', 'url']) {
        const direct = stringOrNull(data[key]);
        if (direct) return direct;
    }
    for (const key of ['input', 'request', 'params']) {
        const nested = inferPath(data[key]);
        if (nested) return nested;
    }
    return null;
}

/**
 * @param {unknown} args
 * @returns {string | null}
 */
function inferQuestion(args) {
    const data = objectOrNull(args);
    if (!data) return null;
    return stringOrNull(data['question']) ?? stringOrNull(data['message']) ?? stringOrNull(data['prompt']);
}

/**
 * @param {string} toolName
 * @param {string | null} path
 * @returns {{ operation: TerminalToolOperation; label: string }}
 */
function inferOperation(toolName, path) {
    const canonical = resolveToolName(toolName) ?? toolName;
    const normalized = `${toolName} ${canonical}`.replace(/[_:-]+/g, ' ');
    for (const pattern of FILE_OPERATION_PATTERNS) {
        if (pattern.match.test(normalized)) {
            return {
                operation: /** @type {TerminalToolOperation} */ (pattern.operation),
                label: pattern.label,
            };
        }
    }
    if (path) return { operation: 'unknown', label: 'operando arquivo' };
    if (/\b(shell|terminal|exec|bash|npm|node|test)\b/i.test(normalized)) {
        return { operation: 'run', label: 'executando comando' };
    }
    return { operation: 'unknown', label: 'executando tool' };
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function compactTerminalToolText(text, max = 140) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} fallbackName
 * @returns {TerminalToolActivityPresentation}
 */
export function buildTerminalToolActivityPresentation(evt, fallbackName = 'tool') {
    const toolName = stringOrNull(evt['toolName']) ?? stringOrNull(evt['name']) ?? fallbackName;
    const canonicalToolName = resolveToolName(toolName);
    const displayToolName =
        canonicalToolName && canonicalToolName !== toolName ? `${toolName} -> ${canonicalToolName}` : toolName;
    const toolArgs = evt['args'] ?? evt['arguments'] ?? evt['input'] ?? evt['data'];
    const isStructuredInputTool = (canonicalToolName ?? toolName) === 'request_user_input';
    const questionPreview = isStructuredInputTool ? inferQuestion(toolArgs) : null;
    const path = isStructuredInputTool ? null : inferPath(toolArgs);
    const { operation, label } = inferOperation(toolName, path);
    const target = questionPreview ?? path ?? stringOrNull(evt['mcpServerName']) ?? stringOrNull(evt['requestId']) ?? null;
    const targetSuffix = target ? ` · ${target}` : '';
    const aliasSuffix = displayToolName !== toolName ? ` · alias ${displayToolName}` : '';
    const effectiveLabel = isStructuredInputTool ? 'aguardando decisão humana' : label;
    const detail = `${effectiveLabel}${targetSuffix}${aliasSuffix}`;
    const startLine = target ? `${effectiveLabel}: ${target}` : effectiveLabel;
    const progressLinePrefix = target ? `${displayToolName} · ${target}` : displayToolName;

    return {
        toolName,
        canonicalToolName,
        displayToolName,
        operation,
        label,
        path,
        target,
        detail,
        startLine,
        progressLinePrefix,
        completeLine(success, durationLabel) {
            const outcome = success ? 'concluído' : 'falhou';
            return `${effectiveLabel} ${outcome}${targetSuffix} (${durationLabel})`;
        },
    };
}
