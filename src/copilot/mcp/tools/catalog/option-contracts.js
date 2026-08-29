// @ts-check
/**
 * Declarative semantic contracts for high-friction MCP tool options.
 *
 * This SSOT describes option activation/default/precedence/inheritance semantics without changing the wire descriptor.
 * It is intentionally narrower than the exhaustive Tool Contract catalog: only tools whose option interactions are
 * operationally important are enrolled. Unknown tools remain unobserved rather than being inferred heuristically.
 *
 * The projection API is content-free by construction. It emits only bounded enums and counts; option names, values,
 * commands, paths, environment values, patch text and payloads never enter audit telemetry.
 *
 * @module copilot/mcp/tools/catalog/option-contracts
 */

import { readMcpWorkflowPolicy } from '#copilot/mcp/public/workflow-policy';

export const MCP_TOOL_OPTION_CONTRACTS_VERSION = '1.12.0';

const OPTION_CATEGORIES = Object.freeze(['semantic', 'tuning', 'result', 'safety', 'recovery']);
const INACTIVE_POLICIES = Object.freeze(['reject']);

/**
 * @typedef {'semantic' | 'tuning' | 'result' | 'safety' | 'recovery'} McpToolOptionCategory
 * @typedef {'reject'} McpToolInactiveOptionPolicy
 * @typedef {{
 *   category: McpToolOptionCategory;
 *   activeIn?: readonly string[];
 *   inactivePolicy?: McpToolInactiveOptionPolicy;
 *   defaultKind?: 'literal' | 'runtime' | 'derived';
 *   requires?: string;
 * }} McpToolOptionDescriptor
 * @typedef {{kind:'presence'; option:string; presentMode:string; absentMode:string} |
 *           {kind:'enum'; option:string; defaultMode?:string; allowedModes:readonly string[]} |
 *           {kind:'boolean'; option:string; trueMode:string; falseMode:string; defaultMode:string} |
 *           {kind:'dry-run-confirm'} |
 *           {kind:'constant'; mode:string}} McpToolOptionModeRule
 * @typedef {{kind:'alias-precedence'; primary:string; alias:string; divergencePolicy:'reject-divergence'} |
 *           {kind:'nested-boolean-forces-enum'; collection:string; nestedOption:string; option:string; forcedValue:string} |
 *           {kind:'nested-collection-boolean-forces-enum'; collection:string; nestedCollection:string; nestedOption:string; option:string; forcedValue:string}} McpToolOptionNormalizationRule
 * @typedef {{source:string; target:string; precedence:'source'}} McpToolOptionInheritanceRule
 * @typedef {{domain:'patch'|'fileBatch'|'terminal'; defaults?:Readonly<Record<string,string|number|boolean>>}} McpToolOptionWorkflowBinding
 * @typedef {{
 *   mode: McpToolOptionModeRule;
 *   options: Readonly<Record<string, McpToolOptionDescriptor>>;
 *   normalization?: readonly McpToolOptionNormalizationRule[];
 *   inheritance?: readonly McpToolOptionInheritanceRule[];
 *   workflow?: Readonly<McpToolOptionWorkflowBinding>;
 * }} McpToolOptionContract
 */

