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
import { introspectToolTargets } from '../../core/tool-target-introspection.js';

const FILE_OPERATION_PATTERNS = /** @type {const} */ ([
    { match: /\b(read|view|open|cat|show)\b/i, operation: 'read', label: 'lendo arquivo' },
    { match: /\b(write|create|save)\b/i, operation: 'write', label: 'escrevendo arquivo' },
    { match: /\b(edit|patch|apply|update|replace)\b/i, operation: 'edit', label: 'editando arquivo' },
    { match: /\b(delete|remove|rm)\b/i, operation: 'delete', label: 'removendo arquivo' },
    { match: /\b(list|ls|glob|find|search)\b/i, operation: 'list', label: 'inspecionando arquivos' },
]);

const INSPECTION_TOOL_PATTERNS = /** @type {const} */ ([
    { match: /\b(get|read|show)\s+(workspace|agent|system|session)\s+(info|state|context)\b/i, label: 'inspecionando contexto' },
    { match: /\b(get|show)\s+(telemetry|metrics|health|status|capabilities)\b/i, label: 'inspecionando diagnóstico' },
    { match: /\b(list|show)\s+(available\s+)?tools\b/i, label: 'inspecionando tools' },
    { match: /\b(skill|invoke\s+skill|task|todo)\b/i, label: 'inspecionando recurso do agente' },
]);

/**
 * @typedef {'read' | 'write' | 'edit' | 'delete' | 'list' | 'run' | 'inspect' | 'unknown'} TerminalToolOperation
 *
 * @typedef {{
 *     toolName: string;
 *     canonicalToolName: string | null;
 *     displayToolName: string;
 *     operation: TerminalToolOperation;
 *     label: string;
 *     path: string | null;
 *     target: string | null;
 *     fileTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     patchFiles: string[];
 *     lineRange: { start: number | null; end: number | null } | null;
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
 * - Normaliza payload de argumentos de tool, incluindo eventos externos que chegam como `{ data: { arguments:
 *   string|object } }`.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normalizeToolArgsPayload(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const base = /** @type {Record<string, unknown>} */ (raw);
    const wrappedArgs = base['arguments'] ?? base['args'] ?? null;
    if (wrappedArgs === null || wrappedArgs === undefined) return base;
    if (typeof wrappedArgs === 'string') {
        try {
            const parsed = JSON.parse(wrappedArgs);
            if (parsed && typeof parsed === 'object') {
                return /** @type {Record<string, unknown>} */ (parsed);
            }
        } catch {
            // fallback para payload original
        }
    }
    if (wrappedArgs && typeof wrappedArgs === 'object') {
        return /** @type {Record<string, unknown>} */ (wrappedArgs);
    }
    return base;
}

/**
 * - @param {unknown} args
 *
 * @returns {string | null}
 */
function inferQuestion(args) {
    const data = objectOrNull(args);
    if (!data) return null;
    return stringOrNull(data['question']) ?? stringOrNull(data['message']) ?? stringOrNull(data['prompt']);
}

/**
 * @param {{
 *     fileTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     lineRange: { start: number | null; end: number | null } | null;
 *     primaryTarget: string | null;
 * }} meta
 * @returns {string | null}
 */
function buildTargetSummary(meta) {
    /** @type {string[]} */
    const chunks = [];
    if (meta.fileTargets.length > 0) {
        const preview = meta.fileTargets.slice(0, 2).join(', ');
        const extra = meta.fileTargets.length > 2 ? ` (+${meta.fileTargets.length - 2})` : '';
        chunks.push(`arquivo${meta.fileTargets.length > 1 ? 's' : ''}: ${preview}${extra}`);
    }
    if (meta.urlTargets.length > 0) {
        const preview = meta.urlTargets.slice(0, 2).join(', ');
        const extra = meta.urlTargets.length > 2 ? ` (+${meta.urlTargets.length - 2})` : '';
        chunks.push(`página${meta.urlTargets.length > 1 ? 's' : ''}: ${preview}${extra}`);
    }
    if (meta.searchTerms.length > 0) {
        const preview = meta.searchTerms[0] ?? '';
        chunks.push(`busca: ${compactTerminalToolText(preview, 52)}`);
    }
    if (meta.lineRange) {
        const start = meta.lineRange.start ?? '?';
        const end = meta.lineRange.end ?? '?';
        chunks.push(`linhas ${start}-${end}`);
    }
    if (chunks.length === 0) return meta.primaryTarget;
    return chunks.join(' · ');
}

