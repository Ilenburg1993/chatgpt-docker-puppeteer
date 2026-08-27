// @ts-check
/**
 * Machine-readable recovery recipe contract for MCP tool results.
 *
 * Recipes are declarative result data only. This module never dispatches a tool and therefore adds no execution
 * authority. Domain owners decide whether an invocation is retry-safe, merely suggested, manual, or terminal.
 *
 * @module copilot/mcp/protocol/tools/contracts/recovery
 */

export const MCP_RECOVERY_RECIPE_VERSION = 1;

const RECOVERY_DISPOSITIONS = Object.freeze(['retry-safe', 'suggested', 'manual', 'no-retry']);
const RECOVERY_SCOPES = Object.freeze(['operation', 'target', 'dependency-group', 'workflow']);

/** @param {unknown} value @returns {unknown} */
function cloneAndFreeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map((entry) => cloneAndFreeze(entry)));
    if (value && typeof value === 'object') {
        return Object.freeze(
            Object.fromEntries(
                Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, entry]) => [
                    key,
                    cloneAndFreeze(entry),
                ]),
            ),
        );
    }
    return value;
}

/**
 * @typedef {{ tool: string; args: Readonly<Record<string, unknown>> }} McpRecoveryInvocation
 * @typedef {{
 *   version: 1;
 *   disposition: 'retry-safe' | 'suggested' | 'manual' | 'no-retry';
 *   scope: 'operation' | 'target' | 'dependency-group' | 'workflow';
 *   reasonCode: string;
 *   retryInvocation?: McpRecoveryInvocation;
 *   suggestedInvocation?: McpRecoveryInvocation;
 *   preconditions?: readonly string[];
 * }} McpRecoveryRecipe
 */

/**
 * Build one immutable recovery recipe. Invocation fields are data for the caller; no generic executor consumes them.
 *
 * @param {{
 *   disposition: McpRecoveryRecipe['disposition'];
 *   scope: McpRecoveryRecipe['scope'];
 *   reasonCode: string;
 *   retryInvocation?: { tool: string; args: Record<string, unknown> };
 *   suggestedInvocation?: { tool: string; args: Record<string, unknown> };
 *   preconditions?: string[];
 * }} input
 * @returns {Readonly<McpRecoveryRecipe>}
 */
export function createMcpRecoveryRecipe(input) {
    if (!RECOVERY_DISPOSITIONS.includes(input.disposition)) {
        throw new TypeError(`Unsupported recovery disposition: ${String(input.disposition)}`);
    }
    if (!RECOVERY_SCOPES.includes(input.scope)) {
        throw new TypeError(`Unsupported recovery scope: ${String(input.scope)}`);
    }
    if (!input.reasonCode || input.reasonCode.length > 128) {
        throw new TypeError('Recovery reasonCode must be a non-empty bounded string.');
    }
    if (input.disposition === 'retry-safe' && !input.retryInvocation) {
        throw new TypeError('retry-safe recovery requires retryInvocation.');
    }
    if (input.disposition !== 'retry-safe' && input.retryInvocation) {
        throw new TypeError('retryInvocation is reserved for retry-safe recovery.');
    }
    if (input.disposition === 'suggested' && !input.suggestedInvocation) {
        throw new TypeError('suggested recovery requires suggestedInvocation.');
    }
    const freezeInvocation = (/** @type {{ tool: string; args: Record<string, unknown> }} */ invocation) => {
        if (!invocation.tool || invocation.tool.length > 128)
            throw new TypeError('Recovery invocation tool is invalid.');
        return Object.freeze({
            tool: invocation.tool,
            args: /** @type {Readonly<Record<string, unknown>>} */ (cloneAndFreeze(invocation.args)),
        });
    };
    return Object.freeze({
        version: MCP_RECOVERY_RECIPE_VERSION,
        disposition: input.disposition,
        scope: input.scope,
        reasonCode: input.reasonCode,
        ...(input.retryInvocation ? { retryInvocation: freezeInvocation(input.retryInvocation) } : {}),
        ...(input.suggestedInvocation ? { suggestedInvocation: freezeInvocation(input.suggestedInvocation) } : {}),
        ...(input.preconditions ? { preconditions: Object.freeze([...input.preconditions]) } : {}),
    });
}