/** @type {Readonly<Record<string, McpToolOptionContract>>} */
const OPTION_CONTRACTS = Object.freeze({
    terminal_exec: Object.freeze({
        mode: Object.freeze({ kind: 'presence', option: 'batch', presentMode: 'batch', absentMode: 'single' }),
        workflow: Object.freeze({
            domain: 'terminal',
            defaults: Object.freeze({ batchCapacity: 32 }),
        }),
        options: Object.freeze({
            command: option('semantic', ['single'], 'reject'),
            args: option('semantic', ['single'], 'reject', 'literal'),
            shell: option('semantic', ['single'], 'reject', 'literal'),
            shellPath: option('semantic', ['single'], 'reject', 'runtime'),
            cwd: option('semantic', ['single'], 'reject', 'runtime'),
            env: option('semantic', ['single'], 'reject'),
            inheritEnv: option('safety', ['single'], 'reject', 'literal'),
            stdin: option('semantic', ['single'], 'reject'),
            timeoutMs: option('tuning', ['single'], 'reject', 'literal'),
            maxOutputBytes: option('tuning', ['single'], 'reject', 'literal'),
            batch: option('semantic', ['batch'], 'reject'),
            batchConcurrency: option('tuning', ['batch'], 'reject', 'literal'),
            batchFailureMode: option('semantic', ['batch'], 'reject', 'literal'),
            batchResultBudgetBytes: option('tuning', ['batch'], 'reject', 'literal'),
        }),
    }),
    terminal_session_control: Object.freeze({
        mode: Object.freeze({
            kind: 'enum',
            option: 'action',
            allowedModes: Object.freeze(['open', 'write', 'eof', 'resize', 'signal', 'close', 'forget']),
        }),
        options: Object.freeze({
            action: option('semantic'),
            sessionId: option('semantic', ['write', 'eof', 'resize', 'signal', 'close', 'forget'], 'reject'),
            command: option('semantic', ['open'], 'reject', 'runtime'),
            args: option('semantic', ['open'], 'reject', 'literal'),
            shell: option('semantic', ['open'], 'reject', 'literal'),
            shellPath: option('semantic', ['open'], 'reject', 'runtime'),
            cwd: option('semantic', ['open'], 'reject', 'runtime'),
            env: option('semantic', ['open'], 'reject'),
            inheritEnv: option('safety', ['open'], 'reject', 'literal'),
            backend: option('semantic', ['open'], 'reject', 'literal'),
            cols: option('tuning', ['open', 'resize'], 'reject', 'literal'),
            rows: option('tuning', ['open', 'resize'], 'reject', 'literal'),
            bufferBytes: option('tuning', ['open'], 'reject', 'runtime'),
            initialInput: option('semantic', ['open'], 'reject'),
            data: option('semantic', ['write'], 'reject', 'literal'),
            appendNewline: option('semantic', ['write'], 'reject', 'literal'),
            signal: option('semantic', ['signal'], 'reject', 'literal'),
            processGroup: option('safety', ['signal', 'close'], 'reject', 'literal'),
            graceMs: option('safety', ['close'], 'reject', 'literal'),
        }),
    }),
    terminal_session_read: Object.freeze({
        mode: Object.freeze({
            kind: 'enum',
            option: 'action',
            defaultMode: 'read',
            allowedModes: Object.freeze(['read', 'status', 'list', 'capabilities']),
        }),
        options: Object.freeze({
            action: option('semantic', undefined, undefined, 'literal'),
            sessionId: option('semantic', ['read', 'status'], 'reject'),
            afterSeq: option('semantic', ['read'], 'reject', 'literal'),
            maxBytes: option('tuning', ['read'], 'reject', 'literal'),
            limit: option('tuning', ['list'], 'reject', 'literal'),
            waitFor: option('semantic', ['read'], 'reject'),
            waitMs: option('tuning', ['read'], 'reject', 'literal', 'waitFor'),
        }),
    }),
    repo_read_file: Object.freeze({
        mode: Object.freeze({ kind: 'presence', option: 'batch', presentMode: 'batch', absentMode: 'single' }),
        options: Object.freeze({
            path: option('semantic', ['single'], 'reject'),
            startLine: option('semantic', ['single'], 'reject'),
            endLine: option('semantic', ['single'], 'reject'),
            hashMode: option('result', ['single'], 'reject', 'literal'),
            batch: option('semantic', ['batch'], 'reject'),
            batchFailureMode: option('semantic', ['batch'], 'reject', 'literal'),
            batchConcurrency: option('tuning', ['batch'], 'reject', 'literal'),
            batchResultBudgetBytes: option('tuning', ['batch'], 'reject', 'literal'),
        }),
    }),
    repo_file_outline: Object.freeze({
        mode: Object.freeze({ kind: 'presence', option: 'batch', presentMode: 'batch', absentMode: 'single' }),
        options: Object.freeze({
            path: option('semantic', ['single'], 'reject'),
            includeImports: option('result', ['single'], 'reject', 'literal'),
            includeExports: option('result', ['single'], 'reject', 'literal'),
            includeOutline: option('result', ['single'], 'reject', 'literal'),
            includeTopComments: option('result', ['single'], 'reject', 'literal'),
            maxItems: option('result', ['single'], 'reject', 'literal'),
            maxBytes: option('result', ['single'], 'reject', 'literal'),
            cursor: option('semantic', ['single'], 'reject'),
            batch: option('semantic', ['batch'], 'reject'),
            batchFailureMode: option('semantic', ['batch'], 'reject', 'literal'),
            batchConcurrency: option('tuning', ['batch'], 'reject', 'literal'),
            batchResultBudgetBytes: option('tuning', ['batch'], 'reject', 'literal'),
        }),
    }),
    repo_search_text: Object.freeze({
        mode: Object.freeze({ kind: 'presence', option: 'batch', presentMode: 'batch', absentMode: 'single' }),
        options: Object.freeze({
            pattern: option('semantic', ['single'], 'reject'),
            query: option('semantic', ['single'], 'reject'),
            path: option('semantic', ['single'], 'reject', 'runtime'),
            isRegex: option('semantic', ['single'], 'reject', 'literal'),
            caseSensitive: option('semantic', ['single'], 'reject', 'literal'),
            includePattern: option('semantic', ['single'], 'reject'),
            excludePattern: option('semantic', ['single'], 'reject'),
            contextLines: option('result', ['single'], 'reject', 'literal'),
            maxResults: option('result', ['single'], 'reject', 'runtime'),
            cursor: option('semantic', ['single'], 'reject'),
            batch: option('semantic', ['batch'], 'reject'),
            batchFailureMode: option('semantic', ['batch'], 'reject', 'literal'),
            batchConcurrency: option('tuning', ['batch'], 'reject', 'literal'),
            batchResultBudgetBytes: option('tuning', ['batch'], 'reject', 'literal'),
        }),
        normalization: Object.freeze([
            Object.freeze({
                kind: 'alias-precedence',
                primary: 'pattern',
                alias: 'query',
                divergencePolicy: 'reject-divergence',
            }),
        ]),
    }),
    repo_apply_patch_batch: Object.freeze({
        mode: Object.freeze({ kind: 'dry-run-confirm' }),
        workflow: Object.freeze({
            domain: 'patch',
            defaults: Object.freeze({ defaultApplyMode: 'per-target-fast', defaultFailureMode: 'best-effort' }),
        }),
        options: Object.freeze({
            targets: option('semantic'),
            dryRun: option('safety', undefined, undefined, 'derived'),
            confirmBatch: option('safety', ['apply'], 'reject'),
            applyMode: option('semantic', undefined, undefined, 'literal'),
            failureMode: option('semantic', ['apply'], 'reject', 'derived'),
            targetConcurrency: option('tuning', undefined, undefined, 'derived'),
            resultMode: option('result', undefined, undefined, 'literal'),
            includePreflightDetails: option('result', ['apply'], 'reject', 'literal'),
            postValidate: option('safety'),
            postValidateOnPartial: option('recovery', ['apply'], 'reject', 'literal', 'postValidate'),
        }),
        normalization: Object.freeze([
            Object.freeze({
                kind: 'nested-collection-boolean-forces-enum',
                collection: 'targets',
                nestedCollection: 'operations',
                nestedOption: 'includeDiffPreview',
                option: 'resultMode',
                forcedValue: 'detailed',
            }),
        ]),
    }),
    repo_apply_patch: Object.freeze({
        mode: Object.freeze({
            kind: 'boolean',
            option: 'dryRun',
            trueMode: 'dry-run',
            falseMode: 'apply',
            defaultMode: 'apply',
        }),
        options: Object.freeze({
            path: option('semantic'),
            old_string: option('semantic'),
            new_string: option('semantic'),
            replace_all: option('semantic', undefined, undefined, 'literal'),
            expected_occurrences: option('safety'),
            occurrence_index: option('semantic'),
            expectedHash: option('safety'),
            dryRun: option('safety', undefined, undefined, 'literal'),
            allowNoop: option('recovery', undefined, undefined, 'literal'),
            diffContextLines: option('result', undefined, undefined, 'literal'),
            maxDiffLines: option('result', undefined, undefined, 'literal'),
            includeDiffPreview: option('result', undefined, undefined, 'literal'),
            durability: option('safety', ['apply'], 'reject', 'literal'),
        }),
    }),
    repo_apply_file_batch: Object.freeze({
        mode: Object.freeze({ kind: 'dry-run-confirm' }),
        workflow: Object.freeze({ domain: 'fileBatch' }),
        options: Object.freeze({
            operations: option('semantic'),
            dryRun: option('safety', undefined, undefined, 'derived'),
            confirmBatch: option('safety', ['apply'], 'reject'),
            applyMode: option('semantic', undefined, undefined, 'derived'),
            includePreflightDetails: option('result', ['apply'], 'reject', 'literal'),
        }),
    }),
    repo_bulk_inspect: Object.freeze({
        mode: Object.freeze({ kind: 'presence', option: 'operations', presentMode: 'batch', absentMode: 'single' }),
        options: Object.freeze({
            single: option('semantic', ['single'], 'reject'),
            operations: option('semantic', ['batch'], 'reject'),
            failureMode: option('semantic', ['batch'], 'reject', 'literal'),
            concurrency: option('tuning', ['batch'], 'reject', 'literal'),
            resultBudgetBytes: option('tuning', ['batch'], 'reject', 'literal'),
        }),
    }),
    repo_tree: Object.freeze({
        mode: Object.freeze({ kind: 'constant', mode: 'read' }),
        options: Object.freeze({
            path: option('semantic', undefined, undefined, 'runtime'),
            recursive: option('semantic', undefined, undefined, 'literal'),
            depth: option('semantic', undefined, undefined, 'literal'),
            maxEntries: option('result', undefined, undefined, 'literal'),
            showHidden: option('semantic', undefined, undefined, 'literal'),
            includePattern: option('semantic'),
            excludePattern: option('semantic'),
            maxOutputBytes: option('result', undefined, undefined, 'literal'),
            cursor: option('semantic'),
        }),
    }),
    repo_inventory: Object.freeze({
        mode: Object.freeze({ kind: 'constant', mode: 'read' }),
        options: Object.freeze({
            source: option('semantic', undefined, undefined, 'literal'),
            path: option('semantic', undefined, undefined, 'runtime'),
            maxResults: option('result', undefined, undefined, 'literal'),
            maxOutputBytes: option('result', undefined, undefined, 'literal'),
            cursor: option('semantic'),
        }),
    }),
    repo_read_file_chunks: Object.freeze({
        mode: Object.freeze({ kind: 'constant', mode: 'read' }),
        options: Object.freeze({
            path: option('semantic'),
            startLine: option('semantic'),
            endLine: option('semantic'),
            chunkLines: option('result', undefined, undefined, 'literal'),
            maxChunks: option('result', undefined, undefined, 'literal'),
            maxOutputBytes: option('result', undefined, undefined, 'literal'),
            cursor: option('semantic'),
            highWaterMark: option('tuning', undefined, undefined, 'runtime'),
        }),
    }),
});

