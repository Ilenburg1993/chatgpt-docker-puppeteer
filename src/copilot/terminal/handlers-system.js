// @ts-check
/**
 * src/copilot/terminal/handlers-system.js
 *
 * Handlers de sistema: health, config, metrics, git, gh, skills, tools, quota, SSE.
 *
 * @module copilot/terminal/handlers-system
 * @see module:copilot/terminal/route-table
 */

import { defaultAuditLog } from '#copilot/audit/pipeline';
import { LLM_B_TERMINAL_PORT } from '#copilot/config/env';
import {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/sdk/custom-tools';
import { getToolsConfig, patchToolsConfig } from '#copilot/sdk/tools-state';
import { existsSync } from 'node:fs';
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { alwaysAliveAgent, setBackgroundCompactionThreshold } from '../agent/index.js';
import { listIssues, listPrs, listRuns } from '../bridges/gh/index.js';
import { gitLog, gitStatus } from '../bridges/git-bridge.js';
import { getMcpStatus } from '../bridges/mcp-tool-bridge.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { conversationStore } from '../conversation-hub/store.js';
import { defaultErrorTracker } from '../observability/error-tracker.js';
import { defaultMetrics } from '../observability/metrics.js';
import { getStatsByCategory, getToolStats } from '../observability/tool-stats.js';
import { getFileCacheStats } from './file-context.js';
import { clearRateLimiters } from './rate-limiter-state.js';
import {
    getBusy,
    getHubSessionId,
    getInjectHistory,
    getPlanMode,
    getSseClients,
    getSseCriticalClients,
} from './state.js';

/**
 * @typedef {import('./handlers-shared.js').HandlerResult} HandlerResult
 */

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @returns {HandlerResult}
 */
export function handleHealth() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    // UPG-N22/GAP-N06 (fix): incluir status do ConversationHub no /health
    let hubInfo = { initialized: false, activeSessions: 0 };
    if (conversationHub.isReady) {
        try {
            // T-30 fix: usar countHubSessions (COUNT(*)) em vez de listHubSessions({}).length O(n)
            const activeSessions = conversationStore.countHubSessions({ status: 'active' });
            hubInfo = { initialized: true, activeSessions };
        } catch {
            hubInfo = { initialized: true, activeSessions: -1 };
        }
    }
    return {
        status: 200,
        body: {
            ok: true,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            agentStatus: alwaysAliveAgent.status,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            sseClients: getSseClients().size,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            // AA.5: dados reais de uso de contexto
            contextWindow: snapshot.contextWindow,
            // AB.3: estatísticas de cache
            cacheStats: { fileContext: getFileCacheStats() },
            // UPG-N22: status do ConversationHub
            hub: hubInfo,
            // F4.1: métricas acumuladas (tokens, tasks, dialog)
            metrics: (() => {
                const s = defaultMetrics.getSummary();
                return {
                    tokens: {
                        input: s.tokens.inputTokens,
                        output: s.tokens.outputTokens,
                        cacheRead: s.tokens.cacheReadTokens,
                        total: s.tokens.inputTokens + s.tokens.outputTokens,
                    },
                    tasks: { completed: s.tasks.completed, failed: s.tasks.failed },
                    dialog: { turns: s.dialog.turnsTotal, success: s.dialog.turnsSuccess },
                };
            })(),
            // QUA-P2-08: uptime e memória do processo
            uptime: Math.round(process.uptime()),
            memoryMB: Math.round(process.memoryUsage.rss() / 1_048_576),
            // F9.1: estado do MCP bridge (circuit breaker + disponibilidade)
            mcp: getMcpStatus(),
            // F10.4: modo de operação derivado do estado MCP
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
 * @returns {HandlerResult}
 */
export function handleGetConfig() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            planMode: getPlanMode(),
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            port: LLM_B_TERMINAL_PORT,
            contextWindow: snapshot.contextWindow,
            lastCheckpointPath: snapshot.lastCheckpointPath,
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
        setBackgroundCompactionThreshold(backgroundCompactionThreshold);
    }
    return { status: 200, cors: true, body: { ok: true, infiniteSession: getInfiniteSessionConfig() } };
}

// ── GET /config/skills + PUT /config/skills (AG.3) ───────────────────────────

const SKILLS_PATH = join(resolve(import.meta.dirname, '../../../..'), 'skills.json');

/**
 * @typedef {Object} SkillsConfig
 * @property {string[]} paths
 */

/**
 * Lê o skills.json do disco.
 *
 * @returns {Promise<SkillsConfig>}
 */
async function readSkillsConfig() {
    if (!existsSync(SKILLS_PATH)) return { paths: [] };
    try {
        // T-09: usar async I/O para não bloquear o event loop
        const raw = await readFileAsync(SKILLS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { paths: [] };
    }
}

/**
 * Persiste o skills.json no disco.
 *
 * @param {SkillsConfig} config
 * @returns {Promise<void>}
 */
async function writeSkillsConfig(config) {
    // T-09: usar async I/O para não bloquear o event loop
    await writeFileAsync(SKILLS_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET /config/skills — retorna a lista de skills configurados.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGetSkills() {
    // T-09: async I/O para não bloquear o event loop
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
    const { paths } = /** @type {Record<string, unknown>} */ (body) ?? {};
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
        return { status: 400, body: { ok: false, error: 'body deve conter { paths: string[] }' } };
    }
    const config = { paths };
    // T-09: async I/O para não bloquear o event loop
    await writeSkillsConfig(config);
    return { status: 200, cors: true, body: { ok: true, skills: config } };
}

// ── GET /config/tools + PUT /config/tools (AH.2) ─────────────────────────────

/**
 * GET /config/tools — retorna a configuração atual de allowlist/denylist de ferramentas.
 *
 * @returns {HandlerResult}
 */
export function handleGetToolsConfig() {
    return { status: 200, cors: true, body: { ok: true, tools: getToolsConfig() } };
}

/**
 * PUT /config/tools — atualiza allowlist e/ou denylist de ferramentas em runtime.
 *
 * @param {unknown} rawBody
 * @returns {HandlerResult}
 */
export function handleSetToolsConfig(rawBody) {
    const body = /** @type {Record<string, unknown>} */ (rawBody) ?? {};

    if ('allowlist' in body) {
        if (
            body['allowlist'] !== null &&
            (!Array.isArray(body['allowlist']) ||
                body['allowlist'].some((/** @type {unknown} */ t) => typeof t !== 'string'))
        ) {
            return { status: 400, body: { ok: false, error: 'allowlist deve ser string[] ou null' } };
        }
        patchToolsConfig({ allowlist: body['allowlist'] });
    }

    if ('denylist' in body) {
        if (
            !Array.isArray(body['denylist']) ||
            body['denylist'].some((/** @type {unknown} */ t) => typeof t !== 'string')
        ) {
            return { status: 400, body: { ok: false, error: 'denylist deve ser string[]' } };
        }
        patchToolsConfig({ denylist: body['denylist'] });
    }

    return { status: 200, cors: true, body: { ok: true, tools: getToolsConfig() } };
}

// ── Custom tools (AI.2) ─────────────────────────────────────────────────────

/**
 * GET /config/tools/custom — lista as custom tools registradas em runtime.
 *
 * @returns {HandlerResult}
 */
export function handleGetCustomTools() {
    const tools = getCustomToolDefinitions();
    const availableHandlers = [...BUILTIN_HANDLER_MAP.keys()];
    return { status: 200, cors: true, body: { ok: true, tools, availableHandlers } };
}

/**
 * POST /config/tools/custom — registra uma nova custom tool declarativa.
 *
 * @param {unknown} rawBody
 * @returns {HandlerResult}
 */
export function handleRegisterCustomTool(rawBody) {
    const body = /** @type {Record<string, unknown>} */ (rawBody) ?? {};
    if (typeof body['name'] !== 'string' || !body['name']) {
        return { status: 400, body: { ok: false, error: 'name (string) é obrigatório' } };
    }
    if (typeof body['description'] !== 'string' || !body['description']) {
        return { status: 400, body: { ok: false, error: 'description (string) é obrigatória' } };
    }
    if (typeof body['handlerId'] !== 'string' || !body['handlerId']) {
        return { status: 400, body: { ok: false, error: 'handlerId (string) é obrigatório' } };
    }
    const result = registerCustomTool({
        name: body['name'],
        description: body['description'],
        handlerId: body['handlerId'],
        ...(body['parameters'] != null && {
            parameters: /** @type {Record<string, unknown>} */ (body['parameters']),
        }),
    });
    if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 201, cors: true, body: { ok: true, tool: { name: body['name'], handlerId: body['handlerId'] } } };
}

/**
 * DELETE /config/tools/custom/:name — remove uma custom tool pelo nome.
 *
 * @param {{ name: string } | string} nameOrParams
 * @returns {HandlerResult}
 */
export function handleDeleteCustomTool(nameOrParams) {
    const name = typeof nameOrParams === 'string' ? nameOrParams : nameOrParams?.name;
    if (!name) return { status: 400, body: { ok: false, error: 'name é obrigatório' } };
    const result = removeCustomTool(name);
    if (!result.ok) return { status: 404, body: { ok: false, error: result.error } };
    return { status: 200, cors: true, body: { ok: true } };
}

// ─── GET /metrics ─────────────────────────────────────────────────────────────

/**
 * Endpoint `/metrics` compatível com Prometheus.
 *
 * @returns {{ status: number; contentType: string; body: string }}
 */
export function handleMetrics() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const statusValue = snapshot.status !== 'stopped' ? 1 : 0;
    const queueSize = snapshot.queueSize ?? 0;
    const sendCount = snapshot.sendCount ?? 0;
    const sseClients = getSseClients().size;
    const cw = snapshot.contextWindow;

    const lines = [
        '# HELP llmb_agent_status Current agent status (1=active, 0=inactive)',
        '# TYPE llmb_agent_status gauge',
        `llmb_agent_status ${statusValue}`,
        '',
        '# HELP llmb_queue_size Number of tasks pending in the queue',
        '# TYPE llmb_queue_size gauge',
        `llmb_queue_size ${queueSize}`,
        '',
        '# HELP llmb_send_count_total Total messages sent since last start',
        '# TYPE llmb_send_count_total counter',
        `llmb_send_count_total ${sendCount}`,
        '',
        '# HELP llmb_sse_clients Number of connected SSE clients',
        '# TYPE llmb_sse_clients gauge',
        `llmb_sse_clients ${sseClients}`,
        '',
        '# HELP llmb_context_tokens Context window tokens used',
        '# TYPE llmb_context_tokens gauge',
        `llmb_context_tokens ${cw?.tokens ?? 0}`,
        '',
        '# HELP llmb_context_token_limit Context window token limit',
        '# TYPE llmb_context_token_limit gauge',
        `llmb_context_token_limit ${cw?.tokenLimit ?? 0}`,
        '',
        '# HELP llmb_context_utilization Context window utilization ratio (0.0 to 1.0)',
        '# TYPE llmb_context_utilization gauge',
        `llmb_context_utilization ${cw?.utilization ?? 0}`,
        '',
    ];

    // F13.3: métricas de canal inject (LLM-A ↔ LLM-B) via tool-stats
    const stats = getToolStats();
    const injectStats = stats['channel.inject'];
    if (injectStats) {
        const successCount = injectStats.calls - injectStats.errors;
        lines.push(
            '# HELP llm_b_inject_total Total de chamadas ao canal inject LLM-A→LLM-B',
            '# TYPE llm_b_inject_total counter',
            `llm_b_inject_total{status="success"} ${successCount}`,
            `llm_b_inject_total{status="error"} ${injectStats.errors}`,
            `llm_b_inject_total{status="total"} ${injectStats.calls}`,
            '',
            '# HELP llm_b_inject_duration_ms_avg Latência média do canal inject em ms',
            '# TYPE llm_b_inject_duration_ms_avg gauge',
            `llm_b_inject_duration_ms_avg ${injectStats.avgLatencyMs}`,
            '',
            '# HELP llm_b_inject_error_rate Taxa de erro do canal inject (0.0-100.0)',
            '# TYPE llm_b_inject_error_rate gauge',
            `llm_b_inject_error_rate ${injectStats.errorRate}`,
            '',
        );
    }

    // F4.1: dialog loop e sessão — contadores reais do defaultMetrics
    const summary = defaultMetrics.getSummary();
    lines.push(
        '# HELP llmb_dialog_turns_total Total de turns do dialog loop executados',
        '# TYPE llmb_dialog_turns_total counter',
        `llmb_dialog_turns_total ${summary.dialog.turnsTotal}`,
        '',
        '# HELP llmb_dialog_turns_success Turns do dialog loop concluídos com sucesso',
        '# TYPE llmb_dialog_turns_success counter',
        `llmb_dialog_turns_success ${summary.dialog.turnsSuccess}`,
        '',
        '# HELP llmb_dialog_stalls_total Total de stalls detectados pelo watchdog',
        '# TYPE llmb_dialog_stalls_total counter',
        `llmb_dialog_stalls_total ${summary.dialog.stallsTotal}`,
        '',
        '# HELP llmb_sessions_started_total Total de sessões SDK iniciadas',
        '# TYPE llmb_sessions_started_total counter',
        `llmb_sessions_started_total ${summary.sessions.started}`,
        '',
        '# HELP llmb_sessions_errors_total Total de erros de sessão SDK',
        '# TYPE llmb_sessions_errors_total counter',
        `llmb_sessions_errors_total ${summary.sessions.errors}`,
        '',
        '# HELP llmb_sessions_rotations_total Sessões rotacionadas por política',
        '# TYPE llmb_sessions_rotations_total counter',
        `llmb_sessions_rotations_total ${summary.sessions.rotations}`,
        '',
        '# HELP llmb_sessions_keepalive_pings_total Pings de keepalive enviados',
        '# TYPE llmb_sessions_keepalive_pings_total counter',
        `llmb_sessions_keepalive_pings_total ${summary.sessions.keepalivePings}`,
        '',
        '# HELP llmb_sessions_handoffs_total Handoffs recebidos',
        '# TYPE llmb_sessions_handoffs_total counter',
        `llmb_sessions_handoffs_total ${summary.sessions.handoffs}`,
        '',
        '# HELP llmb_tokens_input_total Total de tokens de input consumidos',
        '# TYPE llmb_tokens_input_total counter',
        `llmb_tokens_input_total ${summary.tokens.inputTokens}`,
        '',
        '# HELP llmb_tokens_output_total Total de tokens de output gerados',
        '# TYPE llmb_tokens_output_total counter',
        `llmb_tokens_output_total ${summary.tokens.outputTokens}`,
        '',
    );

    // F17.3: percentis de latência do dialog turn
    if (summary.dialog.turnsTotal > 0) {
        const lp = summary.dialog.turnLatency;
        lines.push(
            '# HELP llmb_dialog_turn_duration_p50_ms Percentil 50 de duração de turns (ms)',
            '# TYPE llmb_dialog_turn_duration_p50_ms gauge',
            `llmb_dialog_turn_duration_p50_ms ${lp.p50}`,
            '',
            '# HELP llmb_dialog_turn_duration_p95_ms Percentil 95 de duração de turns (ms)',
            '# TYPE llmb_dialog_turn_duration_p95_ms gauge',
            `llmb_dialog_turn_duration_p95_ms ${lp.p95}`,
            '',
        );
    }

    return {
        status: 200,
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        body: lines.join('\n'),
    };
}

// ─── F14.1 — Errors endpoint ──────────────────────────────────────────────────

/**
 * GET /errors — estatísticas e últimos erros do error tracker.
 *
 * Expõe `defaultErrorTracker.getStats()` e `getErrors(20)` como JSON para monitoramento por LLM-A e dashboards
 * externos.
 *
 * @returns {HandlerResult}
 */
export function handleGetErrors() {
    const stats = defaultErrorTracker.getStats();
    const recent = defaultErrorTracker.getErrors(20);
    return {
        status: 200,
        cors: true,
        body: { ok: true, stats, recent },
    };
}

// ─── F14.2 — Audit endpoint ───────────────────────────────────────────────────

/**
 * GET /audit — ring buffer de auditoria e sumário do audit log.
 *
 * Retorna as últimas entradas do buffer em memória via `defaultAuditLog.getEntries()`. O query param `?summary=1`
 * executa leitura JSONL histórica via `getAuditSummary()`.
 *
 * @param {{ summary?: number; limit?: number; sessionId?: string | null }} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleGetAudit({ summary: wantSummary = 0, limit = 50, sessionId = null } = {}) {
    const entries = defaultAuditLog.getEntries();
    if (!wantSummary) {
        return { status: 200, cors: true, body: { ok: true, entries } };
    }
    try {
        const historical = await defaultAuditLog.getAuditSummary(sessionId, limit);
        return { status: 200, cors: true, body: { ok: true, entries, historical } };
    } catch (/** @type {any} */ e) {
        return { status: 200, cors: true, body: { ok: true, entries, historicalError: e.message } };
    }
}

