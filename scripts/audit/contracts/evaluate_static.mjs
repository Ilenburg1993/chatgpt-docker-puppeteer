import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'backups', 'tests', 'artifacts', 'coverage']);

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
 * @param {string} line
 * @param {number} column
 */
function isInsideCommentOrString(line, column) {
    const pre = line.slice(0, Math.max(0, column));
    const inlineCommentIdx = line.indexOf('//');
    if (inlineCommentIdx !== -1 && column >= inlineCommentIdx) {
        return true;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
        return true;
    }
    const dq = (pre.match(/"/g) || []).length;
    const sq = (pre.match(/'/g) || []).length;
    const bt = (pre.match(/`/g) || []).length;
    return dq % 2 === 1 || sq % 2 === 1 || bt % 2 === 1;
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
 */
export function evaluateStaticContracts(options) {
    const rootDir = path.resolve(options.rootDir);
    const scanRoot = path.resolve(options.scanDir || path.join(rootDir, 'src'));
    const files = walk(scanRoot);

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
        const ignoreCommentLike = contract.matcher.ignore_comment_like !== false;
        const ignoreStringLike = contract.matcher.ignore_string_like !== false;
        const allowlistedFiles = resolveAllowlistedFiles(contract, options.allowlists || {});

        for (const filePath of files) {
            const relFile = relativePath(filePath, rootDir);
            if (allowlistedFiles.has(relFile)) {
                continue;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
            let match;
            while ((match = regex.exec(content)) !== null) {
                const idx = match.index;
                let lineNum = 1;
                let acc = 0;
                for (let i = 0; i < lines.length; i += 1) {
                    acc += lines[i].length + 1;
                    if (acc > idx) {
                        lineNum = i + 1;
                        break;
                    }
                }
                const currentLine = lines[lineNum - 1] || '';
                const lineStart = acc - (currentLine.length + 1);
                const column = idx - Math.max(0, lineStart);
                if (ignoreCommentLike || ignoreStringLike) {
                    const inside = isInsideCommentOrString(currentLine, column);
                    if (inside) {
                        continue;
                    }
                }

                const evidence = currentLine.trim() || String(match[0] || pattern);
                findings.push({
                    contract_id: contract.id,
                    domain: contract.domain,
                    source_tool: 'contract-static',
                    file: relFile,
                    line: lineNum,
                    evidence,
                    rule: contract.id,
                    severity_hint: contract.severity_default,
                    type: contract.type_default,
                    impact: contract.description,
                    root_cause: `Violação de contrato estático ${contract.id}.`,
                    suggested_patch: `Ajustar trecho para atender ${contract.title}.`,
                    test_strategy: contract.test_recipe.join(' ; '),
                    regression_risk: contract.severity_default === 'P0' || contract.severity_default === 'P1' ? 'Alto' : 'Médio',
                    owner: contract.owner,
                    enforcement_state: contract.enforcement?.level || 'warn',
                });
                hitsByContract[contract.id] = (hitsByContract[contract.id] || 0) + 1;
            }
        }
    }

    return {
        findings,
        files_scanned: files.length,
        contracts_scanned: options.contracts.filter(contract => contract.kind === 'static' && contract.status === 'active').length,
        hits_by_contract: hitsByContract,
    };
}