/**
 * @param {McpToolOptionCategory} category
 * @param {readonly string[]} [activeIn]
 * @param {McpToolInactiveOptionPolicy} [inactivePolicy]
 * @param {'literal'|'runtime'|'derived'} [defaultKind]
 * @param {string} [requires]
 * @returns {Readonly<McpToolOptionDescriptor>}
 */
function option(category, activeIn, inactivePolicy, defaultKind, requires) {
    return Object.freeze({
        category,
        ...(activeIn ? { activeIn: Object.freeze([...activeIn]) } : {}),
        ...(inactivePolicy ? { inactivePolicy } : {}),
        ...(defaultKind ? { defaultKind } : {}),
        ...(requires ? { requires } : {}),
    });
}

/**
 * Testing-only direct-module projection. This is intentionally not exported by the public catalog membrane: tests may
 * enumerate the immutable contract to prove combinatorial invariants without expanding the MCP wire or production API.
 */
export function readMcpToolOptionContractsForTests() {
    return OPTION_CONTRACTS;
}

/** Return bounded coverage facts without exposing the contract body on the wire. */
export function readMcpToolOptionContractCoverage() {
    const toolNames = Object.keys(OPTION_CONTRACTS).sort();
    const categoryCounts = Object.fromEntries(OPTION_CATEGORIES.map((category) => [category, 0]));
    let optionCount = 0;
    for (const contract of Object.values(OPTION_CONTRACTS)) {
        for (const descriptor of Object.values(contract.options)) {
            optionCount += 1;
            categoryCounts[descriptor.category] = (categoryCounts[descriptor.category] ?? 0) + 1;
        }
    }
    return Object.freeze({
        version: MCP_TOOL_OPTION_CONTRACTS_VERSION,
        coveredToolCount: toolNames.length,
        optionCount,
        categoryCounts: Object.freeze(categoryCounts),
        toolNames: Object.freeze(toolNames),
    });
}

