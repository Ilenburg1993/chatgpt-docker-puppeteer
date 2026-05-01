// @ts-check
/**
 * @module copilot/presentation/system-metrics
 * @file Superfície compartilhada de métricas, observabilidade operacional, git/gh e orçamento do agente.
 *
 *   Este módulo centraliza projections e handlers compartilhados consumidos por `server` e `terminal`, sem alterar o
 *   papel do terminal como interface operacional da LLM-B. O runtime truth continua em `agent/`, bridges, observability
 *   e estado legítimo do terminal.
 */

import { defaultAuditLog } from '#copilot/audit';
import { gitLog, gitStatus, listIssues, listPrs, listRuns } from '#copilot/bridges';
import { container, toError } from '#copilot/core';
import { ERROR_TRACKER, getStatsByCategory, getToolStats, METRICS_STORE } from '#copilot/observability';
import { getSseClients } from '../infra/sse/state.js';
import { clearRateLimiters } from './realtime.js';
import { readAgentRuntimeOverview, readAgentRuntimeOverviewProjection } from './runtime-overview.js';
import { readRuntimeIdFromParams } from './runtime-targeting.js';
import {
    readRuntimeInjectHistory,
    readRuntimeLatestThinkingHistoryEntry,
    readRuntimeThinkingHistory,
    readRuntimeThinkingHistoryEntry,
} from './runtime-ui-state.js';

/**
 * @typedef {import('./types.js').HandlerResult} HandlerResult
 */

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {string | null}
 */
function resolveRuntimeIdParam(params) {
    return readRuntimeIdFromParams(params);
}

/**
 * Endpoint `/metrics` compatível com Prometheus.
 *
 * @param {Record<string, unknown>} [params]
 * @returns {{ status: number; contentType: string; body: string }}
 */
