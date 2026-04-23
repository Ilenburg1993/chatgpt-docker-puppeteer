// @ts-check
/**
 * @module copilot/presentation/system-config
 * @file Superfície compartilhada de projections e handlers de config/health consumida por server e terminal.
 *
 *   Este módulo existe para reduzir o papel de `terminal/handlers/system-config.js` como pseudo-camada comum do runtime.
 *   A borda do terminal continua consumindo estes handlers, mas o `server/` deixa de depender diretamente do módulo
 *   terminal para health/config.
 */

import { getMcpStatus } from '#copilot/bridges';
import {
    LLM_B_TERMINAL_PORT,
    readDeclarativeCustomToolsConfig,
    readDeclarativeToolsConfig,
    readSkillsConfig,
    registerDeclarativeCustomToolConfig,
    removeDeclarativeCustomToolConfig,
    updateDeclarativeToolsConfig,
    updateSkillsConfig,
} from '#copilot/config';
import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import { getSseClients, getSseCriticalClients } from '../infra/sse/state.js';
import { setDefaultAgentBackgroundCompactionThreshold } from './runtime-controls.js';
import { readAgentRuntimeOverviewProjection } from './runtime-overview.js';
import { readRuntimeIdFromParams } from './runtime-targeting.js';
import {
    readRuntimeBusyState,
    readRuntimeFileCacheStats,
    readRuntimeHubSessionId,
    readRuntimeLastSdkPlanOperation,
    readRuntimeSdkSessionMode,
} from './runtime-ui-state.js';

/**
 * @typedef {import('./types.js').HandlerResult} HandlerResult
 */

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {HandlerResult}
 */
export function handleHealth(params = {}) {
    const requestedRuntimeId = readRuntimeIdFromParams(params && typeof params === 'object' ? params : null);
    const {
        requestedRuntimeId: requestedRuntime,
        runtimeId,
        runtimeFound,
        usedDefaultRuntimeFallback,
        agentRuntimes,
        snap: snapshot,
        health,
        dialogLoopActive,
        status: agentStatus,
        model,
        reasoningEffort,
    } = readAgentRuntimeOverviewProjection(requestedRuntimeId);
    const healthRecord = health && typeof health === 'object' ? /** @type {Record<string, unknown>} */ (health) : null;
    const healthChecks =
        healthRecord && typeof healthRecord['checks'] === 'object'
            ? /** @type {Record<string, unknown>} */ (healthRecord['checks'])
            : null;
    const ioChecks =
        healthChecks && typeof healthChecks['io'] === 'object'
            ? /** @type {Record<string, unknown>} */ (healthChecks['io'])
            : null;
    const quotaChecks =
        healthChecks && typeof healthChecks['quota'] === 'object'
            ? /** @type {Record<string, unknown>} */ (healthChecks['quota'])
            : null;
    const metricsSummary = (() => {
        try {
            return container.resolve(METRICS_STORE).getSummary();
        } catch {
            return {
                tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
                tasks: { completed: 0, failed: 0 },
                dialog: { turnsTotal: 0, turnsSuccess: 0 },
            };
        }
    })();
    let hubInfo = { initialized: false, activeSessions: 0 };
    if (conversationHub.isReady) {
        try {
            const activeSessions = conversationStore.countHubSessions({ status: 'active' });
            hubInfo = { initialized: true, activeSessions };
        } catch {
            hubInfo = { initialized: true, activeSessions: -1 };
        }
    }
    return {
        status: healthRecord?.['ok'] === false ? 503 : 200,
        body: {
            ok: healthRecord?.['ok'] ?? true,
            healthStatus: healthRecord?.['status'] ?? 'healthy',
            issues: healthRecord?.['issues'] ?? [],
            dialogLoopActive,
            agentStatus,
            runtimeId,
            requestedRuntimeId: requestedRuntime,
            runtimeFound,
            usedDefaultRuntimeFallback,
            agentRuntimes,
            busy: readRuntimeBusyState(),
            hubSessionId: readRuntimeHubSessionId(),
            sseClients: getSseClients().size,
            model,
            reasoningEffort,
            contextWindow: snapshot['contextWindow'],
            backgroundPendingCount: healthRecord?.['backgroundPendingCount'] ?? 0,
            keepaliveRunning: ioChecks?.['keepaliveRunning'] ?? false,
            quotaMonitorRunning: quotaChecks?.['running'] ?? false,
            cacheStats: { fileContext: readRuntimeFileCacheStats() },
            hub: hubInfo,
            metrics: {
                tokens: {
                    input: metricsSummary.tokens.inputTokens,
                    output: metricsSummary.tokens.outputTokens,
                    cacheRead: metricsSummary.tokens.cacheReadTokens,
                    total: metricsSummary.tokens.inputTokens + metricsSummary.tokens.outputTokens,
                },
                tasks: { completed: metricsSummary.tasks.completed, failed: metricsSummary.tasks.failed },
                dialog: { turns: metricsSummary.dialog.turnsTotal, success: metricsSummary.dialog.turnsSuccess },
            },
            uptime: Math.round(process.uptime()),
            memoryMB: Math.round(process.memoryUsage.rss() / 1_048_576),
            mcp: getMcpStatus(),
            operationMode: (() => {
                const s = getMcpStatus();
                return s.available && s.toolCount > 0 && !s.circuitOpen ? 'connected' : 'standalone';
            })(),
        },
    };
}

// ─── SSE Clients ──────────────────────────────────────────────────────────────

/**
 * Obtém os conjuntos de clientes SSE.
 *
 * @returns {{ all: Set<import('node:http').ServerResponse>; critical: Set<import('node:http').ServerResponse> }}
 */