/**
 * Fail catalog construction when a covered tool's actual Zod input fields diverge from its option contract.
 * This deliberately validates only enrolled tools: unenrolled tools are not implicitly declared correct.
 *
 * @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} tools
 */
export function assertMcpToolOptionContractParity(tools) {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    /** @type {string[]} */
    const violations = [];
    for (const [toolName, contract] of Object.entries(OPTION_CONTRACTS)) {
        const tool = byName.get(toolName);
        if (!tool) {
            violations.push(`${toolName}: covered tool is absent from canonical catalog`);
            continue;
        }
        const inputSchema = tool.inputSchema ?? {};
        const actual = Object.keys(inputSchema).sort();
        const declared = Object.keys(contract.options).sort();
        const missing = actual.filter((name) => !declared.includes(name));
        const stale = declared.filter((name) => !actual.includes(name));
        if (missing.length > 0 || stale.length > 0) {
            violations.push(
                `${toolName}: option parity mismatch missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}`,
            );
        }
        for (const optionName of declared) {
            const description = readSchemaDescription(inputSchema[optionName]);
            if (!description)
                violations.push(`${toolName}.${optionName}: covered option requires a non-empty description`);
        }
        validateContractShape(toolName, contract, violations);
    }
    validateWorkflowParity(violations);
    if (violations.length > 0) throw new Error(`MCP option contract violations: ${violations.join(' | ')}`);
}