export function handleMetrics(params = {}) {
    const { snap: snapshot, contextWindow: cw } = readAgentRuntimeOverview(resolveRuntimeIdParam(params));
    const statusValue = snapshot['status'] !== 'stopped' ? 1 : 0;
    const queueSize = Number(snapshot['queueSize'] ?? 0);
    const sendCount = Number(snapshot['sendCount'] ?? 0);
    const sseClients = getSseClients().size;

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

    const summary = container.resolve(METRICS_STORE).getSummary();
    lines.push(
        '# HELP llmb_dialog_turns_total Total de turns do dialog loop executados',
        '# TYPE llmb_dialog_turns_total counter',
        `llmb_dialog_turns_total ${summary.dialog.turnsTotal}`,
        '',
        '# HELP llmb_dialog_turns_success Turns do dialog loop concluídos com sucesso',
        '# TYPE llmb_dialog_turns_success counter',
        `llmb_dialog_turns_success ${summary.dialog.turnsSuccess}`,
        '',
        '# HELP llmb_sdk_dialog_turns_total Total de turns concluídos pelo SDK/base model',
        '# TYPE llmb_sdk_dialog_turns_total counter',
        `llmb_sdk_dialog_turns_total ${summary.sdkDialog.turnsTotal}`,
        '',
        '# HELP llmb_sdk_dialog_turns_success Turns SDK concluídos com sucesso',
        '# TYPE llmb_sdk_dialog_turns_success counter',
        `llmb_sdk_dialog_turns_success ${summary.sdkDialog.turnsSuccess}`,
        '',
        '# HELP llmb_inject_attempts_total Total de chamadas HTTP ao endpoint /inject',
        '# TYPE llmb_inject_attempts_total counter',
        `llmb_inject_attempts_total ${summary.inject.attemptsTotal}`,
        '',
        '# HELP llmb_inject_success_total Total de chamadas /inject concluídas dentro do SLA HTTP',
        '# TYPE llmb_inject_success_total counter',
        `llmb_inject_success_total ${summary.inject.successTotal}`,
        '',
        '# HELP llmb_inject_timeouts_total Total de timeouts HTTP no endpoint /inject',
        '# TYPE llmb_inject_timeouts_total counter',
        `llmb_inject_timeouts_total ${summary.inject.timeoutsTotal}`,
        '',
        '# HELP llmb_inject_errors_total Total de erros não-timeout no endpoint /inject',
        '# TYPE llmb_inject_errors_total counter',
        `llmb_inject_errors_total ${summary.inject.errorsTotal}`,
        '',
        '# HELP llmb_dialog_stalls_total Total de stalls detectados pelo watchdog',
        '# TYPE llmb_dialog_stalls_total counter',
        `llmb_dialog_stalls_total ${summary.dialog.stallsTotal}`,
        '',
        '# HELP llmb_dialog_recovery_total Total de recuperações semânticas do dialog loop',
        '# TYPE llmb_dialog_recovery_total counter',
        `llmb_dialog_recovery_total ${summary.dialogRecovery.total}`,
        '',
        '# HELP llmb_dialog_recovery_success_total Recuperações semânticas concluídas',
        '# TYPE llmb_dialog_recovery_success_total counter',
        `llmb_dialog_recovery_success_total ${summary.dialogRecovery.success}`,
        '',
        '# HELP llmb_dialog_recovery_failed_total Recuperações semânticas com falha',
        '# TYPE llmb_dialog_recovery_failed_total counter',
        `llmb_dialog_recovery_failed_total ${summary.dialogRecovery.failed}`,
        '',
        '# HELP llmb_dialog_recovery_zero_pr_total Recuperações sem consumir Premium Request',
        '# TYPE llmb_dialog_recovery_zero_pr_total counter',
        `llmb_dialog_recovery_zero_pr_total ${summary.dialogRecovery.zeroPr}`,
        '',
        '# HELP llmb_dialog_recovery_pr_total Recuperações que consumiram Premium Request',
        '# TYPE llmb_dialog_recovery_pr_total counter',
        `llmb_dialog_recovery_pr_total ${summary.dialogRecovery.pr}`,
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

    if (summary.inject.attemptsTotal > 0) {
        const injectLatency = summary.inject.latency;
        lines.push(
            '# HELP llmb_inject_duration_p50_ms Percentil 50 de duração do endpoint /inject (ms)',
            '# TYPE llmb_inject_duration_p50_ms gauge',
            `llmb_inject_duration_p50_ms ${injectLatency.p50}`,
            '',
            '# HELP llmb_inject_duration_p95_ms Percentil 95 de duração do endpoint /inject (ms)',
            '# TYPE llmb_inject_duration_p95_ms gauge',
            `llmb_inject_duration_p95_ms ${injectLatency.p95}`,
            '',
        );
    }

    if (summary.dialogRecovery.total > 0) {
        const recoveryLatency = summary.dialogRecovery.latency;
        lines.push(
            '# HELP llmb_dialog_recovery_duration_p95_ms Percentil 95 de duração da recuperação do dialog (ms)',
            '# TYPE llmb_dialog_recovery_duration_p95_ms gauge',
            `llmb_dialog_recovery_duration_p95_ms ${recoveryLatency.p95}`,
            '',
        );
    }

    return {
        status: 200,
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        body: lines.join('\n'),
    };
}

/**
 * GET /errors — estatísticas e últimos erros do error tracker.
 *
 * @returns {HandlerResult}
 */
export function handleGetErrors() {
    const stats = container.resolve(ERROR_TRACKER).getStats();
    const recent = container.resolve(ERROR_TRACKER).getErrors(20);
    return {
        status: 200,
        cors: true,
        body: { ok: true, stats, recent },
    };
}

/**
 * GET /audit — ring buffer de auditoria e sumário do audit log.
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
    } catch (e) {
        return { status: 200, cors: true, body: { ok: true, entries, historicalError: toError(e).message } };
    }
}

/**
 * GET /tool-stats — estatísticas detalhadas por tool.
 *
 * @returns {{
 *     stats: Record<string, any>;
 *     entries: [string, Record<string, any>][];
 *     tools: Record<string, any>[];
 *     byCategory: Record<string, any>;
 *     toolCount: number;
 * }}
 */
export function readToolStatsProjection() {
    const stats = getToolStats();
    const entries = /** @type {[string, Record<string, any>][]} */ (Object.entries(stats));
    const tools = entries.map(([name, s]) => ({ name, ...s }));
    let byCategory;
    try {
        byCategory = getStatsByCategory();
    } catch {
        byCategory = {};
    }
    return {
        stats,
        entries,
        tools,
        byCategory,
        toolCount: entries.length,
    };
}

/**
 * GET /tool-stats — estatísticas detalhadas por tool.
 *
 * @returns {HandlerResult}
 */
export function handleGetToolStats() {
    const projection = readToolStatsProjection();
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            toolCount: projection.toolCount,
            tools: projection.tools,
            byCategory: projection.byCategory,
        },
    };
}

/**
 * GET /history — retorna o histórico das últimas N injeções.
 *
 * @param {{ limit?: number }} [params]
 * @returns {HandlerResult}
 */
export function handleGetHistory({ limit = 50 } = {}) {
    const entries = readRuntimeInjectHistory(limit);
    return {
        status: 200,
        cors: true,
        body: { ok: true, count: entries.length, entries },
    };
}

