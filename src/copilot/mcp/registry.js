// @ts-check
/**
 * Canonical MCP tool registry for ChatGPT connector.
 *
 * Registry responsibilities:
 *
 * - Build the canonical tool surface from all repo/MCP/Cloudflare tool modules.
 * - Apply the configured tool-surface policy without deleting implementations.
 * - Validate MCP + Apps SDK descriptor contracts before registration.
 * - Register guarded handlers that enforce OAuth scopes before execution.
 * - Isolate audit/metrics failures from user-visible tool behavior.
 *
 * HTTP/2+ remains the canonical remote transport; this registry is transport-neutral and is shared by stdio, HTTP/1.1
 * fallback, and HTTPS/HTTP/2+ adapters.
 *
 * @module copilot/mcp/registry
 */

import {
    appendMcpAuditEvent,
    authorizeMcpToolCall,
    errorResult,
    getResultSizeHint,
    normalizeMcpToolDefinitions,
    recordMcpToolMetric,
} from '#copilot/mcp/control-plane';
import {
    bindMcpOAuthFrictionAuditProvider,
    bindMcpToolsStatusProvider,
    companyKnowledgeTools,
    connectionTools,
    copilotSessionTools,
    delegateToRepoAutonomyRunnerTool,
    gitReadTools,
    gitWriteTools,
    jobTools,
    llmBLiveTools,
    maintenanceTools,
    mcpAppsSdkReadinessTool,
    mcpAutonomyPowerScoreTool,
    mcpCloudflareConfigAuditTool,
    mcpCloudflareEdgeAuditTool,
    mcpCloudflareEdgeBackupCreateTool,
    mcpCloudflareEdgeBackupsListTool,
    mcpCloudflareEdgePolicyApplyTool,
    mcpCloudflareEdgePolicyDiffTool,
    mcpCloudflareEdgePolicyPlanTool,
    mcpCloudflareEdgeSnapshotTool,
    mcpCloudflareMcpPassthroughApplyTool,
    mcpCloudflareMcpPassthroughDiffTool,
    mcpCloudflareMcpPassthroughPlanTool,
    mcpCloudflareMetricsSnapshotTool,
    mcpCloudflarePlanCapabilitiesAuditTool,
    mcpCloudflarePostChangeGatesTool,
    mcpCloudflareRemoteAuditTool,
    mcpCloudflareSkipAuditTool,
    mcpCloudflareTransportBenchmarkPlanTool,
    mcpConnectorSmokeRefreshTool,
    mcpDevcontainerNetworkPostureAuditTool,
    mcpGoldenPromptsTool,
    mcpHostBlockDiagnosticsTool,
    mcpLatencyDashboardTool,
    mcpToolPayloadAuditTool,
    mcpOAuthFrictionAuditTool,
    mcpPostRestartReadinessTool,
    mcpReloadTools,
    mcpRuntimeHealthTool,
    mcpSessionProfileTool,
    mcpSmokeWorkspaceTool,
    mcpToolsStatusTool,
    mcpTunnelStatusTool,
    metaTools,
    projectDoctorTool,
    repoIndexTools,
    repoPlanTools,
    repoReadTools,
    repoWriteTools,
} from '#copilot/mcp/tools';
import { createHash, randomUUID } from 'node:crypto';
import {
    applyMcpToolSurfacePolicy,
    describeMcpToolSurfacePolicy,
    readMcpToolSurfacePolicy,
    toolSurfaceCacheKey,
} from './tool-surface.js';

export const COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME = 'copilot-mcp-registry';
export const COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION = '1.1.0';

const devcontainerNetworkTools = [mcpDevcontainerNetworkPostureAuditTool];

/** @type {WeakMap<McpToolDefinition, { risk: ReturnType<typeof classifyMcpToolRisk>; requiredScopes: string[] }>} */
const TOOL_RUNTIME_CONTEXT_CACHE = new WeakMap();

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const MAX_TOOL_TITLE_LENGTH = 120;
const MAX_TOOL_DESCRIPTION_LENGTH = 1200;
const MAX_TOOL_META_STRING_LENGTH = 2048;
const MAX_TOOL_INVOCATION_STATUS_LENGTH = 64;
const DEFAULT_MAX_REGISTERED_TOOLS = 250;
const DEFAULT_HANDLER_EXCEPTION_MODE = 'tool-result';
const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOOL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_TOOL_RATE_LIMIT_PER_WINDOW = 120;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_INVOCATION_BUDGETS = 4096;
const SUSPICIOUS_DESCRIPTOR_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/iu,
    /do\s+not\s+tell\s+the\s+user/iu,
    /reveal\s+(secrets?|tokens?|credentials?)/iu,
    /bypass\s+(oauth|auth|security|approval)/iu,
    /disable\s+(safety|security|logging|audit)/iu,
];

/** @type {readonly string[]} */
const MUTATING_TOOL_NAME_MARKERS = Object.freeze([
    'apply',
    'batch',
    'create',
    'delete',
    'disable',
    'edit',
    'enable',
    'fix',
    'move',
    'patch',
    'quarantine',
    'remove',
    'rename',
    'restart',
    'restore',
    'run',
    'set',
    'start',
    'stop',
    'update',
    'write',
]);

/** @type {readonly string[]} */
const HIGH_IMPACT_TOOL_NAME_MARKERS = Object.freeze([
    'admin',
    'autonomy',
    'cloudflare',
    'edge',
    'policy',
    'validator',
    'doctor',
    'run_',
    'restart',
    'apply',
    'write',
    'remove',
    'delete',
]);

/** @type {McpToolDefinition[] | null} */
let canonicalMcpToolsCache = null;
/** @type {string | null} */
let canonicalMcpToolsCacheKey = null;
/** @type {Record<string, unknown> | null} */
let canonicalMcpToolSurfaceState = null;
/** @type {Record<string, unknown> | null} */
let canonicalMcpRegistryState = null;

