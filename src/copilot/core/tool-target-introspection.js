// @ts-check
/**
 * Extração canônica de metadados de alvos de tools (arquivos, URLs, queries e ranges).
 *
 * Este módulo centraliza heurísticas usadas por UX de terminal e observabilidade para evitar divergência entre "o que
 * foi executado" e "o que foi exibido/persistido".
 *
 * @module copilot/core/tool-target-introspection
 */

import { redactSecretText } from './security/redaction.js';

const MAX_DISCOVERED_VALUES = 24;
const MAX_RECURSION_DEPTH = 5;
const MAX_COMMAND_PREVIEW_CHARS = 160;
const MAX_FILTER_PREVIEW_CHARS = 96;

const FILE_KEYS = new Set([
    'path',
    'path_a',
    'path_b',
    'file',
    'filePath',
    'filepath',
    'filename',
    'searchPath',
    'targetPath',
    'source',
    'sourcePath',
    'destination',
    'destinationPath',
    'dest',
    'src',
    'includePattern',
    'excludePattern',
]);

const DIRECTORY_KEYS = new Set(['cwd', 'directory', 'dir', 'root', 'workspaceRoot', 'baseDir', 'basePath']);

const URL_KEYS = new Set(['url', 'uri', 'href', 'link', 'page', 'webpage', 'endpoint']);

const QUERY_KEYS = new Set(['query', 'pattern', 'search', 'needle', 'regex', 'text', 'lineContent']);

const COMMAND_KEYS = new Set(['command', 'cmd', 'shellCommand', 'script']);

const FILTER_KEYS = new Set(['category', 'filter', 'scope', 'kind', 'type', 'language']);

const RESULT_COUNT_KEYS = new Set([
    'count',
    'total',
    'totalCount',
    'resultCount',
    'resultsCount',
    'matchCount',
    'matchesCount',
    'returnedCount',
]);

const START_LINE_KEYS = new Set(['startLine', 'start', 'fromLine']);
const END_LINE_KEYS = new Set(['endLine', 'end', 'toLine']);

const PATCH_KEYS = new Set(['patch', 'diff', 'content']);

const RESULT_LINE_RANGE_KEYS = new Set(['returnedLines', 'lineRange']);

/**
 * @typedef {{ start: number | null; end: number | null }} ToolLineRange
 */

/**
 * @typedef {{
 *     fileTargets: string[];
 *     directoryTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     patchFiles: string[];
 *     lineRange: ToolLineRange | null;
 *     commands: string[];
 *     filters: string[];
 *     resultCount: number | null;
 *     resultSummary: string | null;
 *     primaryTarget: string | null;
 *     primaryTargetKind: 'file' | 'directory' | 'url' | 'search' | 'patch' | 'command' | 'filter' | null;
 * }} ToolTargetIntrospection
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asCleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isLikelyUrl(value) {
    return /^https?:\/\//iu.test(value) || value.startsWith('file://');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isLikelyPathLike(value) {
    if (!value) return false;
    if (isLikelyUrl(value)) return false;
    if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~')) {
        return true;
    }
    if (/^[A-Za-z]:\\/u.test(value)) return true;
    if (value.includes('/')) return true;
    return /\.[A-Za-z0-9_-]{1,10}$/u.test(value);
}

/**
 * @param {Set<string>} target
 * @param {string | null} value
 * @returns {void}
 */
