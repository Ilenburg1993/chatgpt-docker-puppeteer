// @ts-check
/**
 * ChatGPT host-block diagnostic helpers.
 *
 * @module copilot/mcp/tools/host-blocks
 */

import {
    MCP_TOOL_EXECUTION_LIMITS,
    MCP_TOOL_EXECUTION_LIMITS_VERSION,
    okResult,
    readMcpSchemaConvergenceState,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';
import { z } from 'zod';

const HOST_BLOCK_TEMPLATE = {
    timestamp: '<ISO timestamp>',
    chatgptConversationUrl: '<optional>',
    blockedToolName: '<tool name>',
    blockedToolArgsClass: '<read | plan-read | bounded-write | destructive | validation | url-input | unknown>',
    hostMessage: '<message shown by chatgpt.com>',
    mcpReachedServer: '<true | false | unknown>',
    httpStatus: '<optional HTTP status>',
    wwwAuthenticatePresent: '<true | false | unknown>',
    cloudflareRayIdPresent: '<true | false | unknown>',
    mcpAuditEventPresent: '<true | false | unknown>',
    replacementToolTried: '<optional lower-friction tool>',
    completedAfterReplacement: '<true | false | unknown>',
    notes: '<short observation>',
};

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function optionalBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalHttpStatus(value) {
    return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

/**
 * @param {{
 *     mcpReachedServer?: boolean;
 *     httpStatus?: number;
 *     wwwAuthenticatePresent?: boolean;
 *     cloudflareRayIdPresent?: boolean;
 *     mcpAuditEventPresent?: boolean;
 *     schemaErrorPresent?: boolean;
 *     toolResultIsError?: boolean;
 * }} input
 * @returns {{
 *     code: string;
 *     layer: string;
 *     confidence: 'low' | 'medium' | 'high';
 *     severity: 'low' | 'medium' | 'high';
 *     reason: string;
 *     recommendedAlternatives: string[];
 * } | null}
 */
function classifyByEvidence(input) {
    const mcpReachedServer = optionalBoolean(input.mcpReachedServer);
    const httpStatus = optionalHttpStatus(input.httpStatus);
    const wwwAuthenticatePresent = optionalBoolean(input.wwwAuthenticatePresent);
    const cloudflareRayIdPresent = optionalBoolean(input.cloudflareRayIdPresent);
    const mcpAuditEventPresent = optionalBoolean(input.mcpAuditEventPresent);
    const schemaErrorPresent = optionalBoolean(input.schemaErrorPresent);
    const toolResultIsError = optionalBoolean(input.toolResultIsError);
    const schemaConvergence = readMcpSchemaConvergenceState();

    if (
        mcpReachedServer === false &&
        schemaErrorPresent === true &&
        schemaConvergence.status !== 'converged-observed'
    ) {
        return {
            code: 'LIKELY_STALE_CLIENT_SCHEMA_PROJECTION',
            layer: 'chatgpt-host-schema',
            confidence: 'high',
            severity: 'medium',
            reason: 'The host rejected the input before MCP while this server generation has not observed a fresh tools/list. The client-visible schema is likely stale relative to server capability truth.',
            recommendedAlternatives: ['mcp_tools_status', 'mcp_capabilities_summary'],
        };
    }

    if (mcpReachedServer === false) {
        if (cloudflareRayIdPresent === true || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
            return {
                code: 'CLOUDFLARE_OR_TUNNEL_BLOCK',
                layer: 'cloudflare-or-network',
                confidence: 'high',
                severity: 'medium',
                reason: 'The MCP handler was not reached and network/Cloudflare evidence is present.',
                recommendedAlternatives: ['mcp_tunnel_status', 'chatgpt_connector_current_url_status'],
            };
        }
        return {
            code: 'CHATGPT_HOST_PRECALL_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'high',
            severity: 'medium',
            reason: 'The MCP server did not receive the call, so the block happened before the MCP handler.',
            recommendedAlternatives: ['mcp_tools_status', 'mcp_capabilities_summary', 'mcp_host_block_diagnostics'],
        };
    }
    if (httpStatus === 401 || wwwAuthenticatePresent === true) {
        return {
            code: 'MCP_AUTH_CHALLENGE_OR_REAUTH',
            layer: 'mcp-oauth-auth',
            confidence: 'high',
            severity: 'medium',
            reason: 'The request reached the MCP/auth layer and received an OAuth challenge or 401.',
            recommendedAlternatives: ['mcp_auth_profile', 'mcp_oauth_issuer_diagnostics'],
        };
    }
    if (schemaErrorPresent === true || httpStatus === 400 || httpStatus === 422) {
        return {
            code: 'MCP_SCHEMA_OR_ARGUMENT_REJECTION',
            layer: 'mcp-schema',
            confidence: 'high',
            severity: 'low',
            reason: 'The request reached the MCP server but was rejected by schema/argument validation.',
            recommendedAlternatives: ['mcp_tools_status', 'mcp_capabilities_summary'],
        };
    }
    if (mcpAuditEventPresent === true || toolResultIsError === true) {
        return {
            code: 'MCP_TOOL_HANDLER_ERROR',
            layer: 'mcp-tool-handler',
            confidence: mcpAuditEventPresent === true ? 'high' : 'medium',
            severity: 'medium',
            reason: 'The tool reached MCP execution and failed inside the server/tool handler path.',
            recommendedAlternatives: ['mcp_runtime_health', 'mcp_last_validation_summary'],
        };
    }
    if (mcpReachedServer === true) {
        return {
            code: 'MCP_REACHED_UNCLEAR_FAILURE',
            layer: 'mcp-or-downstream',
            confidence: 'medium',
            severity: 'medium',
            reason: 'The call reached MCP, but available evidence is insufficient to isolate auth, schema, handler or downstream failure.',
            recommendedAlternatives: ['mcp_runtime_health', 'mcp_tunnel_status', 'mcp_auth_profile'],
        };
    }
    return null;
}

/**
 * @param {{ toolName?: string; hostMessage?: string; operationKind?: string; argsShape?: string }} input
 * @returns {{
 *     code: string;
 *     layer: string;
 *     confidence: 'low' | 'medium' | 'high';
 *     severity: 'low' | 'medium' | 'high';
 *     reason: string;
 *     recommendedAlternatives: string[];
 * }}
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
            layer: 'chatgpt-host',
            confidence: 'medium',
            reason: 'The host reported a network-level connector failure, usually outside tool metadata.',
            recommendedAlternatives: ['chatgpt_connector_current_url_status', 'mcp_tunnel_status'],
        };
    }
    if (toolName.includes('url_check') || argsShape.includes('url')) {
        return {
            code: 'HOST_URL_INPUT_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'medium',
            severity: 'medium',
            reason: 'The host may dislike public URL arguments in tool inputs.',
            recommendedAlternatives: ['chatgpt_connector_current_url_status', 'mcp_tunnel_status'],
        };
    }
    if (toolName.includes('root_tree') && (argsShape.includes('showhidden') || argsShape.includes('hidden'))) {
        return {
            code: 'HOST_HIDDEN_LISTING_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'medium',
            severity: 'medium',
            reason: 'The host may treat hidden file listing as sensitive even when the MCP redacts protected names.',
            recommendedAlternatives: ['repo_root_redaction_status', 'repo_root_tree without showHidden'],
        };
    }
    if (toolName.includes('remove') || toolName.includes('delete') || operationKind.includes('destructive')) {
        return {
            code: 'HOST_DESTRUCTIVE_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'medium',
            severity: 'high',
            reason: 'The host classified the requested action as destructive.',
            recommendedAlternatives: ['repo_quarantine_file_plan', 'repo_quarantine_file'],
        };
    }
    if (toolName.includes('run_') || toolName.includes('validator') || operationKind.includes('validation')) {
        return {
            code: 'HOST_VALIDATION_JOB_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'medium',
            severity: 'medium',
            reason: 'The host blocked starting a validation job.',
            recommendedAlternatives: ['mcp_validation_plan', 'mcp_last_validation_summary'],
        };
    }
    if (toolName.endsWith('_plan') || operationKind.includes('plan')) {
        return {
            code: 'HOST_PLAN_READ_BLOCK',
            layer: 'chatgpt-host',
            confidence: 'medium',
            severity: 'low',
            reason: 'A read-only planning call was blocked; this is likely host-side heuristic friction.',
            recommendedAlternatives: ['mcp_capabilities_summary', 'mcp_session_profile'],
        };
    }
    return {
        code: 'HOST_BLOCK_UNCLASSIFIED',
        layer: 'unknown',
        confidence: 'low',
        severity: 'medium',
        reason: 'The available evidence is insufficient to isolate the blocking layer.',
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
        toolName: z.string().optional()['describe']('Tool name ChatGPT tried to call when the host blocked it.'),
        hostMessage: z.string().optional()['describe']('Host/UI error text shown by ChatGPT.'),
        operationKind: z
            .string()
            .optional()
            ['describe']('Optional coarse kind: read, plan-read, bounded-write, destructive, validation, url-input.'),
        argsShape: z
            .string()
            .optional()
            ['describe']('Short non-sensitive description of attempted args, not raw secrets or full file content.'),
        mcpReachedServer: z
            .boolean()
            .optional()
            ['describe']('Whether MCP server logs/metrics/audit show that the call reached MCP.'),
        httpStatus: z.number().int().min(100).max(599).optional()['describe']('Observed HTTP status, if any.'),
        wwwAuthenticatePresent: z
            .boolean()
            .optional()
            ['describe']('Whether a WWW-Authenticate challenge was observed.'),
        cloudflareRayIdPresent: z
            .boolean()
            .optional()
            ['describe']('Whether Cloudflare response metadata, such as a Ray ID, was observed.'),
        mcpAuditEventPresent: z
            .boolean()
            .optional()
            ['describe']('Whether MCP audit/log/metrics recorded the attempted tool call.'),
        schemaErrorPresent: z
            .boolean()
            .optional()
            ['describe']('Whether the error was an input schema or argument validation failure.'),
        toolResultIsError: z.boolean().optional()['describe']('Whether MCP returned a tool result with isError=true.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({
        toolName,
        hostMessage,
        operationKind,
        argsShape,
        mcpReachedServer,
        httpStatus,
        wwwAuthenticatePresent,
        cloudflareRayIdPresent,
        mcpAuditEventPresent,
        schemaErrorPresent,
        toolResultIsError,
    }) => {
        const evidenceClassification = classifyByEvidence({
            mcpReachedServer,
            httpStatus,
            wwwAuthenticatePresent,
            cloudflareRayIdPresent,
            mcpAuditEventPresent,
            schemaErrorPresent,
            toolResultIsError,
        });
        const classification =
            evidenceClassification ?? classifyHostBlock({ toolName, hostMessage, operationKind, argsShape });
        const schemaConvergence = readMcpSchemaConvergenceState();
        const projectionDiagnosis = {
            status:
                classification.code === 'LIKELY_STALE_CLIENT_SCHEMA_PROJECTION'
                    ? 'likely-stale-client-projection'
                    : schemaConvergence.status === 'converged-observed'
                      ? 'server-observed-client-relist'
                      : 'unverified-client-projection',
            executionLimitsVersion: MCP_TOOL_EXECUTION_LIMITS_VERSION,
            executionLimits: MCP_TOOL_EXECUTION_LIMITS,
            schemaConvergence,
            hostRefreshRequired: classification.code === 'LIKELY_STALE_CLIENT_SCHEMA_PROJECTION',
        };
        return okResult({
            success: true,
            classification,
            projectionDiagnosis,
            observed: {
                toolName: toolName ?? null,
                operationKind: operationKind ?? null,
                argsShape: argsShape ?? null,
                hostMessagePresent: typeof hostMessage === 'string' && hostMessage.length > 0,
                mcpReachedServer: mcpReachedServer ?? null,
                httpStatus: httpStatus ?? null,
                wwwAuthenticatePresent: wwwAuthenticatePresent ?? null,
                cloudflareRayIdPresent: cloudflareRayIdPresent ?? null,
                mcpAuditEventPresent: mcpAuditEventPresent ?? null,
                schemaErrorPresent: schemaErrorPresent ?? null,
                toolResultIsError: toolResultIsError ?? null,
            },
            auditTemplate: HOST_BLOCK_TEMPLATE,
            nextSteps: [
                'Prefer the recommendedAlternatives list before retrying the blocked tool.',
                classification.code === 'LIKELY_STALE_CLIENT_SCHEMA_PROJECTION'
                    ? 'Do not add a plan call just to work around schema rejection. Compare mcp_tools_status capability truth, then refresh/reconnect the client projection when needed; use compatibility-safe legacy arguments meanwhile.'
                    : 'Use a *_plan tool only when preview, destructive-risk review, or a separate approval boundary adds information; plan is not a generic recovery step.',
                'If the block is network/tunnel related, verify the permanent connector/tunnel state before changing transport or DNS.',
                'Record the auditTemplate fields in the external ChatGPT audit report.',
            ],
        });
    },
};