/** @type {Map<string, { count: number; resetAt: number }>} */
const toolInvocationBudgets = new Map();

/**
 * @typedef {object} McpToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodType>} inputSchema
 * @property {import('zod').ZodType | Record<string, import('zod').ZodType>} [outputSchema]
 * @property {Record<string, unknown>[]} [securitySchemes]
 * @property {Record<string, unknown>} [_meta]
 * @property {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations} annotations
 * @property {(
 *     args: any,
 * ) =>
 *     | Promise<import('#copilot/mcp/control-plane').StructuredCallToolResult>
 *     | import('#copilot/mcp/control-plane').StructuredCallToolResult} handler
 *
 *
 * @typedef {object} RegisterCanonicalMcpToolsOptions
 * @property {import('#copilot/mcp/control-plane').McpAuthContext} [authContext]
 * @property {import('./tool-surface.js').McpToolSurfacePolicy} [toolSurfacePolicy]
 *
 * @typedef {{
 *     strictDescriptorValidation: boolean;
 *     strictRiskValidation: boolean;
 *     enrichOpenAiMeta: boolean;
 *     handlerExceptionMode: 'throw' | 'tool-result';
 *     validateStructuredOutput: boolean;
 *     maxRegisteredTools: number;
 *     toolCountWarnPercent: number;
 *     expectedToolCount: number;
 *     toolTimeoutMs: number;
 *     toolRateLimitWindowMs: number;
 *     toolRateLimitPerWindow: number;
 *     maxToolResultBytes: number;
 * }} McpRegistryPolicy
 *
 *
 * @typedef {{
 *     errors: string[];
 *     warnings: string[];
 *     facts: Record<string, unknown>;
 * }} McpRegistryValidation
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpRegistryPolicy}
 */
export function readMcpRegistryPolicy(env = process.env) {
    return {
        strictDescriptorValidation: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_STRICT_DESCRIPTOR_VALIDATION', false),
        strictRiskValidation: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_STRICT_RISK_VALIDATION', false),
        enrichOpenAiMeta: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_ENRICH_OPENAI_META', true),
        handlerExceptionMode: readEnumEnv(
            env,
            'COPILOT_MCP_REGISTRY_HANDLER_EXCEPTION_MODE',
            ['throw', 'tool-result'],
            DEFAULT_HANDLER_EXCEPTION_MODE,
        ),
        validateStructuredOutput: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_VALIDATE_STRUCTURED_OUTPUT', false),
        maxRegisteredTools: readIntegerEnv(
            env,
            'COPILOT_MCP_REGISTRY_MAX_TOOLS',
            DEFAULT_MAX_REGISTERED_TOOLS,
            1,
            1000,
        ),
        toolCountWarnPercent: readIntegerEnv(env, 'COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT', 80, 1, 100),
        expectedToolCount: readIntegerEnv(env, 'COPILOT_MCP_REGISTRY_EXPECTED_TOOL_COUNT', 0, 0, 1000),
        toolTimeoutMs: readIntegerEnv(
            env,
            'COPILOT_MCP_REGISTRY_TOOL_TIMEOUT_MS',
            DEFAULT_TOOL_TIMEOUT_MS,
            0,
            60 * 60 * 1000,
        ),
        toolRateLimitWindowMs: readIntegerEnv(
            env,
            'COPILOT_MCP_REGISTRY_TOOL_RATE_LIMIT_WINDOW_MS',
            DEFAULT_TOOL_RATE_LIMIT_WINDOW_MS,
            1_000,
            60 * 60 * 1000,
        ),
        toolRateLimitPerWindow: readIntegerEnv(
            env,
            'COPILOT_MCP_REGISTRY_TOOL_RATE_LIMIT_PER_WINDOW',
            DEFAULT_TOOL_RATE_LIMIT_PER_WINDOW,
            1,
            10_000,
        ),
        maxToolResultBytes: readIntegerEnv(
            env,
            'COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES',
            DEFAULT_MAX_TOOL_RESULT_BYTES,
            16 * 1024,
            64 * 1024 * 1024,
        ),
    };
}

/**
 * @param {{
 *     toolSurfacePolicy?: import('./tool-surface.js').McpToolSurfacePolicy;
 * }} [options]
 * @returns {McpToolDefinition[]}
 */
export function getCanonicalMcpTools(options = {}) {
    const registryPolicy = readMcpRegistryPolicy();
    const surfacePolicy = options.toolSurfacePolicy ?? readMcpToolSurfacePolicy();
    const cacheKey = `${toolSurfaceCacheKey(surfacePolicy)}|${registryPolicyCacheKey(registryPolicy)}`;
    if (canonicalMcpToolsCache && canonicalMcpToolsCacheKey === cacheKey) return canonicalMcpToolsCache;

    const allTools = normalizeMcpToolDefinitions(buildCanonicalMcpToolList());
    const allValidation = validateMcpToolDefinitions(allTools, registryPolicy, 'all-tools');
    enforceRegistryValidation('canonical all-tool registry', allValidation, registryPolicy);

    const surfacedTools = applyMcpToolSurfacePolicy(allTools, surfacePolicy);
    const tools = surfacedTools.map((tool) => enrichMcpToolDescriptor(tool, registryPolicy));
    const surfacedValidation = validateMcpToolDefinitions(tools, registryPolicy, 'surfaced-tools');
    enforceRegistryValidation('canonical surfaced-tool registry', surfacedValidation, registryPolicy);

    canonicalMcpToolsCache = tools;
    canonicalMcpToolsCacheKey = cacheKey;
    canonicalMcpToolSurfaceState = {
        ...describeMcpToolSurfacePolicy(tools, allTools, surfacePolicy),
        registry: {
            implementation: {
                name: COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME,
                version: COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION,
            },
            policy: summarizeRegistryPolicy(registryPolicy),
            validation: surfacedValidation,
            manifest: buildMcpToolDescriptorManifest(tools, { includeDescriptors: false }),
        },
    };
    canonicalMcpRegistryState = buildMcpRegistryState(tools, allTools, registryPolicy, cacheKey, {
        allValidation,
        surfacedValidation,
    });
    bindMcpToolsStatusProvider(() => canonicalMcpToolsCache ?? tools);
    bindMcpOAuthFrictionAuditProvider(() => canonicalMcpToolsCache ?? tools);
    return tools;
}