function addIfPresent(target, value) {
    if (!value) return;
    if (target.size >= MAX_DISCOVERED_VALUES) return;
    target.add(value);
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
function asSafePreview(value, maxLength) {
    const text = asCleanString(value);
    if (!text) return null;
    return redactSecretText(text.replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim(), { maxLength });
}

/**
 * @param {ToolLineRange} target
 * @param {ToolLineRange | null} candidate
 * @returns {void}
 */
function mergeLineRange(target, candidate) {
    if (!candidate) return;
    if (candidate.start !== null) target.start = candidate.start;
    if (candidate.end !== null) target.end = candidate.end;
}

/**
 * @param {unknown} value
 * @returns {ToolLineRange | null}
 */
function extractStructuredLineRange(value) {
    if (!isObjectRecord(value)) return null;
    const start = asFiniteNumber(value['start']);
    const end = asFiniteNumber(value['end']);
    if (start === null && end === null) return null;
    return { start, end };
}

/**
 * @param {string} keyName
 * @param {unknown} raw
 * @param {{
 *     fileTargets: Set<string>;
 *     directoryTargets: Set<string>;
 *     urlTargets: Set<string>;
 *     searchTerms: Set<string>;
 *     patchFiles: Set<string>;
 *     commands: Set<string>;
 *     filters: Set<string>;
 *     lineRange: ToolLineRange;
 *     allowPatchKeys: boolean;
 *     allowQueryKeys: boolean;
 *     allowCommandKeys: boolean;
 *     allowFilterKeys: boolean;
 *     allowResultMetadata: boolean;
 *     resultCount: number | null;
 *     resultSuccess: boolean | null;
 *     resultExitCode: number | null;
 * }} state
 * @returns {void}
 */
function processStructuredEntry(keyName, raw, state) {
    const text = asCleanString(raw);

    if (START_LINE_KEYS.has(keyName)) {
        const num = asFiniteNumber(raw);
        if (num !== null) state.lineRange.start = num;
    }
    if (END_LINE_KEYS.has(keyName)) {
        const num = asFiniteNumber(raw);
        if (num !== null) state.lineRange.end = num;
    }
    if (RESULT_LINE_RANGE_KEYS.has(keyName)) {
        mergeLineRange(state.lineRange, extractStructuredLineRange(raw));
    }
    if (state.allowResultMetadata && RESULT_COUNT_KEYS.has(keyName)) {
        const count = asFiniteNumber(raw);
        if (count !== null && count >= 0) state.resultCount = count;
    }
    if (state.allowResultMetadata && keyName === 'success' && typeof raw === 'boolean') {
        state.resultSuccess = raw;
    }
    if (state.allowResultMetadata && keyName === 'exitCode') {
        const exitCode = asFiniteNumber(raw);
        if (exitCode !== null) state.resultExitCode = exitCode;
    }

    if (!text) return;

    if (state.allowPatchKeys && PATCH_KEYS.has(keyName)) {
        for (const file of extractPatchFileTargets(text)) {
            addIfPresent(state.patchFiles, file);
            if (isLikelyPathLike(file)) addIfPresent(state.fileTargets, file);
        }
    }

    if (FILE_KEYS.has(keyName)) {
        if (isLikelyUrl(text)) addIfPresent(state.urlTargets, text);
        else addIfPresent(state.fileTargets, text);
    }

    if (DIRECTORY_KEYS.has(keyName)) {
        addIfPresent(state.directoryTargets, text);
    }

    if (URL_KEYS.has(keyName) && isLikelyUrl(text)) {
        addIfPresent(state.urlTargets, text);
    }

    if (state.allowQueryKeys && QUERY_KEYS.has(keyName)) {
        addIfPresent(state.searchTerms, text);
    }

    if (state.allowCommandKeys && COMMAND_KEYS.has(keyName)) {
        addIfPresent(state.commands, asSafePreview(text, MAX_COMMAND_PREVIEW_CHARS));
    }

    if (state.allowFilterKeys && FILTER_KEYS.has(keyName)) {
        addIfPresent(state.filters, asSafePreview(`${keyName}: ${text}`, MAX_FILTER_PREVIEW_CHARS));
    }
}

/**
 * @param {unknown} value
 * @param {{
 *     fileTargets: Set<string>;
 *     directoryTargets: Set<string>;
 *     urlTargets: Set<string>;
 *     searchTerms: Set<string>;
 *     patchFiles: Set<string>;
 *     commands: Set<string>;
 *     filters: Set<string>;
 *     lineRange: ToolLineRange;
 *     allowPatchKeys: boolean;
 *     allowQueryKeys: boolean;
 *     allowCommandKeys: boolean;
 *     allowFilterKeys: boolean;
 *     allowResultMetadata: boolean;
 *     resultCount: number | null;
 *     resultSuccess: boolean | null;
 *     resultExitCode: number | null;
 * }} state
 * @param {number} depth
 * @returns {void}
 */
function visitStructuredMetadata(value, state, depth) {
    if (depth > MAX_RECURSION_DEPTH) return;
    if (Array.isArray(value)) {
        for (const item of value) visitStructuredMetadata(item, state, depth + 1);
        return;
    }
    if (!isObjectRecord(value)) return;

    for (const [key, raw] of Object.entries(value)) {
        processStructuredEntry(key.trim(), raw, state);
        visitStructuredMetadata(raw, state, depth + 1);
    }
}

/**
 * @param {unknown} value
 * @param {(text: string) => void} onText
 * @param {number} depth
 * @returns {void}
 */
function walkTextNodes(value, onText, depth) {
    if (depth > MAX_RECURSION_DEPTH) return;
    const str = asCleanString(value);
    if (str) {
        onText(str);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            walkTextNodes(item, onText, depth + 1);
        }
        return;
    }
    if (!isObjectRecord(value)) return;
    for (const nested of Object.values(value)) {
        walkTextNodes(nested, onText, depth + 1);
    }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractPatchFileTargets(text) {
    /** @type {Set<string>} */
    const files = new Set();

    const updateMatches = text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gmu);
    for (const match of updateMatches) {
        const raw = asCleanString(match[1]);
        if (raw) files.add(raw);
    }

    const gitMatches = text.matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gmu);
    for (const match of gitMatches) {
        const raw = asCleanString(match[1]);
        if (raw && raw !== '/dev/null') files.add(raw);
    }

    return Array.from(files).slice(0, MAX_DISCOVERED_VALUES);
}