/**
 * Project only sanitized aggregate option-policy facts for one validated tool call.
 *
 * Rates are derived downstream; this layer emits integer counts and one allowlisted mode only.
 * @param {string} toolName
 * @param {unknown} args
 * @returns {Readonly<Record<string, string | number>> | null}
 */
export function projectMcpToolOptionPolicy(toolName, args) {
    const contract = OPTION_CONTRACTS[toolName];
    if (!contract) return null;
    const input = asRecord(args);
    const mode = resolveMode(contract.mode, input);
    const requestedNames = Object.keys(contract.options).filter((name) => input[name] !== undefined);
    let defaultedCount = 0;
    const ignoredCount = 0;
    let rejectedCount = 0;
    let conflictCount = 0;
    let normalizedCount = 0;
    let coercedCount = 0;

    for (const [name, descriptor] of Object.entries(contract.options)) {
        const requested = input[name] !== undefined;
        const active = isOptionActive(descriptor, mode, input);
        if (requested) {
            if (active) continue;
            if ((descriptor.inactivePolicy ?? 'reject') === 'reject') {
                rejectedCount += 1;
                conflictCount += 1;
            }
        } else if (active && descriptor.defaultKind) {
            defaultedCount += 1;
        }
    }

    for (const rule of contract.normalization ?? []) {
        if (rule.kind === 'alias-precedence') {
            if (!isNamedOptionActive(contract, rule.alias, mode, input)) continue;
            const primaryPresent = input[rule.primary] !== undefined;
            const aliasPresent = input[rule.alias] !== undefined;
            if (!aliasPresent) continue;
            if (!primaryPresent || Object.is(input[rule.primary], input[rule.alias])) {
                normalizedCount += 1;
                continue;
            }
            conflictCount += 1;
            rejectedCount += 1;
            continue;
        }
        if (!isNamedOptionActive(contract, rule.option, mode, input)) continue;
        const collection = input[rule.collection];
        if (!Array.isArray(collection)) continue;
        const forceRequested =
            rule.kind === 'nested-collection-boolean-forces-enum'
                ? collection.some((item) => {
                      const nested = asRecord(item)[rule.nestedCollection];
                      return (
                          Array.isArray(nested) && nested.some((entry) => asRecord(entry)[rule.nestedOption] === true)
                      );
                  })
                : collection.some((item) => asRecord(item)[rule.nestedOption] === true);
        if (!forceRequested) continue;
        const explicit = input[rule.option];
        if (explicit !== undefined && explicit !== rule.forcedValue) {
            coercedCount += 1;
            conflictCount += 1;
        } else if (explicit === undefined) {
            normalizedCount += 1;
        }
    }

    for (const rule of contract.inheritance ?? []) {
        if (input[rule.source] === undefined || !isNamedOptionActive(contract, rule.source, mode, input)) continue;
        normalizedCount += 1;
    }
    const effectiveRequestedCount = Math.max(0, requestedNames.length - ignoredCount - rejectedCount);

    return Object.freeze({
        optionContractVersion: MCP_TOOL_OPTION_CONTRACTS_VERSION,
        optionPolicyCoverage: 'complete',
        optionMode: mode,
        optionDeclaredCount: Object.keys(contract.options).length,
        optionRequestedCount: requestedNames.length,
        optionEffectiveRequestedCount: effectiveRequestedCount,
        optionDefaultedCount: defaultedCount,
        optionNormalizedCount: normalizedCount,
        optionIgnoredCount: ignoredCount,
        optionCoercedCount: coercedCount,
        optionRejectedCount: rejectedCount,
        optionConflictCount: conflictCount,
    });
}