/**
 * @returns {McpToolDefinition[]}
 */
function buildCanonicalMcpToolList() {
    return [
        ...repoReadTools,
        ...repoPlanTools,
        ...repoIndexTools,
        ...gitReadTools,
        ...gitWriteTools,
        projectDoctorTool,
        ...jobTools,
        ...llmBLiveTools,
        mcpLatencyDashboardTool,
        mcpToolPayloadAuditTool,
        ...maintenanceTools,
        delegateToRepoAutonomyRunnerTool,
        mcpGoldenPromptsTool,
        mcpAppsSdkReadinessTool,
        ...companyKnowledgeTools,
        ...devcontainerNetworkTools,
        mcpCloudflareConfigAuditTool,
        mcpCloudflarePlanCapabilitiesAuditTool,
        mcpCloudflareEdgeBackupCreateTool,
        mcpCloudflareEdgeBackupsListTool,
        mcpCloudflareEdgeAuditTool,
        mcpCloudflareEdgePolicyApplyTool,
        mcpCloudflareEdgePolicyDiffTool,
        mcpCloudflareEdgePolicyPlanTool,
        mcpCloudflareEdgeSnapshotTool,
        mcpCloudflareMetricsSnapshotTool,
        mcpCloudflarePostChangeGatesTool,
        mcpCloudflareTransportBenchmarkPlanTool,
        mcpHostBlockDiagnosticsTool,
        ...connectionTools,
        mcpCloudflareRemoteAuditTool,
        mcpCloudflareSkipAuditTool,
        mcpCloudflareMcpPassthroughPlanTool,
        mcpCloudflareMcpPassthroughDiffTool,
        mcpCloudflareMcpPassthroughApplyTool,
        ...repoWriteTools,
        ...copilotSessionTools,
        ...metaTools,
        mcpOAuthFrictionAuditTool,
        mcpSessionProfileTool,
        mcpAutonomyPowerScoreTool,
        mcpToolsStatusTool,
        mcpSmokeWorkspaceTool,
        mcpTunnelStatusTool,
        mcpConnectorSmokeRefreshTool,
        mcpPostRestartReadinessTool,
        ...mcpReloadTools,
        mcpRuntimeHealthTool,
    ];
}

/**
 * @returns {Record<string, unknown>}
 */
export function getCanonicalMcpToolSurfaceState() {
    if (!canonicalMcpToolSurfaceState) {
        getCanonicalMcpTools();
    }
    return canonicalMcpToolSurfaceState ?? {};
}

/**
 * @returns {Record<string, unknown>}
 */
export function getCanonicalMcpRegistryState() {
    if (!canonicalMcpRegistryState) {
        getCanonicalMcpTools();
    }
    return canonicalMcpRegistryState ?? {};
}

/**
 * Returns bounded runtime registry diagnostics without exposing subjects or credentials.
 *
 * @returns {{ toolInvocationBudgets: { size: number; maxSize: number } }}
 */
export function readMcpRegistryRuntimeState() {
    pruneToolInvocationBudgets();
    return {
        toolInvocationBudgets: {
            size: toolInvocationBudgets.size,
            maxSize: MAX_TOOL_INVOCATION_BUDGETS,
        },
    };
}

/**
 * @param {{ includeDescriptors?: boolean; toolSurfacePolicy?: import('./tool-surface.js').McpToolSurfacePolicy }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildCanonicalMcpRegistryManifest(options = {}) {
    return buildMcpToolDescriptorManifest(
        getCanonicalMcpTools(
            options.toolSurfacePolicy === undefined ? {} : { toolSurfacePolicy: options.toolSurfacePolicy },
        ),
        { includeDescriptors: options.includeDescriptors === true },
    );
}

/**
 * Test helper for env/profile switching inside one Node process.
 *
 * @returns {void}
 */
export function resetCanonicalMcpToolsCacheForTests() {
    canonicalMcpToolsCache = null;
    canonicalMcpToolsCacheKey = null;
    canonicalMcpToolSurfaceState = null;
    canonicalMcpRegistryState = null;
    toolInvocationBudgets.clear();
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {RegisterCanonicalMcpToolsOptions} [options]
 * @returns {McpToolDefinition[]}
 */
export function registerCanonicalMcpTools(server, options = {}) {
    const registryPolicy = readMcpRegistryPolicy();
    const tools = getCanonicalMcpTools(
        options.toolSurfacePolicy === undefined ? {} : { toolSurfacePolicy: options.toolSurfacePolicy },
    );
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            buildMcpRegisterToolOptions(tool),
            /** @param {Record<string, unknown>} args */
            async (args) => guardedToolHandler(tool, args, options, registryPolicy),
        );
    }
    return tools;
}

/**
 * @param {McpToolDefinition} tool
 * @returns {Parameters<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>[1]}
 */
