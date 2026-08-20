// @ts-check
/**
 * Metadata canônica de tools da LLM-B.
 *
 * Este módulo é puro e não conhece MCP runtime. Ele normaliza o que o terminal, o verifier e a própria LLM-B precisam
 * saber sobre uma tool local: operação, risco, efeitos colaterais, autonomia efetiva e capacidades de I/O.
 *
 * @module copilot/tools/introspection/tool-metadata
 */

/**
 * @typedef {'read'
 *     | 'write'
 *     | 'patch'
 *     | 'delete'
 *     | 'move'
 *     | 'copy'
 *     | 'search'
 *     | 'shell'
 *     | 'web'
 *     | 'session'
 *     | 'ask'
 *     | 'intent'
 *     | 'inspect'
 *     | 'unknown'} ToolOperation
 *
 *
 * @typedef {'low' | 'medium' | 'high' | 'destructive'} ToolRisk
 *
 * @typedef {'none' | 'filesystem' | 'process' | 'network' | 'session' | 'permission' | 'mixed' | 'unknown'} ToolSideEffect
 *
 *
 * @typedef {'approve_all' | 'audit_only' | 'selective'} ToolPermissionMode
 *
 * @typedef {{
 *     dryRun: boolean;
 *     rollback: boolean;
 *     hashPrecondition: boolean;
 *     pagination: boolean;
 *     streaming: boolean;
 *     diff: boolean;
 *     preview: boolean;
 * }} ToolCapabilityMetadata
 *
 *
 * @typedef {{
 *     name: string;
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 *     operation: ToolOperation;
 *     risk: ToolRisk;
 *     sideEffect: ToolSideEffect;
 *     targetKinds: string[];
 *     capabilities: ToolCapabilityMetadata;
 *     declaredSkipPermission: boolean;
 *     effectiveSkipPermission: boolean;
 *     autonomyReason: string | null;
 *     inferred: {
 *         operation: boolean;
 *         risk: boolean;
 *         sideEffect: boolean;
 *     };
 * }} ToolDefinitionMetadata
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
 * @param {string[] | undefined} tags
 * @returns {string[]}
 */