export function getSseClientSets() {
    return { all: getSseClients(), critical: getSseCriticalClients() };
}

// ─── GET /config ──────────────────────────────────────────────────────────────

/**
 * Retorna configuração dinâmica atual da sessão LLM-B.
 *
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {HandlerResult}
 */
export function handleGetConfig(params = {}) {
    const requestedRuntimeId = readRuntimeIdFromParams(params && typeof params === 'object' ? params : null);
    const {
        requestedRuntimeId: requestedRuntime,
        runtimeId,
        runtimeFound,
        usedDefaultRuntimeFallback,
        agentRuntimes,
        snap: snapshot,
        model,
        reasoningEffort,
        dialogLoopActive,
    } = readAgentRuntimeOverviewProjection(requestedRuntimeId);
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            runtimeId,
            requestedRuntimeId: requestedRuntime,
            runtimeFound,
            usedDefaultRuntimeFallback,
            agentRuntimes,
            model,
            reasoningEffort,
            sdkSessionMode: readRuntimeSdkSessionMode(),
            sdkPlanOperation: readRuntimeLastSdkPlanOperation(),
            dialogLoopActive,
            busy: readRuntimeBusyState(),
            hubSessionId: readRuntimeHubSessionId(),
            port: LLM_B_TERMINAL_PORT,
            contextWindow: snapshot['contextWindow'],
            lastCheckpointPath: snapshot['lastCheckpointPath'],
            infiniteSession: getInfiniteSessionConfig(),
        },
    };
}

// ─── InfiniteSession config dinâmico (AC.1) ───────────────────────────────────

/** @type {{ backgroundCompactionThreshold: number }} */
let _infiniteSessionConfig = { backgroundCompactionThreshold: 0.75 };

/**
 * Retorna a configuração atual de InfiniteSession.
 *
 * @returns {{ backgroundCompactionThreshold: number }}
 */
export function getInfiniteSessionConfig() {
    return { ..._infiniteSessionConfig };
}

/**
 * Atualiza o threshold de compaction dinâmico.
 *
 * @param {{ backgroundCompactionThreshold?: number }} body
 * @returns {HandlerResult}
 */
export function handleSetInfiniteSessionConfig(body) {
    const { backgroundCompactionThreshold } = body ?? {};
    if (backgroundCompactionThreshold !== undefined) {
        if (
            typeof backgroundCompactionThreshold !== 'number' ||
            backgroundCompactionThreshold < 0.1 ||
            backgroundCompactionThreshold > 1.0
        ) {
            return {
                status: 400,
                body: { ok: false, error: 'backgroundCompactionThreshold deve ser um número entre 0.1 e 1.0' },
            };
        }
        _infiniteSessionConfig = { ..._infiniteSessionConfig, backgroundCompactionThreshold };
        setDefaultAgentBackgroundCompactionThreshold(backgroundCompactionThreshold);
    }
    return { status: 200, cors: true, body: { ok: true, infiniteSession: getInfiniteSessionConfig() } };
}

// ── GET /config/skills + PUT /config/skills (AG.3) ───────────────────────────

/**
 * GET /config/skills — retorna a lista de skills configurados.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGetSkills() {
    const skills = await readSkillsConfig();
    return { status: 200, cors: true, body: { ok: true, skills } };
}

/**
 * PUT /config/skills — atualiza a lista de paths pinned.
 *
 * @param {unknown} body
 * @returns {Promise<HandlerResult>}
 */
export async function handleSetSkills(body) {
    const result = await updateSkillsConfig(body);
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 200, cors: true, body: { ok: true, skills: result.skills } };
}

// ── GET /config/tools + PUT /config/tools (AH.2) ─────────────────────────────

/**
 * GET /config/tools — retorna a configuração atual de allowlist/denylist de ferramentas.
 *
 * @returns {HandlerResult}
 */
export function handleGetToolsConfig() {
    return { status: 200, cors: true, body: { ok: true, tools: readDeclarativeToolsConfig() } };
}

/**
 * PUT /config/tools — atualiza allowlist e/ou denylist de ferramentas em runtime.
 *
 * @param {unknown} rawBody
 * @returns {Promise<HandlerResult>}
 */
export async function handleSetToolsConfig(rawBody) {
    const result = await updateDeclarativeToolsConfig(rawBody);
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 200, cors: true, body: { ok: true, tools: result.tools } };
}

// ── Custom tools (AI.2) ─────────────────────────────────────────────────────

/**
 * GET /config/tools/custom — lista as custom tools registradas em runtime.
 *
 * @returns {HandlerResult}
 */
export function handleGetCustomTools() {
    const { tools, availableHandlers } = readDeclarativeCustomToolsConfig();
    return { status: 200, cors: true, body: { ok: true, tools, availableHandlers } };
}

/**
 * POST /config/tools/custom — registra uma nova custom tool declarativa.
 *
 * @param {unknown} rawBody
 * @returns {Promise<HandlerResult>}
 */
export async function handleRegisterCustomTool(rawBody) {
    const result = await registerDeclarativeCustomToolConfig(rawBody);
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 201, cors: true, body: { ok: true, tool: result.tool } };
}

/**
 * DELETE /config/tools/custom/:name — remove uma custom tool pelo nome.
 *
 * @param {Record<string, unknown>} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleDeleteCustomTool(params) {
    const result = await removeDeclarativeCustomToolConfig(params);
    if (!result.ok) {
        const status = result.error === 'name é obrigatório' ? 400 : 404;
        return { status, body: { ok: false, error: result.error } };
    }
    return { status: 200, cors: true, body: { ok: true } };
}