function buildMcpRegisterToolOptions(tool) {
    return /** @type {Parameters<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>[1]} */ ({
        title: tool.title,
        description: tool.description,
        inputSchema: /**
         * @type {Parameters<
         *     import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']
         * >[1]['inputSchema']}
         */ (/** @type {unknown} */ (tool.inputSchema)),
        annotations: tool.annotations,
        ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.securitySchemes !== undefined ? { securitySchemes: tool.securitySchemes } : {}),
        ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
    });
}

/**
 * @param {McpToolDefinition} tool
 * @param {Record<string, unknown>} args
 * @param {RegisterCanonicalMcpToolsOptions} options
 * @param {McpRegistryPolicy} registryPolicy
 * @returns {Promise<import('#copilot/mcp/control-plane').StructuredCallToolResult>}
 */
async function guardedToolHandler(tool, args, options, registryPolicy) {
    const startedAt = Date.now();
    const callId = randomUUID();
    const runtimeContext = getMcpToolRuntimeContext(tool);
    const risk = runtimeContext.risk;
    const requiredScopes = runtimeContext.requiredScopes;
    /** @type {Record<string, number>} */
    const phases = {};
    let activePhase = 'auditStart';
    let activePhaseStartedAt = startedAt;
    /**
     * @param {string} phase
     * @returns {number}
     */
    const startPhase = (phase) => {
        activePhase = phase;
        activePhaseStartedAt = Date.now();
        return activePhaseStartedAt;
    };
    /**
     * @param {string} phase
     * @param {number} phaseStartedAt
     * @returns {void}
     */
    const finishPhase = (phase, phaseStartedAt) => {
        phases[phase] = elapsedMs(phaseStartedAt);
        activePhase = 'idle';
        activePhaseStartedAt = Date.now();
    };
    await safeAppendMcpAuditEvent({
        event: 'tool_call_started',
        callId,
        tool: tool.name,
        readOnly: tool.annotations.readOnlyHint === true,
        destructive: tool.annotations.destructiveHint === true,
        openWorld: tool.annotations.openWorldHint === true,
        risk,
        requiredScopes,
    });
    try {
        const rateLimitStartedAt = startPhase('rateLimit');
        const rateLimit = consumeToolInvocationBudget(tool, options, registryPolicy);
        finishPhase('rateLimit', rateLimitStartedAt);
        if (!rateLimit.allowed) {
            const durationMs = elapsedMs(startedAt);
            await safeAppendMcpAuditEvent({
                event: 'tool_call_rate_limited',
                callId,
                tool: tool.name,
                durationMs,
                retryAfterMs: rateLimit.retryAfterMs,
                risk,
            });
            safeRecordMcpToolMetric(tool.name, { durationMs, isError: true, phases });
            return errorResult('MCP tool rate limit exceeded.', {
                code: 'MCP_TOOL_RATE_LIMITED',
                retryAfterMs: rateLimit.retryAfterMs,
                callId,
            });
        }

        const authorizationStartedAt = startPhase('authorization');
        const authorization = await authorizeMcpToolCall(tool, options.authContext);
        finishPhase('authorization', authorizationStartedAt);
        if (!authorization.allowed) {
            const durationMs = elapsedMs(startedAt);
            await safeAppendMcpAuditEvent({
                event: 'tool_call_auth_denied',
                callId,
                tool: tool.name,
                durationMs,
                code: authorization.code,
                requiredScopes: authorization.requiredScopes,
                risk,
            });
            safeRecordMcpToolMetric(tool.name, { durationMs, isError: true, phases });
            return errorResult(
                authorization.message ?? 'MCP authorization failed.',
                {
                    code: authorization.code ?? 'MCP_AUTH_DENIED',
                    hint: authorization.hint,
                    requiredScopes: authorization.requiredScopes,
                    enforcement: authorization.enforcement,
                    callId,
                },
                authorization.challenge
                    ? {
                          'mcp/www_authenticate': authorization.challenge,
                      }
                    : undefined,
            );
        }

        const handlerStartedAt = startPhase('handler');
        const result = await runToolHandlerWithTimeout(tool, args, registryPolicy);
        finishPhase('handler', handlerStartedAt);
        const resultSizeStartedAt = startPhase('resultSize');
        const resultSizeValidation = validateToolResultSize(result, registryPolicy);
        const resultSizeError =
            typeof resultSizeValidation === 'string' ? resultSizeValidation : resultSizeValidation.error;
        const resultSizeMetric = typeof resultSizeValidation === 'string' ? undefined : resultSizeValidation;
        finishPhase('resultSize', resultSizeStartedAt);
        if (resultSizeError) {
            const durationMs = elapsedMs(startedAt);
            await safeAppendMcpAuditEvent({
                event: 'tool_call_result_rejected',
                callId,
                tool: tool.name,
                durationMs,
                reason: resultSizeError,
                risk,
            });
            safeRecordMcpToolMetric(tool.name, {
                durationMs,
                isError: true,
                phases,
                resultSize: { ...resultSizeMetric, rejected: true },
            });
            return errorResult('MCP tool result rejected by registry policy.', {
                code: 'MCP_TOOL_RESULT_REJECTED',
                hint: resultSizeError,
                callId,
            });
        }

        const outputValidationStartedAt = startPhase('outputValidation');
        const outputValidation = registryPolicy.validateStructuredOutput
            ? validateToolStructuredOutput(tool, result)
            : [];
        finishPhase('outputValidation', outputValidationStartedAt);
        if (outputValidation.length > 0) {
            await safeAppendMcpAuditEvent({
                event: 'tool_call_output_validation_warning',
                callId,
                tool: tool.name,
                durationMs: elapsedMs(startedAt),
                warnings: outputValidation,
            });
        }
        const durationMs = elapsedMs(startedAt);
        const auditCompletionStartedAt = startPhase('auditCompletion');
        await safeAppendMcpAuditEvent({
            event: 'tool_call_completed',
            callId,
            tool: tool.name,
            durationMs,
            isError: result.isError === true,
            risk,
        });
        finishPhase('auditCompletion', auditCompletionStartedAt);
        safeRecordMcpToolMetric(tool.name, {
            durationMs,
            isError: result.isError === true,
            phases,
            ...(resultSizeMetric ? { resultSize: resultSizeMetric } : {}),
        });
        return result;
    } catch (error) {
        const durationMs = elapsedMs(startedAt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (activePhase !== 'idle' && phases[activePhase] === undefined) {
            phases[activePhase] = elapsedMs(activePhaseStartedAt);
        }
        await safeAppendMcpAuditEvent({
            event: 'tool_call_failed',
            callId,
            tool: tool.name,
            durationMs,
            error: errorMessage,
            risk,
        });
        safeRecordMcpToolMetric(tool.name, { durationMs, isError: true, phases });
        if (registryPolicy.handlerExceptionMode === 'tool-result') {
            return errorResult('MCP tool execution failed.', {
                code: 'MCP_TOOL_EXECUTION_FAILED',
                hint: errorMessage,
                callId,
            });
        }
        throw error;
    }
}

/**
 * @param {McpToolDefinition} tool
 * @param {RegisterCanonicalMcpToolsOptions} options
 * @param {McpRegistryPolicy} policy
 * @returns {{ allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number }}
 */
function consumeToolInvocationBudget(tool, options, policy) {
    pruneToolInvocationBudgets();
    const subject = buildToolInvocationBudgetSubject(options);
    const key = `${tool.name}:${subject}`;
    const now = Date.now();
    const current = toolInvocationBudgets.get(key);
    if (!current || current.resetAt <= now) {
        toolInvocationBudgets.set(key, { count: 1, resetAt: now + policy.toolRateLimitWindowMs });
        enforceToolInvocationBudgetLimit();
        return { allowed: true, retryAfterMs: 0 };
    }
    current.count += 1;
    if (current.count <= policy.toolRateLimitPerWindow) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: Math.max(0, current.resetAt - now) };
}

