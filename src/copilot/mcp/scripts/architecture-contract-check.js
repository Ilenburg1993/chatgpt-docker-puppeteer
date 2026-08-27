// @ts-check
/**
 * Gates estruturais leves para impedir regressões conhecidas enquanto hotspots são decompostos incrementalmente.
 *
 * Não tenta substituir ESLint nem uma análise completa de dependências: fixa apenas fronteiras arquiteturais canônicas
 * e ceilings explícitos para arquivos que já ultrapassaram muito o tamanho recomendado pelo projeto.
 *
 * @module copilot/mcp/scripts/architecture-contract-check
 */

import { createWorkspaceReadIo } from '#copilot/infra/public/composition/workspace/read-io';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { parse } from '@babel/parser';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = MCP_WORKSPACE_ROOT;
const architectureWorkspaceIo = createWorkspaceReadIo({ workspaceRoot: ROOT });
const PRESENTATION_ROOT = 'src/copilot/presentation';
const SOURCE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.ts']);

const HOTSPOT_BUDGETS = Object.freeze([
    { path: 'src/copilot/terminal/commands/byok.js', maxBytes: 375_000, maxLines: 8_700 },
    { path: 'src/copilot/model-gateway/catalog/sqlite-catalog-store.js', maxBytes: 175_000 },
    { path: 'src/copilot/mcp/auth/issuer/dev-oauth.js', maxBytes: 247_500 },
    { path: 'src/copilot/terminal/commands/session.js', maxBytes: 135_000 },
    { path: 'src/copilot/terminal/commands/sdk.js', maxBytes: 120_000 },
    { path: 'src/copilot/terminal/events/sdk-session-events.js', maxBytes: 112_000 },
    // Recalibrated 2026-08-21 to the main-branch baseline; keep ~2-4% drift headroom, not a size target.
    { path: 'src/copilot/tools/model-gateway/model-gateway-tools.js', maxBytes: 112_000 },
    { path: 'src/copilot/mcp/tools/repo-write.js', maxBytes: 180_000 },
    { path: 'src/copilot/mcp/diagnostics/oauth-smoke/runtime.js', maxBytes: 100_000 },
    { path: 'src/copilot/model-gateway/routing/runtime-selector.js', maxBytes: 98_000 },
    { path: 'src/copilot/sdk/session/provider.js', maxBytes: 90_000 },
    { path: 'src/copilot/terminal/dialog/engine.js', maxBytes: 90_000 },
]);

/** @param {string} path */
async function readWorkspaceText(path) {
    return (await architectureWorkspaceIo.readTextFresh(resolve(ROOT, path), { includeHash: false })).content;
}

/** @param {string} path */
async function collectSourceFiles(path) {
    const absolute = resolve(ROOT, path);
    /** @type {string[]} */
    const files = [];
    const entries = (await architectureWorkspaceIo.listDirectoryNamesFresh(absolute)).entries;
    for (const entryName of entries) {
        const relative = `${path}/${entryName}`;
        const info = (await architectureWorkspaceIo.lstatPath(resolve(ROOT, relative))).stats;
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) files.push(...(await collectSourceFiles(relative)));
        else if (info.isFile() && SOURCE_EXTENSIONS.includes(entryName.slice(entryName.lastIndexOf('.'))))
            files.push(relative);
    }
    return files;
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * Collect code-loading/process-authority facts that cannot be proven by the legacy literal-import regex alone.
 *
 * @param {string} source
 * @param {string} path
 */