// ─── F14.3 — Tool stats endpoint ──────────────────────────────────────────────

/**
 * GET /tool-stats — estatísticas detalhadas por tool.
 *
 * Retorna o mapa completo de `getToolStats()` como JSON estruturado, com contagens de chamadas, erros, latência média e
 * taxa de erro por ferramenta.
 *
 * @returns {HandlerResult}
 */
export function handleGetToolStats() {
    const stats = getToolStats();
    const entries = Object.entries(stats).map(([name, s]) => ({ name, ...s }));
    const byCategory = getStatsByCategory();
    return {
        status: 200,
        cors: true,
        body: { ok: true, toolCount: entries.length, tools: entries, byCategory },
    };
}

/**
 * GET /history — retorna o histórico das últimas N injeções.
 *
 * @param {{ limit?: number }} [params]
 * @returns {HandlerResult}
 */
export function handleGetHistory({ limit = 50 } = {}) {
    const entries = getInjectHistory(limit);
    return {
        status: 200,
        cors: true,
        body: { ok: true, count: entries.length, entries },
    };
}

/**
 * POST /system/reset — limpa rate limiters + error tracker. Útil após throttling acidental.
 *
 * @returns {HandlerResult}
 */
export function handleSystemReset() {
    clearRateLimiters();
    defaultErrorTracker.clearErrors();
    return { status: 200, body: { ok: true, message: 'Rate limiters e error tracker resetados.' } };
}

