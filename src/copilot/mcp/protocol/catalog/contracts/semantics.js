// @ts-check
/**
 * Pure projections and invariants for the internal MCP semantic tool contract.
 *
 * The contract is deliberately richer than MCP ToolAnnotations. Protocol annotations, registry risk summaries and
 * authorization metadata are projections of this domain contract; they are not independent sources of truth.
 *
 * @module copilot/mcp/protocol/catalog/contracts/semantics
 */

/** @param {import('./types.js').McpToolContract} contract */
export function projectMcpToolAnnotations(contract) {
    return Object.freeze({
        readOnlyHint: contract.effects.mutation === 'none',
        destructiveHint: contract.effects.mutation === 'destructive',
        idempotentHint: contract.idempotency === 'idempotent',
        openWorldHint: contract.authority.network === 'open-world',
    });
}

/**
 * Semantic risk projection. No name/title/description heuristics participate in this classification.
 *
 * @param {import('./types.js').McpToolContract} contract
 */
export function classifyMcpToolContractRisk(contract) {
    const mutating = contract.effects.mutation !== 'none';
    const external = contract.authority.network !== 'local';
    const externalSideEffects = contract.effects.externalSideEffects !== 'none';
    const highImpact =
        contract.authority.callerScope === 'admin' ||
        contract.effects.mutation === 'destructive' ||
        externalSideEffects;
    const category =
        contract.effects.mutation === 'destructive'
            ? externalSideEffects
                ? 'external-destructive'
                : 'destructive'
            : contract.effects.mutation === 'bounded-write'
              ? externalSideEffects
                  ? 'external-write'
                  : 'bounded-write'
              : external
                ? 'external-read'
                : contract.idempotency === 'stateful-read'
                  ? 'stateful-read'
                  : 'read-idempotent';
    return Object.freeze({
        mutating,
        highImpact,
        external,
        externalSideEffects,
        openWorld: contract.authority.network === 'open-world',
        category,
    });
}

/** @param {import('./types.js').McpToolContract} contract */
export function validateMcpToolContractSemantics(contract) {
    /** @type {string[]} */
    const errors = [];
    if (contract.effects.mutation === 'none' && contract.effects.externalSideEffects !== 'none') {
        errors.push('read-only contract cannot declare external mutation side effects');
    }
    if (contract.idempotency === 'idempotent' && contract.effects.mutation !== 'none') {
        errors.push('mutating contract cannot claim unconditional idempotency');
    }
    if (contract.authority.network === 'local' && contract.credentials.some((item) => item !== 'none')) {
        errors.push('local-only contract cannot require a remote credential boundary');
    }
    if (contract.retry === 'safe' && contract.idempotency !== 'idempotent') {
        errors.push('safe retry requires an idempotent contract');
    }
    if (contract.retry === 'manual-only' && contract.idempotency === 'idempotent') {
        errors.push('idempotent contract should not require manual-only retry');
    }
    if (contract.output.class === 'specific' && contract.output.rationale.length < 20) {
        errors.push('specific output contract requires a meaningful rationale');
    }
    if (contract.output.class === 'intentional-untyped' && contract.output.rationale.length < 40) {
        errors.push('intentional-untyped output contract requires a meaningful rationale');
    }
    if (contract.resultBudget.mode === 'tool-specific' && !Number.isInteger(contract.resultBudget.maxBytes)) {
        errors.push('tool-specific result budget requires maxBytes');
    }
    return Object.freeze(errors);
}
