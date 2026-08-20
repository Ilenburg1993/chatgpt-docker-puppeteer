// @ts-check
/**
 * Registry-wide MCP tool metadata helpers.
 *
 * @module copilot/mcp/control-plane/tool-metadata
 */

import { z } from 'zod';

import { securitySchemesForMcpTool } from './auth.js';

/**
 * @typedef {{ type: 'noauth' } | { type: 'oauth2'; scopes: string[] }} McpSecurityScheme
 */

const NOAUTH = /** @type {const} */ ({ type: 'noauth' });
const MAX_TOOL_INVOCATION_STATUS_LENGTH = 64;

export const MCP_BASELINE_OUTPUT_SCHEMA_VERSION = 1;
export const MCP_BASELINE_OUTPUT_SCHEMA = z.object({})['passthrough']();

/** @param {unknown} schema @returns {boolean} */
export function isBaselineMcpOutputSchema(schema) {
    return schema === MCP_BASELINE_OUTPUT_SCHEMA;
}

const TOOL_INVOCATION_LABELS = new Map([
    ['repo_status', 'Status do repo'],
    ['repo_tree', 'Arvore do repo'],
    ['repo_root_tree', 'Raiz do repo'],
    ['repo_read_file', 'Lendo arquivo'],
    ['repo_read_file_chunks', 'Lendo arquivo em blocos'],
    ['repo_search_text', 'Buscando texto'],
    ['repo_diff_files', 'Comparando arquivos'],
    ['repo_file_stats', 'Inspecionando arquivo'],
    ['repo_file_outline', 'Mapeando arquivo'],
    ['repo_symbol_search', 'Buscando simbolo'],
    ['repo_find_symbol_usages', 'Buscando usos'],
    ['repo_find_imports', 'Buscando imports'],
    ['repo_write_file', 'Escrevendo arquivo'],
    ['repo_create_file', 'Criando arquivo'],
    ['repo_create_file_plan', 'Planejando criacao'],
    ['repo_apply_patch', 'Aplicando patch'],
    ['repo_patch_plan', 'Planejando patch'],
    ['repo_move_file', 'Movendo arquivo'],
    ['repo_move_file_plan', 'Planejando movimento'],
    ['repo_quarantine_file', 'Quarentenando arquivo'],
    ['repo_quarantine_file_plan', 'Planejando quarentena'],
    ['repo_restore_quarantined_file', 'Restaurando arquivo'],
    ['terminal_exec', 'Executando terminal'],
    ['terminal_session_control', 'Controlando terminal'],
    ['terminal_session_read', 'Lendo terminal'],
    ['repo_remove_file', 'Removendo arquivo'],
    ['repo_apply_file_batch', 'Aplicando lote de arquivos'],
    ['repo_apply_file_batch_plan', 'Planejando lote de arquivos'],
    ['git_status', 'Lendo Git status'],
    ['git_diff', 'Lendo diff Git'],
    ['git_log', 'Lendo historico Git'],
    ['git_branch_info', 'Lendo branch Git'],
    ['run_lint_copilot', 'Rodando lint copilot'],
    ['run_typecheck_copilot', 'Rodando typecheck copilot'],
    ['run_unit_copilot', 'Rodando testes copilot'],
    ['run_copilot_validator', 'Rodando validador copilot'],
]);

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeInvocationStatusText(value) {
    return String(value)
        .replace(/[\r\n\t]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '')
        .trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function humanizeToolName(value) {
    const normalized = value
        .replace(/^mcp_/u, '')
        .replace(/^repo_/u, '')
        .replace(/_/gu, ' ')
        .trim();
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Tool';
}

/**
 * @param {string} value
 * @returns {string}
 */
function trimInvocationStatus(value) {
    if (value.length <= MAX_TOOL_INVOCATION_STATUS_LENGTH) return value;
    return `${value.slice(0, MAX_TOOL_INVOCATION_STATUS_LENGTH - 1).trimEnd()}…`;
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {string}
 */
export function buildHumanMcpToolInvocationLabel(tool) {
    const explicit = TOOL_INVOCATION_LABELS.get(tool.name);
    if (explicit) return explicit;
    // The top-level title already carries the richer UI label. Invocation metadata is repeated twice per tool on the
    // wire, so derive its status from the stable compact tool name instead of duplicating the longer title.
    return sanitizeInvocationStatusText(humanizeToolName(tool.name)) || 'Tool';
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {'invoking' | 'invoked'} phase
 * @returns {string}
 */
export function buildHumanMcpToolInvocationStatus(tool, phase) {
    if (phase === 'invoked') return 'OK';
    return trimInvocationStatus(`${buildHumanMcpToolInvocationLabel(tool)}...`);
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {McpSecurityScheme[]}
 */
export function defaultSecuritySchemesForTool(tool) {
    return securitySchemesForMcpTool(tool).map((scheme) =>
        scheme.type === 'noauth' ? { ...NOAUTH } : { type: 'oauth2', scopes: [...scheme.scopes] },
    );
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {Record<string, unknown>}
 */
export function buildToolMeta(tool) {
    return {
        ...(tool._meta ?? {}),
        securitySchemes: tool.securitySchemes ?? defaultSecuritySchemesForTool(tool),
        'openai/toolInvocation/invoking':
            tool._meta?.['openai/toolInvocation/invoking'] ?? buildHumanMcpToolInvocationStatus(tool, 'invoking'),
        'openai/toolInvocation/invoked':
            tool._meta?.['openai/toolInvocation/invoked'] ?? buildHumanMcpToolInvocationStatus(tool, 'invoked'),
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {import('../registry.js').McpToolDefinition}
 */
export function normalizeMcpToolDefinition(tool) {
    const securitySchemes = tool.securitySchemes ?? defaultSecuritySchemesForTool(tool);
    return {
        ...tool,
        outputSchema: tool.outputSchema ?? MCP_BASELINE_OUTPUT_SCHEMA,
        securitySchemes,
        _meta: buildToolMeta({ ...tool, securitySchemes }),
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition[]} tools
 * @returns {import('../registry.js').McpToolDefinition[]}
 */
export function normalizeMcpToolDefinitions(tools) {
    return tools.map(normalizeMcpToolDefinition);
}