/**
 * @param {{ args?: unknown; result?: unknown }} input
 * @returns {ToolTargetIntrospection}
 */
export function introspectToolTargets({ args, result }) {
    /** @type {Set<string>} */
    const fileTargets = new Set();
    /** @type {Set<string>} */
    const directoryTargets = new Set();
    /** @type {Set<string>} */
    const urlTargets = new Set();
    /** @type {Set<string>} */
    const searchTerms = new Set();
    /** @type {Set<string>} */
    const patchFiles = new Set();
    /** @type {Set<string>} */
    const commands = new Set();
    /** @type {Set<string>} */
    const filters = new Set();

    /** @type {ToolLineRange} */
    const lineRange = { start: null, end: null };

    const state = {
        fileTargets,
        directoryTargets,
        urlTargets,
        searchTerms,
        patchFiles,
        commands,
        filters,
        lineRange,
        allowPatchKeys: true,
        allowQueryKeys: true,
        allowCommandKeys: true,
        allowFilterKeys: true,
        allowResultMetadata: false,
        resultCount: null,
        resultSuccess: null,
        resultExitCode: null,
    };
    visitStructuredMetadata(args, state, 0);

    state.allowPatchKeys = false;
    state.allowQueryKeys = false;
    state.allowCommandKeys = false;
    state.allowFilterKeys = false;
    state.allowResultMetadata = true;
    visitStructuredMetadata(result, state, 0);

    walkTextNodes(
        result,
        (text) => {
            if (searchTerms.size < MAX_DISCOVERED_VALUES && /\b(query|pattern|search)\b/iu.test(text)) {
                addIfPresent(searchTerms, text);
            }
        },
        0,
    );

    for (const file of patchFiles) {
        if (fileTargets.size >= MAX_DISCOVERED_VALUES) break;
        addIfPresent(fileTargets, file);
    }

    const normalizedFiles = Array.from(fileTargets).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedDirectories = Array.from(directoryTargets).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedUrls = Array.from(urlTargets).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedQueries = Array.from(searchTerms).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedPatchFiles = Array.from(patchFiles).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedCommands = Array.from(commands).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedFilters = Array.from(filters).slice(0, MAX_DISCOVERED_VALUES);

    const primaryTarget =
        normalizedFiles[0] ??
        normalizedUrls[0] ??
        normalizedQueries[0] ??
        normalizedPatchFiles[0] ??
        normalizedCommands[0] ??
        normalizedFilters[0] ??
        normalizedDirectories[0] ??
        null;
    const primaryTargetKind =
        normalizedFiles.length > 0
            ? 'file'
            : normalizedUrls.length > 0
              ? 'url'
              : normalizedQueries.length > 0
                ? 'search'
                : normalizedPatchFiles.length > 0
                  ? 'patch'
                  : normalizedCommands.length > 0
                    ? 'command'
                    : normalizedFilters.length > 0
                      ? 'filter'
                      : normalizedDirectories.length > 0
                        ? 'directory'
                        : null;

    const hasRange = lineRange.start !== null || lineRange.end !== null;
    const resultSummary = [
        state.resultSuccess === null ? null : state.resultSuccess ? 'sucesso' : 'falha',
        state.resultExitCode === null ? null : `saída ${state.resultExitCode}`,
        state.resultCount === null ? null : `${state.resultCount} resultado${state.resultCount === 1 ? '' : 's'}`,
    ]
        .filter(Boolean)
        .join(' · ');

    return {
        fileTargets: normalizedFiles,
        directoryTargets: normalizedDirectories,
        urlTargets: normalizedUrls,
        searchTerms: normalizedQueries,
        patchFiles: normalizedPatchFiles,
        lineRange: hasRange ? lineRange : null,
        commands: normalizedCommands,
        filters: normalizedFilters,
        resultCount: state.resultCount,
        resultSummary: resultSummary || null,
        primaryTarget,
        primaryTargetKind,
    };
}