function collectModuleAuthorityFacts(source, path) {
    /** @type {ReturnType<typeof parse>} */
    let ast;
    try {
        ast = parse(source, { sourceType: 'module' });
    } catch (error) {
        return {
            parseError: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            computedImports: /** @type {{ line: number | null; expressionType: string }[]} */ ([]),
            literalDynamicImports: /** @type {{ line: number | null; specifier: string }[]} */ ([]),
            workspaceIdentityImports: /** @type {string[]} */ ([]),
            processCwdCalls: /** @type {number[]} */ ([]),
            childProcessImport: false,
            workerThreadImport: false,
            processEnvReferences: 0,
            broadChildEnvironmentLines: /** @type {number[]} */ ([]),
            broadEnvironmentSpreadLines: /** @type {number[]} */ ([]),
            topLevelStateDeclarations: /** @type {{ name: string; kind: string; collection?: string }[]} */ ([]),
            processSemantics: {
                abortAware: false,
                observesClose: false,
                detachedLaunch: false,
                spawnAcceptance: false,
            },
        };
    }

    /** @type {{ line: number | null; expressionType: string }[]} */
    const computedImports = [];
    /** @type {{ line: number | null; specifier: string }[]} */
    const literalDynamicImports = [];
    const workspaceIdentityImports = new Set();
    /** @type {number[]} */
    const processCwdCalls = [];
    let childProcessImport = false;
    let workerThreadImport = false;
    let processEnvReferences = 0;
    /** @type {number[]} */
    const broadChildEnvironmentLines = [];
    /** @type {number[]} */
    const broadEnvironmentSpreadLines = [];
    const childProcessFunctionBindings = new Set();
    const childProcessNamespaceBindings = new Set();
    const childProcessCreationMethods = new Set([
        'spawn',
        'spawnSync',
        'exec',
        'execSync',
        'execFile',
        'execFileSync',
        'fork',
    ]);

    /** @type {{ name: string; kind: string; collection?: string }[]} */
    const topLevelStateDeclarations = [];
    for (const statement of ast.program.body) {
        if (statement.type !== 'VariableDeclaration') continue;
        for (const declaration of statement.declarations) {
            const init = declaration.init;
            const collection =
                init?.type === 'NewExpression' &&
                init.callee.type === 'Identifier' &&
                ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(init.callee.name)
                    ? init.callee.name
                    : null;
            if (statement.kind !== 'let' && !collection) continue;
            const name = declaration.id.type === 'Identifier' ? declaration.id.name : declaration.id.type;
            topLevelStateDeclarations.push({
                name,
                kind: statement.kind,
                ...(collection ? { collection } : {}),
            });
        }
    }

    /** @param {Record<string, unknown>} node */
    function readNodeStartLine(node) {
        const loc = asRecord(node['loc']);
        const start = asRecord(loc['start']);
        return typeof start['line'] === 'number' ? start['line'] : null;
    }

    /** @param {unknown} candidate @returns {boolean} */
    function containsProcessEnv(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        const node = asRecord(candidate);
        if (node['type'] === 'MemberExpression') {
            const objectNode = asRecord(node['object']);
            const propertyNode = asRecord(node['property']);
            if (
                objectNode['type'] === 'Identifier' &&
                objectNode['name'] === 'process' &&
                ((propertyNode['type'] === 'Identifier' && propertyNode['name'] === 'env') ||
                    (node['computed'] === true &&
                        propertyNode['type'] === 'StringLiteral' &&
                        propertyNode['value'] === 'env'))
            ) {
                return true;
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
            if (Array.isArray(value)) {
                if (value.some((item) => containsProcessEnv(item))) return true;
            } else if (value && typeof value === 'object' && containsProcessEnv(value)) {
                return true;
            }
        }
        return false;
    }

    /** @param {unknown} candidate @returns {boolean} */
    function isBroadEnvironmentSpread(candidate) {
        const node = asRecord(candidate);
        if (containsProcessEnv(node)) return true;
        return (
            node['type'] === 'Identifier' &&
            /^(?:env|parentEnv|sourceEnv|environment)$/u.test(String(node['name'] ?? ''))
        );
    }

    /** @param {Record<string, unknown>} callNode @returns {boolean} */
    function isProcessCreationCall(callNode) {
        const callee = asRecord(callNode['callee']);
        if (callee['type'] === 'Identifier') {
            return childProcessFunctionBindings.has(String(callee['name'] ?? ''));
        }
        if (callee['type'] !== 'MemberExpression') return false;
        const object = asRecord(callee['object']);
        if (object['type'] !== 'Identifier' || !childProcessNamespaceBindings.has(String(object['name'] ?? ''))) {
            return false;
        }
        const property = asRecord(callee['property']);
        const method = property['type'] === 'Identifier' ? property['name'] : property['value'];
        return childProcessCreationMethods.has(String(method ?? ''));
    }

    /** @param {Record<string, unknown>} callNode */
    function recordBroadChildEnvironment(callNode) {
        if (!isProcessCreationCall(callNode)) return;
        const args = Array.isArray(callNode['arguments']) ? callNode['arguments'] : [];
        let hasExplicitEnvironment = false;
        let broadEnvironment = false;
        for (const rawArg of args) {
            const arg = asRecord(rawArg);
            if (arg['type'] !== 'ObjectExpression') continue;
            const properties = Array.isArray(arg['properties']) ? arg['properties'] : [];
            for (const rawProperty of properties) {
                const property = asRecord(rawProperty);
                if (property['type'] === 'SpreadElement' && containsProcessEnv(property['argument'])) {
                    broadEnvironment = true;
                    continue;
                }
                if (property['type'] !== 'ObjectProperty') continue;
                const key = asRecord(property['key']);
                const keyName = key['type'] === 'Identifier' ? key['name'] : key['value'];
                if (keyName !== 'env') continue;
                hasExplicitEnvironment = true;
                if (containsProcessEnv(property['value'])) broadEnvironment = true;
            }
        }
        // Node child_process inherits process.env when options.env is omitted. Treat omission as ambient authority rather
        // than as a harmless default; callers must choose an explicit projected environment, including `{}` when none
        // is required.
        if (!hasExplicitEnvironment || broadEnvironment) {
            broadChildEnvironmentLines.push(readNodeStartLine(callNode) ?? 0);
        }
    }

    /** @param {unknown} candidate */
    function walk(candidate) {
        if (!candidate || typeof candidate !== 'object') return;
        const node = asRecord(candidate);
        const nodeType = node['type'];
        if (nodeType === 'ImportDeclaration') {
            const sourceNode = asRecord(node['source']);
            const specifier = sourceNode['value'];
            if (specifier === 'node:child_process' || specifier === 'child_process') {
                childProcessImport = true;
                const importSpecifiers = Array.isArray(node['specifiers']) ? node['specifiers'] : [];
                for (const rawSpecifier of importSpecifiers) {
                    const importSpecifier = asRecord(rawSpecifier);
                    const local = asRecord(importSpecifier['local']);
                    const localName = local['type'] === 'Identifier' ? String(local['name'] ?? '') : '';
                    if (!localName) continue;
                    if (
                        importSpecifier['type'] === 'ImportNamespaceSpecifier' ||
                        importSpecifier['type'] === 'ImportDefaultSpecifier'
                    ) {
                        childProcessNamespaceBindings.add(localName);
                        continue;
                    }
                    if (importSpecifier['type'] !== 'ImportSpecifier') continue;
                    const imported = asRecord(importSpecifier['imported']);
                    const importedName = String(imported['name'] ?? imported['value'] ?? '');
                    if (childProcessCreationMethods.has(importedName)) childProcessFunctionBindings.add(localName);
                }
            }
            if (specifier === 'node:worker_threads' || specifier === 'worker_threads') workerThreadImport = true;
            if (specifier === '#copilot/mcp/public/workspace') {
                const trackedIdentityExports = new Set([
                    'MCP_WORKSPACE_ROOT',
                    'resolveMcpWorkspaceIdentityPath',
                    'toMcpWorkspaceRelativePath',
                ]);
                for (const rawSpecifier of Array.isArray(node['specifiers']) ? node['specifiers'] : []) {
                    const importSpecifier = asRecord(rawSpecifier);
                    if (importSpecifier['type'] !== 'ImportSpecifier') continue;
                    const imported = asRecord(importSpecifier['imported']);
                    const importedName = String(imported['name'] ?? imported['value'] ?? '');
                    if (trackedIdentityExports.has(importedName)) workspaceIdentityImports.add(importedName);
                }
            }
        }
        if (nodeType === 'SpreadElement' && isBroadEnvironmentSpread(node['argument'])) {
            broadEnvironmentSpreadLines.push(readNodeStartLine(node) ?? 0);
        }
        if (nodeType === 'MemberExpression') {
            const objectNode = asRecord(node['object']);
            const propertyNode = asRecord(node['property']);
            if (
                objectNode['type'] === 'Identifier' &&
                objectNode['name'] === 'process' &&
                ((propertyNode['type'] === 'Identifier' && propertyNode['name'] === 'env') ||
                    (node['computed'] === true &&
                        propertyNode['type'] === 'StringLiteral' &&
                        propertyNode['value'] === 'env'))
            ) {
                processEnvReferences += 1;
            }
        }
        if (nodeType === 'ImportExpression') {
            const sourceNode = asRecord(node['source']);
            if (sourceNode['type'] === 'StringLiteral' && typeof sourceNode['value'] === 'string') {
                literalDynamicImports.push({ line: readNodeStartLine(node), specifier: sourceNode['value'] });
            } else {
                computedImports.push({
                    line: readNodeStartLine(node),
                    expressionType: String(sourceNode['type'] ?? 'unknown'),
                });
            }
        }
        if (nodeType === 'CallExpression') {
            recordBroadChildEnvironment(node);
            const calleeNode = asRecord(node['callee']);
            if (calleeNode['type'] === 'MemberExpression') {
                const objectNode = asRecord(calleeNode['object']);
                const propertyNode = asRecord(calleeNode['property']);
                const propertyName =
                    propertyNode['type'] === 'Identifier' ? propertyNode['name'] : propertyNode['value'];
                if (objectNode['type'] === 'Identifier' && objectNode['name'] === 'process' && propertyName === 'cwd') {
                    processCwdCalls.push(readNodeStartLine(node) ?? 0);
                }
            }
            const argumentNodes = Array.isArray(node['arguments']) ? node['arguments'] : [];
            if (calleeNode['type'] === 'Import') {
                const sourceNode = asRecord(argumentNodes[0]);
                if (sourceNode['type'] === 'StringLiteral' && typeof sourceNode['value'] === 'string') {
                    literalDynamicImports.push({ line: readNodeStartLine(node), specifier: sourceNode['value'] });
                } else {
                    computedImports.push({
                        line: readNodeStartLine(node),
                        expressionType: String(sourceNode['type'] ?? 'unknown'),
                    });
                }
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
            if (Array.isArray(value)) {
                for (const item of value) walk(item);
            } else if (value && typeof value === 'object') {
                walk(value);
            }
        }
    }
    walk(ast.program);
    return {
        parseError: null,
        computedImports,
        literalDynamicImports,
        workspaceIdentityImports: [...workspaceIdentityImports].sort(),
        processCwdCalls,
        childProcessImport,
        workerThreadImport,
        processEnvReferences,
        broadChildEnvironmentLines,
        broadEnvironmentSpreadLines,
        topLevelStateDeclarations,
        processSemantics: {
            abortAware: /(?:addEventListener\(\s*['"]abort['"]|\.aborted\b|AbortSignal\b)/u.test(source),
            observesClose: /(?:\.closed\b|once\(\s*['"]close['"])/u.test(source),
            detachedLaunch: /detached\s*:\s*(?:true|process\.platform\s*!==\s*['"]win32['"])/u.test(source),
            spawnAcceptance: /once\(\s*['"]spawn['"]/u.test(source),
        },
    };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string[]} mcpSourceFiles
 */
function validateMcpOwnerManifest(manifest, mcpSourceFiles) {
    const ownerRows = Array.isArray(manifest['owners']) ? manifest['owners'].map(asRecord) : [];
    const violations = [];
    const byId = new Map();
    const byPath = new Map();
    for (const owner of ownerRows) {
        const ownerId = owner['ownerId'];
        const ownerPath = owner['path'];
        const kind = owner['kind'];
        if (typeof ownerId !== 'string' || !ownerId) {
            violations.push('owner with missing ownerId');
            continue;
        }
        if (typeof ownerPath !== 'string' || !ownerPath.startsWith('src/copilot/mcp')) {
            violations.push(`${ownerId}: invalid path=${String(ownerPath)}`);
            continue;
        }
        if (!['owner', 'taxonomy', 'entrypoint-space'].includes(String(kind))) {
            violations.push(`${ownerId}: invalid kind=${String(kind)}`);
        }
        if (byId.has(ownerId)) violations.push(`duplicate ownerId=${ownerId}`);
        if (byPath.has(ownerPath)) violations.push(`duplicate owner path=${ownerPath}`);
        byId.set(ownerId, owner);
        byPath.set(ownerPath, owner);
    }
    for (const [ownerId, owner] of byId.entries()) {
        const parentOwnerId = owner['parentOwnerId'];
        if (parentOwnerId === null) continue;
        if (typeof parentOwnerId !== 'string' || !byId.has(parentOwnerId)) {
            violations.push(`${ownerId}: missing parent=${String(parentOwnerId)}`);
            continue;
        }
        const parentPath = byId.get(parentOwnerId)?.['path'];
        if (typeof parentPath === 'string' && !String(owner['path']).startsWith(`${parentPath}/`)) {
            violations.push(`${ownerId}: path is outside parent ${parentOwnerId}`);
        }
        const visited = new Set([ownerId]);
        /** @type {string | null} */
        let cursor = parentOwnerId;
        while (cursor) {
            if (visited.has(cursor)) {
                violations.push(`${ownerId}: parent cycle through ${cursor}`);
                break;
            }
            visited.add(cursor);
            const nextParentOwnerId = /** @type {unknown} */ (byId.get(cursor)?.['parentOwnerId']);
            cursor = typeof nextParentOwnerId === 'string' && nextParentOwnerId ? nextParentOwnerId : null;
        }
    }

    const mcpPrefix = 'src/copilot/mcp/';
    const physicalTopLevel = new Set(
        mcpSourceFiles
            .map((path) => path.slice(mcpPrefix.length).split('/'))
            .filter((parts) => parts.length > 1)
            .map((parts) => `${mcpPrefix}${parts[0]}`),
    );
    const manifestTopLevel = new Set(
        ownerRows
            .filter((owner) => owner['parentOwnerId'] === manifest['rootOwnerId'])
            .map((owner) => owner['path'])
            .filter((path) => typeof path === 'string'),
    );
    for (const path of physicalTopLevel)
        if (!manifestTopLevel.has(path)) violations.push(`unclassified top-level path=${path}`);
    for (const path of manifestTopLevel)
        if (!physicalTopLevel.has(path)) violations.push(`stale top-level owner path=${path}`);

    return {
        violations,
        owners: ownerRows,
        protectedRoots: ownerRows
            .filter((owner) => owner['protectedBoundary'] === true && typeof owner['path'] === 'string')
            .map((owner) => /** @type {string} */ (owner['path'])),
    };
}

/** @param {ReturnType<typeof validateMcpOwnerManifest>} ownerManifestReport @param {string} targetPath */
function resolveMcpOwnerForPath(ownerManifestReport, targetPath) {
    return (
        ownerManifestReport.owners
            .filter((owner) => {
                const ownerPath = owner['path'];
                return (
                    typeof ownerPath === 'string' &&
                    (targetPath === ownerPath || targetPath.startsWith(`${ownerPath}/`))
                );
            })
            .sort((left, right) => String(right['path'] ?? '').length - String(left['path'] ?? '').length)[0] ?? null
    );
}

/** @param {unknown} target */
function normalizePackageImportTarget(target) {
    return typeof target === 'string' ? target.replace(/^\.\//u, '') : null;
}

/**
 * Find risk annotations declared directly on raw wire-tool object literals. Canonical protocol annotations must be
 * projected from the exhaustive semantic Tool Contract, never authored independently by a wire tool.
 *
 * @param {string} source
 * @param {string} path
 */
function collectRawToolAnnotationDeclarations(source, path) {
    /** @type {ReturnType<typeof parse>} */
    let ast;
    try {
        ast = parse(source, { sourceType: 'module' });
    } catch {
        return [];
    }
    /** @type {number[]} */
    const lines = [];
    /** @param {unknown} candidate */
    function walk(candidate) {
        if (!candidate || typeof candidate !== 'object') return;
        const node = asRecord(candidate);
        if (node['type'] === 'ObjectExpression') {
            const properties = Array.isArray(node['properties']) ? node['properties'].map(asRecord) : [];
            const keys = new Set(
                properties
                    .filter((property) => property['type'] === 'ObjectProperty' && property['computed'] !== true)
                    .map((property) => {
                        const key = asRecord(property['key']);
                        return String(key['name'] ?? key['value'] ?? '');
                    }),
            );
            if (
                keys.has('name') &&
                keys.has('description') &&
                keys.has('inputSchema') &&
                keys.has('handler') &&
                keys.has('annotations')
            ) {
                const loc = asRecord(node['loc']);
                const start = asRecord(loc['start']);
                lines.push(typeof start['line'] === 'number' ? start['line'] : 0);
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
            if (Array.isArray(value)) for (const item of value) walk(item);
            else if (value && typeof value === 'object') walk(value);
        }
    }
    walk(ast.program);
    return lines.map((line) => `${path}:${line || 'unknown-line'}`);
}

/**
 * Measure the raw-tool definition boundary. Every literal tool definition must be contextually typed by
 * defineMcpRawTool(inputSchema -> Zod output) before entering the heterogeneous catalog.
 *
 * @param {string} source
 * @param {string} path
 * @returns {{ definitions: number; wrapped: number; violations: string[] }}
 */
function collectRawToolDefinitionBoundaryFacts(source, path) {
    /** @type {ReturnType<typeof parse>} */
    let ast;
    try {
        ast = parse(source, { sourceType: 'module' });
    } catch {
        return { definitions: 0, wrapped: 0, violations: [`${path}:parse-failed`] };
    }
    let definitions = 0;
    let wrapped = 0;
    /** @type {string[]} */
    const violations = [];
    /** @param {unknown} candidate @param {Record<string, unknown> | null} parent */
    function walk(candidate, parent) {
        if (!candidate || typeof candidate !== 'object') return;
        const node = asRecord(candidate);
        if (node['type'] === 'ObjectExpression') {
            const properties = Array.isArray(node['properties']) ? node['properties'].map(asRecord) : [];
            const keys = new Set(
                properties
                    .filter((property) => property['type'] === 'ObjectProperty' && property['computed'] !== true)
                    .map((property) => {
                        const key = asRecord(property['key']);
                        return String(key['name'] ?? key['value'] ?? '');
                    }),
            );
            if (
                keys.has('name') &&
                keys.has('title') &&
                keys.has('description') &&
                keys.has('inputSchema') &&
                keys.has('handler')
            ) {
                definitions += 1;
                const callee = parent?.['type'] === 'CallExpression' ? asRecord(parent['callee']) : {};
                const isWrapped = callee['type'] === 'Identifier' && callee['name'] === 'defineMcpRawTool';
                if (isWrapped) wrapped += 1;
                else {
                    const loc = asRecord(node['loc']);
                    const start = asRecord(loc['start']);
                    const line = typeof start['line'] === 'number' ? start['line'] : 'unknown-line';
                    violations.push(`${path}:${line}:missing-defineMcpRawTool`);
                }
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
            if (Array.isArray(value)) for (const item of value) walk(item, node);
            else if (value && typeof value === 'object') walk(value, node);
        }
    }
    walk(ast.program, null);
    return { definitions, wrapped, violations };
}

const MCP_PROCESS_COMPLETION_MODELS = Object.freeze([
    'attached-close',
    'detached-acceptance',
    'managed-lifecycle',
    'job-lifecycle',
    'persistent-session',
    'sync-probe',
]);
const MCP_PROCESS_CANCELLATION_MODES = Object.freeze([
    'drain',
    'before-acceptance',
    'before-acceptance-then-explicit-control',
    'explicit-control',
    'not-applicable',
]);
const MCP_PROCESS_CWD_AUTHORITIES = Object.freeze([
    'fixed-workspace',
    'caller-bounded-workspace',
    'process-cwd-inherited',
]);
const MCP_PROCESS_EXECUTABLE_AUTHORITIES = Object.freeze([
    'fixed-binary',
    'fixed-node-script',
    'fixed-package-manager',
    'allowlisted-node-script',
    'allowlisted-command',
    'caller-command',
    'bound-process-spec',
]);
/** @type {Readonly<Record<string, string>>} */
const MCP_PROCESS_SIGNAL_POLICY_BY_COMPLETION = Object.freeze({
    'sync-probe': 'none',
    'attached-close': 'attached-supervisor',
    'detached-acceptance': 'detached-acceptance-supervisor',
    'managed-lifecycle': 'managed-controller',
    'persistent-session': 'persistent-session-control',
    'job-lifecycle': 'job-manager',
});
/** @type {Readonly<Record<string, string>>} */
const MCP_PROCESS_TERMINALITY_BY_COMPLETION = Object.freeze({
    'sync-probe': 'synchronous',
    'attached-close': 'attached',
    'detached-acceptance': 'detached',
    'managed-lifecycle': 'managed-daemon',
    'persistent-session': 'persistent',
    'job-lifecycle': 'job',
});

/**
 * @param {Record<string, unknown>} manifest
 * @param {Set<string>} actualChildProcessOwners
 * @param {Map<string, ReturnType<typeof collectModuleAuthorityFacts>>} moduleAuthorityFacts
 * @param {ReturnType<typeof validateMcpOwnerManifest>} ownerManifestReport
 */
function validateMcpChildProcessAuthorityManifest(
    manifest,
    actualChildProcessOwners,
    moduleAuthorityFacts,
    ownerManifestReport,
) {
    const violations = [];
    const rows = Array.isArray(manifest['childProcessAuthorities'])
        ? manifest['childProcessAuthorities'].map(asRecord)
        : [];
    const byPath = new Map();
    const ownersById = new Map(ownerManifestReport.owners.map((owner) => [owner['ownerId'], owner]));
    for (const row of rows) {
        const path = row['path'];
        const ownerId = row['ownerId'];
        if (typeof path !== 'string' || !path) {
            violations.push('process authority with missing path');
            continue;
        }
        if (byPath.has(path)) violations.push(`${path}: duplicate process authority`);
        byPath.set(path, row);
        if (!actualChildProcessOwners.has(path)) violations.push(`${path}: stale process authority`);
        const owner = typeof ownerId === 'string' ? ownersById.get(ownerId) : undefined;
        if (!owner) violations.push(`${path}: unknown ownerId=${String(ownerId)}`);
        else {
            const ownerPath = String(owner['path'] ?? '');
            if (!(path === ownerPath || path.startsWith(`${ownerPath}/`))) {
                violations.push(`${path}: outside owner=${String(ownerId)}`);
            }
            const deepestOwner = resolveMcpOwnerForPath(ownerManifestReport, path);
            if (!deepestOwner || deepestOwner['ownerId'] !== ownerId) {
                violations.push(
                    `${path}: ownerId must be deepest owner actual=${String(deepestOwner?.['ownerId'] ?? 'missing')} declared=${String(ownerId)}`,
                );
            }
        }
        const launchers = Array.isArray(row['launchers']) ? row['launchers'].map(asRecord) : [];
        if (launchers.length === 0) violations.push(`${path}: no launcher contracts`);
        const ids = new Set();
        const facts = moduleAuthorityFacts.get(path);
        for (const launcher of launchers) {
            const id = launcher['id'];
            const completionModel = String(launcher['completionModel'] ?? '');
            const callerCancellation = String(launcher['callerCancellation'] ?? '');
            const executableAuthority = String(launcher['executableAuthority'] ?? '');
            const cwdAuthority = String(launcher['cwdAuthority'] ?? '');
            const environmentAuthority = String(launcher['environmentAuthority'] ?? '');
            const credentialAuthority = String(launcher['credentialAuthority'] ?? '');
            const signalPolicy = String(launcher['signalPolicy'] ?? '');
            const terminality = String(launcher['terminality'] ?? '');
            const processGroup = String(launcher['processGroup'] ?? '');
            const bound = launcher['bound'];
            if (typeof id !== 'string' || !id) violations.push(`${path}: launcher missing id`);
            else if (ids.has(id)) violations.push(`${path}: duplicate launcher id=${id}`);
            else ids.add(id);
            if (!MCP_PROCESS_COMPLETION_MODELS.includes(completionModel))
                violations.push(`${path}:${String(id)} invalid completionModel=${completionModel}`);
            if (!MCP_PROCESS_CANCELLATION_MODES.includes(callerCancellation))
                violations.push(`${path}:${String(id)} invalid callerCancellation=${callerCancellation}`);
            if (!MCP_PROCESS_EXECUTABLE_AUTHORITIES.includes(executableAuthority)) {
                violations.push(`${path}:${String(id)} invalid executableAuthority=${executableAuthority}`);
            }
            if (!MCP_PROCESS_CWD_AUTHORITIES.includes(cwdAuthority))
                violations.push(`${path}:${String(id)} invalid cwdAuthority=${cwdAuthority}`);
            if (environmentAuthority !== 'explicit-projection')
                violations.push(`${path}:${String(id)} invalid environmentAuthority=${environmentAuthority}`);
            if (credentialAuthority !== 'projected-only') {
                violations.push(`${path}:${String(id)} invalid credentialAuthority=${credentialAuthority}`);
            }
            const expectedSignalPolicy = MCP_PROCESS_SIGNAL_POLICY_BY_COMPLETION[completionModel];
            if (signalPolicy !== expectedSignalPolicy) {
                violations.push(
                    `${path}:${String(id)} signalPolicy=${signalPolicy} expected=${String(expectedSignalPolicy ?? 'unknown')}`,
                );
            }
            const expectedTerminality = MCP_PROCESS_TERMINALITY_BY_COMPLETION[completionModel];
            if (terminality !== expectedTerminality) {
                violations.push(
                    `${path}:${String(id)} terminality=${terminality} expected=${String(expectedTerminality ?? 'unknown')}`,
                );
            }
            if (!['yes', 'no'].includes(processGroup))
                violations.push(`${path}:${String(id)} invalid processGroup=${processGroup}`);
            if (typeof bound !== 'string' || bound.trim().length < 12)
                violations.push(`${path}:${String(id)} missing bound/rationale`);
            if (
                callerCancellation === 'drain' &&
                (!facts?.processSemantics.abortAware || !facts.processSemantics.observesClose)
            ) {
                violations.push(`${path}:${String(id)} claims drain without abort+close evidence`);
            }
            if (
                (callerCancellation === 'before-acceptance' ||
                    callerCancellation === 'before-acceptance-then-explicit-control') &&
                (!facts?.processSemantics.abortAware ||
                    !facts.processSemantics.detachedLaunch ||
                    !facts.processSemantics.spawnAcceptance ||
                    !facts.processSemantics.observesClose)
            ) {
                violations.push(
                    `${path}:${String(id)} claims a pre-acceptance cancellation boundary without abort+detached+spawn+close evidence`,
                );
            }
            if (
                callerCancellation === 'before-acceptance-then-explicit-control' &&
                completionModel !== 'persistent-session'
            ) {
                violations.push(
                    `${path}:${String(id)} may transfer from caller cancellation to explicit control only for persistent-session lifecycle`,
                );
            }
            if (completionModel === 'attached-close' && !facts?.processSemantics.observesClose)
                violations.push(`${path}:${String(id)} claims attached-close without close evidence`);
            if (
                completionModel === 'detached-acceptance' &&
                (!facts?.processSemantics.detachedLaunch || !facts.processSemantics.spawnAcceptance)
            ) {
                violations.push(`${path}:${String(id)} claims detached-acceptance without detached+spawn evidence`);
            }
        }
    }
    for (const path of actualChildProcessOwners)
        if (!byPath.has(path)) violations.push(`${path}: undeclared process authority`);
    return { violations, rows };
}

const MCP_STATE_SCOPES = Object.freeze([
    'process',
    'process-generation',
    'workspace',
    'config-identity',
    'transport-identity',
]);
const MCP_STATE_LIFECYCLES = Object.freeze([
    'bounded-cache',
    'weak-identity-cache',
    'timer-service',
    'singleton-runtime',
    'state-machine',
    'registry',
    'session-manager',
    'job-manager',
    'last-value',
    'counter',
    'provider-binding',
]);
const MCP_STATE_BOUNDEDNESS = Object.freeze([
    'bounded',
    'weak-keyed',
    'single-value',
    'externally-bounded',
    'persistent-bounded',
    'unbounded-review',
]);

/**
 * @param {Record<string, unknown>} manifest
 * @param {Map<string, ReturnType<typeof collectModuleAuthorityFacts>>} moduleAuthorityFacts
 * @param {ReturnType<typeof validateMcpOwnerManifest>} ownerManifestReport
 */
function validateMcpStateScopeManifest(manifest, moduleAuthorityFacts, ownerManifestReport) {
    const violations = [];
    const rawEntries = Array.isArray(manifest['entries']) ? manifest['entries'].map(asRecord) : [];
    /** @type {Map<string, { declarations: Record<string, unknown>[]; migrationTarget: boolean }>} */
    const declared = new Map();
    const owners = ownerManifestReport.owners;
    /** @param {string} sourcePath */
    const resolveOwnerId = (sourcePath) =>
        owners
            .filter(
                (owner) =>
                    typeof owner['path'] === 'string' &&
                    (sourcePath === owner['path'] || sourcePath.startsWith(`${owner['path']}/`)),
            )
            .sort((left, right) => String(right['path']).length - String(left['path']).length)[0]?.['ownerId'] ?? null;
    let migrationTargetCount = 0;
    let declarationCount = 0;

    for (const entry of rawEntries) {
        const sourcePath = entry['path'];
        if (typeof sourcePath !== 'string' || !sourcePath.startsWith('src/copilot/mcp/')) {
            violations.push(`state manifest invalid path=${String(sourcePath)}`);
            continue;
        }
        if (declared.has(sourcePath)) {
            violations.push(`${sourcePath}: duplicate state-scope declaration`);
            continue;
        }
        if (!MCP_STATE_SCOPES.includes(String(entry['scope'])))
            violations.push(`${sourcePath}: invalid scope=${String(entry['scope'])}`);
        if (!MCP_STATE_LIFECYCLES.includes(String(entry['lifecycle'])))
            violations.push(`${sourcePath}: invalid lifecycle=${String(entry['lifecycle'])}`);
        if (!MCP_STATE_BOUNDEDNESS.includes(String(entry['boundedness'])))
            violations.push(`${sourcePath}: invalid boundedness=${String(entry['boundedness'])}`);
        if (typeof entry['bound'] !== 'string' || !entry['bound'])
            violations.push(`${sourcePath}: missing bound rationale`);
        if (typeof entry['rationale'] !== 'string' || !entry['rationale'])
            violations.push(`${sourcePath}: missing state rationale`);
        const expectedOwner = resolveOwnerId(sourcePath);
        if (entry['ownerId'] !== expectedOwner)
            violations.push(
                `${sourcePath}: owner mismatch declared=${String(entry['ownerId'])} actual=${String(expectedOwner)}`,
            );
        const declarations = Array.isArray(entry['declarations']) ? entry['declarations'].map(asRecord) : [];
        if (declarations.length === 0) violations.push(`${sourcePath}: empty state declaration list`);
        declarationCount += declarations.length;
        const migrationTarget = entry['migrationTarget'] === true;
        if (migrationTarget) migrationTargetCount += 1;
        declared.set(sourcePath, { declarations, migrationTarget });
    }

    /** @param {Record<string, unknown>} entry */
    const normalizeDeclaration = (entry) =>
        `${String(entry['name'])}:${String(entry['kind'])}:${String(entry['collection'] ?? '')}`;
    let actualFileCount = 0;
    let actualDeclarationCount = 0;
    for (const [sourcePath, facts] of moduleAuthorityFacts.entries()) {
        const actualDeclarations = facts.topLevelStateDeclarations;
        if (actualDeclarations.length === 0) continue;
        actualFileCount += 1;
        actualDeclarationCount += actualDeclarations.length;
        const manifestEntry = declared.get(sourcePath);
        if (!manifestEntry) {
            violations.push(`${sourcePath}: undeclared top-level mutable state count=${actualDeclarations.length}`);
            continue;
        }
        const actual = actualDeclarations.map((entry) => normalizeDeclaration(entry)).sort();
        const expected = manifestEntry.declarations.map((entry) => normalizeDeclaration(entry)).sort();
        if (actual.join('|') !== expected.join('|')) {
            violations.push(
                `${sourcePath}: state declaration drift actual=${actual.join(',')} declared=${expected.join(',')}`,
            );
        }
    }
    for (const [sourcePath] of declared.entries()) {
        const facts = moduleAuthorityFacts.get(sourcePath);
        if (!facts) violations.push(`${sourcePath}: stale state-scope path`);
        else if (facts.topLevelStateDeclarations.length === 0)
            violations.push(`${sourcePath}: stale zero-state manifest entry`);
    }
    const policy = asRecord(manifest['policy']);
    if (policy['unknownTopLevelMutableState'] !== 'reject')
        violations.push('state policy must reject unknown mutable state');
    if (policy['staleEntries'] !== 'reject') violations.push('state policy must reject stale entries');
    if (policy['migrationTargetRatchet'] !== 'exact') violations.push('state migration target ratchet must be exact');

    return {
        violations,
        declaredFileCount: declared.size,
        declaredDeclarationCount: declarationCount,
        actualFileCount,
        actualDeclarationCount,
        migrationTargetCount,
    };
}

const MCP_CONFIG_AUTHORITY_CLASSES = Object.freeze([
    'canonical-snapshot',
    'config-parser-default',
    'environment-projector',
    'process-entrypoint',
    'migration-target',
]);

/**
 * Validate the exact set of source files still entitled to read ambient process environment. Migration targets are
 * exact-count ratchets: reducing one requires shrinking the manifest immediately, so the old budget can never regrow
 * silently. Stable parser/entrypoint/projector authorities use ceilings but stale zero-reference entries are rejected.
 *
 * @param {Record<string, unknown>} manifest
 * @param {Map<string, ReturnType<typeof collectModuleAuthorityFacts>>} moduleAuthorityFacts
 * @param {ReturnType<typeof validateMcpOwnerManifest>} ownerManifestReport
 */
function validateMcpConfigAuthorityManifest(manifest, moduleAuthorityFacts, ownerManifestReport) {
    const violations = [];
    const authorities = asRecord(manifest['authorities']);
    const declaredByPath = new Map();
    let migrationTargetCount = 0;

    for (const [authorityClass, rawEntries] of Object.entries(authorities)) {
        if (!MCP_CONFIG_AUTHORITY_CLASSES.includes(authorityClass)) {
            violations.push(`unknown authority class=${authorityClass}`);
            continue;
        }
        if (!Array.isArray(rawEntries)) {
            violations.push(`${authorityClass}: entries must be an array`);
            continue;
        }
        for (const rawEntry of rawEntries) {
            const entry = asRecord(rawEntry);
            const path = entry['path'];
            const maxReferences = Number(entry['maxReferences']);
            if (typeof path !== 'string' || !path.startsWith('src/copilot/mcp/')) {
                violations.push(`${authorityClass}: invalid path=${String(path)}`);
                continue;
            }
            if (!Number.isInteger(maxReferences) || maxReferences < 1) {
                violations.push(`${path}: invalid maxReferences=${String(entry['maxReferences'])}`);
                continue;
            }
            if (declaredByPath.has(path)) {
                violations.push(`${path}: duplicate config authority declaration`);
                continue;
            }
            declaredByPath.set(path, { authorityClass, maxReferences });
            if (authorityClass === 'migration-target') migrationTargetCount += 1;
        }
    }

    let actualFileCount = 0;
    let actualReferenceCount = 0;
    for (const [path, facts] of moduleAuthorityFacts.entries()) {
        const actual = facts.processEnvReferences;
        if (actual <= 0) continue;
        actualFileCount += 1;
        actualReferenceCount += actual;
        const declared = declaredByPath.get(path);
        if (!declared) {
            violations.push(`${path}: undeclared process.env authority actual=${actual}`);
            continue;
        }
        if (actual > declared.maxReferences) {
            violations.push(`${path}: process.env budget exceeded actual=${actual} max=${declared.maxReferences}`);
        }
        if (declared.authorityClass === 'migration-target' && actual !== declared.maxReferences) {
            violations.push(`${path}: migration ratchet stale actual=${actual} declared=${declared.maxReferences}`);
        }
    }
    for (const [path] of declaredByPath.entries()) {
        const facts = moduleAuthorityFacts.get(path);
        if (!facts) violations.push(`${path}: stale config authority path`);
        else if (facts.processEnvReferences === 0) violations.push(`${path}: stale zero-reference config authority`);
    }

    const policy = asRecord(manifest['policy']);
    const canonicalSnapshotPath = policy['canonicalSnapshotPath'];
    const canonicalSnapshotOwner = policy['canonicalSnapshotOwner'];
    const canonicalEntries = [...declaredByPath.entries()].filter(
        ([, value]) => value.authorityClass === 'canonical-snapshot',
    );
    if (canonicalEntries.length !== 1) {
        violations.push(`canonical-snapshot authority count=${canonicalEntries.length}, expected=1`);
    }
    const canonicalDeclaredPath = canonicalEntries[0]?.[0];
    if (typeof canonicalSnapshotPath !== 'string' || canonicalDeclaredPath !== canonicalSnapshotPath) {
        violations.push(
            `canonical snapshot path mismatch policy=${String(canonicalSnapshotPath)} declared=${String(canonicalDeclaredPath)}`,
        );
    }
    const canonicalOwner = ownerManifestReport.owners.find((owner) => owner['ownerId'] === canonicalSnapshotOwner);
    if (!canonicalOwner) {
        violations.push(`canonical snapshot owner missing=${String(canonicalSnapshotOwner)}`);
    } else if (
        typeof canonicalSnapshotPath === 'string' &&
        typeof canonicalOwner['path'] === 'string' &&
        !canonicalSnapshotPath.startsWith(`${canonicalOwner['path']}/`)
    ) {
        violations.push(`${canonicalSnapshotPath}: outside canonical owner=${String(canonicalSnapshotOwner)}`);
    }

    return {
        violations,
        declaredFileCount: declaredByPath.size,
        actualFileCount,
        actualReferenceCount,
        migrationTargetCount,
        canonicalSnapshotPath,
    };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {Map<string, ReturnType<typeof collectModuleAuthorityFacts>>} moduleAuthorityFacts
 * @param {ReturnType<typeof validateMcpOwnerManifest>} ownerManifestReport
 * @param {string} canonicalSource
 */
function validateMcpWorkspaceIdentityManifest(manifest, moduleAuthorityFacts, ownerManifestReport, canonicalSource) {
    const violations = [];
    const expectedDefinition = Object.freeze({
        path: 'src/copilot/mcp/workspace/contracts/root.js',
        publicSpecifier: '#copilot/mcp/public/workspace',
        rootExport: 'MCP_WORKSPACE_ROOT',
        resolverExport: 'resolveMcpWorkspaceIdentityPath',
        relativeExport: 'toMcpWorkspaceRelativePath',
        derivation: 'import.meta.url',
    });
    const definition = asRecord(manifest['canonicalDefinition']);
    for (const [key, expected] of Object.entries(expectedDefinition)) {
        if (definition[key] !== expected) {
            violations.push(`canonicalDefinition.${key}=${String(definition[key])}, expected=${expected}`);
        }
    }
    if (
        !canonicalSource.includes("new URL('../../../../../', import.meta.url)") ||
        !canonicalSource.includes('resolve(MCP_WORKSPACE_ROOT, value)')
    ) {
        violations.push('canonical workspace identity is no longer derived only from module location');
    }

    const allowlistRows = Array.isArray(manifest['ambientCwdAllowlist']) ? manifest['ambientCwdAllowlist'] : [];
    const ambientCwdAllowlist = new Set(allowlistRows.filter((value) => typeof value === 'string'));
    if (ambientCwdAllowlist.size !== allowlistRows.length)
        violations.push('ambientCwdAllowlist contains invalid/duplicate rows');

    const consumers = Array.isArray(manifest['consumers']) ? manifest['consumers'].map(asRecord) : [];
    const declaredByPath = new Map();
    for (const consumer of consumers) {
        const path = consumer['path'];
        const ownerId = consumer['ownerId'];
        const symbols = Array.isArray(consumer['symbols'])
            ? [...new Set(consumer['symbols'].filter((value) => typeof value === 'string'))].sort()
            : [];
        const rationale = consumer['rationale'];
        if (typeof path !== 'string' || !path) {
            violations.push('workspace identity consumer missing path');
            continue;
        }
        if (declaredByPath.has(path)) violations.push(`${path}: duplicate workspace identity consumer`);
        declaredByPath.set(path, { ownerId, symbols });
        const owner = resolveMcpOwnerForPath(ownerManifestReport, path);
        if (!owner || owner['ownerId'] !== ownerId) {
            violations.push(
                `${path}: workspace identity owner actual=${String(owner?.['ownerId'] ?? 'missing')} declared=${String(ownerId)}`,
            );
        }
        if (symbols.length === 0) violations.push(`${path}: workspace identity consumer has no tracked symbols`);
        if (typeof rationale !== 'string' || rationale.trim().length < 12) {
            violations.push(`${path}: workspace identity consumer missing rationale`);
        }
    }

    let actualConsumerFiles = 0;
    let actualSymbolImports = 0;
    let ambientCwdCalls = 0;
    for (const [path, facts] of moduleAuthorityFacts.entries()) {
        const actualSymbols = [...facts.workspaceIdentityImports].sort();
        if (actualSymbols.length > 0) {
            actualConsumerFiles += 1;
            actualSymbolImports += actualSymbols.length;
            const declared = declaredByPath.get(path);
            if (!declared) {
                violations.push(`${path}: undeclared workspace identity consumer symbols=${actualSymbols.join('|')}`);
            } else if (JSON.stringify(declared.symbols) !== JSON.stringify(actualSymbols)) {
                violations.push(
                    `${path}: workspace identity symbols actual=${actualSymbols.join('|')} declared=${declared.symbols.join('|')}`,
                );
            }
        }
        if (facts.processCwdCalls.length > 0) {
            ambientCwdCalls += facts.processCwdCalls.length;
            if (!ambientCwdAllowlist.has(path)) {
                violations.push(`${path}: ambient process.cwd() at lines=${facts.processCwdCalls.join('|')}`);
            }
        }
    }
    for (const path of declaredByPath.keys()) {
        const facts = moduleAuthorityFacts.get(path);
        if (!facts) violations.push(`${path}: stale workspace identity consumer path`);
        else if (facts.workspaceIdentityImports.length === 0)
            violations.push(`${path}: stale workspace identity consumer`);
    }
    for (const path of ambientCwdAllowlist) {
        const facts = moduleAuthorityFacts.get(path);
        if (!facts || facts.processCwdCalls.length === 0) violations.push(`${path}: stale ambient cwd allowlist entry`);
    }

    return {
        violations,
        declaredConsumerFiles: declaredByPath.size,
        actualConsumerFiles,
        actualSymbolImports,
        ambientCwdCalls,
    };
}

/**
 * @returns {Promise<{ success: boolean; checks: { name: string; passed: boolean; detail: string }[] }>}
 */
export async function runArchitectureContractCheck() {
    /** @type {{ name: string; passed: boolean; detail: string }[]} */
    const checks = [];

    const mcpToolFiles = await collectSourceFiles('src/copilot/mcp/tools');
    const wireProcessAuthorityPattern =
        /(?:from\s+['"]node:child_process['"]|from\s+['"]child_process['"]|\b(?:spawn|execFile|execFileSync|fork)\s*\(|\bprocess\.kill\s*\(|\bchild\.kill\s*\()/u;
    const wireLauncherLiteralPattern = /(?:src\/copilot\/mcp\/scripts\/|scripts\/model-gateway\/)/u;
    const wireProcessAuthorityViolations = [];
    const wireLauncherViolations = [];
    for (const path of mcpToolFiles) {
        const content = await readWorkspaceText(path);
        if (wireProcessAuthorityPattern.test(content)) wireProcessAuthorityViolations.push(path);
        if (wireLauncherLiteralPattern.test(content)) wireLauncherViolations.push(path);
    }
    checks.push({
        name: 'mcp-wire-tools-own-no-child-process-authority',
        passed: wireProcessAuthorityViolations.length === 0,
        detail:
            wireProcessAuthorityViolations.length === 0
                ? 'wire tools delegate subprocess ownership to semantic runtime owners'
                : `violations=${wireProcessAuthorityViolations.join(',')}`,
    });
    checks.push({
        name: 'mcp-wire-tools-reference-no-physical-launchers',
        passed: wireLauncherViolations.length === 0,
        detail:
            wireLauncherViolations.length === 0
                ? 'wire tools depend on semantic owner APIs rather than launcher paths'
                : `violations=${wireLauncherViolations.join(',')}`,
    });

    const mcpSourceFiles = await collectSourceFiles('src/copilot/mcp');
    const ownerManifest = asRecord(JSON.parse(await readWorkspaceText('config/architecture/copilot-mcp-owners.json')));
    const dynamicGraphManifest = asRecord(
        JSON.parse(await readWorkspaceText('config/architecture/copilot-mcp-dynamic-graph.json')),
    );
    const configAuthorityManifest = asRecord(
        JSON.parse(await readWorkspaceText('config/architecture/copilot-mcp-config-authorities.json')),
    );
    const workspaceIdentityManifest = asRecord(
        JSON.parse(await readWorkspaceText('config/architecture/copilot-mcp-workspace-identity.json')),
    );
    const stateScopeManifest = asRecord(
        JSON.parse(await readWorkspaceText('config/architecture/copilot-mcp-state-scopes.json')),
    );
    const ownerManifestReport = validateMcpOwnerManifest(ownerManifest, mcpSourceFiles);
    checks.push({
        name: 'mcp-owner-manifest-is-complete-and-consistent',
        passed: ownerManifestReport.violations.length === 0,
        detail:
            ownerManifestReport.violations.length === 0
                ? `owners=${ownerManifestReport.owners.length} protectedBoundaries=${ownerManifestReport.protectedRoots.length}`
                : `violations=${ownerManifestReport.violations.join(',')}`,
    });

    const moduleAuthorityFacts = new Map();
    const moduleFactParseErrors = [];
    for (const path of mcpSourceFiles) {
        const facts = collectModuleAuthorityFacts(await readWorkspaceText(path), path);
        moduleAuthorityFacts.set(path, facts);
        if (facts.parseError) moduleFactParseErrors.push(facts.parseError);
    }
    checks.push({
        name: 'mcp-dynamic-authority-scan-parses-all-source-files',
        passed: moduleFactParseErrors.length === 0,
        detail:
            moduleFactParseErrors.length === 0
                ? `parsed=${mcpSourceFiles.length}`
                : `errors=${moduleFactParseErrors.join(',')}`,
    });

    const workspaceIdentityReport = validateMcpWorkspaceIdentityManifest(
        workspaceIdentityManifest,
        moduleAuthorityFacts,
        ownerManifestReport,
        await readWorkspaceText('src/copilot/mcp/workspace/contracts/root.js'),
    );
    checks.push({
        name: 'mcp-workspace-identity-authority-is-canonical-and-ratcheted',
        passed: workspaceIdentityReport.violations.length === 0,
        detail:
            workspaceIdentityReport.violations.length === 0
                ? `consumers=${workspaceIdentityReport.actualConsumerFiles} symbolImports=${workspaceIdentityReport.actualSymbolImports} ambientCwdCalls=${workspaceIdentityReport.ambientCwdCalls}`
                : `violations=${workspaceIdentityReport.violations.join(',')}`,
    });

    const stateScopeReport = validateMcpStateScopeManifest(
        stateScopeManifest,
        moduleAuthorityFacts,
        ownerManifestReport,
    );
    checks.push({
        name: 'mcp-top-level-mutable-state-is-declared-and-ratcheted',
        passed: stateScopeReport.violations.length === 0,
        detail:
            stateScopeReport.violations.length === 0
                ? `files=${stateScopeReport.actualFileCount} declarations=${stateScopeReport.actualDeclarationCount} migrationTargets=${stateScopeReport.migrationTargetCount}`
                : `violations=${stateScopeReport.violations.join(',')}`,
    });

    const configAuthorityReport = validateMcpConfigAuthorityManifest(
        configAuthorityManifest,
        moduleAuthorityFacts,
        ownerManifestReport,
    );
    checks.push({
        name: 'mcp-process-env-authorities-are-declared-and-ratcheted',
        passed: configAuthorityReport.violations.length === 0,
        detail:
            configAuthorityReport.violations.length === 0
                ? `files=${configAuthorityReport.actualFileCount} refs=${configAuthorityReport.actualReferenceCount} migrationTargets=${configAuthorityReport.migrationTargetCount}`
                : `violations=${configAuthorityReport.violations.join(',')}`,
    });
    checks.push({
        name: 'mcp-process-config-snapshot-authority-is-singular',
        passed:
            configAuthorityReport.violations.length === 0 &&
            configAuthorityReport.canonicalSnapshotPath === 'src/copilot/mcp/composition/process-config/runtime.js',
        detail:
            configAuthorityReport.violations.length === 0
                ? `canonical=${String(configAuthorityReport.canonicalSnapshotPath)}`
                : `violations=${configAuthorityReport.violations.join(',')}`,
    });

    const declaredComputedImports = Array.isArray(dynamicGraphManifest['computedImports'])
        ? dynamicGraphManifest['computedImports'].map(asRecord)
        : [];
    const actualComputedImports = [...moduleAuthorityFacts.entries()].flatMap(([path, facts]) => {
        const imports = /** @type {{ line: number | null; expressionType: string }[]} */ (facts.computedImports);
        return imports.map((entry) => ({ path, ...entry }));
    });
    const computedImportViolations = [];
    if (declaredComputedImports.length > 0) {
        computedImportViolations.push('computedImports manifest must remain empty; use a literal dynamic import');
    }
    for (const entry of actualComputedImports) {
        computedImportViolations.push(
            `${entry.path}:${String(entry.line ?? 'unknown-line')} computed import expressionType=${entry.expressionType}`,
        );
    }
    checks.push({
        name: 'mcp-computed-dynamic-imports-are-prohibited',
        passed: computedImportViolations.length === 0,
        detail:
            computedImportViolations.length === 0
                ? 'computedImports=0; lazy loading requires an exact literal module specifier'
                : `violations=${computedImportViolations.join(',')}`,
    });

    const dynamicPackageJson = asRecord(JSON.parse(await readWorkspaceText('package.json')));
    const dynamicPackageImports = asRecord(dynamicPackageJson['imports']);
    const declaredLiteralDynamicImports = Array.isArray(dynamicGraphManifest['literalDynamicImports'])
        ? dynamicGraphManifest['literalDynamicImports'].map(asRecord)
        : [];
    const actualLiteralDynamicImports = new Map();
    for (const [source, facts] of moduleAuthorityFacts.entries()) {
        for (const entry of facts.literalDynamicImports) {
            const key = `${source}\u0000${entry.specifier}`;
            actualLiteralDynamicImports.set(key, Number(actualLiteralDynamicImports.get(key) ?? 0) + 1);
        }
    }
    const declaredDependencyPackages = new Set([
        ...Object.keys(asRecord(dynamicPackageJson['dependencies'])),
        ...Object.keys(asRecord(dynamicPackageJson['devDependencies'])),
        ...Object.keys(asRecord(dynamicPackageJson['optionalDependencies'])),
    ]);
    const literalDynamicImportViolations = [];
    const declaredLiteralDynamicKeys = new Set();
    for (const entry of declaredLiteralDynamicImports) {
        const source = entry['source'];
        const specifier = entry['specifier'];
        const sourceOwnerId = entry['sourceOwnerId'];
        const targetOwnerId = entry['targetOwnerId'];
        const audience = entry['audience'];
        const loadPolicy = entry['loadPolicy'];
        const rationale = entry['rationale'];
        const expectedCount = Number(entry['expectedCount'] ?? 1);
        if (typeof source !== 'string' || typeof specifier !== 'string') {
            literalDynamicImportViolations.push('literal dynamic import entry missing source/specifier');
            continue;
        }
        const key = `${source}\u0000${specifier}`;
        if (declaredLiteralDynamicKeys.has(key)) {
            literalDynamicImportViolations.push(`${source}:${specifier} duplicate literal dynamic import declaration`);
            continue;
        }
        declaredLiteralDynamicKeys.add(key);
        const actualCount = Number(actualLiteralDynamicImports.get(key) ?? 0);
        if (!Number.isInteger(expectedCount) || expectedCount < 1 || actualCount !== expectedCount) {
            literalDynamicImportViolations.push(
                `${source}:${specifier} actual=${actualCount} declared=${String(expectedCount)}`,
            );
        }
        const sourceOwner = resolveMcpOwnerForPath(ownerManifestReport, source);
        if (!sourceOwner || sourceOwner['ownerId'] !== sourceOwnerId) {
            literalDynamicImportViolations.push(
                `${source}:${specifier} sourceOwner actual=${String(sourceOwner?.['ownerId'] ?? 'missing')} declared=${String(sourceOwnerId)}`,
            );
        }
        const packageTarget = normalizePackageImportTarget(dynamicPackageImports[specifier]);
        if (specifier.startsWith('#copilot/mcp/public/')) {
            if (!packageTarget) {
                literalDynamicImportViolations.push(`${source}:${specifier} missing exact MCP public package target`);
                continue;
            }
            const targetOwner = resolveMcpOwnerForPath(ownerManifestReport, packageTarget);
            if (!targetOwner || targetOwner['ownerId'] !== targetOwnerId) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} targetOwner actual=${String(targetOwner?.['ownerId'] ?? 'missing')} declared=${String(targetOwnerId)}`,
                );
            }
            if (audience !== 'public')
                literalDynamicImportViolations.push(`${source}:${specifier} audience must be public`);
        } else if (specifier.startsWith('#copilot/')) {
            if (!packageTarget || !specifier.includes('/public/')) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} cross-domain lazy import must use an exact public package membrane`,
                );
            }
            if (audience !== 'cross-domain-public') {
                literalDynamicImportViolations.push(`${source}:${specifier} audience must be cross-domain-public`);
            }
            if (targetOwnerId !== null && targetOwnerId !== undefined) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} cross-domain targetOwnerId must be null/omitted`,
                );
            }
        } else {
            if (specifier.startsWith('.') || specifier.startsWith('/')) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} relative/absolute lazy imports are forbidden across governance boundaries`,
                );
            }
            const packageName = specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : specifier.split('/')[0];
            if (!packageName || !declaredDependencyPackages.has(packageName)) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} external package is not declared in package.json`,
                );
            }
            if (audience !== 'external')
                literalDynamicImportViolations.push(`${source}:${specifier} audience must be external`);
            if (targetOwnerId !== null && targetOwnerId !== undefined) {
                literalDynamicImportViolations.push(
                    `${source}:${specifier} external targetOwnerId must be null/omitted`,
                );
            }
        }
        if (
            ![
                'protocol-compatibility-lazy',
                'startup-lazy',
                'operation-lazy',
                'benchmark-lazy',
                'native-probe-lazy',
                'optional-capability',
            ].includes(String(loadPolicy))
        ) {
            literalDynamicImportViolations.push(`${source}:${specifier} invalid loadPolicy=${String(loadPolicy)}`);
        }
        if (typeof rationale !== 'string' || rationale.trim().length < 12) {
            literalDynamicImportViolations.push(`${source}:${specifier} missing rationale`);
        }
    }
    for (const key of actualLiteralDynamicImports.keys()) {
        if (!declaredLiteralDynamicKeys.has(key)) {
            const [source, specifier] = key.split('\u0000');
            literalDynamicImportViolations.push(
                `${String(source)}:${String(specifier)} undeclared literal dynamic import`,
            );
        }
    }
    checks.push({
        name: 'mcp-literal-dynamic-imports-have-owned-public-surfaces',
        passed: literalDynamicImportViolations.length === 0,
        detail:
            literalDynamicImportViolations.length === 0
                ? `declared=${declaredLiteralDynamicImports.length} actual=${actualLiteralDynamicImports.size}`
                : `violations=${literalDynamicImportViolations.join(',')}`,
    });

    const httpHandlerSource = await readWorkspaceText('src/copilot/mcp/adapters/http/handler.js');
    const httpBodyReaderSource = await readWorkspaceText('src/copilot/mcp/adapters/http-body.js');
    const lazyCompatibilitySpecifiers = declaredLiteralDynamicImports
        .filter(
            (entry) =>
                entry['source'] === 'src/copilot/mcp/adapters/http/handler.js' &&
                entry['loadPolicy'] === 'protocol-compatibility-lazy' &&
                typeof entry['specifier'] === 'string',
        )
        .map((entry) => String(entry['specifier']));
    const httpCompatibilityClosureViolations = [];
    for (const specifier of lazyCompatibilitySpecifiers) {
        const hasStaticImport =
            httpHandlerSource.includes(`from '${specifier}'`) || httpHandlerSource.includes(`from "${specifier}"`);
        const hasLiteralDynamicImport =
            httpHandlerSource.includes(`import('${specifier}')`) ||
            httpHandlerSource.includes(`import("${specifier}")`);
        if (hasStaticImport) httpCompatibilityClosureViolations.push(`eager=${specifier}`);
        if (!hasLiteralDynamicImport) httpCompatibilityClosureViolations.push(`missing-lazy=${specifier}`);
    }
    if (lazyCompatibilitySpecifiers.length === 0)
        httpCompatibilityClosureViolations.push('missing-compatibility-lazy-manifest');
    if (httpHandlerSource.includes('NodeStreamableHTTPServerTransport')) {
        httpCompatibilityClosureViolations.push('adapter-owns-NodeStreamableHTTPServerTransport');
    }
    checks.push({
        name: 'mcp-modern-http-handler-keeps-compatibility-transports-lazy',
        passed: httpCompatibilityClosureViolations.length === 0,
        detail:
            httpCompatibilityClosureViolations.length === 0
                ? `literalLazyEdges=${lazyCompatibilitySpecifiers.length} eagerCompatEdges=0`
                : `violations=${httpCompatibilityClosureViolations.join(',')}`,
    });
    const httpBodyReaderBoundaryViolations = [];
    if (httpBodyReaderSource.includes('#copilot/mcp/public/transport/http/')) {
        httpBodyReaderBoundaryViolations.push('body-reader-imports-transport-semantics');
    }
    if (
        /\b(?:isMcpInitializeRequestBody|classifyMcpPostSessionRequirement|normalizeMcpSessionId)\b/u.test(
            httpBodyReaderSource,
        )
    ) {
        httpBodyReaderBoundaryViolations.push('body-reader-owns-session-classification');
    }
    checks.push({
        name: 'mcp-http-body-reader-is-host-io-only',
        passed: httpBodyReaderBoundaryViolations.length === 0,
        detail:
            httpBodyReaderBoundaryViolations.length === 0
                ? 'bounded Node body I/O is separate from stateful transport/session semantics'
                : `violations=${httpBodyReaderBoundaryViolations.join(',')}`,
    });

    const rawToolAnnotationViolations = [];
    for (const path of mcpToolFiles) {
        rawToolAnnotationViolations.push(...collectRawToolAnnotationDeclarations(await readWorkspaceText(path), path));
    }
    checks.push({
        name: 'mcp-raw-tools-declare-no-independent-risk-annotations',
        passed: rawToolAnnotationViolations.length === 0,
        detail:
            rawToolAnnotationViolations.length === 0
                ? 'canonical annotations are projected only from the semantic Tool Contract'
                : `violations=${rawToolAnnotationViolations.join(',')}`,
    });

    let rawToolDefinitionCount = 0;
    let typedRawToolDefinitionCount = 0;
    const rawToolDefinitionBoundaryViolations = [];
    for (const path of mcpToolFiles) {
        const facts = collectRawToolDefinitionBoundaryFacts(await readWorkspaceText(path), path);
        rawToolDefinitionCount += facts.definitions;
        typedRawToolDefinitionCount += facts.wrapped;
        rawToolDefinitionBoundaryViolations.push(...facts.violations);
    }
    const rawToolContractSource = await readWorkspaceText('src/copilot/mcp/protocol/catalog/contracts/types.js');
    const rawToolDefinitionSource = await readWorkspaceText('src/copilot/mcp/protocol/catalog/contracts/definition.js');
    const rawToolCatalogPublicSource = await readWorkspaceText('src/copilot/mcp/protocol/catalog/public/index.js');
    if (/\bargs:\s*any\b/u.test(rawToolContractSource)) {
        rawToolDefinitionBoundaryViolations.push('catalog/contracts/types.js:raw-handler-args-any');
    }
    if (!/\bargs:\s*unknown\b/u.test(rawToolContractSource)) {
        rawToolDefinitionBoundaryViolations.push('catalog/contracts/types.js:raw-handler-args-not-unknown');
    }
    if (!rawToolDefinitionSource.includes("import('zod').output<import('zod').ZodObject<TShape>>")) {
        rawToolDefinitionBoundaryViolations.push('catalog/contracts/definition.js:missing-zod-output-inference');
    }
    if (
        !rawToolCatalogPublicSource.includes('defineMcpRawTool') ||
        !rawToolCatalogPublicSource.includes('contracts/definition.js')
    ) {
        rawToolDefinitionBoundaryViolations.push('catalog/public/index.js:missing-defineMcpRawTool-public-membrane');
    }
    checks.push({
        name: 'mcp-raw-tool-handlers-are-zod-inferred-and-type-erased-once',
        passed: rawToolDefinitionBoundaryViolations.length === 0,
        detail:
            rawToolDefinitionBoundaryViolations.length === 0
                ? `definitions=${rawToolDefinitionCount} typed=${typedRawToolDefinitionCount} storageArgs=unknown inference=zod-output`
                : `violations=${rawToolDefinitionBoundaryViolations.join(',')}`,
    });

    const semanticRiskAuthorityFiles = [
        'src/copilot/mcp/registry/runtime.js',
        'src/copilot/mcp/server/runtime.js',
        'src/copilot/mcp/auth/resource-server/service.js',
    ];
    const retiredRiskHeuristicTokens = [
        'MUTATING_TOOL_NAME_MARKERS',
        'HIGH_IMPACT_TOOL_NAME_MARKERS',
        'MUTATION_NAME_PATTERN',
        'HIGH_IMPACT_NAME_PATTERN',
        'mutatingName',
        'highImpactName',
        'COPILOT_MCP_REGISTRY_STRICT_RISK_VALIDATION',
        'COPILOT_MCP_SERVER_STRICT_TOOL_RISK_VALIDATION',
    ];
    const semanticRiskAuthorityViolations = [];
    for (const path of semanticRiskAuthorityFiles) {
        const content = await readWorkspaceText(path);
        for (const token of retiredRiskHeuristicTokens) {
            if (content.includes(token)) semanticRiskAuthorityViolations.push(`${path}:${token}`);
        }
    }
    checks.push({
        name: 'mcp-tool-risk-authority-is-semantic-not-name-heuristic',
        passed: semanticRiskAuthorityViolations.length === 0,
        detail:
            semanticRiskAuthorityViolations.length === 0
                ? 'registry, server and auth consume explicit semantic contracts rather than tool-name heuristics'
                : `violations=${semanticRiskAuthorityViolations.join(',')}`,
    });

    const declaredChildProcessOwners = new Set(
        Array.isArray(dynamicGraphManifest['childProcessImportOwners'])
            ? dynamicGraphManifest['childProcessImportOwners'].filter((path) => typeof path === 'string')
            : [],
    );
    const actualChildProcessOwners = new Set(
        [...moduleAuthorityFacts.entries()].filter(([, facts]) => facts.childProcessImport).map(([path]) => path),
    );
    const childProcessManifestViolations = [
        ...[...actualChildProcessOwners]
            .filter((path) => !declaredChildProcessOwners.has(path))
            .map((path) => `undeclared=${path}`),
        ...[...declaredChildProcessOwners]
            .filter((path) => !actualChildProcessOwners.has(path))
            .map((path) => `stale=${path}`),
    ];
    checks.push({
        name: 'mcp-child-process-import-authorities-match-manifest',
        passed: childProcessManifestViolations.length === 0,
        detail:
            childProcessManifestViolations.length === 0
                ? `owners=${actualChildProcessOwners.size}`
                : `violations=${childProcessManifestViolations.join(',')}`,
    });

    const childProcessAuthorityReport = validateMcpChildProcessAuthorityManifest(
        dynamicGraphManifest,
        actualChildProcessOwners,
        moduleAuthorityFacts,
        ownerManifestReport,
    );
    checks.push({
        name: 'mcp-child-process-authorities-have-explicit-lifecycle-contracts',
        passed: childProcessAuthorityReport.violations.length === 0,
        detail:
            childProcessAuthorityReport.violations.length === 0
                ? `owners=${childProcessAuthorityReport.rows.length} launcherContracts=${childProcessAuthorityReport.rows.reduce((sum, row) => sum + (Array.isArray(row['launchers']) ? row['launchers'].length : 0), 0)}`
                : `violations=${childProcessAuthorityReport.violations.join(',')}`,
    });

    const declaredWorkerOwners = new Set(
        Array.isArray(dynamicGraphManifest['workerThreadImportOwners'])
            ? dynamicGraphManifest['workerThreadImportOwners'].filter((path) => typeof path === 'string')
            : [],
    );
    const actualWorkerOwners = new Set(
        [...moduleAuthorityFacts.entries()].filter(([, facts]) => facts.workerThreadImport).map(([path]) => path),
    );
    const workerManifestViolations = [
        ...[...actualWorkerOwners]
            .filter((path) => !declaredWorkerOwners.has(path))
            .map((path) => `undeclared=${path}`),
        ...[...declaredWorkerOwners].filter((path) => !actualWorkerOwners.has(path)).map((path) => `stale=${path}`),
    ];
    checks.push({
        name: 'mcp-worker-thread-import-authorities-match-manifest',
        passed: workerManifestViolations.length === 0,
        detail:
            workerManifestViolations.length === 0
                ? `owners=${actualWorkerOwners.size}`
                : `violations=${workerManifestViolations.join(',')}`,
    });

    const broadChildEnvironmentViolations = [];
    for (const [path, facts] of moduleAuthorityFacts.entries()) {
        if (facts.broadChildEnvironmentLines.length === 0) continue;
        const lines = facts.broadChildEnvironmentLines.filter((/** @type {number} */ line) => line > 0);
        broadChildEnvironmentViolations.push(`${path}:${lines.join('|') || 'unknown-line'}`);
    }
    checks.push({
        name: 'mcp-child-processes-never-inherit-broad-ambient-environment',
        passed: broadChildEnvironmentViolations.length === 0,
        detail:
            broadChildEnvironmentViolations.length === 0
                ? 'child environments are projected/explicit rather than broad ambient inheritance'
                : `violations=${broadChildEnvironmentViolations.join(',')}`,
    });

    const broadEnvironmentSpreadViolations = [];
    for (const [path, facts] of moduleAuthorityFacts.entries()) {
        if (facts.broadEnvironmentSpreadLines.length === 0) continue;
        const lines = facts.broadEnvironmentSpreadLines.filter((/** @type {number} */ line) => line > 0);
        broadEnvironmentSpreadViolations.push(`${path}:${lines.join('|') || 'unknown-line'}`);
    }
    checks.push({
        name: 'mcp-raw-environment-objects-are-never-broadly-spread',
        passed: broadEnvironmentSpreadViolations.length === 0,
        detail:
            broadEnvironmentSpreadViolations.length === 0
                ? 'raw env/parentEnv/process.env objects are projected instead of broadly copied'
                : `violations=${broadEnvironmentSpreadViolations.join(',')}`,
    });

    const importSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/gu;
    const protectedMcpOwnerRoots = ownerManifestReport.protectedRoots;
    const privateOwnerImportViolations = [];
    const crossTopRelativeImportViolations = [];
    const bootAuthorityViolations = [];
    const controlPlaneReferenceViolations = [];
    for (const path of mcpSourceFiles) {
        const content = await readWorkspaceText(path);
        importSpecifierPattern.lastIndex = 0;
        for (const match of content.matchAll(importSpecifierPattern)) {
            const specifier = match[1];
            if (!specifier) continue;
            if (
                (specifier === '#copilot/boot' || specifier.startsWith('#copilot/boot/')) &&
                !path.startsWith('src/copilot/mcp/composition/')
            ) {
                bootAuthorityViolations.push(`${path} -> ${specifier}`);
            }
            if (specifier.includes('/control-plane/') || specifier.startsWith('#copilot/mcp/control-plane')) {
                controlPlaneReferenceViolations.push(`${path} -> ${specifier}`);
            }
            if (!specifier.startsWith('.')) continue;
            const resolvedImport = posix.normalize(posix.join(posix.dirname(path), specifier));
            const mcpRootPrefix = 'src/copilot/mcp/';
            if (path.startsWith(mcpRootPrefix) && resolvedImport.startsWith(mcpRootPrefix)) {
                const sourceTop = path.slice(mcpRootPrefix.length).split('/')[0];
                const targetTop = resolvedImport.slice(mcpRootPrefix.length).split('/')[0];
                if (sourceTop && targetTop && sourceTop !== targetTop) {
                    crossTopRelativeImportViolations.push(`${path} -> ${specifier}`);
                }
            }
            for (const ownerRoot of protectedMcpOwnerRoots) {
                if (!resolvedImport.startsWith(`${ownerRoot}/`)) continue;
                if (path.startsWith(`${ownerRoot}/`)) continue;
                if (resolvedImport.includes('/public/') || resolvedImport.includes('/testing/')) continue;
                privateOwnerImportViolations.push(`${path} -> ${specifier}`);
            }
        }
    }
    checks.push({
        name: 'mcp-relative-cross-top-import-graph-is-zero',
        passed: crossTopRelativeImportViolations.length === 0,
        detail:
            crossTopRelativeImportViolations.length === 0
                ? 'literal static/dynamic/type relative imports do not cross MCP top-level domains'
                : `violations=${crossTopRelativeImportViolations.join(',')}`,
    });
    checks.push({
        name: 'mcp-boot-authority-confined-to-composition',
        passed: bootAuthorityViolations.length === 0,
        detail:
            bootAuthorityViolations.length === 0
                ? 'only MCP composition roots may depend on application boot authority'
                : `violations=${bootAuthorityViolations.join(',')}`,
    });
    const controlPlaneDirectoryExists = await architectureWorkspaceIo
        .statPath(resolve(ROOT, 'src/copilot/mcp/control-plane'))
        .then((value) => value.stats.isDirectory())
        .catch(() => false);
    checks.push({
        name: 'mcp-control-plane-owner-is-extinct',
        passed: controlPlaneReferenceViolations.length === 0 && !controlPlaneDirectoryExists,
        detail:
            controlPlaneReferenceViolations.length === 0 && !controlPlaneDirectoryExists
                ? 'retired control-plane topology is absent physically and from imports'
                : `directoryExists=${controlPlaneDirectoryExists} violations=${controlPlaneReferenceViolations.join(',') || 'none'}`,
    });
    checks.push({
        name: 'mcp-protected-owner-imports-cross-public-membranes',
        passed: privateOwnerImportViolations.length === 0,
        detail:
            privateOwnerImportViolations.length === 0
                ? 'protected MCP owners are crossed only through public/testing membranes'
                : `violations=${privateOwnerImportViolations.join(',')}`,
    });

    const presentationFiles = await collectSourceFiles(PRESENTATION_ROOT);
    const forbiddenBoundaryPattern = /(?:from\s+|import\s*)['"][^'"]*(?:\/terminal\/|#copilot\/terminal(?:\/|['"]))/u;
    for (const path of presentationFiles) {
        const content = await readWorkspaceText(path);
        const passed = !forbiddenBoundaryPattern.test(content);
        checks.push({
            name: `presentation-does-not-import-terminal:${path}`,
            passed,
            detail: passed ? 'ok' : 'presentation -> terminal import violates the shared-boundary contract',
        });
    }

    for (const budget of HOTSPOT_BUDGETS) {
        const absolute = resolve(ROOT, budget.path);
        const stats = (await architectureWorkspaceIo.statPath(absolute)).stats;
        const content =
            budget.maxLines === undefined
                ? null
                : (await architectureWorkspaceIo.readTextFresh(absolute, { includeHash: false })).content;
        const lines = content === null ? null : content.split(/\r?\n/u).length;
        const withinBytes = stats.size <= budget.maxBytes;
        const withinLines = budget.maxLines === undefined || (lines !== null && lines <= budget.maxLines);
        checks.push({
            name: `hotspot-budget:${budget.path}`,
            passed: withinBytes && withinLines,
            detail: `bytes=${stats.size}/${budget.maxBytes}${budget.maxLines === undefined ? '' : ` lines=${String(lines)}/${budget.maxLines}`}`,
        });
    }

    const permissionFallbackContracts = [
        {
            path: 'src/copilot/config/session-config.js',
            forbidden: ['?? approveAll', '= approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
        {
            path: 'src/copilot/sdk/session/lifecycle.js',
            forbidden: ['?? approveAll', '= approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
        {
            path: 'src/copilot/server/routes/sdk/session-crud.js',
            forbidden: ['sdkSession.approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
    ];
    for (const contract of permissionFallbackContracts) {
        const content = await readWorkspaceText(contract.path);
        const forbiddenFound = contract.forbidden.filter((snippet) => content.includes(snippet));
        const requiredPresent = content.includes(contract.required);
        checks.push({
            name: `permission-fallback-contract:${contract.path}`,
            passed: forbiddenFound.length === 0 && requiredPresent,
            detail:
                forbiddenFound.length === 0 && requiredPresent
                    ? 'configured policy helper is the implicit fallback'
                    : `required=${requiredPresent} forbidden=${forbiddenFound.join(',') || 'none'}`,
        });
    }

    const alwaysAliveProfile = await readWorkspaceText('src/copilot/hooks/presets/profiles.js');
    checks.push({
        name: 'always-alive-permission-default-is-configurable',
        passed: alwaysAliveProfile.includes('onPermissionRequest = createConfiguredPermissionHandler()'),
        detail: 'approve_all remains the central policy default; AlwaysAlive does not hard-code a separate fallback',
    });

    const packageJson = JSON.parse(await readWorkspaceText('package.json'));
    const packageLock = JSON.parse(await readWorkspaceText('package-lock.json'));
    const declaredSdkVersion = packageJson?.dependencies?.['@github/copilot-sdk'];
    const installedSdkVersion = packageLock?.packages?.['node_modules/@github/copilot-sdk']?.version;
    const sdkVersionAligned =
        typeof declaredSdkVersion === 'string' &&
        typeof installedSdkVersion === 'string' &&
        (declaredSdkVersion === installedSdkVersion || declaredSdkVersion.endsWith(installedSdkVersion));
    checks.push({
        name: 'copilot-sdk-declared-installed-version-aligned',
        passed: sdkVersionAligned,
        detail: `declared=${String(declaredSdkVersion ?? 'missing')} installed=${String(installedSdkVersion ?? 'missing')}`,
    });

    const packageImports = packageJson?.imports && typeof packageJson.imports === 'object' ? packageJson.imports : {};
    const retiredMcpAggregateAliases = [
        '#copilot/mcp',
        '#copilot/mcp/adapters',
        '#copilot/mcp/cloudflare',
        '#copilot/mcp/connection',
        '#copilot/mcp/scripts',
        '#copilot/mcp/tools',
        '#copilot/mcp/openai',
        '#copilot/mcp/public/adapters/http-shared',
        '#copilot/mcp/public/adapters/http-body',
        '#copilot/mcp/public/adapters/http-stateful',
        '#copilot/testing/mcp/adapters/http-shared',
        '#copilot/testing/mcp/adapters/http-protocol',
    ];
    const presentRetiredAliases = retiredMcpAggregateAliases.filter((key) => key in packageImports);
    const retiredMcpAggregateFiles = [
        'src/copilot/mcp/index.js',
        'src/copilot/mcp/cloudflare/public/index.js',
        'src/copilot/mcp/connection/index.js',
        'src/copilot/mcp/tool-surface.js',
        'src/copilot/mcp/scripts/tool-payload-audit.js',
        'src/copilot/mcp/server.js',
        'src/copilot/mcp/tools/apps-sdk-resources.js',
        'src/copilot/mcp/composition/process-host.js',
        'src/copilot/mcp/integrations/model-gateway/sqlite-fingerprint.js',
        'src/copilot/mcp/adapters/index.js',
        'src/copilot/mcp/scripts/oauth-smoke.js',
        'src/copilot/mcp/scripts/index.js',
        'src/copilot/mcp/tools/index.js',
        'src/copilot/mcp/openai/index.js',
        'src/copilot/mcp/tools/testing/latency-attribution.js',
        'src/copilot/mcp/adapters/http-shared.js',
        'src/copilot/mcp/adapters/http-stateful-router.js',
        'src/copilot/mcp/adapters/public/http-shared.js',
        'src/copilot/mcp/adapters/public/http-body.js',
        'src/copilot/mcp/adapters/public/http-stateful.js',
        'src/copilot/mcp/adapters/testing/http-shared.js',
        'src/copilot/mcp/protocol/tools/contracts/annotations.js',
    ];
    const presentRetiredFiles = [];
    for (const path of retiredMcpAggregateFiles) {
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, path))
            .then((value) => value.stats.isFile() || value.stats.isDirectory())
            .catch(() => false);
        if (exists) presentRetiredFiles.push(path);
    }
    checks.push({
        name: 'mcp-retired-aggregate-surfaces-remain-absent',
        passed: presentRetiredAliases.length === 0 && presentRetiredFiles.length === 0,
        detail:
            presentRetiredAliases.length === 0 && presentRetiredFiles.length === 0
                ? 'retired MCP aggregate aliases/barrels and misplaced owner files remain absent'
                : `aliases=${presentRetiredAliases.join(',') || 'none'} files=${presentRetiredFiles.join(',') || 'none'}`,
    });
    for (const [key, target] of Object.entries(packageImports)) {
        const checkedSurface =
            key.startsWith('#copilot/sdk') ||
            key.startsWith('#copilot/model-gateway/') ||
            key.startsWith('#copilot/mcp/public/') ||
            key.startsWith('#copilot/testing/mcp/');
        if (!checkedSurface || key.includes('*') || typeof target !== 'string' || !target.startsWith('./')) continue;
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, target.slice(2)))
            .then((value) => value.stats.isFile() || value.stats.isDirectory())
            .catch(() => false);
        checks.push({
            name: `public-package-import-target:${key}`,
            passed: exists,
            detail: `${target} ${exists ? 'exists' : 'missing'}`,
        });
    }

    const usageHandler = await readWorkspaceText('src/copilot/event-handlers/usage.js');
    const usageClassifier = await readWorkspaceText('src/copilot/event-handlers/usage-classifier.js');
    const autoModelPolicy = await readWorkspaceText('src/copilot/sdk/models/auto-policy.js');
    const liveRunner = await readWorkspaceText(
        'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs',
    );
    const liveReadiness = await readWorkspaceText('scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
    checks.push({
        name: 'usage-domain-does-not-infer-premium-requests',
        passed:
            !usageHandler.includes("emit('pr.consumed'") &&
            !usageClassifier.includes("PREMIUM_REQUEST: 'premium_request'") &&
            usageClassifier.includes("USER_TURN: 'user_turn'"),
        detail: 'assistant.usage is attributed by origin; request-based billing is legacy-only',
    });
    checks.push({
        name: 'auto-model-policy-is-usage-based',
        passed:
            !autoModelPolicy.includes('premium_multiplier_lte_1') &&
            !autoModelPolicy.includes('models_with_premium_request_multiplier_gt_1') &&
            autoModelPolicy.includes('usage_cost_efficiency'),
        detail: 'Auto policy has no request-multiplier criterion in the current usage-based contract',
    });
    checks.push({
        name: 'llmb-live-control-only-is-canonical',
        passed:
            liveRunner.includes('--control-only') &&
            liveRunner.includes('--no-pr is deprecated') &&
            !liveReadiness.includes('--no-pr'),
        detail: '--control-only is canonical; --no-pr exists only as a deprecated parser alias',
    });
    for (const path of [
        'src/copilot/mcp/tools/git-write.js',
        'src/copilot/mcp/tools/llm-b-live.js',
        'src/copilot/mcp/tools/restart-control.js',
        'src/copilot/mcp/scripts/scheduled-restart-runner.js',
        'src/copilot/mcp/runtime/reload/runner.js',
        'src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js',
        'src/copilot/mcp/cloudflare/transport-benchmark/runtime.js',
        'src/copilot/mcp/cloudflare/transport-benchmark/state.js',
        'src/copilot/mcp/diagnostics/io-cache/worker.js',
        'src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js',
        'src/copilot/mcp/validation/suites/runtime.js',
        'src/copilot/mcp/scripts/run-safe-validation-suite.js',
        'src/copilot/mcp/validation/devcontainer-shell/runtime.js',
        'src/copilot/mcp/scripts/validate-devcontainer-shell.js',
        'src/copilot/mcp/transport/http/stateful/bootstrap/runtime.js',
        'src/copilot/mcp/scripts/stateful-env.js',
    ]) {
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, path))
            .then((value) => value.stats.isFile())
            .catch(() => false);
        checks.push({
            name: `autonomy-runtime-entry-exists:${path}`,
            passed: exists,
            detail: exists ? 'ok' : 'missing',
        });
    }

    const byokLabels = await architectureWorkspaceIo
        .statPath(resolve(ROOT, 'src/copilot/terminal/byok/rendering/labels.js'))
        .then((value) => value.stats.isFile())
        .catch(() => false);
    checks.push({
        name: 'byok-presentation-labels-extracted',
        passed: byokLabels,
        detail: byokLabels ? 'terminal/byok/rendering/labels.js exists' : 'extracted BYOK labels module missing',
    });

    return { success: checks.every((check) => check.passed), checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runArchitectureContractCheck();
    const output = report.success
        ? {
              success: true,
              checkCount: report.checks.length,
              passedCount: report.checks.filter((check) => check.passed).length,
          }
        : report;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
}