/**
 * GET /gh/issues — lista GitHub issues via gh CLI.
 *
 * @param {{ state?: string; limit?: number; page?: number }} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhIssues({ state = 'open', limit = 15, page = 1 } = {}) {
    try {
        const result = await listIssues({
            state: /** @type {'open' | 'closed' | 'all'} */ (state),
            perPage: limit,
            page,
        });
        return {
            status: 200,
            cors: true,
            body: { ok: true, issues: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * GET /gh/prs — lista GitHub pull requests via gh CLI.
 *
 * @param {{ state?: string; limit?: number; page?: number }} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhPrs({ state = 'open', limit = 15, page = 1 } = {}) {
    try {
        const result = await listPrs({
            state: /** @type {'open' | 'closed' | 'merged' | 'all'} */ (state),
            perPage: limit,
            page,
        });
        return {
            status: 200,
            cors: true,
            body: { ok: true, prs: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * GET /gh/ci — lista GitHub Actions runs.
 *
 * @param {{ limit?: number; page?: number }} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhCi({ limit = 15, page = 1 } = {}) {
    try {
        const result = await listRuns({ perPage: limit, page });
        return {
            status: 200,
            cors: true,
            body: { ok: true, runs: result.items, hasMore: result.hasMore, page: result.page },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * GET /git/status — retorna output de `git status --porcelain`.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitStatus() {
    try {
        const entries = await gitStatus();
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * GET /git/log — retorna log de commits recentes.
 *
 * @param {{ n?: number }} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitLog({ n = 20 } = {}) {
    try {
        const entries = await gitLog({ n });
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── Quota ────────────────────────────────────────────────────────────────────

/**
 * GET /quota — retorna dados de cota de PRs.
 *
 * @returns {{ status: number; body: object }}
 */
export function handleGetQuota() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const prInfo = alwaysAliveAgent.lastPrInfo ?? null;
    return {
        status: 200,
        body: {
            ok: true,
            sendCount: snapshot?.sendCount ?? 0,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            sessionId: alwaysAliveAgent.sessionId ?? null,
            lastPrConsumedAt: prInfo?.ts ?? null,
            lastPrModel: prInfo?.model ?? null,
            lastPrCost: prInfo?.cost ?? null,
            lastQuotaSnapshots: prInfo?.quotaSnapshots ?? null,
        },
    };
}

/**
 * F55 (PARTE-9): GET /pr-budget — métricas detalhadas de consumo de Premium Requests.
 *
 * @returns {{ status: number; body: object }}
 */
export function handleGetPrBudget() {
    const prMetrics = alwaysAliveAgent.dialogPrMetrics;
    const prInfo = alwaysAliveAgent.lastPrInfo ?? null;
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    return {
        status: 200,
        body: {
            ok: true,
            prMetrics: prMetrics ?? { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
            sendCount: snapshot?.sendCount ?? 0,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            sessionId: alwaysAliveAgent.sessionId ?? null,
            lastPrConsumedAt: prInfo?.ts ?? null,
            lastPrModel: prInfo?.model ?? null,
            lastPrCost: prInfo?.cost ?? null,
            uptime: Math.round(process.uptime()),
        },
    };
}
