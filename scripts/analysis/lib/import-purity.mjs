// @ts-check
/**
 * High-confidence import-time side-effect audit for static public-surface closures.
 *
 * This intentionally does not guess whether arbitrary factory calls in variable initializers are pure. It catches only
 * forms that are semantically import-time execution or well-known process/fs/subprocess/network effects. The policy is
 * therefore suitable as a zero-baseline ratchet without accumulating heuristic exceptions.
 *
 * @module scripts/analysis/lib/import-purity
 */

import { parse } from '@babel/parser';
import { readFileSync } from 'node:fs';

const GLOBAL_EFFECT_CALLS = new Set(['fetch', 'queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout']);
const PROCESS_EFFECT_CALLS = new Set([
    'process.addListener',
    'process.chdir',
    'process.exit',
    'process.kill',
    'process.on',
    'process.once',
    'process.umask',
]);
const EFFECTFUL_NODE_IMPORTS = Object.freeze({
    'node:child_process': new Set(['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync']),
    'node:fs': new Set([
        'appendFile',
        'appendFileSync',
        'chmod',
        'chmodSync',
        'chown',
        'chownSync',
        'copyFile',
        'copyFileSync',
        'cp',
        'cpSync',
        'createWriteStream',
        'link',
        'linkSync',
        'mkdir',
        'mkdirSync',
        'mkdtemp',
        'mkdtempSync',
        'open',
        'openSync',
        'rename',
        'renameSync',
        'rm',
        'rmSync',
        'rmdir',
        'rmdirSync',
        'symlink',
        'symlinkSync',
        'truncate',
        'truncateSync',
        'unlink',
        'unlinkSync',
        'write',
        'writeFile',
        'writeFileSync',
        'writeSync',
    ]),
    'node:fs/promises': new Set([
        'appendFile',
        'chmod',
        'chown',
        'copyFile',
        'cp',
        'mkdir',
        'mkdtemp',
        'open',
        'rename',
        'rm',
        'rmdir',
        'symlink',
        'truncate',
        'unlink',
        'writeFile',
    ]),
    'node:worker_threads': new Set(['Worker']),
});
const FUNCTION_OR_CLASS_NODES = new Set([
    'ArrowFunctionExpression',
    'ClassDeclaration',
    'ClassExpression',
    'ClassMethod',
    'ClassPrivateMethod',
    'FunctionDeclaration',
    'FunctionExpression',
    'ObjectMethod',
]);
const TOP_LEVEL_EXECUTION_EXPRESSIONS = new Set([
    'AssignmentExpression',
    'AwaitExpression',
    'CallExpression',
    'NewExpression',
    'OptionalCallExpression',
    'UpdateExpression',
]);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);

/** @param {string} file */
function sourceExtension(file) {
    const dot = file.lastIndexOf('.');
    return dot < 0 ? '' : file.slice(dot);
}

/** @param {unknown} node */
function memberPath(node) {
    /** @type {string[]} */
    const parts = [];
    let current = /** @type {any} */ (node);
    while (current?.type === 'MemberExpression' && current.computed === false) {
        if (current.property?.type !== 'Identifier') return '';
        parts.unshift(current.property.name);
        current = current.object;
    }
    if (current?.type === 'Identifier') parts.unshift(current.name);
    return parts.join('.');
}

/** @param {any} statement @param {Set<string>} effectfulBindings */
function captureEffectfulBinding(statement, effectfulBindings) {
    if (statement?.type !== 'ImportDeclaration') return;
    const allowed =
        EFFECTFUL_NODE_IMPORTS[/** @type {keyof typeof EFFECTFUL_NODE_IMPORTS} */ (String(statement.source?.value))];
    if (!allowed) return;
    for (const specifier of statement.specifiers ?? []) {
        if (specifier.type !== 'ImportSpecifier') continue;
        const imported = String(
            specifier.imported?.type === 'Identifier' ? specifier.imported.name : (specifier.imported?.value ?? ''),
        );
        if (allowed.has(imported) && specifier.local?.name) effectfulBindings.add(specifier.local.name);
    }
}