/**
 * @param {string} toolName
 * @param {string | null} path
 * @returns {{ operation: TerminalToolOperation; label: string }}
 */
function inferOperation(toolName, path) {
    const canonical = resolveToolName(toolName) ?? toolName;
    const normalized = `${toolName} ${canonical}`.replace(/[_:-]+/g, ' ');

    if (/\bexternal\s*tool\b/i.test(normalized)) {
        return { operation: 'run', label: 'executando integração externa' };
    }

    if (/\b(report|intent|telemetry|diagnostic|health|status)\b/i.test(normalized)) {
        return { operation: 'inspect', label: 'inspecionando diagnóstico' };
    }
    if (/\b(ask user|request user input|permission|elicitation)\b/i.test(normalized)) {
        return { operation: 'run', label: 'coletando decisão humana' };
    }

    for (const pattern of INSPECTION_TOOL_PATTERNS) {
        if (pattern.match.test(normalized)) {
            return { operation: 'inspect', label: pattern.label };
        }
    }

    for (const pattern of FILE_OPERATION_PATTERNS) {
        if (pattern.match.test(normalized)) {
            return {
                operation: /** @type {TerminalToolOperation} */ (pattern.operation),
                label: pattern.label,
            };
        }
    }
    if (path) return { operation: 'inspect', label: 'operando arquivo' };
    if (/\b(shell|terminal|exec|bash|npm|node|test)\b/i.test(normalized)) {
        return { operation: 'run', label: 'executando comando' };
    }
    return { operation: 'inspect', label: 'executando tool genérica' };
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
 * @param {TerminalToolOperation} operation
 * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'tool'}
 */
export function mapTerminalToolOperationRole(operation) {
    if (operation === 'read') return 'fileRead';
    if (operation === 'write') return 'fileWrite';
    if (operation === 'edit') return 'fileEdit';
    if (operation === 'delete') return 'fileDelete';
    return 'tool';
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
        canonicalToolName && canonicalToolName !== toolName ? `${canonicalToolName} (alias: ${toolName})` : toolName;
    const rawToolArgs = evt['args'] ?? evt['arguments'] ?? evt['input'] ?? evt['data'];
    const toolArgs = normalizeToolArgsPayload(rawToolArgs);
    const toolResult = evt['result'] ?? evt['output'] ?? null;
    const meta = introspectToolTargets({ args: toolArgs, result: toolResult });
    const isStructuredInputTool = (canonicalToolName ?? toolName) === 'request_user_input';
    const questionPreview = isStructuredInputTool ? inferQuestion(toolArgs) : null;
    const path = isStructuredInputTool ? null : (meta.fileTargets[0] ?? null);
    const { operation, label } = inferOperation(toolName, path);
    const target =
        questionPreview ??
        buildTargetSummary(meta) ??
        stringOrNull(evt['mcpServerName']) ??
        stringOrNull(evt['requestId']) ??
        stringOrNull(evt['toolCallId']) ??
        null;
    const targetSuffix = target ? ` · ${target}` : '';
    const effectiveLabel = isStructuredInputTool ? 'aguardando decisão humana' : label;
    const detail = `${effectiveLabel}${targetSuffix}`;
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
        fileTargets: meta.fileTargets,
        urlTargets: meta.urlTargets,
        searchTerms: meta.searchTerms,
        patchFiles: meta.patchFiles,
        lineRange: meta.lineRange,
        detail,
        startLine,
        progressLinePrefix,
        completeLine(success, durationLabel) {
            const outcome = success ? 'concluído' : 'falhou';
            const safeDuration =
                typeof durationLabel === 'string' && durationLabel.trim().length > 0 ? durationLabel.trim() : 'n/d';
            return `${effectiveLabel} ${outcome}${targetSuffix} (${safeDuration})`;
        },
    };
}