/**
 * @param {RegisterCanonicalMcpToolsOptions} options
 * @returns {string}
 */
function buildToolInvocationBudgetSubject(options) {
    const token = String(options.authContext?.bearerToken ?? 'anonymous');
    return sha256String(token).slice(0, 24);
}

/**
 * @returns {number}
 */
function enforceToolInvocationBudgetLimit() {
    let removed = 0;
    while (toolInvocationBudgets.size > MAX_TOOL_INVOCATION_BUDGETS) {
        const oldest = toolInvocationBudgets.keys().next().value;
        if (typeof oldest !== 'string') break;
        toolInvocationBudgets.delete(oldest);
        removed += 1;
    }
    return removed;
}

/**
 * @param {number} [now]
 * @returns {number}
 */
function pruneToolInvocationBudgets(now = Date.now()) {
    let removed = 0;
    for (const [key, budget] of toolInvocationBudgets) {
        if (budget.resetAt <= now) {
            toolInvocationBudgets.delete(key);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {McpToolDefinition} tool
 * @param {Record<string, unknown>} args
 * @param {McpRegistryPolicy} policy
 * @returns {Promise<import('#copilot/mcp/control-plane').StructuredCallToolResult>}
 */
async function runToolHandlerWithTimeout(tool, args, policy) {
    if (!policy.toolTimeoutMs) return tool.handler(args);
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve(tool.handler(args)),
            new Promise((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error(`MCP tool timed out after ${policy.toolTimeoutMs}ms.`)),
                    policy.toolTimeoutMs,
                );
                timeout.unref?.();
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/**
 * @param {unknown} result
 * @param {McpRegistryPolicy} policy
 * @returns {{ error: string | null; strategy: string; bytes: number | null }}
 */
function validateToolResultSize(result, policy) {
    const hint = getResultSizeHint(result);
    if (hint) {
        return {
            error:
                hint.bytes > policy.maxToolResultBytes
                    ? `Tool result is ${hint.bytes} bytes by ${hint.source}; limit is ${policy.maxToolResultBytes} bytes.`
                    : null,
            strategy: 'hint',
            bytes: hint.bytes,
        };
    }
    try {
        const bytes = Buffer.byteLength(stableJsonStringify(result));
        return {
            error:
                bytes > policy.maxToolResultBytes
                    ? `Tool result is ${bytes} bytes; limit is ${policy.maxToolResultBytes} bytes.`
                    : null,
            strategy: 'stringify',
            bytes,
        };
    } catch {
        return { error: null, strategy: 'unknown', bytes: null };
    }
}

/**
 * @param {McpToolDefinition[]} tools
 * @param {McpRegistryPolicy} policy
 * @param {string} scope
 * @returns {McpRegistryValidation}
 */
export function validateMcpToolDefinitions(tools, policy = readMcpRegistryPolicy(), scope = 'tools') {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    const names = new Set();
    if (!Array.isArray(tools)) {
        return {
            errors: [`${scope}: tools must be an array.`],
            warnings,
            facts: { scope },
        };
    }
    if (tools.length === 0) errors.push(`${scope}: no tools are registered.`);
    if (tools.length > policy.maxRegisteredTools) {
        errors.push(`${scope}: ${tools.length} tools exceeds maxRegisteredTools=${policy.maxRegisteredTools}.`);
    } else {
        const warningCount = Math.ceil((policy.maxRegisteredTools * policy.toolCountWarnPercent) / 100);
        if (tools.length >= warningCount) {
            warnings.push(
                `${scope}: tool count ${tools.length} reached ${policy.toolCountWarnPercent}% warning threshold for maxRegisteredTools=${policy.maxRegisteredTools}.`,
            );
        }
    }
    if (policy.expectedToolCount > 0 && tools.length !== policy.expectedToolCount) {
        warnings.push(`${scope}: tool count ${tools.length} differs from expected ${policy.expectedToolCount}.`);
    }

    for (const [index, tool] of tools.entries()) {
        const label = tool?.name ? `${scope}:${tool.name}` : `${scope}:#${index}`;
        if (!tool || typeof tool !== 'object') {
            errors.push(`${label}: tool descriptor must be an object.`);
            continue;
        }
        if (!TOOL_NAME_PATTERN.test(String(tool.name ?? ''))) {
            errors.push(
                `${label}: tool name must be 1-128 chars and only contain ASCII letters, digits, '_', '-' or '.'.`,
            );
        }
        if (names.has(tool.name)) errors.push(`${label}: duplicate tool name.`);
        names.add(tool.name);

        if (typeof tool.title !== 'string' || !tool.title.trim()) warnings.push(`${label}: title should be non-empty.`);
        if (String(tool.title ?? '').length > MAX_TOOL_TITLE_LENGTH) warnings.push(`${label}: title is too long.`);
        if (typeof tool.description !== 'string' || !tool.description.trim()) {
            warnings.push(`${label}: description should be non-empty.`);
        }
        if (String(tool.description ?? '').length > MAX_TOOL_DESCRIPTION_LENGTH) {
            warnings.push(`${label}: description is unusually long.`);
        }
        for (const pattern of SUSPICIOUS_DESCRIPTOR_PATTERNS) {
            if (pattern.test(`${tool.title ?? ''}\n${tool.description ?? ''}`)) {
                errors.push(`${label}: descriptor contains suspicious instruction-like text.`);
                break;
            }
        }

        if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
            errors.push(`${label}: inputSchema must be an object.`);
        }
        if (tool.outputSchema !== undefined && (!tool.outputSchema || typeof tool.outputSchema !== 'object')) {
            warnings.push(`${label}: outputSchema should be an object or Zod schema.`);
        }
        if (typeof tool.handler !== 'function') errors.push(`${label}: handler must be a function.`);

        validateAnnotations(tool, label, warnings, errors);
        validateSecuritySchemes(tool, label, warnings);
        validateToolMeta(tool, label, warnings, errors);
    }

    return {
        errors,
        warnings,
        facts: {
            scope,
            count: tools.length,
            readOnly: tools.filter((tool) => tool?.annotations?.readOnlyHint === true).length,
            destructive: tools.filter((tool) => tool?.annotations?.destructiveHint === true).length,
            openWorld: tools.filter((tool) => tool?.annotations?.openWorldHint === true).length,
        },
    };
}

/**
 * @param {McpToolDefinition} tool
 * @param {string} label
 * @param {string[]} warnings
 * @param {string[]} errors
 * @returns {void}
 */
function validateAnnotations(tool, label, warnings, errors) {
    const annotations = tool.annotations ?? {};
    if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
        warnings.push(`${label}: annotations should be an object.`);
        return;
    }
    const risk = classifyMcpToolRisk(tool);
    if (annotations.readOnlyHint === true && annotations.destructiveHint === true) {
        errors.push(`${label}: readOnlyHint and destructiveHint cannot both be true.`);
    }
    if (risk.mutatingName && annotations.readOnlyHint === true) {
        warnings.push(`${label}: mutating-looking tool is marked readOnlyHint=true.`);
    }
    if (risk.highImpactName && annotations.destructiveHint !== true && annotations.readOnlyHint !== true) {
        warnings.push(`${label}: high-impact tool should declare readOnlyHint=true or destructiveHint=true.`);
    }
    for (const field of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        const value = /** @type {Record<string, unknown>} */ (annotations)[field];
        if (value !== undefined && typeof value !== 'boolean')
            warnings.push(`${label}: annotation ${field} should be boolean.`);
    }
}

/**
 * @param {McpToolDefinition} tool
 * @param {string} label
 * @param {string[]} warnings
 * @returns {void}
 */
function validateSecuritySchemes(tool, label, warnings) {
    if (tool.securitySchemes === undefined) return;
    if (!Array.isArray(tool.securitySchemes)) {
        warnings.push(`${label}: securitySchemes should be an array.`);
        return;
    }
    for (const [index, scheme] of tool.securitySchemes.entries()) {
        if (!scheme || typeof scheme !== 'object' || Array.isArray(scheme)) {
            warnings.push(`${label}: securitySchemes[${index}] should be an object.`);
            continue;
        }
        if (typeof scheme['type'] !== 'string' || !scheme['type']) {
            warnings.push(`${label}: securitySchemes[${index}].type should be a non-empty string.`);
        }
    }
}

/**
 * @param {McpToolDefinition} tool
 * @param {string} label
 * @param {string[]} warnings
 * @param {string[]} errors
 * @returns {void}
 */
function validateToolMeta(tool, label, warnings, errors) {
    if (tool._meta === undefined) return;
    if (!tool._meta || typeof tool._meta !== 'object' || Array.isArray(tool._meta)) {
        warnings.push(`${label}: _meta should be an object.`);
        return;
    }
    const meta = /** @type {Record<string, unknown>} */ (tool._meta);
    for (const [key, value] of Object.entries(meta)) {
        if (typeof key !== 'string' || key.length > 160) warnings.push(`${label}: _meta key is unusual.`);
        if (typeof value === 'string' && value.length > MAX_TOOL_META_STRING_LENGTH) {
            warnings.push(`${label}: _meta["${key}"] is unusually long.`);
        }
    }
    for (const key of ['openai/toolInvocation/invoking', 'openai/toolInvocation/invoked']) {
        const value = meta[key];
        if (value !== undefined && (typeof value !== 'string' || value.length > MAX_TOOL_INVOCATION_STATUS_LENGTH)) {
            errors.push(
                `${label}: _meta["${key}"] must be a string of at most ${MAX_TOOL_INVOCATION_STATUS_LENGTH} chars.`,
            );
        }
    }
}

/**
 * @param {string} context
 * @param {McpRegistryValidation} validation
 * @param {McpRegistryPolicy} policy
 * @returns {void}
 */
function enforceRegistryValidation(context, validation, policy) {
    const errors = [...validation.errors];
    if (policy.strictDescriptorValidation) errors.push(...validation.warnings);
    if (policy.strictRiskValidation) {
        errors.push(
            ...validation.warnings.filter((warning) =>
                /readOnlyHint|destructiveHint|high-impact|mutating/u.test(warning),
            ),
        );
    }
    if (errors.length > 0) {
        throw new Error(`${context} failed validation: ${errors.slice(0, 20).join('; ')}`);
    }
}

/**
 * @param {McpToolDefinition} tool
 * @param {McpRegistryPolicy} policy
 * @returns {McpToolDefinition}
 */
function enrichMcpToolDescriptor(tool, policy) {
    const risk = classifyMcpToolRisk(tool);
    const annotations = normalizeToolAnnotations(tool.annotations, risk);
    if (!policy.enrichOpenAiMeta) return { ...tool, annotations };

    const meta = { ...(tool._meta ?? {}) };
    if (tool.securitySchemes && !Array.isArray(meta['securitySchemes'])) {
        meta['securitySchemes'] = tool.securitySchemes;
    }
    if (meta['openai/toolInvocation/invoking'] === undefined) {
        meta['openai/toolInvocation/invoking'] = buildInvocationStatus(tool, 'running');
    }
    if (meta['openai/toolInvocation/invoked'] === undefined) {
        meta['openai/toolInvocation/invoked'] = buildInvocationStatus(tool, 'complete');
    }
    return { ...tool, annotations, _meta: meta };
}

/**
 * @param {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations | undefined} annotations
 * @param {ReturnType<typeof classifyMcpToolRisk>} risk
 * @returns {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations}
 */
function normalizeToolAnnotations(annotations, risk) {
    const current = annotations && typeof annotations === 'object' ? annotations : {};
    return {
        ...current,
        ...(typeof current.readOnlyHint === 'boolean'
            ? {}
            : { readOnlyHint: !risk.mutatingName && !risk.highImpactName }),
        ...(typeof current.destructiveHint === 'boolean'
            ? {}
            : { destructiveHint: risk.mutatingName && risk.highImpactName }),
        ...(typeof current.openWorldHint === 'boolean' ? {} : { openWorldHint: risk.openWorldName }),
    };
}

/**
 * @param {McpToolDefinition} tool
 * @param {'running' | 'complete'} phase
 * @returns {string}
 */
function buildInvocationStatus(tool, phase) {
    const base = sanitizeStatusText(tool.title || tool.name || 'Tool');
    const text = phase === 'running' ? `${base}…` : `${base} done`;
    return text.length <= MAX_TOOL_INVOCATION_STATUS_LENGTH
        ? text
        : `${text.slice(0, MAX_TOOL_INVOCATION_STATUS_LENGTH - 1)}…`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeStatusText(value) {
    const compact = String(value ?? '')
        .replace(/[^\p{L}\p{N} .:_-]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    return compact || 'Tool';
}

/**
 * @param {McpToolDefinition} tool
 * @returns {{ mutatingName: boolean; highImpactName: boolean; openWorldName: boolean; category: string }}
 */
export function classifyMcpToolRisk(tool) {
    const name = String(tool?.name ?? '').toLowerCase();
    const text = `${name} ${String(tool?.title ?? '').toLowerCase()} ${String(tool?.description ?? '').toLowerCase()}`;
    const mutatingName = MUTATING_TOOL_NAME_MARKERS.some((marker) => name.includes(marker));
    const highImpactName = HIGH_IMPACT_TOOL_NAME_MARKERS.some((marker) => name.includes(marker));
    const openWorldName = /\b(web|cloudflare|remote|github|internet|external|connector|tunnel)\b/u.test(text);
    return {
        mutatingName,
        highImpactName,
        openWorldName,
        category:
            mutatingName && highImpactName
                ? 'high-impact-write'
                : mutatingName
                  ? 'write'
                  : highImpactName
                    ? 'high-impact-read'
                    : 'read-or-compute',
    };
}

/**
 * @param {McpToolDefinition[]} tools
 * @param {{ includeDescriptors?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
function buildMcpToolDescriptorManifest(tools, options = {}) {
    const descriptors = tools.map((tool) => descriptorManifestEntry(tool));
    const fingerprint = sha256StableJson(descriptors);
    return {
        schemaVersion: 1,
        implementation: {
            name: COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME,
            version: COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION,
        },
        generatedAt: new Date().toISOString(),
        toolCount: tools.length,
        fingerprint,
        counts: {
            readOnly: tools.filter((tool) => tool.annotations?.readOnlyHint === true).length,
            destructive: tools.filter((tool) => tool.annotations?.destructiveHint === true).length,
            openWorld: tools.filter((tool) => tool.annotations?.openWorldHint === true).length,
            outputSchema: tools.filter((tool) => tool.outputSchema !== undefined).length,
            oauthSecurity: tools.filter((tool) => collectToolSecurityScopes(tool).length > 0).length,
        },
        ...(options.includeDescriptors
            ? { tools: descriptors }
            : { toolNames: descriptors.map((entry) => entry['name']) }),
    };
}

/**
 * @param {McpToolDefinition} tool
 * @returns {Record<string, unknown>}
 */
function descriptorManifestEntry(tool) {
    const risk = classifyMcpToolRisk(tool);
    return {
        name: tool.name,
        title: tool.title,
        descriptionHash: sha256String(String(tool.description ?? '')),
        annotations: normalizePlainObject(tool.annotations ?? {}),
        inputFields: Object.keys(tool.inputSchema ?? {}).sort(),
        hasOutputSchema: tool.outputSchema !== undefined,
        securityScopes: collectToolSecurityScopes(tool),
        risk: risk.category,
        metaKeys: Object.keys(tool._meta ?? {}).sort(),
    };
}

/**
 * @param {McpToolDefinition[]} tools
 * @param {McpToolDefinition[]} allTools
 * @param {McpRegistryPolicy} policy
 * @param {string} cacheKey
 * @param {{ allValidation: McpRegistryValidation; surfacedValidation: McpRegistryValidation }} validation
 * @returns {Record<string, unknown>}
 */
function buildMcpRegistryState(tools, allTools, policy, cacheKey, validation) {
    const manifest = buildMcpToolDescriptorManifest(tools);
    return {
        implementation: {
            name: COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME,
            version: COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION,
        },
        cacheKeyHash: sha256String(cacheKey),
        policy: summarizeRegistryPolicy(policy),
        allToolCount: allTools.length,
        surfacedToolCount: tools.length,
        manifest,
        validation,
        lastBuiltAt: new Date().toISOString(),
    };
}

/**
 * @param {McpRegistryPolicy} policy
 * @returns {Record<string, unknown>}
 */
function summarizeRegistryPolicy(policy) {
    return {
        strictDescriptorValidation: policy.strictDescriptorValidation,
        strictRiskValidation: policy.strictRiskValidation,
        enrichOpenAiMeta: policy.enrichOpenAiMeta,
        handlerExceptionMode: policy.handlerExceptionMode,
        validateStructuredOutput: policy.validateStructuredOutput,
        maxRegisteredTools: policy.maxRegisteredTools,
        toolCountWarnPercent: policy.toolCountWarnPercent,
        expectedToolCount: policy.expectedToolCount || null,
        toolTimeoutMs: policy.toolTimeoutMs,
        toolRateLimitWindowMs: policy.toolRateLimitWindowMs,
        toolRateLimitPerWindow: policy.toolRateLimitPerWindow,
        maxToolResultBytes: policy.maxToolResultBytes,
    };
}

/**
 * @param {McpRegistryPolicy} policy
 * @returns {string}
 */
function registryPolicyCacheKey(policy) {
    return stableJsonStringify(summarizeRegistryPolicy(policy));
}

/**
 * @param {McpToolDefinition} tool
 * @returns {{ risk: ReturnType<typeof classifyMcpToolRisk>; requiredScopes: string[] }}
 */
function getMcpToolRuntimeContext(tool) {
    const cached = TOOL_RUNTIME_CONTEXT_CACHE.get(tool);
    if (cached) return cached;
    const context = {
        risk: classifyMcpToolRisk(tool),
        requiredScopes: collectToolSecurityScopes(tool),
    };
    TOOL_RUNTIME_CONTEXT_CACHE.set(tool, context);
    return context;
}

/**
 * @param {McpToolDefinition} tool
 * @returns {string[]}
 */
function collectToolSecurityScopes(tool) {
    const scopes = new Set();
    for (const scheme of [
        ...normalizeSecuritySchemeArray(tool.securitySchemes),
        ...normalizeSecuritySchemeArray(tool._meta?.['securitySchemes']),
    ]) {
        if (Array.isArray(scheme['scopes'])) {
            for (const scope of scheme['scopes']) if (typeof scope === 'string' && scope) scopes.add(scope);
        }
    }
    return [...scopes].sort();
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function normalizeSecuritySchemeArray(value) {
    return Array.isArray(value)
        ? /** @type {Record<string, unknown>[]} */ (
              value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
          )
        : [];
}

/**
 * @param {McpToolDefinition} tool
 * @param {import('#copilot/mcp/control-plane').StructuredCallToolResult} result
 * @returns {string[]}
 */
function validateToolStructuredOutput(tool, result) {
    if (tool.outputSchema === undefined || !result || typeof result !== 'object') return [];
    if (!('structuredContent' in result)) return [];
    const schema = tool.outputSchema;
    if (schema && typeof schema === 'object' && 'safeParse' in schema && typeof schema.safeParse === 'function') {
        const parsed = schema.safeParse(result.structuredContent);
        return parsed.success ? [] : ['structuredContent does not satisfy outputSchema.'];
    }
    return [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(/** @type {Record<string, unknown>} */ (value))
            .filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Date.now() - startedAt;
}

/**
 * @param {Parameters<typeof appendMcpAuditEvent>[0] & Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function safeAppendMcpAuditEvent(event) {
    try {
        await appendMcpAuditEvent(event);
    } catch {
        // Telemetry failures must not break a tool call.
    }
}

/**
 * @param {string} toolName
 * @param {Parameters<typeof recordMcpToolMetric>[1]} metric
 * @returns {void}
 */
function safeRecordMcpToolMetric(toolName, metric) {
    try {
        recordMcpToolMetric(toolName, metric);
    } catch {
        // Metrics failures must not break a tool call.
    }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(env, name, fallback) {
    const raw = String(env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
}

/**
 * @template {string} T
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
function readEnumEnv(env, name, allowed, fallback) {
    const raw = String(env[name] ?? '').trim();
    return allowed.includes(/** @type {T} */ (raw)) ? /** @type {T} */ (raw) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function readIntegerEnv(env, name, fallback, min, max) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJsonStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(/** @type {Record<string, unknown>} */ (value))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256StableJson(value) {
    return sha256String(stableJsonStringify(value));
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256String(value) {
    return createHash('sha256').update(value).digest('hex');
}
