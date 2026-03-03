// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'backups', 'tests', 'artifacts', 'coverage', 'dist']);

/**
 * @typedef {import('./load_registry.mjs').ContractDefinitionV1} ContractDefinitionV1
 */

/**
 * @param {string} target
 * @returns {string[]}
 */
function walk(target) {
    /** @type {string[]} */
    let files = [];
    const entries = fs.readdirSync(target, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(target, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                files = files.concat(walk(fullPath));
            }
            continue;
        }
        if (!/\.(js|mjs|cjs|ts)$/.test(entry.name)) {
            continue;
        }
        files.push(fullPath);
    }
    return files;
}

/**
 * @param {string} absolute
 * @param {string} rootDir
 */
function relativePath(absolute, rootDir) {
    return path.relative(rootDir, absolute).split(path.sep).join('/');
}

/**
 * @param {string} text
 */
function buildLineStarts(text) {
    const starts = [0];
    for (let idx = 0; idx < text.length; idx += 1) {
        if (text[idx] === '\n') {
            starts.push(idx + 1);
        }
    }
    return starts;
}

/**
 * @param {number[]} lineStarts
 * @param {number} index
 */
function resolveLineNumber(lineStarts, index) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = lineStarts[mid];
        const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
        if (index >= start && index < next) {
            return mid + 1;
        }
        if (index < start) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return lineStarts.length;
}

/**
 * @param {Array<[number, number]>} ranges
 */
function mergeRanges(ranges) {
    if (ranges.length <= 1) {
        return ranges;
    }
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    /** @type {Array<[number, number]>} */
    const merged = [];
    for (const current of sorted) {
        const prev = merged[merged.length - 1];
        if (!prev || current[0] > prev[1]) {
            merged.push([current[0], current[1]]);
            continue;
        }
        prev[1] = Math.max(prev[1], current[1]);
    }
    return merged;
}

/**
 * @param {Array<[number, number]>} ranges
 * @param {number} index
 */
function isIndexInRanges(ranges, index) {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const [start, end] = ranges[mid];
        if (index < start) {
            high = mid - 1;
            continue;
        }
        if (index >= end) {
            low = mid + 1;
            continue;
        }
        return true;
    }
    return false;
}

/**
 * Extracts lexical ranges for comments and string-like literals.
 * Template literal static parts are considered string-like; `${...}` expressions remain code.
 * @param {string} content
 */
function buildIgnoredRanges(content) {
    /** @type {Array<[number, number]>} */
    const commentRanges = [];
    /** @type {Array<[number, number]>} */
    const stringRanges = [];

    let mode = 'code';
    let quote = '';
    let rangeStart = -1;
    /** @type {Array<{ braceDepth: number }>} */
    const templateExprStack = [];

    for (let idx = 0; idx < content.length; ) {
        const ch = content[idx];
        const next = idx + 1 < content.length ? content[idx + 1] : '';

        if (mode === 'line-comment') {
            if (ch === '\n') {
                commentRanges.push([rangeStart, idx]);
                mode = 'code';
                rangeStart = -1;
            }
            idx += 1;
            continue;
        }

        if (mode === 'block-comment') {
            if (ch === '*' && next === '/') {
                commentRanges.push([rangeStart, idx + 2]);
                mode = 'code';
                rangeStart = -1;
                idx += 2;
                continue;
            }
            idx += 1;
            continue;
        }

        if (mode === 'string') {
            if (ch === '\\') {
                idx += 2;
                continue;
            }
            if (ch === quote) {
                stringRanges.push([rangeStart, idx + 1]);
                mode = 'code';
                quote = '';
                rangeStart = -1;
            }
            idx += 1;
            continue;
        }

        if (mode === 'template') {
            if (ch === '\\') {
                idx += 2;
                continue;
            }
            if (ch === '`') {
                stringRanges.push([rangeStart, idx + 1]);
                mode = 'code';
                rangeStart = -1;
                idx += 1;
                continue;
            }
            if (ch === '$' && next === '{') {
                if (rangeStart >= 0 && rangeStart < idx) {
                    stringRanges.push([rangeStart, idx]);
                }
                templateExprStack.push({ braceDepth: 0 });
                mode = 'code';
                rangeStart = -1;
                idx += 2;
                continue;
            }
            idx += 1;
            continue;
        }

        const topTemplateExpr = templateExprStack[templateExprStack.length - 1];
        if (topTemplateExpr) {
            if (ch === '{') {
                topTemplateExpr.braceDepth += 1;
                idx += 1;
                continue;
            }
            if (ch === '}') {
                if (topTemplateExpr.braceDepth === 0) {
                    templateExprStack.pop();
                    mode = 'template';
                    rangeStart = idx + 1;
                    idx += 1;
                    continue;
                }
                topTemplateExpr.braceDepth -= 1;
                idx += 1;
                continue;
            }
        }

        if (ch === '/' && next === '/') {
            mode = 'line-comment';
            rangeStart = idx;
            idx += 2;
            continue;
        }
        if (ch === '/' && next === '*') {
            mode = 'block-comment';
            rangeStart = idx;
            idx += 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            mode = 'string';
            quote = ch;
            rangeStart = idx;
            idx += 1;
            continue;
        }
        if (ch === '`') {
            mode = 'template';
            rangeStart = idx;
            idx += 1;
            continue;
        }

        idx += 1;
    }

    if (mode === 'line-comment' && rangeStart >= 0) {
        commentRanges.push([rangeStart, content.length]);
    }
    if (mode === 'block-comment' && rangeStart >= 0) {
        commentRanges.push([rangeStart, content.length]);
    }
    if ((mode === 'string' || mode === 'template') && rangeStart >= 0) {
        stringRanges.push([rangeStart, content.length]);
    }

    return {
        commentRanges: mergeRanges(commentRanges),
        stringRanges: mergeRanges(stringRanges),
    };
}