function normalizeTags(tags) {
    return (tags ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokens(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter(Boolean);
}

/**
 * @param {string[]} allTokens
 * @param {string[]} wanted
 * @returns {boolean}
 */
function hasAny(allTokens, wanted) {
    const set = new Set(allTokens);
    return wanted.some((token) => set.has(token));
}

/**
 * @param {unknown} schema
 * @returns {Record<string, unknown>}
 */
function schemaProperties(schema) {
    const record = objectOrNull(schema);
    const properties = objectOrNull(record?.['properties']);
    return properties ?? {};
}

/**
 * @param {Record<string, unknown>} properties
 * @param {string[]} names
 * @returns {boolean}
 */
function hasProperty(properties, names) {
    return names.some((name) => Object.prototype.hasOwnProperty.call(properties, name));
}

/**
 * @param {ToolPermissionMode} permissionMode
 * @returns {boolean}
 */
export function permissionModeSkipsPrompts(permissionMode) {
    return permissionMode === 'approve_all' || permissionMode === 'audit_only';
}

/**
 * @param {string} name
 * @param {string} category
 * @param {string[]} tags
 * @returns {ToolOperation}
 */
function inferOperation(name, category, tags) {
    const all = [...tokens(name), ...tokens(category), ...tags.flatMap(tokens)];
    if (hasAny(all, ['delete', 'remove', 'rm', 'unlink', 'quarantine'])) return 'delete';
    if (hasAny(all, ['patch', 'edit', 'replace'])) return 'patch';
    if (hasAny(all, ['move', 'mv', 'rename', 'restore'])) return 'move';
    if (hasAny(all, ['copy', 'cp'])) return 'copy';
    if (hasAny(all, ['write', 'create', 'append', 'mkdir', 'save', 'set', 'update'])) return 'write';
    if (hasAny(all, ['exec', 'shell', 'bash', 'command', 'run', 'terminal', 'npm', 'node'])) return 'shell';
    if (hasAny(all, ['search', 'find', 'grep', 'glob', 'symbol'])) return 'search';
    if (hasAny(all, ['web', 'fetch', 'http', 'url'])) return 'web';
    if (hasAny(all, ['ask', 'question', 'input', 'elicitation'])) return 'ask';
    if (hasAny(all, ['intent'])) return 'intent';
    if (hasAny(all, ['read', 'list', 'get', 'status', 'health', 'info', 'inspect', 'telemetry', 'metrics'])) {
        return hasAny(all, ['read']) ? 'read' : 'inspect';
    }
    if (hasAny(all, ['session', 'rpc', 'hub', 'todo', 'task', 'hook', 'permission'])) return 'session';
    return 'unknown';
}

/**
 * @param {ToolOperation} operation
 * @param {string} name
 * @returns {ToolRisk}
 */
function inferRisk(operation, name) {
    const all = tokens(name);
    if (operation === 'delete' || hasAny(all, ['reset', 'clean', 'kill', 'stop', 'remove', 'delete', 'quarantine'])) {
        return 'destructive';
    }
    if (operation === 'patch' || operation === 'write' || operation === 'move' || operation === 'copy') return 'high';
    if (operation === 'shell') return 'high';
    if (operation === 'session' && hasAny(all, ['set', 'toggle', 'reload', 'restart', 'permission', 'mode'])) {
        return 'high';
    }
    if (operation === 'web') return 'medium';
    if (operation === 'ask') return 'medium';
    return 'low';
}

/**
 * @param {ToolOperation} operation
 * @param {string} category
 * @returns {ToolSideEffect}
 */
function inferSideEffect(operation, category) {
    if (['read', 'search', 'inspect', 'intent'].includes(operation)) return 'none';
    if (['write', 'patch', 'delete', 'move', 'copy'].includes(operation)) return 'filesystem';
    if (operation === 'shell') return 'process';
    if (operation === 'web') return 'network';
    if (operation === 'ask') return 'session';
    if (category === 'permission') return 'permission';
    if (['session', 'session-rpc', 'hub', 'hook', 'task', 'todo'].includes(category)) return 'session';
    return 'unknown';
}

/**
 * @param {ToolOperation} operation
 * @param {Record<string, unknown>} properties
 * @returns {ToolCapabilityMetadata}
 */
function inferCapabilities(operation, properties) {
    return {
        dryRun: hasProperty(properties, ['dryRun', 'dry_run']) || operation === 'patch',
        rollback: ['write', 'patch', 'delete', 'move', 'copy'].includes(operation),
        hashPrecondition: hasProperty(properties, ['expectedHash', 'expected_hash']),
        pagination: hasProperty(properties, ['cursor', 'maxLines', 'maxEntries', 'limit', 'offset']),
        streaming: hasProperty(properties, ['readStrategy', 'streamHighWaterMark']) || operation === 'shell',
        diff: hasProperty(properties, ['diffContextLines', 'maxDiffLines']) || operation === 'patch',
        preview: ['read', 'patch', 'search', 'inspect'].includes(operation),
    };
}

/**
 * @param {ToolOperation} operation
 * @returns {string[]}
 */
function inferTargetKinds(operation) {
    if (['read', 'write', 'patch', 'delete', 'move', 'copy', 'search'].includes(operation)) return ['file'];
    if (operation === 'shell') return ['command'];
    if (operation === 'web') return ['url'];
    if (operation === 'ask') return ['human'];
    if (operation === 'session' || operation === 'intent' || operation === 'inspect') return ['session'];
    return [];
}

/**
 * @param {ToolRisk} risk
 * @returns {boolean}
 */
export function isHighImpactToolRisk(risk) {
    return risk === 'high' || risk === 'destructive';
}

/**
 * @param {string} entryName
 * @param {unknown} entryValue
 * @param {{ permissionMode?: ToolPermissionMode }} [options]
 * @returns {ToolDefinitionMetadata}
 */
export function buildToolDefinitionMetadata(entryName, entryValue, options = {}) {
    const entry = objectOrNull(entryValue) ?? {};
    const tool = objectOrNull(entry['tool']) ?? {};
    const name = typeof tool['name'] === 'string' && tool['name'].trim() ? tool['name'].trim() : entryName;
    const category =
        typeof entry['category'] === 'string' && entry['category'].trim() ? entry['category'].trim() : 'unknown';
    const tags = normalizeTags(Array.isArray(entry['tags']) ? /** @type {string[]} */ (entry['tags']) : []);
    const readOnly = entry['readOnly'] === true;
    const operation = inferOperation(name, category, tags);
    const risk = readOnly ? 'low' : inferRisk(operation, name);
    const sideEffect = readOnly ? 'none' : inferSideEffect(operation, category);
    const declaredSkipPermission = tool['skipPermission'] === true;
    const permissionMode = options.permissionMode ?? 'selective';
    const effectiveSkipPermission = declaredSkipPermission || permissionModeSkipsPrompts(permissionMode);
    const properties = schemaProperties(tool['parameters']);
    const autonomyReason =
        effectiveSkipPermission && !declaredSkipPermission
            ? `permissionMode=${permissionMode}`
            : effectiveSkipPermission
              ? 'tool.skipPermission=true'
              : null;

    return {
        name,
        category,
        tags,
        readOnly,
        operation,
        risk,
        sideEffect,
        targetKinds: inferTargetKinds(operation),
        capabilities: inferCapabilities(operation, properties),
        declaredSkipPermission,
        effectiveSkipPermission,
        autonomyReason,
        inferred: {
            operation: true,
            risk: true,
            sideEffect: true,
        },
    };
}
