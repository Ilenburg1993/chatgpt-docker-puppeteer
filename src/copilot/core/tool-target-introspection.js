// @ts-check
/**
 * Extração canônica de metadados de alvos de tools (arquivos, URLs, queries e ranges).
 *
 * Este módulo centraliza heurísticas usadas por UX de terminal e observabilidade para evitar divergência entre "o que
 * foi executado" e "o que foi exibido/persistido".
 *
 * @module copilot/core/tool-target-introspection
 */

const MAX_DISCOVERED_VALUES = 24;
const MAX_RECURSION_DEPTH = 5;

const FILE_KEYS = new Set([
    'path',
    'file',
    'filePath',
    'filepath',
    'filename',
    'targetPath',
    'sourcePath',
    'destinationPath',
    'dest',
    'src',
    'cwd',
    'includePattern',
    'excludePattern',
]);

const URL_KEYS = new Set(['url', 'uri', 'href', 'link', 'page', 'webpage', 'endpoint']);

const QUERY_KEYS = new Set(['query', 'pattern', 'search', 'needle', 'regex', 'text', 'lineContent']);

const START_LINE_KEYS = new Set(['startLine', 'start', 'fromLine']);
const END_LINE_KEYS = new Set(['endLine', 'end', 'toLine']);

const PATCH_KEYS = new Set(['patch', 'diff', 'content']);

/**
 * @typedef {{ start: number | null; end: number | null }} ToolLineRange
 */

/**
 * @typedef {{
 *     fileTargets: string[];
 *     urlTargets: string[];
 *     searchTerms: string[];
 *     patchFiles: string[];
 *     lineRange: ToolLineRange | null;
 *     primaryTarget: string | null;
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
    const urlTargets = new Set();
    /** @type {Set<string>} */
    const searchTerms = new Set();
    /** @type {Set<string>} */
    const patchFiles = new Set();

    /** @type {ToolLineRange} */
    const lineRange = { start: null, end: null };

    /**
     * @param {unknown} value
     * @param {number} depth
     * @returns {void}
     */
    function visit(value, depth) {
        if (depth > MAX_RECURSION_DEPTH) return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1);
            return;
        }
        if (!isObjectRecord(value)) return;

        for (const [key, raw] of Object.entries(value)) {
            const keyName = key.trim();
            const text = asCleanString(raw);

            if (START_LINE_KEYS.has(keyName)) {
                const num = asFiniteNumber(raw);
                if (num !== null) lineRange.start = num;
            }
            if (END_LINE_KEYS.has(keyName)) {
                const num = asFiniteNumber(raw);
                if (num !== null) lineRange.end = num;
            }

            if (text) {
                if (PATCH_KEYS.has(keyName)) {
                    for (const file of extractPatchFileTargets(text)) {
                        addIfPresent(patchFiles, file);
                        if (isLikelyPathLike(file)) addIfPresent(fileTargets, file);
                    }
                }

                if (FILE_KEYS.has(keyName)) {
                    if (isLikelyUrl(text)) addIfPresent(urlTargets, text);
                    else addIfPresent(fileTargets, text);
                }

                if (URL_KEYS.has(keyName) && isLikelyUrl(text)) {
                    addIfPresent(urlTargets, text);
                }

                if (QUERY_KEYS.has(keyName)) {
                    addIfPresent(searchTerms, text);
                }
            }

            visit(raw, depth + 1);
        }
    }

    visit(args, 0);

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
    const normalizedUrls = Array.from(urlTargets).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedQueries = Array.from(searchTerms).slice(0, MAX_DISCOVERED_VALUES);
    const normalizedPatchFiles = Array.from(patchFiles).slice(0, MAX_DISCOVERED_VALUES);

    const primaryTarget =
        normalizedFiles[0] ?? normalizedUrls[0] ?? normalizedQueries[0] ?? normalizedPatchFiles[0] ?? null;

    const hasRange = lineRange.start !== null || lineRange.end !== null;

    return {
        fileTargets: normalizedFiles,
        urlTargets: normalizedUrls,
        searchTerms: normalizedQueries,
        patchFiles: normalizedPatchFiles,
        lineRange: hasRange ? lineRange : null,
        primaryTarget,
    };
}
