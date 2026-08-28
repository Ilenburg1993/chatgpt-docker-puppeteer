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
 * @module copilot/mcp/registry/runtime
 */

import { readMutationAppliedState } from '#copilot/infra/public/policy';
import { authorizeMcpToolCall, readMcpAuthConfig } from '#copilot/mcp/public/auth';
import {
    readMcpHttpToolTimingMetadata,
    recordMcpHttpToolHandlerEnd,
    recordMcpHttpToolHandlerStart,
    recordMcpToolInteractionEnd,
    recordMcpToolInteractionStart,
    recordMcpToolMetric,
} from '#copilot/mcp/public/observability';
import {
    MCP_TOOL_DESCRIPTOR_SET_FINGERPRINT_KIND,
    buildMcpToolDescriptorRevisionToken,
    buildMcpToolWireFingerprintIndex,
    classifyMcpToolContractRisk,
    fingerprintMcpToolWireDescriptorSet,
    normalizeMcpToolDefinitions,
    projectMcpToolAnnotations,
    validateMcpToolContractSemantics,
} from '#copilot/mcp/public/protocol/catalog';
import {
    createMcpToolOperationContext,
    errorResult,
    getResultExecutionHint,
    getResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';
import { buildMcpWireToolCatalog, projectMcpToolOptionPolicy } from '#copilot/mcp/public/tools/catalog';
import { toMcpWorkspaceRelativePath } from '#copilot/mcp/public/workspace';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { buildMcpToolCallAuditCorrelation, scopeMcpToolAuditCapability } from './audit-correlation.js';
import { projectMcpToolResultOutcome } from './result-outcome.js';
import {
    MCP_TOOL_SURFACE_MODES,
    applyMcpToolSurfacePolicy,
    createMcpToolSurfacePolicy,
    describeMcpToolSurfacePolicy,
    readMcpToolSurfacePolicy,
    toolSurfaceCacheKey,
} from './surface-policy.js';

export const COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME = 'copilot-mcp-registry';
export const COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION = '1.1.0';

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
/** @type {readonly string[]} */
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

/** @typedef {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} McpToolDefinition */

/**
 * @typedef {object} RegisterCanonicalMcpToolsOptions
 * @property {import('#copilot/mcp/public/auth').McpAuthContext} [authContext]
 * @property {import('#copilot/mcp/public/auth').McpAuthRuntimeConfig & { resourceServer?: ReturnType<typeof import('#copilot/mcp/public/auth').createMcpAuthResourceServerRuntime> }} [authRuntime]
 * @property {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} [workspace]
 * @property {import('#copilot/mcp/public/protocol/tools').McpToolConfigProjection} [toolConfig]
 * @property {import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection} [toolCapabilities]
 * @property {import('./surface-policy.js').McpToolSurfacePolicy} [toolSurfacePolicy]
 * @property {McpRegistryPolicy} [registryPolicy]
 *
 * @typedef {{
 *     strictDescriptorValidation: boolean;
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
        enrichOpenAiMeta: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_ENRICH_OPENAI_META', true),
        handlerExceptionMode: readEnumEnv(
            env,
            'COPILOT_MCP_REGISTRY_HANDLER_EXCEPTION_MODE',
            ['throw', 'tool-result'],
            DEFAULT_HANDLER_EXCEPTION_MODE,
        ),
        validateStructuredOutput: readBooleanEnv(env, 'COPILOT_MCP_REGISTRY_VALIDATE_STRUCTURED_OUTPUT', true),
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
 * Build and validate the normalized all-tool catalog without mutating registry cache/status state.
 *
 * @param {McpRegistryPolicy} registryPolicy
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} authConfig
 */
function buildCanonicalAllMcpTools(registryPolicy, authConfig) {
    const allTools = normalizeMcpToolDefinitions(buildMcpWireToolCatalog(), { authConfig });
    const allValidation = validateMcpToolDefinitions(allTools, registryPolicy, 'all-tools');
    enforceRegistryValidation('canonical all-tool registry', allValidation, registryPolicy);
    return { allTools, allValidation };
}

/**
 * Materialize one selected surface from an already-normalized all-tool catalog without touching process-global cache.
 *
 * @param {McpToolDefinition[]} allTools
 * @param {import('./surface-policy.js').McpToolSurfacePolicy} surfacePolicy
 * @param {McpRegistryPolicy} registryPolicy
 */
function buildCanonicalMcpToolSurface(allTools, surfacePolicy, registryPolicy) {
    const surfacedTools = applyMcpToolSurfacePolicy(allTools, surfacePolicy);
    const tools = surfacedTools.map((tool) => enrichMcpToolDescriptor(tool, registryPolicy));
    const observedValidation = validateMcpToolDefinitions(tools, registryPolicy, 'surfaced-tools');
    const surfacedValidation = normalizeIntentionalEmptySurfaceValidation(observedValidation, tools, surfacePolicy);
    enforceRegistryValidation('canonical surfaced-tool registry', surfacedValidation, registryPolicy);
    return { tools, surfacedValidation };
}

/**
 * Preserve the global invariant that the canonical all-tool registry is non-empty while allowing an explicitly empty
 * advertisement projection. `allowEmpty` is a surface-policy escape hatch, not a descriptor-validation bypass: only
 * the one error caused solely by selecting zero surfaced tools is suppressed; every other error/warning remains.
 *
 * @param {McpRegistryValidation} validation
 * @param {McpToolDefinition[]} tools
 * @param {import('./surface-policy.js').McpToolSurfacePolicy} surfacePolicy
 * @returns {McpRegistryValidation}
 */
function normalizeIntentionalEmptySurfaceValidation(validation, tools, surfacePolicy) {
    if (!surfacePolicy.allowEmpty || tools.length !== 0) return validation;
    const emptySurfaceError = 'surfaced-tools: no tools are registered.';
    return {
        ...validation,
        errors: validation.errors.filter((error) => error !== emptySurfaceError),
    };
}

/**
 * Create a bounded, server-generation-owned comparison capability. The all-tool catalog and eight canonical surfaces
 * are materialized only on the first comparison request, so normal server startup does not pay this diagnostic cost.
 * The closure never mutates the canonical current-surface cache/status.
 *
 * @param {McpRegistryPolicy} registryPolicy
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} authConfig
 */
function createMcpToolSurfaceComparisonCapability(registryPolicy, authConfig) {
    /** @type {readonly Readonly<{ mode:string; tools:readonly McpToolDefinition[]; names:readonly string[] }>[] | null} */
    let cachedSurfaces = null;
    return Object.freeze({
        resolveCanonicalSurfaces: () => {
            if (cachedSurfaces) return cachedSurfaces;
            const { allTools } = buildCanonicalAllMcpTools(registryPolicy, authConfig);
            cachedSurfaces = Object.freeze(
                MCP_TOOL_SURFACE_MODES.map((mode) => {
                    const { tools } = buildCanonicalMcpToolSurface(
                        allTools,
                        createMcpToolSurfacePolicy({ mode }),
                        registryPolicy,
                    );
                    return Object.freeze({
                        mode,
                        tools: Object.freeze([...tools]),
                        names: Object.freeze(tools.map((tool) => tool.name)),
                    });
                }),
            );
            return cachedSurfaces;
        },
    });
}

/**
 * @param {{
 *     toolSurfacePolicy?: import('./surface-policy.js').McpToolSurfacePolicy;
 *     registryPolicy?: McpRegistryPolicy;
 *     authConfig?: import('#copilot/mcp/public/auth').McpAuthConfig;
 * }} [options]
 * @returns {McpToolDefinition[]}
 */
export function getCanonicalMcpTools(options = {}) {
    const registryPolicy = options.registryPolicy ?? readMcpRegistryPolicy();
    const surfacePolicy = options.toolSurfacePolicy ?? readMcpToolSurfacePolicy();
    const authConfig = options.authConfig ?? readMcpAuthConfig();
    const cacheKey = `${toolSurfaceCacheKey(surfacePolicy)}|${registryPolicyCacheKey(registryPolicy)}|${authMetadataCacheKey(authConfig)}`;
    if (canonicalMcpToolsCache && canonicalMcpToolsCacheKey === cacheKey) return canonicalMcpToolsCache;

    const { allTools, allValidation } = buildCanonicalAllMcpTools(registryPolicy, authConfig);
    const { tools, surfacedValidation } = buildCanonicalMcpToolSurface(allTools, surfacePolicy, registryPolicy);

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
    return tools;
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
 * @param {{ includeDescriptors?: boolean; toolSurfacePolicy?: import('./surface-policy.js').McpToolSurfacePolicy; registryPolicy?: McpRegistryPolicy; authConfig?: import('#copilot/mcp/public/auth').McpAuthConfig }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildCanonicalMcpRegistryManifest(options = {}) {
    return buildMcpToolDescriptorManifest(
        getCanonicalMcpTools({
            ...(options.toolSurfacePolicy === undefined ? {} : { toolSurfacePolicy: options.toolSurfacePolicy }),
            ...(options.registryPolicy === undefined ? {} : { registryPolicy: options.registryPolicy }),
            ...(options.authConfig === undefined ? {} : { authConfig: options.authConfig }),
        }),
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
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {RegisterCanonicalMcpToolsOptions} [options]
 * @returns {McpToolDefinition[]}
 */
export function registerCanonicalMcpTools(server, options = {}) {
    const registryPolicy = options.registryPolicy ?? readMcpRegistryPolicy();
    const authConfig = options.authRuntime?.config ?? readMcpAuthConfig();
    const tools = getCanonicalMcpTools({
        ...(options.toolSurfacePolicy === undefined ? {} : { toolSurfacePolicy: options.toolSurfacePolicy }),
        registryPolicy,
        authConfig,
    });
    const comparisonCapability = createMcpToolSurfaceComparisonCapability(registryPolicy, authConfig);
    const wireSnapshot = buildMcpToolWireDescriptorSnapshot(tools);
    const toolSurfaceCapability = Object.freeze({
        tools: Object.freeze([...tools]),
        names: Object.freeze(tools.map((tool) => tool.name)),
        descriptorFingerprint: wireSnapshot.fingerprint,
        descriptorFingerprintKind: wireSnapshot.fingerprintKind,
        toolDescriptorFingerprints: wireSnapshot.toolFingerprints,
        toolDescriptorRevisionTokens: wireSnapshot.toolRevisionTokens,
        resolveCanonicalSurfaces: comparisonCapability.resolveCanonicalSurfaces,
    });
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            buildMcpRegisterToolOptions(tool),
            /**
             * @param {Record<string, unknown>} args
             * @param {import('@modelcontextprotocol/server').ServerContext} serverContext
             */
            async (args, serverContext) =>
                guardedToolHandler(tool, args, options, registryPolicy, serverContext, toolSurfaceCapability),
        );
    }
    return tools;
}

/**
 * @param {McpToolDefinition} tool
 * @returns {Parameters<import('@modelcontextprotocol/server').McpServer['registerTool']>[1]}
 */
function buildMcpRegisterToolOptions(tool) {
    return /** @type {Parameters<import('@modelcontextprotocol/server').McpServer['registerTool']>[1]} */ ({
        title: tool.title,
        description: tool.description,
        inputSchema:
            /**
             * @type {Parameters<
             *     import('@modelcontextprotocol/server').McpServer['registerTool']
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
 * @param {import('@modelcontextprotocol/server').ServerContext} serverContext
 * @param {NonNullable<import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['toolSurface']>} toolSurfaceCapability
 * @returns {Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>}
 */
async function guardedToolHandler(tool, args, options, registryPolicy, serverContext, toolSurfaceCapability) {
    const startedAt = Date.now();
    if (!options.workspace) {
        throw new Error(`MCP tool ${tool.name} cannot execute without a composition-owned workspace capability.`);
    }
    const callId = randomUUID();
    const requestMeta =
        serverContext.mcpReq._meta && typeof serverContext.mcpReq._meta === 'object'
            ? /** @type {Readonly<Record<string, unknown>>} */ (serverContext.mcpReq._meta)
            : undefined;
    const runtimeSourceGeneration = options.toolConfig?.runtimeSourceGeneration;
    const auditCorrelation = buildMcpToolCallAuditCorrelation({
        callId,
        toolName: tool.name,
        args,
        ...(requestMeta ? { requestMeta } : {}),
        ...(runtimeSourceGeneration ? { runtimeSourceGeneration } : {}),
    });
    const scopedAudit = scopeMcpToolAuditCapability(options.toolCapabilities?.audit, auditCorrelation);
    const operationContext = createMcpToolOperationContext(serverContext, {
        workspace: options.workspace,
        callId,
        ...(options.toolConfig ? { config: options.toolConfig } : {}),
        capabilities: {
            ...(options.toolCapabilities ?? {}),
            ...(scopedAudit ? { audit: scopedAudit } : {}),
            toolSurface: toolSurfaceCapability,
        },
        timeoutMs: registryPolicy.toolTimeoutMs,
    });
    safeRecordMcpToolInteractionStart(tool.name, startedAt);
    safeRecordMcpHttpToolHandlerStart(tool.name, callId, startedAt);
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
    const httpTimingMetadata = readMcpHttpToolTimingMetadata();
    const latencyExperimentMetadata = buildLatencyPulseAuditMetadata(tool.name, args);
    const optionPolicyMetadata = projectMcpToolOptionPolicy(tool.name, args);
    await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
        event: 'tool_call_started',
        callId,
        tool: tool.name,
        ...(httpTimingMetadata?.edgeColo ? { edgeColo: httpTimingMetadata.edgeColo } : {}),
        ...(httpTimingMetadata
            ? { originRequestReceivedAt: new Date(httpTimingMetadata.requestReceivedAt).toISOString() }
            : {}),
        ...latencyExperimentMetadata,
        ...(optionPolicyMetadata ?? {}),
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
            await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
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
        const authorization = options.authRuntime?.resourceServer
            ? await options.authRuntime.resourceServer.authorize(
                  tool,
                  options.authContext,
                  options.authRuntime.config,
                  options.authRuntime.secrets,
                  options.authRuntime.decisionCache,
              )
            : await authorizeMcpToolCall(tool, options.authContext);
        finishPhase('authorization', authorizationStartedAt);
        if (!authorization.allowed) {
            const durationMs = elapsedMs(startedAt);
            await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
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
        const result = await runToolHandlerWithCancellation(tool, args, operationContext);
        finishPhase('handler', handlerStartedAt);
        const executionMetric = getResultExecutionHint(result) ?? undefined;
        const resultSizeStartedAt = startPhase('resultSize');
        const resultSizeValidation = validateToolResultSize(result, registryPolicy, tool);
        const resultSizeError =
            typeof resultSizeValidation === 'string' ? resultSizeValidation : resultSizeValidation.error;
        const resultSizeMetric = typeof resultSizeValidation === 'string' ? undefined : resultSizeValidation;
        finishPhase('resultSize', resultSizeStartedAt);
        if (resultSizeError) {
            const durationMs = elapsedMs(startedAt);
            await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
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
            await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
                event: 'tool_call_output_validation_warning',
                callId,
                tool: tool.name,
                durationMs: elapsedMs(startedAt),
                warnings: outputValidation,
            });
        }
        const durationMs = elapsedMs(startedAt);
        const auditCompletionStartedAt = startPhase('auditCompletion');
        await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
            event: 'tool_call_completed',
            callId,
            tool: tool.name,
            durationMs,
            isError: result.isError === true,
            risk,
            ...buildMcpToolResultAuditMetadata(tool.name, result, resultSizeMetric, executionMetric),
        });
        finishPhase('auditCompletion', auditCompletionStartedAt);
        safeRecordMcpToolMetric(tool.name, {
            durationMs,
            isError: result.isError === true,
            phases,
            ...(resultSizeMetric ? { resultSize: resultSizeMetric } : {}),
            ...(executionMetric ? { execution: executionMetric } : {}),
        });
        return result;
    } catch (error) {
        const durationMs = elapsedMs(startedAt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const mutationState = readMutationAppliedState(error);
        const mutationPaths = mutationState.paths
            .slice(0, 16)
            .map((entry) => (path.isAbsolute(entry) ? toMcpWorkspaceRelativePath(entry) : entry));
        if (activePhase !== 'idle' && phases[activePhase] === undefined) {
            phases[activePhase] = elapsedMs(activePhaseStartedAt);
        }
        await safeAppendMcpAuditEvent(operationContext.capabilities.audit, {
            event: 'tool_call_failed',
            callId,
            tool: tool.name,
            durationMs,
            error: errorMessage,
            risk,
            ...(mutationState.applied
                ? {
                      mutationApplied: true,
                      mutationPhase: mutationState.phase,
                      mutationPaths,
                      failureClass: 'applied-but-unconfirmed',
                      retryability: 'inspect-before-retry',
                      recoveryRequired: true,
                  }
                : {}),
        });
        safeRecordMcpToolMetric(tool.name, { durationMs, isError: true, phases });
        if (registryPolicy.handlerExceptionMode === 'tool-result') {
            return errorResult('MCP tool execution failed.', {
                code: 'MCP_TOOL_EXECUTION_FAILED',
                hint: errorMessage,
                callId,
                ...(mutationState.applied
                    ? {
                          mutationApplied: true,
                          mutationPhase: mutationState.phase,
                          mutationPaths,
                          failureClass: 'applied-but-unconfirmed',
                          retryability: 'inspect-before-retry',
                          recoveryRequired: true,
                      }
                    : {}),
            });
        }
        throw error;
    } finally {
        safeRecordMcpHttpToolHandlerEnd();
        safeRecordMcpToolInteractionEnd(tool.name);
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
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} operationContext
 * @returns {Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>}
 */
async function runToolHandlerWithCancellation(tool, args, operationContext) {
    const execution = requireMcpToolExecutionContract(tool);
    if (operationContext.signal.aborted) throw buildToolCancellationError(operationContext, execution);

    const handlerOutcome = Promise.resolve()
        .then(() => tool.handler(args, operationContext))
        .then(
            (value) => ({ kind: /** @type {const} */ ('value'), value }),
            (error) => ({ kind: /** @type {const} */ ('error'), error }),
        );

    /** @type {(() => void) | null} */
    let resolveAbort = null;
    const aborted = new Promise((resolve) => {
        resolveAbort = () => resolve({ kind: /** @type {const} */ ('aborted') });
        operationContext.signal.addEventListener('abort', resolveAbort, { once: true });
    });

    try {
        const first = await Promise.race([handlerOutcome, aborted]);
        if (first.kind === 'value') return first.value;
        if (first.kind === 'error') throw first.error;

        if (execution.cancellation !== 'cancellable') {
            throw buildToolCancellationError(operationContext, execution);
        }

        const drainTimeoutMs = execution.drainTimeoutMs;
        if (!Number.isInteger(drainTimeoutMs) || Number(drainTimeoutMs) <= 0) {
            throw new Error(`Cancellable MCP tool ${tool.name} has no valid drainTimeoutMs.`);
        }
        const drained = await waitForToolHandlerDrain(handlerOutcome, Number(drainTimeoutMs));
        if (!drained) throw buildToolCancellationDrainTimeoutError(tool, operationContext, execution);
        throw buildToolCancellationError(operationContext, execution);
    } finally {
        if (resolveAbort) operationContext.signal.removeEventListener('abort', resolveAbort);
    }
}

/**
 * Testing-only seam re-exported exclusively through `registry/testing`.
 *
 * @param {McpToolDefinition} tool
 * @param {Record<string, unknown>} args
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} operationContext
 */
export async function runToolHandlerWithCancellationForTests(tool, args, operationContext) {
    return await runToolHandlerWithCancellation(tool, args, operationContext);
}

/**
 * @param {Promise<{ kind: 'value'; value: import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult } | { kind: 'error'; error: unknown }>} handlerOutcome
 * @param {number} drainTimeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForToolHandlerDrain(handlerOutcome, drainTimeoutMs) {
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), drainTimeoutMs);
        timer.unref();
    });
    try {
        return /** @type {boolean} */ (await Promise.race([handlerOutcome.then(() => true), timeout]));
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * @param {McpToolDefinition} tool
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpToolExecutionContract}
 */
function requireMcpToolExecutionContract(tool) {
    if (!tool.execution) throw new Error(`MCP tool ${tool.name} is missing its internal execution contract.`);
    return tool.execution;
}

/**
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} operationContext
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolExecutionContract} execution
 * @returns {Error & { code: string; cancellationSource: 'caller' | 'deadline' | 'unknown'; executionPolicy: string; workMayContinue: boolean; continuationBoundMs: number | null }}
 */
function buildToolCancellationError(operationContext, execution) {
    /** @type {'caller' | 'deadline' | 'unknown'} */
    const source = operationContext.cancellationSource() ?? 'unknown';
    const code = source === 'deadline' ? 'MCP_TOOL_TIMEOUT' : 'MCP_TOOL_CANCELLED';
    const message =
        source === 'deadline'
            ? `MCP tool deadline exceeded for request ${operationContext.requestId}.`
            : `MCP tool invocation cancelled for request ${operationContext.requestId}.`;
    return Object.assign(new Error(message), {
        code,
        cancellationSource: source,
        executionPolicy: execution.cancellation,
        workMayContinue: execution.cancellation === 'bounded-non-cancellable',
        continuationBoundMs:
            execution.cancellation === 'bounded-non-cancellable' && Number.isInteger(execution.continuationBoundMs)
                ? Number(execution.continuationBoundMs)
                : null,
    });
}

/**
 * @param {McpToolDefinition} tool
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} operationContext
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolExecutionContract} execution
 */
function buildToolCancellationDrainTimeoutError(tool, operationContext, execution) {
    /** @type {'caller' | 'deadline' | 'unknown'} */
    const source = operationContext.cancellationSource() ?? 'unknown';
    return Object.assign(
        new Error(
            `Cancellable MCP tool ${tool.name} did not drain within ${String(execution.drainTimeoutMs)}ms after ${source} cancellation.`,
        ),
        {
            code: 'MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT',
            cancellationSource: source,
            executionPolicy: execution.cancellation,
            drainTimeoutMs: execution.drainTimeoutMs ?? null,
            tool: tool.name,
        },
    );
}

/**
 * @param {unknown} result
 * @param {McpRegistryPolicy} policy
 * @param {McpToolDefinition} tool
 * @returns {{ error: string | null; strategy: string; bytes: number | null; limitBytes: number }}
 */
function validateToolResultSize(result, policy, tool) {
    const requestedLimit = Number(tool.maxResultBytes);
    const limitBytes =
        Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.max(16 * 1024, Math.min(64 * 1024 * 1024, requestedLimit))
            : policy.maxToolResultBytes;
    const hint = getResultSizeHint(result);
    if (hint) {
        return {
            error:
                hint.bytes > limitBytes
                    ? `Tool result is ${hint.bytes} bytes by ${hint.source}; limit is ${limitBytes} bytes.`
                    : null,
            strategy: 'hint',
            bytes: hint.bytes,
            limitBytes,
        };
    }
    try {
        const bytes = Buffer.byteLength(stableJsonStringify(result));
        return {
            error: bytes > limitBytes ? `Tool result is ${bytes} bytes; limit is ${limitBytes} bytes.` : null,
            strategy: 'stringify',
            bytes,
            limitBytes,
        };
    } catch {
        return { error: null, strategy: 'unknown', bytes: null, limitBytes };
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
        if (
            tool.maxResultBytes !== undefined &&
            (!Number.isInteger(tool.maxResultBytes) ||
                tool.maxResultBytes < 16 * 1024 ||
                tool.maxResultBytes > 64 * 1024 * 1024)
        ) {
            errors.push(`${label}: maxResultBytes must be an integer between 16 KiB and 64 MiB.`);
        }
        if (typeof tool.handler !== 'function') errors.push(`${label}: handler must be a function.`);

        validateExecutionContract(tool, label, errors);
        validateSemanticContract(tool, label, errors);
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
            cancellable: tools.filter((tool) => tool?.execution?.cancellation === 'cancellable').length,
            boundedNonCancellable: tools.filter((tool) => tool?.execution?.cancellation === 'bounded-non-cancellable')
                .length,
            cancellationNotApplicable: tools.filter((tool) => tool?.execution?.cancellation === 'not-applicable')
                .length,
        },
    };
}

/**
 * @param {McpToolDefinition} tool
 * @param {string} label
 * @param {string[]} errors
 */
function validateExecutionContract(tool, label, errors) {
    const execution = tool.execution;
    if (!execution || typeof execution !== 'object') {
        errors.push(`${label}: internal execution contract is required.`);
        return;
    }
    if (!['cancellable', 'bounded-non-cancellable', 'not-applicable'].includes(execution.cancellation)) {
        errors.push(`${label}: invalid cancellation policy=${String(execution.cancellation)}.`);
        return;
    }
    if (typeof execution.rationale !== 'string' || execution.rationale.trim().length < 20) {
        errors.push(`${label}: execution rationale must be a substantive string.`);
    }
    if (execution.cancellation === 'cancellable') {
        if (
            !Number.isInteger(execution.drainTimeoutMs) ||
            Number(execution.drainTimeoutMs) < 100 ||
            Number(execution.drainTimeoutMs) > 60_000
        ) {
            errors.push(`${label}: cancellable execution requires drainTimeoutMs between 100 and 60000.`);
        }
        if (execution.continuationBoundMs !== undefined) {
            errors.push(`${label}: cancellable execution must not declare continuationBoundMs.`);
        }
        return;
    }
    if (execution.cancellation === 'bounded-non-cancellable') {
        if (
            !Number.isInteger(execution.continuationBoundMs) ||
            Number(execution.continuationBoundMs) < 100 ||
            Number(execution.continuationBoundMs) > 3_600_000
        ) {
            errors.push(
                `${label}: bounded-non-cancellable execution requires continuationBoundMs between 100 and 3600000.`,
            );
        }
        if (execution.drainTimeoutMs !== undefined) {
            errors.push(`${label}: bounded-non-cancellable execution must not declare drainTimeoutMs.`);
        }
        return;
    }
    if (execution.drainTimeoutMs !== undefined || execution.continuationBoundMs !== undefined) {
        errors.push(`${label}: not-applicable execution must not declare drain/continuation bounds.`);
    }
}

/**
 * Validate that the canonical domain contract is present, internally coherent and exactly projected to the MCP wire.
 * Semantic risk truthfulness is fail-closed regardless of descriptor strictness settings.
 *
 * @param {McpToolDefinition} tool
 * @param {string} label
 * @param {string[]} errors
 */
function validateSemanticContract(tool, label, errors) {
    const contract = tool.contract;
    if (!contract) {
        errors.push(`${label}: semantic tool contract is required.`);
        return;
    }
    for (const semanticError of validateMcpToolContractSemantics(contract)) {
        errors.push(`${label}: semantic contract: ${semanticError}.`);
    }
    const projected = projectMcpToolAnnotations(contract);
    const annotations = tool.annotations;
    if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
        errors.push(`${label}: protocol annotations must be the semantic-contract projection.`);
        return;
    }
    /** @type {('readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint')[]} */
    const fields = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
    for (const field of fields) {
        if (annotations[field] !== projected[field]) {
            errors.push(`${label}: annotation ${field} diverges from semantic tool contract.`);
        }
    }
    const specificOutput = contract.output.class === 'specific';
    if (specificOutput !== (tool.outputSchema !== undefined)) {
        errors.push(`${label}: outputSchema diverges from output contract=${contract.output.class}.`);
    }
    const contractMax = contract.resultBudget.mode === 'tool-specific' ? contract.resultBudget.maxBytes : undefined;
    if (contractMax !== tool.maxResultBytes) {
        errors.push(`${label}: maxResultBytes diverges from semantic result budget.`);
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
    const contract = requireMcpToolContract(tool);
    const annotations = projectMcpToolAnnotations(contract);
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
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpToolContract}
 */
function requireMcpToolContract(tool) {
    if (!tool.contract) throw new Error(`MCP tool ${tool.name} has no semantic tool contract.`);
    return tool.contract;
}

/**
 * Registry risk is a direct domain-contract projection. Names, titles and descriptions carry no authority.
 *
 * @param {McpToolDefinition} tool
 */
export function classifyMcpToolRisk(tool) {
    return classifyMcpToolContractRisk(requireMcpToolContract(tool));
}

/**
 * Build the canonical semantic representation of the exact `tools/list` descriptor payload owned by the registry.
 * The fingerprint deliberately hashes the full JSON Schema constraints emitted on the wire, not only field names or
 * schema object shape. This is the descriptor-generation authority used by positive MCP cache hints.
 *
 * @param {McpToolDefinition[]} tools
 * @returns {{
 *   schemaVersion: 2;
 *   fingerprintKind: typeof MCP_TOOL_DESCRIPTOR_SET_FINGERPRINT_KIND;
 *   fingerprint: string;
 *   descriptors: Record<string, unknown>[];
 *   toolFingerprints: Readonly<Record<string, string>>;
 *   toolRevisionTokens: Readonly<Record<string, string>>;
 * }}
 */
export function buildMcpToolWireDescriptorSnapshot(tools) {
    const descriptors = tools.map((tool) => projectMcpToolWireDescriptor(tool));
    const toolFingerprints = buildMcpToolWireFingerprintIndex(descriptors);
    return {
        schemaVersion: 2,
        fingerprintKind: MCP_TOOL_DESCRIPTOR_SET_FINGERPRINT_KIND,
        fingerprint: fingerprintMcpToolWireDescriptorSet(descriptors),
        descriptors,
        toolFingerprints,
        toolRevisionTokens: Object.freeze(
            Object.fromEntries(
                Object.entries(toolFingerprints).map(([name, fingerprint]) => [
                    name,
                    buildMcpToolDescriptorRevisionToken(fingerprint),
                ]),
            ),
        ),
    };
}

/**
 * @param {McpToolDefinition[]} tools
 * @param {{ includeDescriptors?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
function buildMcpToolDescriptorManifest(tools, options = {}) {
    const descriptors = tools.map((tool) => descriptorManifestEntry(tool));
    const wireSnapshot = buildMcpToolWireDescriptorSnapshot(tools);
    const fingerprint = wireSnapshot.fingerprint;
    return {
        schemaVersion: 1,
        implementation: {
            name: COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME,
            version: COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION,
        },
        generatedAt: new Date().toISOString(),
        toolCount: tools.length,
        fingerprint,
        fingerprintKind: wireSnapshot.fingerprintKind,
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
 * Mirror the SDK 2.x high-level `registerTool` → `tools/list` projection for the descriptor fields the registry owns.
 * A focused protocol regression compares this projection against the official SDK result so SDK drift fails closed.
 *
 * @param {McpToolDefinition} tool
 * @returns {Record<string, unknown>}
 */
function projectMcpToolWireDescriptor(tool) {
    /** @type {Record<string, unknown>} */
    const descriptor = {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: projectMcpSchemaToWire(tool.inputSchema, 'input'),
        annotations: tool.annotations,
    };
    if (tool.outputSchema !== undefined)
        descriptor['outputSchema'] = projectMcpSchemaToWire(tool.outputSchema, 'output');
    if (tool._meta !== undefined) descriptor['_meta'] = tool._meta;
    return descriptor;
}

/**
 * @param {McpToolDefinition['inputSchema'] | NonNullable<McpToolDefinition['outputSchema']>} schema
 * @param {'input' | 'output'} io
 * @returns {Record<string, unknown>}
 */
function projectMcpSchemaToWire(schema, io) {
    const normalized = isMcpZodRawShape(schema)
        ? z.object(/** @type {Record<string, import('zod').ZodType>} */ (schema))
        : /** @type {import('zod').ZodType} */ (schema);
    const jsonSchema = /** @type {Record<string, unknown>} */ (
        z.toJSONSchema(normalized, { target: 'draft-2020-12', io })
    );

    if (io === 'output') {
        if (jsonSchema['type'] !== undefined) return jsonSchema;
        return isProvablyObjectShapedSchemaRoot(jsonSchema) ? { type: 'object', ...jsonSchema } : jsonSchema;
    }
    if (jsonSchema['type'] !== undefined && jsonSchema['type'] !== 'object') {
        throw new Error(
            `MCP input schemas must describe objects; canonical wire projection received type=${JSON.stringify(jsonSchema['type'])}.`,
        );
    }
    return { type: 'object', ...jsonSchema };
}

/**
 * Match the SDK's raw-Zod-shape recognition: plain object, not already Standard Schema, whose values are Zod v4.
 *
 * @param {unknown} schema
 * @returns {boolean}
 */
function isMcpZodRawShape(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || '~standard' in schema) return false;
    const prototype = Object.getPrototypeOf(schema);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(/** @type {Record<string, unknown>} */ (schema)).every((value) =>
        Boolean(value && typeof value === 'object' && '_zod' in value),
    );
}

/**
 * @param {Record<string, unknown>} schema
 * @returns {boolean}
 */
function isProvablyObjectShapedSchemaRoot(schema) {
    if (
        'properties' in schema ||
        'patternProperties' in schema ||
        'additionalProperties' in schema ||
        'required' in schema
    ) {
        return true;
    }
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
        const members = schema[key];
        if (Array.isArray(members) && members.length > 0) {
            return members.every((member) => {
                if (!member || typeof member !== 'object') return false;
                const memberRecord = /** @type {Record<string, unknown>} */ (member);
                return memberRecord['type'] === 'object' || isProvablyObjectShapedSchemaRoot(memberRecord);
            });
        }
    }
    return false;
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
        callerScope: tool.contract?.authority.callerScope ?? null,
        networkAuthority: tool.contract?.authority.network ?? null,
        credentials: [...(tool.contract?.credentials ?? [])],
        idempotency: tool.contract?.idempotency ?? null,
        retry: tool.contract?.retry ?? null,
        outputContract: tool.contract?.output.class ?? null,
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
 * Security metadata depends on auth mode and whether the two public OAuth diagnostics advertise noauth fallback. Do not
 * place secret-bearing auth state in the registry cache key.
 *
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 */
function authMetadataCacheKey(config) {
    return `${config.mode}:${config.publicOauthDiagnosticsEnabled ? 'public-diagnostics' : 'protected-diagnostics'}`;
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
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 * @returns {string[]}
 */
function validateToolStructuredOutput(tool, result) {
    if (tool.outputSchema === undefined || !result || typeof result !== 'object') return [];
    if (result.isError === true) return [];
    if (!('structuredContent' in result))
        return ['successful tool result is missing structuredContent for outputSchema.'];
    const schema = normalizeToolOutputSchema(tool.outputSchema);
    if (!schema) return ['outputSchema cannot be normalized for local structuredContent validation.'];
    const parsed = schema.safeParse(result.structuredContent);
    return parsed.success ? [] : ['structuredContent does not satisfy outputSchema.'];
}

/**
 * The MCP SDK accepts either a Zod schema or the legacy raw Zod shape accepted by registerTool(). Normalize both forms
 * here so registry shadow-validation matches the descriptor actually exposed on the wire.
 *
 * @param {McpToolDefinition['outputSchema']} schema
 * @returns {import('zod').ZodType | null}
 */
function normalizeToolOutputSchema(schema) {
    if (!schema || typeof schema !== 'object') return null;
    if ('safeParse' in schema && typeof schema.safeParse === 'function') {
        return /** @type {import('zod').ZodType} */ (schema);
    }
    const entries = Object.entries(schema);
    if (entries.every(([, value]) => value && typeof value === 'object' && 'safeParse' in value)) {
        return z.object(/** @type {Record<string, import('zod').ZodType>} */ (schema))['passthrough']();
    }
    return null;
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
 * Persist only explicitly bounded experiment labels for the no-I/O latency pulse. Raw IPs, URLs and arbitrary input
 * fields are intentionally excluded.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {Record<string, unknown>}
 */
function buildLatencyPulseAuditMetadata(toolName, args) {
    if (toolName !== 'mcp_latency_pulse') return {};
    /** @param {unknown} value */
    const safeLabel = (value) => {
        const normalized = String(value ?? '').trim();
        return /^[A-Za-z0-9._:-]{1,64}$/u.test(normalized) ? normalized : null;
    };
    const seriesId = safeLabel(args['seriesId']);
    const networkLabel = safeLabel(args['networkLabel']);
    const modelLabel = safeLabel(args['modelLabel']);
    const conversationLabel = safeLabel(args['conversationLabel']);
    const clientLabel = safeLabel(args['clientLabel']);
    const vpnLabel = safeLabel(args['vpnLabel']);
    const step = Number(args['step']);
    return {
        ...(seriesId ? { latencySeriesId: seriesId } : {}),
        ...(Number.isInteger(step) && step >= 0 && step <= 1000 ? { latencyStep: step } : {}),
        ...(networkLabel ? { latencyNetworkLabel: networkLabel } : {}),
        ...(modelLabel ? { latencyModelLabel: modelLabel } : {}),
        ...(conversationLabel ? { latencyConversationLabel: conversationLabel } : {}),
        ...(clientLabel ? { latencyClientLabel: clientLabel } : {}),
        ...(vpnLabel ? { latencyVpnLabel: vpnLabel } : {}),
    };
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Date.now() - startedAt;
}

/**
 * Project only bounded recovery-recipe counts. Invocation tool names, arguments, paths, source text and Git state are
 * deliberately excluded from audit persistence.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 */
function projectMcpRecoveryRecipeAuditMetadata(result) {
    const structured =
        result.structuredContent && typeof result.structuredContent === 'object'
            ? /** @type {Record<string, unknown>} */ (result.structuredContent)
            : {};
    const details =
        structured['details'] && typeof structured['details'] === 'object' && !Array.isArray(structured['details'])
            ? /** @type {Record<string, unknown>} */ (structured['details'])
            : {};
    const candidates = [structured['recoveryRecipe'], details['recoveryRecipe']];
    const failures = Array.isArray(structured['failures']) ? structured['failures'] : [];
    for (const failure of failures) {
        if (failure && typeof failure === 'object' && !Array.isArray(failure)) {
            candidates.push(/** @type {Record<string, unknown>} */ (failure)['recoveryRecipe']);
        }
    }
    let recoveryRecipeCount = 0;
    let retrySafeRecoveryRecipeCount = 0;
    let suggestedRecoveryRecipeCount = 0;
    let manualRecoveryRecipeCount = 0;
    let noRetryRecoveryRecipeCount = 0;
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const recipe = /** @type {Record<string, unknown>} */ (candidate);
        if (recipe['version'] !== 1) continue;
        const disposition = recipe['disposition'];
        if (!['retry-safe', 'suggested', 'manual', 'no-retry'].includes(String(disposition))) continue;
        recoveryRecipeCount += 1;
        if (disposition === 'retry-safe') retrySafeRecoveryRecipeCount += 1;
        if (disposition === 'suggested') suggestedRecoveryRecipeCount += 1;
        if (disposition === 'manual') manualRecoveryRecipeCount += 1;
        if (disposition === 'no-retry') noRetryRecoveryRecipeCount += 1;
    }
    return recoveryRecipeCount > 0
        ? {
              recoveryRecipeCount,
              retrySafeRecoveryRecipeCount,
              suggestedRecoveryRecipeCount,
              manualRecoveryRecipeCount,
              noRetryRecoveryRecipeCount,
          }
        : {};
}

/**
 * Project only bounded exact-self-repair counters from the already-sanitized wire envelope. Source anchors, hashes,
 * paths, reason text and retry arguments are deliberately excluded from audit persistence.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 */
function projectMcpExactSelfRepairAuditMetadata(result) {
    const structured =
        result.structuredContent && typeof result.structuredContent === 'object'
            ? /** @type {Record<string, unknown>} */ (result.structuredContent)
            : {};
    const details =
        structured['details'] && typeof structured['details'] === 'object' && !Array.isArray(structured['details'])
            ? /** @type {Record<string, unknown>} */ (structured['details'])
            : {};
    const candidate =
        structured['exactSelfRepair'] && typeof structured['exactSelfRepair'] === 'object'
            ? /** @type {Record<string, unknown>} */ (structured['exactSelfRepair'])
            : details['exactSelfRepair'] && typeof details['exactSelfRepair'] === 'object'
              ? /** @type {Record<string, unknown>} */ (details['exactSelfRepair'])
              : null;
    if (!candidate) return {};

    const attemptedCount =
        nonNegativeSafeInteger(candidate['attemptedCount']) ?? (candidate['attempted'] === true ? 1 : 0);
    if (attemptedCount <= 0) return {};
    const succeededCount =
        nonNegativeSafeInteger(candidate['succeededCount']) ?? (candidate['succeeded'] === true ? 1 : 0);
    const failedClosedCount =
        nonNegativeSafeInteger(candidate['failedClosedCount']) ?? (candidate['failedClosed'] === true ? 1 : 0);
    if (succeededCount > attemptedCount || failedClosedCount > attemptedCount) return {};
    return {
        exactSelfRepairAttemptedCount: attemptedCount,
        exactSelfRepairSucceededCount: succeededCount,
        exactSelfRepairFailedClosedCount: failedClosedCount,
    };
}

/**
 * Persist only bounded numeric/enum facts about a tool result. This is intentionally not a generic structuredContent
 * serializer: source text, terminal output and arbitrary nested result fields never enter the audit through this path.
 *
 * @param {string} toolName
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 * @param {{ strategy?: string; bytes?: number | null; limitBytes?: number } | undefined} resultSizeMetric
 * @param {ReturnType<typeof getResultExecutionHint> | undefined} executionMetric
 */
function buildMcpToolResultAuditMetadata(toolName, result, resultSizeMetric, executionMetric) {
    const resultBytes = nonNegativeSafeInteger(resultSizeMetric?.bytes);
    const textResultBytes = countMcpResultTextBytes(result);
    const duplicateTextBytes = estimateKnownDuplicateTextBytes(toolName, result, textResultBytes);
    const resultOutcome = projectMcpToolResultOutcome(result);
    const recoveryRecipeMetadata = projectMcpRecoveryRecipeAuditMetadata(result);
    const exactSelfRepairMetadata = projectMcpExactSelfRepairAuditMetadata(result);
    return {
        ...resultOutcome,
        ...recoveryRecipeMetadata,
        ...exactSelfRepairMetadata,
        ...(executionMetric
            ? {
                  logicalOperations: executionMetric.logicalOperations,
                  failedOperations: executionMetric.failedOperations ?? 0,
                  skippedOperations: executionMetric.skippedOperations ?? 0,
                  ...(executionMetric.mode ? { executionMode: executionMetric.mode } : {}),
                  ...(executionMetric.executionPolicyClass
                      ? { executionPolicyClass: executionMetric.executionPolicyClass }
                      : {}),
                  ...(executionMetric.executionFailurePolicyClass
                      ? { executionFailurePolicyClass: executionMetric.executionFailurePolicyClass }
                      : {}),
                  ...(executionMetric.executionConcurrencyClass
                      ? { executionConcurrencyClass: executionMetric.executionConcurrencyClass }
                      : {}),
                  ...(executionMetric.batchSize !== undefined ? { batchSize: executionMetric.batchSize } : {}),
                  ...(executionMetric.batchCapacity !== undefined
                      ? { batchCapacity: executionMetric.batchCapacity }
                      : {}),
                  ...(executionMetric.resultBudgetBytes !== undefined
                      ? { resultBudgetBytes: executionMetric.resultBudgetBytes }
                      : {}),
                  ...(executionMetric.truncatedOperations !== undefined
                      ? { truncatedOperations: executionMetric.truncatedOperations }
                      : {}),
                  ...(executionMetric.continuationAvailable === true ? { continuationAvailable: true } : {}),
                  ...(executionMetric.continuationAvailableOperations !== undefined
                      ? { continuationAvailableOperations: executionMetric.continuationAvailableOperations }
                      : {}),
                  ...(executionMetric.continuationTransportRequired === true
                      ? { continuationTransportRequired: true }
                      : {}),
                  ...(executionMetric.continuationTransportRequiredOperations !== undefined
                      ? {
                            continuationTransportRequiredOperations:
                                executionMetric.continuationTransportRequiredOperations,
                        }
                      : {}),
                  ...(executionMetric.continuationRecommended === true ? { continuationRecommended: true } : {}),
                  ...(executionMetric.continuationRecommendedOperations !== undefined
                      ? { continuationRecommendedOperations: executionMetric.continuationRecommendedOperations }
                      : {}),
              }
            : {}),
        ...(resultBytes !== null ? { resultBytes } : {}),
        ...(typeof resultSizeMetric?.strategy === 'string'
            ? { resultSizeStrategy: resultSizeMetric.strategy.slice(0, 32) }
            : {}),
        ...(textResultBytes > 0 ? { textResultBytes } : {}),
        ...(resultBytes !== null ? { nonTextResultBytes: Math.max(0, resultBytes - textResultBytes) } : {}),
        ...(duplicateTextBytes > 0 ? { duplicateTextBytes } : {}),
    };
}

/**
 * Testing-only projection of the bounded audit serializer; exported only through #copilot/testing/mcp/registry.
 * @param {string} toolName
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 * @param {{ strategy?: string; bytes?: number | null; limitBytes?: number } | undefined} resultSizeMetric
 * @param {ReturnType<typeof getResultExecutionHint> | undefined} executionMetric
 */
export function buildMcpToolResultAuditMetadataForTests(toolName, result, resultSizeMetric, executionMetric) {
    return buildMcpToolResultAuditMetadata(toolName, result, resultSizeMetric, executionMetric);
}

/** @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result */
function countMcpResultTextBytes(result) {
    let bytes = 0;
    for (const item of Array.isArray(result.content) ? result.content : []) {
        if (item?.type === 'text' && typeof item.text === 'string') bytes += Buffer.byteLength(item.text, 'utf8');
    }
    return bytes;
}

/**
 * These equality checks cover the currently proven duplicated single-result forms without serializing arbitrary
 * structuredContent again. For tree tools, only the legacy JSON-shaped stringify fallback is counted as duplication;
 * compact human summaries that merely point to structuredContent.entries must not become telemetry false positives.
 *
 * @param {string} toolName
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 * @param {number} textBytes
 */
function estimateKnownDuplicateTextBytes(toolName, result, textBytes) {
    if (textBytes <= 0) return 0;
    const text = result.content?.find((item) => item?.type === 'text')?.text;
    if (typeof text !== 'string') return 0;
    const structured = result.structuredContent;
    if (toolName === 'repo_read_file' && typeof structured?.['content'] === 'string') {
        return structured['content'] === text ? textBytes : 0;
    }
    if (toolName === 'repo_search_text' && typeof structured?.['output'] === 'string') {
        return structured['output'] === text ? textBytes : 0;
    }
    if (toolName === 'repo_tree') {
        const trimmed = text.trimStart();
        return trimmed.startsWith('{') && trimmed.includes('"entries"') ? textBytes : 0;
    }
    return 0;
}

/** @param {unknown} value */
function nonNegativeSafeInteger(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']} audit
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function safeAppendMcpAuditEvent(audit, event) {
    if (!audit) return;
    try {
        await audit.append(event);
    } catch {
        // Telemetry failures must not break a tool call.
    }
}

/** @param {string} toolName @param {string} callId @param {number} observedAt @returns {void} */
function safeRecordMcpHttpToolHandlerStart(toolName, callId, observedAt) {
    try {
        recordMcpHttpToolHandlerStart(toolName, callId, observedAt);
    } catch {
        // HTTP boundary timing failures must not break a tool call.
    }
}

/** @returns {void} */
function safeRecordMcpHttpToolHandlerEnd() {
    try {
        recordMcpHttpToolHandlerEnd();
    } catch {
        // HTTP boundary timing failures must not break a tool call.
    }
}

/** @param {string} toolName @param {number} observedAt @returns {void} */
function safeRecordMcpToolInteractionStart(toolName, observedAt) {
    try {
        recordMcpToolInteractionStart(toolName, observedAt);
    } catch {
        // Interaction metrics failures must not break a tool call.
    }
}

/** @param {string} toolName @returns {void} */
function safeRecordMcpToolInteractionEnd(toolName) {
    try {
        recordMcpToolInteractionEnd(toolName);
    } catch {
        // Interaction metrics failures must not break a tool call.
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
 * @param {string} value
 * @returns {string}
 */
function sha256String(value) {
    return createHash('sha256').update(value).digest('hex');
}