/** @param {McpToolOptionModeRule} rule @param {Record<string, unknown>} input */
function resolveMode(rule, input) {
    if (rule.kind === 'presence') return input[rule.option] !== undefined ? rule.presentMode : rule.absentMode;
    if (rule.kind === 'enum') {
        const value = input[rule.option];
        return typeof value === 'string' && rule.allowedModes.includes(value) ? value : (rule.defaultMode ?? 'unknown');
    }
    if (rule.kind === 'boolean') {
        const value = input[rule.option];
        if (value === true) return rule.trueMode;
        if (value === false) return rule.falseMode;
        return rule.defaultMode;
    }
    if (rule.kind === 'constant') return rule.mode;
    if (input['dryRun'] === true) return 'dry-run';
    if (input['dryRun'] === false) return 'apply';
    return input['confirmBatch'] === true ? 'apply' : 'dry-run';
}

/** @param {McpToolOptionDescriptor} descriptor @param {string} mode @param {Record<string, unknown>} input */
function isOptionActive(descriptor, mode, input) {
    if (descriptor.activeIn && !descriptor.activeIn.includes(mode)) return false;
    if (descriptor.requires && input[descriptor.requires] === undefined) return false;
    return true;
}

/** @param {McpToolOptionContract} contract @param {string} name @param {string} mode @param {Record<string, unknown>} input */
function isNamedOptionActive(contract, name, mode, input) {
    const descriptor = contract.options[name];
    return descriptor ? isOptionActive(descriptor, mode, input) : false;
}