/** @param {any} node @param {Set<string>} effectfulBindings @returns {string | null} */
function highConfidenceEffect(node, effectfulBindings) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'AwaitExpression') return 'top-level-await';
    if (node.type === 'UnaryExpression' && node.operator === 'delete') {
        return memberPath(node.argument).startsWith('process.env.') ? 'process-env-delete' : null;
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        const path = memberPath(node.left ?? node.argument);
        return path.startsWith('process.env.') ? 'process-env-mutation' : null;
    }
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression' && node.type !== 'NewExpression') {
        return null;
    }
    const callee = node.callee;
    if (callee?.type === 'Identifier') {
        if (GLOBAL_EFFECT_CALLS.has(callee.name)) return `effectful-global-call:${callee.name}`;
        if (effectfulBindings.has(callee.name)) return `effectful-node-call:${callee.name}`;
    }
    const path = memberPath(callee);
    if (PROCESS_EFFECT_CALLS.has(path)) return `effectful-process-call:${path}`;
    if (path.endsWith('.listen')) return 'effectful-listen-call';
    return null;
}

/**
 * @param {any} node
 * @param {Set<string>} effectfulBindings
 * @param {(node:any,kind:string)=>void} record
 */
function visitTopLevel(node, effectfulBindings, record) {
    if (!node || typeof node !== 'object') return;
    if (FUNCTION_OR_CLASS_NODES.has(node.type)) return;
    const effect = highConfidenceEffect(node, effectfulBindings);
    if (effect) record(node, effect);
    for (const [key, value] of Object.entries(node)) {
        if (['end', 'innerComments', 'leadingComments', 'loc', 'start', 'trailingComments'].includes(key)) continue;
        if (Array.isArray(value)) {
            for (const child of value) visitTopLevel(child, effectfulBindings, record);
        } else if (value && typeof value === 'object') {
            visitTopLevel(value, effectfulBindings, record);
        }
    }
}

/**
 * Inspect one module for high-confidence import-time execution.
 * @param {string} file
 * @returns {readonly {file:string;line:number|null;kind:string;detail:string|null}[]}
 */
export function inspectModuleImportPurity(file) {
    if (!SOURCE_EXTENSIONS.has(sourceExtension(file))) return Object.freeze([]);
    const source = readFileSync(file, 'utf8');
    const ast = parse(source, { sourceType: 'unambiguous', allowAwaitOutsideFunction: true, errorRecovery: false });
    const effectfulBindings = new Set();
    /** @type {{file:string;line:number|null;kind:string;detail:string|null}[]} */
    const findings = [];
    const seen = new Set();

    /** @param {any} node @param {string} kind @param {string|null} [detail] */
    function record(node, kind, detail = null) {
        const line = Number.isSafeInteger(node?.loc?.start?.line) ? Number(node.loc.start.line) : null;
        const key = `${line ?? 'unknown'}:${kind}:${detail ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        findings.push({ file, line, kind, detail });
    }

    for (const statement of ast.program.body) {
        captureEffectfulBinding(statement, effectfulBindings);
        if (statement.type === 'ImportDeclaration' && statement.specifiers.length === 0) {
            record(statement, 'side-effect-only-import', String(statement.source.value));
        }
    }

    for (const statement of ast.program.body) {
        if (
            statement.type === 'ExpressionStatement' &&
            TOP_LEVEL_EXECUTION_EXPRESSIONS.has(statement.expression?.type)
        ) {
            record(statement, 'top-level-expression', statement.expression.type);
        }
        visitTopLevel(statement, effectfulBindings, record);
    }
    return Object.freeze(findings);
}

/**
 * Audit the transitive static closure of each public descriptor while parsing each unique source file only once.
 * @param {{
 *   manifest:readonly {alias:string;target:string}[];
 *   buildClosure:(target:string)=>{files:readonly string[]};
 * }} options
 */
export function buildTransitiveImportPurityReport(options) {
    /** @type {Map<string, Set<string>>} */
    const aliasesByFile = new Map();
    for (const descriptor of options.manifest) {
        for (const file of options.buildClosure(descriptor.target).files) {
            const aliases = aliasesByFile.get(file) ?? new Set();
            aliases.add(descriptor.alias);
            aliasesByFile.set(file, aliases);
        }
    }

    /** @type {{file:string;line:number|null;kind:string;detail:string|null;aliases:string[]}[]} */
    const findings = [];
    for (const [file, aliases] of aliasesByFile) {
        for (const finding of inspectModuleImportPurity(file)) {
            findings.push({ ...finding, aliases: [...aliases].sort() });
        }
    }
    findings.sort((left, right) =>
        `${left.file}:${left.line ?? 0}:${left.kind}`.localeCompare(`${right.file}:${right.line ?? 0}:${right.kind}`),
    );
    return Object.freeze({
        success: findings.length === 0,
        closureFileCount: aliasesByFile.size,
        findingCount: findings.length,
        findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    });
}