/**
 * @param {import('./runtime-ui-state-store.js').ThinkingHistoryEntry} entry
 * @returns {object}
 */
function projectThinkingSummary(entry) {
    return {
        id: entry.id,
        ts: entry.ts,
        source: entry.source,
        title: entry.title,
        chars: entry.chars,
        durationMs: entry.durationMs,
        reasoningId: entry.reasoningId,
        taskId: entry.taskId ?? null,
        model: entry.model ?? null,
        effort: entry.effort ?? null,
        status: entry.status,
        contentSnippet: entry.content.length > 240 ? `${entry.content.slice(0, 240)}...` : entry.content,
    };
}

/**
 * GET /thinking — lista resumida dos thinkings capturados pelo runtime/terminal.
 *
 * @param {{ limit?: number }} [params]
 * @returns {HandlerResult}
 */
export function handleGetThinkingHistory({ limit = 20 } = {}) {
    const entries = readRuntimeThinkingHistory(limit).map(projectThinkingSummary);
    return {
        status: 200,
        cors: true,
        body: { ok: true, count: entries.length, entries },
    };
}

/**
 * GET /thinking/:id — abre um thinking completo, com suporte a `latest` e sufixos exibidos no terminal.
 *
 * @param {{ id?: string }} [params]
 * @returns {HandlerResult}
 */
export function handleGetThinkingEntry({ id = 'latest' } = {}) {
    const wanted = String(id || 'latest').trim();
    const entry =
        wanted === 'latest'
            ? readRuntimeLatestThinkingHistoryEntry()
            : (readRuntimeThinkingHistoryEntry(wanted) ??
              readRuntimeThinkingHistory(100).find((item) => item.id.endsWith(wanted)) ??
              null);
    if (!entry) {
        return {
            status: 404,
            cors: true,
            body: { ok: false, error: `Thinking não encontrado: ${wanted}` },
        };
    }
    return {
        status: 200,
        cors: true,
        body: { ok: true, entry },
    };
}

/**
 * POST /system/reset — limpa rate limiters + error tracker.
 *
 * @returns {HandlerResult}
 */
export function handleSystemReset() {
    clearRateLimiters();
    container.resolve(ERROR_TRACKER).clearErrors();
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
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
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
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
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
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
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
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
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
    } catch (e) {
        return { status: 500, body: { ok: false, error: toError(e).message } };
    }
}

/**
 * GET /quota — retorna dados de cota de PRs.
 *
 * @param {Record<string, unknown>} [params]
 * @returns {{ status: number; body: object }}
 */
export function handleGetQuota(params = {}) {
    const {
        snap: snapshot,
        runtimeId,
        dialogLoopActive,
        sessionId,
        lastPrInfo: prInfo,
    } = readAgentRuntimeOverviewProjection(resolveRuntimeIdParam(params));
    return {
        status: 200,
        body: {
            ok: true,
            runtimeId,
            sendCount: Number(snapshot?.['sendCount'] ?? 0),
            dialogLoopActive,
            sessionId,
            lastPrConsumedAt: prInfo?.['ts'] ?? null,
            lastPrModel: prInfo?.['model'] ?? null,
            lastPrConfiguredModel: prInfo?.['configuredModel'] ?? null,
            lastPrModelMismatch: prInfo?.['modelMismatch'] ?? false,
            lastPrCost: prInfo?.['cost'] ?? null,
            lastQuotaSnapshots: prInfo?.['quotaSnapshots'] ?? null,
        },
    };
}

/**
 * GET /pr-budget — métricas detalhadas de consumo de Premium Requests.
 *
 * @param {Record<string, unknown>} [params]
 * @returns {{ status: number; body: object }}
 */
export function handleGetPrBudget(params = {}) {
    const {
        snap: snapshot,
        runtimeId,
        dialogLoopActive,
        sessionId,
        dialogPrMetrics: prMetrics,
        lastPrInfo: prInfo,
    } = readAgentRuntimeOverviewProjection(resolveRuntimeIdParam(params));
    return {
        status: 200,
        body: {
            ok: true,
            runtimeId,
            prMetrics: prMetrics ?? { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
            sendCount: Number(snapshot?.['sendCount'] ?? 0),
            dialogLoopActive,
            sessionId,
            lastPrConsumedAt: prInfo?.['ts'] ?? null,
            lastPrModel: prInfo?.['model'] ?? null,
            lastPrConfiguredModel: prInfo?.['configuredModel'] ?? null,
            lastPrModelMismatch: prInfo?.['modelMismatch'] ?? false,
            lastPrCost: prInfo?.['cost'] ?? null,
            uptime: Math.round(process.uptime()),
        },
    };
}