/** @param {string} toolName @param {McpToolOptionContract} contract @param {string[]} violations */
function validateContractShape(toolName, contract, violations) {
    const allowedModes = readAllowedModes(contract.mode);
    for (const [name, descriptor] of Object.entries(contract.options)) {
        if (!OPTION_CATEGORIES.includes(descriptor.category)) violations.push(`${toolName}.${name}: invalid category`);
        if (descriptor.inactivePolicy && !INACTIVE_POLICIES.includes(descriptor.inactivePolicy)) {
            violations.push(`${toolName}.${name}: invalid inactivePolicy`);
        }
        if (descriptor.activeIn && !descriptor.inactivePolicy) {
            violations.push(`${toolName}.${name}: activeIn requires an explicit inactivePolicy`);
        }
        for (const activeMode of descriptor.activeIn ?? []) {
            if (!allowedModes.includes(activeMode))
                violations.push(`${toolName}.${name}: unknown active mode ${activeMode}`);
        }
        if (descriptor.requires && !(descriptor.requires in contract.options)) {
            violations.push(`${toolName}.${name}: requires unknown option ${descriptor.requires}`);
        }
    }
    if (
        (contract.mode.kind === 'presence' || contract.mode.kind === 'enum' || contract.mode.kind === 'boolean') &&
        !(contract.mode.option in contract.options)
    ) {
        violations.push(`${toolName}: mode references unknown option ${contract.mode.option}`);
    }
    for (const rule of contract.normalization ?? []) {
        if (rule.kind === 'alias-precedence') {
            if (!(rule.primary in contract.options) || !(rule.alias in contract.options)) {
                violations.push(`${toolName}: alias rule references unknown option`);
            }
        } else if (!(rule.option in contract.options)) {
            violations.push(`${toolName}: coercion rule references unknown option ${rule.option}`);
        }
    }
    for (const rule of contract.inheritance ?? []) {
        if (!(rule.source in contract.options))
            violations.push(`${toolName}: inheritance references unknown option ${rule.source}`);
    }
}

/** @param {McpToolOptionModeRule} rule */
function readAllowedModes(rule) {
    if (rule.kind === 'presence') return [rule.presentMode, rule.absentMode];
    if (rule.kind === 'enum') return [...rule.allowedModes, ...(rule.defaultMode ? [rule.defaultMode] : [])];
    if (rule.kind === 'boolean') return [rule.trueMode, rule.falseMode, rule.defaultMode];
    if (rule.kind === 'constant') return [rule.mode];
    return ['dry-run', 'apply'];
}

/** @param {string[]} violations */
function validateWorkflowParity(violations) {
    const workflow = readMcpWorkflowPolicy();
    for (const [toolName, contract] of Object.entries(OPTION_CONTRACTS)) {
        const binding = contract.workflow;
        if (!binding) continue;
        const policy = /** @type {Readonly<Record<string, unknown>> | undefined} */ (workflow[binding.domain]);
        if (!policy || policy['happyPathTool'] !== toolName) {
            violations.push(`${toolName}: workflow binding ${binding.domain} does not match canonical happyPathTool`);
            continue;
        }
        for (const [key, expected] of Object.entries(binding.defaults ?? {})) {
            if (policy[key] !== expected) {
                violations.push(
                    `${toolName}: workflow default ${key}=${String(policy[key])} expected ${String(expected)}`,
                );
            }
        }
    }
}

/** @param {unknown} schema */
function readSchemaDescription(schema) {
    if (!schema || typeof schema !== 'object') return null;
    const description = /** @type {{description?:unknown}} */ (schema).description;
    return typeof description === 'string' && description.trim() ? description.trim() : null;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}
