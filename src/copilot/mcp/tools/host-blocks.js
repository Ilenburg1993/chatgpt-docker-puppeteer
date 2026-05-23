// @ts-check
/**
 * ChatGPT host-block diagnostic helpers.
 *
 * @module copilot/mcp/tools/host-blocks
 */

import { z } from 'zod';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

const HOST_BLOCK_TEMPLATE = {
    timestamp: '<ISO timestamp>',
    chatgptConversationUrl: '<optional>',
    blockedToolName: '<tool name>',
    blockedToolArgsClass: '<read | plan-read | bounded-write | destructive | validation | url-input | unknown>',
    hostMessage: '<message shown by chatgpt.com>',
    mcpReachedServer: false,
    replacementToolTried: '<optional lower-friction tool>',
    completedAfterReplacement: '<true | false | unknown>',
    notes: '<short observation>',
};

/**
 * @param {{ toolName?: string; hostMessage?: string; operationKind?: string; argsShape?: string }} input
 * @returns {{ code: string; severity: 'low' | 'medium' | 'high'; reason: string; recommendedAlternatives: string[] }}
 */
function classifyHostBlock(input) {
    const toolName = String(input.toolName ?? '').toLowerCase();
    const message = String(input.hostMessage ?? '').toLowerCase();
    const operationKind = String(input.operationKind ?? '').toLowerCase();
    const argsShape = String(input.argsShape ?? '').toLowerCase();

    if (message.includes('network') || message.includes('connection') || message.includes('mcp_network_error')) {
        return {
            code: 'HOST_NETWORK_OR_TUNNEL',
            severity: 'medium',
            reason: 'The host reported a network-level connector failure, usually outside tool metadata.',
            recommendedAlternatives: ['chatgpt_connector_current_url_status', 'mcp_tunnel_status'],
        };
    }
    if (toolName.includes('url_check') || argsShape.includes('url')) {
        return {
            code: 'HOST_URL_INPUT_BLOCK',
            severity: 'medium',
            reason: 'The host may dislike public URL arguments in tool inputs.',
            recommendedAlternatives: ['chatgpt_connector_current_url_status', 'mcp_tunnel_status'],
        };
    }
    if (toolName.includes('root_tree') && (argsShape.includes('showhidden') || argsShape.includes('hidden'))) {
        return {
            code: 'HOST_HIDDEN_LISTING_BLOCK',
            severity: 'medium',
            reason: 'The host may treat hidden file listing as sensitive even when the MCP redacts protected names.',
            recommendedAlternatives: ['repo_root_redaction_status', 'repo_root_tree without showHidden'],
        };
    }
    if (toolName.includes('remove') || toolName.includes('delete') || operationKind.includes('destructive')) {
        return {
            code: 'HOST_DESTRUCTIVE_BLOCK',
            severity: 'high',
            reason: 'The host classified the requested action as destructive.',
            recommendedAlternatives: ['repo_quarantine_file_plan', 'repo_quarantine_file'],
        };
    }
    if (toolName.includes('run_') || toolName.includes('validator') || operationKind.includes('validation')) {
        return {
            code: 'HOST_VALIDATION_JOB_BLOCK',
            severity: 'medium',
            reason: 'The host blocked starting a validation job.',
            recommendedAlternatives: ['mcp_validation_plan', 'mcp_last_validation_summary'],
        };
    }
    if (toolName.endsWith('_plan') || operationKind.includes('plan')) {
        return {
            code: 'HOST_PLAN_READ_BLOCK',
            severity: 'low',
            reason: 'A read-only planning call was blocked; this is likely host-side heuristic friction.',
            recommendedAlternatives: ['mcp_capabilities_summary', 'mcp_session_profile'],
        };
    }
    return {
        code: 'HOST_BLOCK_UNCLASSIFIED',
        severity: 'medium',
        reason: 'The MCP server did not receive the blocked call; classify manually with the provided template.',
        recommendedAlternatives: ['mcp_tools_status', 'mcp_capabilities_summary', 'mcp_golden_prompts'],
    };
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpHostBlockDiagnosticsTool = {
    name: 'mcp_host_block_diagnostics',
    title: 'MCP host block diagnostics',
    description:
        'Classify a ChatGPT host-side MCP block and return lower-friction replacement tools plus a stable audit template. Does not persist anything.',
    inputSchema: {
        toolName: z.string().optional().describe('Tool name ChatGPT tried to call when the host blocked it.'),
        hostMessage: z.string().optional().describe('Host/UI error text shown by ChatGPT.'),
        operationKind: z
            .string()
            .optional()
            .describe('Optional coarse kind: read, plan-read, bounded-write, destructive, validation, url-input.'),
        argsShape: z
            .string()
            .optional()
            .describe('Short non-sensitive description of attempted args, not raw secrets or full file content.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ toolName, hostMessage, operationKind, argsShape }) => {
        const classification = classifyHostBlock({ toolName, hostMessage, operationKind, argsShape });
        return okResult({
            success: true,
            classification,
            observed: {
                toolName: toolName ?? null,
                operationKind: operationKind ?? null,
                argsShape: argsShape ?? null,
                hostMessagePresent: typeof hostMessage === 'string' && hostMessage.length > 0,
                mcpReachedServer: false,
            },
            auditTemplate: HOST_BLOCK_TEMPLATE,
            nextSteps: [
                'Prefer the recommendedAlternatives list before retrying the blocked tool.',
                'If the blocked action is a write, run the corresponding *_plan tool first.',
                'If the block is network/tunnel related, refresh the temporary Cloudflare URL and update the ChatGPT connector.',
                'Record the auditTemplate fields in the external ChatGPT audit report.',
            ],
        });
    },
};