/**
 * @param {ContractDefinitionV1} contract
 * @param {Record<string, Record<string, string[]>>} allowlists
 */
function resolveAllowlistedFiles(contract, allowlists) {
    const explicit = Array.isArray(contract.allowlist?.files) ? contract.allowlist.files : [];
    const allowlistId = contract.allowlist?.allowlist_id;
    const allowlistKey = contract.allowlist?.allowlist_key;
    const fromStore = allowlistId && allowlistKey ? allowlists?.[allowlistId]?.[allowlistKey] || [] : [];
    return new Set([...explicit, ...fromStore].map(item => String(item).replace(/\\/g, '/')));
}

/**
 * @param {{
 *   rootDir: string,
 *   scanDir?: string,
 *   contracts: ContractDefinitionV1[],
 *   allowlists?: Record<string, Record<string, string[]>>,
 * }} options
  * @returns {any}
 */
export function evaluateStaticContracts(options) {
    const rootDir = path.resolve(options.rootDir);
    const scanRoot = path.resolve(options.scanDir || path.join(rootDir, 'src'));
    const absoluteFiles = walk(scanRoot);

    /** @type {Array<{
     *  relFile: string,
     *  content: string,
     *  lines: string[],
     *  lineStarts: number[],
     *  commentRanges: Array<[number, number]>,
     *  stringRanges: Array<[number, number]>,
     * }>} */
    const fileMetas = [];

    for (const filePath of absoluteFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        const relFile = relativePath(filePath, rootDir);
        const ranges = buildIgnoredRanges(content);
        fileMetas.push({
            relFile,
            content,
            lines: content.split(/\r?\n/),
            lineStarts: buildLineStarts(content),
            commentRanges: ranges.commentRanges,
            stringRanges: ranges.stringRanges,
        });
    }

    /** @type {Array<Record<string, any>>} */
    const findings = [];
    /** @type {Record<string, number>} */
    const hitsByContract = {};

    for (const contract of options.contracts) {
        if (contract.kind !== 'static' || contract.status !== 'active') {
            continue;
        }
        if (contract.matcher?.engine !== 'regex') {
            continue;
        }

        const pattern = String(contract.matcher.pattern || '');
        if (!pattern) {
            continue;
        }
        const flags = String(contract.matcher.flags || 'g');
        const regexFlags = flags.includes('g') ? flags : `${flags}g`;
        const ignoreCommentLike = contract.matcher.ignore_comment_like !== false;
        const ignoreStringLike = contract.matcher.ignore_string_like !== false;
        const allowlistedFiles = resolveAllowlistedFiles(contract, options.allowlists || {});
        const regex = new RegExp(pattern, regexFlags);

        for (const meta of fileMetas) {
            if (allowlistedFiles.has(meta.relFile)) {
                continue;
            }

            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(meta.content)) !== null) {
                const idx = Number(match.index || 0);
                if (ignoreCommentLike && isIndexInRanges(meta.commentRanges, idx)) {
                    continue;
                }
                if (ignoreStringLike && isIndexInRanges(meta.stringRanges, idx)) {
                    continue;
                }

                const lineNum = resolveLineNumber(meta.lineStarts, idx);
                const evidence = (meta.lines[lineNum - 1] || '').trim() || String(match[0] || pattern);
                findings.push({
                    contract_id: contract.id,
                    domain: contract.domain,
                    source_tool: 'contract-static',
                    file: meta.relFile,
                    line: lineNum,
                    evidence,
                    rule: contract.id,
                    severity_hint: contract.severity_default,
                    type: contract.type_default,
                    impact: contract.description,
                    root_cause: `Violação de contrato estático ${contract.id}.`,
                    suggested_patch: `Ajustar trecho para atender ${contract.title}.`,
                    test_strategy: contract.test_recipe.join(' ; '),
                    regression_risk:
                        contract.severity_default === 'P0' || contract.severity_default === 'P1' ? 'Alto' : 'Médio',
                    owner: contract.owner,
                    enforcement_state: contract.enforcement?.level || 'warn',
                });
                hitsByContract[contract.id] = (hitsByContract[contract.id] || 0) + 1;
            }
        }
    }

    return {
        findings,
        files_scanned: fileMetas.length,
        contracts_scanned: options.contracts.filter(
            contract => contract.kind === 'static' && contract.status === 'active'
        ).length,
        hits_by_contract: hitsByContract,
    };
}
