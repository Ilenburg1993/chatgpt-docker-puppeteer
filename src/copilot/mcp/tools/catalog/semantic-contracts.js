// @ts-check
/**
 * Exhaustive semantic contracts for the canonical MCP tool catalog.
 *
 * Every canonical tool name must appear exactly once. New/stale names fail catalog construction. Protocol annotations,
 * OAuth caller scope, risk, retry semantics, cancellation and output-contract class are projections of these entries.
 *
 * @module copilot/mcp/tools/catalog/semantic-contracts
 */

import {
    classifyMcpToolContractRisk,
    projectMcpToolAnnotations,
    validateMcpToolContractSemantics,
} from '#copilot/mcp/public/protocol/catalog';

import { CONTRACT_PROFILE_BY_TOOL } from './semantic-contract-profile.js';
export { MCP_TOOL_CONTRACTS_VERSION, readMcpToolContractCoverage } from './semantic-contract-profile.js';


const SPECIFIC_OUTPUT_RATIONALE =
    'This tool publishes a stable tool-specific output schema and the registry validates the structured result against it.';
const INTENTIONAL_UNTYPED_OUTPUT_RATIONALE =
    'This tool intentionally omits a specific output schema because its diagnostic or workflow result is heterogeneous; a generic passthrough schema would be less truthful than leaving the wire schema absent.';

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} tools
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]}
 */
export function attachMcpToolSemanticContracts(tools) {
    const actualNames = new Set(tools.map((tool) => tool.name));
    const declaredNames = new Set(Object.keys(CONTRACT_PROFILE_BY_TOOL));
    const missing = [...actualNames].filter((name) => !declaredNames.has(name));
    const stale = [...declaredNames].filter((name) => !actualNames.has(name));
    if (missing.length > 0 || stale.length > 0) {
        throw new Error(
            `MCP semantic contract coverage mismatch: missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}`,
        );
    }
    if (actualNames.size !== tools.length)
        throw new Error('MCP semantic contracts require unique canonical tool names.');

    return tools.map((tool) => attachContract(tool));
}

/** @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} tool */
function attachContract(tool) {
    const raw = CONTRACT_PROFILE_BY_TOOL[tool.name];
    if (!raw) throw new Error(`Missing MCP semantic contract for ${tool.name}.`);
    const contract = /** @type {import('#copilot/mcp/public/protocol/catalog').McpToolContract} */ (
        Object.freeze({
            schemaVersion: 1,
            effects: Object.freeze({ mutation: raw.effect, externalSideEffects: raw.externalSideEffects }),
            authority: Object.freeze({ callerScope: raw.callerScope, network: raw.network }),
            credentials: Object.freeze([...raw.credentials]),
            idempotency: raw.idempotency,
            retry: raw.retry,
            execution: Object.freeze({ ...raw.execution }),
            resultBudget: Object.freeze(
                raw.maxResultBytes === undefined
                    ? { mode: 'registry-default' }
                    : { mode: 'tool-specific', maxBytes: raw.maxResultBytes },
            ),
            output: Object.freeze({
                class: raw.output,
                rationale: raw.output === 'specific' ? SPECIFIC_OUTPUT_RATIONALE : INTENTIONAL_UNTYPED_OUTPUT_RATIONALE,
            }),
        })
    );
    const semanticErrors = validateMcpToolContractSemantics(contract);
    if (semanticErrors.length > 0) {
        throw new Error(`Invalid MCP semantic contract for ${tool.name}: ${semanticErrors.join('; ')}`);
    }
    const annotations = projectMcpToolAnnotations(contract);
    validateRawContractProjection(tool, contract);
    return { ...tool, contract, execution: contract.execution, annotations };
}

/**
 * Raw definitions may declare wire shape/result budgets, but never risk annotations. Those raw facts must agree with
 * their semantic output/result contract before the canonical projection is created.
 *
 * @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} tool
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolContract} contract
 */
function validateRawContractProjection(tool, contract) {
    const hasSpecificOutput = tool.outputSchema !== undefined;
    if ((contract.output.class === 'specific') !== hasSpecificOutput) {
        throw new Error(`MCP output-contract drift for ${tool.name}.`);
    }
    const declaredMax = Number.isInteger(tool.maxResultBytes) ? Number(tool.maxResultBytes) : null;
    const contractMax = contract.resultBudget.mode === 'tool-specific' ? Number(contract.resultBudget.maxBytes) : null;
    if (declaredMax !== contractMax) throw new Error(`MCP result-budget drift for ${tool.name}.`);
}

/** @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool */
export function readMcpToolSemanticRisk(tool) {
    if (!tool.contract) throw new Error(`MCP tool ${tool.name} has no semantic contract.`);
    return classifyMcpToolContractRisk(tool.contract);
}
