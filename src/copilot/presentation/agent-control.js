// @ts-check
/**
 * @module copilot/presentation/agent-control
 * @file Superfície compartilhada de controle do agente consumida por `server` e `terminal`.
 *
 *   Esta camada concentra os handlers de context, inject, pipeline, dialog control e handoff, preservando o terminal como
 *   interface operacional da LLM-B, mas removendo a dependência direta de `server/` em `terminal/handlers/agent.js`.
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { container, toError } from '#copilot/core';
import { log, METRICS_STORE } from '#copilot/observability';
import { projectAgentHttpError } from './agent-http-errors.js';
import { resolveOptionalDialogTimeout } from './dialog-timeout-policy.js';
import {
    getAgentHandoffManager,
    getAgentRuntimeControlsTarget,
    pauseAgentDialogLoop,
    readAgentRuntimeControlState,
    resumeAgentDialogLoop,
} from './runtime-controls.js';
import {
    attachmentToRuntimeEmbed,
    embedRuntimeMultiple,
    MAX_EMBED_BYTES,
    readRuntimeFileContext,
    sendRuntimeDialogTurn,
    sendRuntimeDialogTurnWithDiagnostics,
} from './runtime-dialog.js';
import { readAgentRuntimeOverview } from './runtime-overview.js';
import { readAgentStatusSnapshot } from './runtime-status.js';
import { readRuntimeIdFromParams } from './runtime-targeting.js';
import { recordRuntimeInjectHistory } from './runtime-ui-state.js';

/**
 * @typedef {import('./types.js').HandlerResult} HandlerResult
 */

/**
 * Valores válidos para o campo `from` nos endpoints /inject e /pipeline.
 *
 * @type {ReadonlySet<string>}
 */
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);

/**
 * @returns {string}
 */
function createInjectTraceId() {
    return `inject-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

/**
 * @returns {import('#copilot/observability/metrics.js').MetricsStore | null}
 */
function resolveMetricsStoreSafe() {
    try {
        return container.resolve(METRICS_STORE);
    } catch {
        return null;
    }
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {number | undefined} explicitTimeoutMs
 * @returns {{ timeoutMs: number | null; strategy: 'explicit' | 'adaptive' | 'disabled'; reasons: string[] }}
 */
function resolveInjectTimeout(runtimeId, explicitTimeoutMs) {
    const metrics = resolveMetricsStoreSafe();
    const summary = metrics?.getSummary?.();
    const runtime = readAgentRuntimeOverview(runtimeId);
    const injectAttempts = Number(summary?.inject?.attemptsTotal ?? 0);
    const injectTimeouts = Number(summary?.inject?.timeoutsTotal ?? 0);
    return resolveOptionalDialogTimeout({
        explicitTimeoutMs,
        defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
        queueDepth: Number(runtime.snap?.['queueSize'] ?? 0),
        contextUtilization: Number(runtime.contextWindow?.utilization ?? 0),
        recentP50Ms: Number(summary?.inject?.latency?.p50 ?? summary?.dialog?.turnLatency?.p50 ?? 0),
        recentP95Ms: Number(summary?.inject?.latency?.p95 ?? summary?.dialog?.turnLatency?.p95 ?? 0),
        recentP99Ms: Number(summary?.inject?.latency?.p99 ?? summary?.dialog?.turnLatency?.p99 ?? 0),
        recentTimeoutRate: injectAttempts > 0 ? injectTimeouts / injectAttempts : 0,
        payloadChars: 0,
        phase: 'inject',
        allowDisabled: true,
    });
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/always-alive.js').AlwaysAliveAgent}
 */
function getAgent(runtimeId = null) {
    return getAgentRuntimeControlsTarget(runtimeId);
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {string | null}
 */
function resolveRuntimeIdParam(params) {
    return readRuntimeIdFromParams(params);
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Record<string, unknown> | null}
 */
function extractRequestBody(params) {
    if (!params || typeof params !== 'object') return null;
    const body = params['body'];
    return body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Record<string, unknown>}
 */
function resolveAgentControlInput(params) {
    return extractRequestBody(params) ?? (params && typeof params === 'object' ? params : {});
}

/**
 * UPG-04: Endpoint dedicado para monitoramento de uso de contexto.
 *
 * @returns {HandlerResult}
 */
export function handleGetContext(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const { snap: snapshot, contextWindow: cw } = readAgentRuntimeOverview(runtimeId);
    const lastCheckpointPath =
        typeof snapshot['lastCheckpointPath'] === 'string' ? snapshot['lastCheckpointPath'] : null;
    if (!cw) {
        return {
            status: 200,
            cors: true,
            body: {
                ok: true,
                tokens: 0,
                tokenLimit: 0,
                utilization: 0,
                utilizationPercent: 0,
                lastCheckpointPath,
                warning: 'none',
            },
        };
    }
    const utilization = cw.utilization;
    /** @type {'none' | 'moderate' | 'high' | 'critical'} */
    let warning = 'none';
    if (utilization >= 0.95) warning = 'critical';
    else if (utilization >= 0.8) warning = 'high';
    else if (utilization >= 0.6) warning = 'moderate';
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            tokens: cw.tokens,
            tokenLimit: cw.tokenLimit,
            utilization,
            utilizationPercent: Math.round(utilization * 100),
            lastCheckpointPath,
            warning,
        },
    };
}

/**
 * Executa uma sequência ordenada de turnos (pipeline).
 *
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handlePipeline(params = {}) {
    const body = resolveAgentControlInput(params);
    const runtimeId = resolveRuntimeIdParam(params);
    const steps = Array.isArray(body['steps']) ? body['steps'] : null;
    if (!steps || steps.length === 0) {
        return { status: 400, body: { ok: false, error: '"steps" deve ser um array não vazio' } };
    }

    const MAX_PIPELINE_STEPS = 20;
    if (steps.length > MAX_PIPELINE_STEPS) {
        return {
            status: 400,
            body: {
                ok: false,
                error: `Máximo ${MAX_PIPELINE_STEPS} steps por pipeline (recebido: ${steps.length})`,
            },
        };
    }

    const rawGlobalFrom = body['from'] ?? 'llm-a';
    const globalFrom = typeof rawGlobalFrom === 'string' && ALLOWED_FROM.has(rawGlobalFrom) ? rawGlobalFrom : 'llm-a';
    /** @type {{ step: number; prompt: string; reply: string | null; durationMs: number }[]} */
    const results = [];

    for (let i = 0; i < steps.length; i++) {
        const rawStep = steps[i];
        if (!rawStep || typeof rawStep !== 'object') continue;
        const step = /** @type {Record<string, unknown>} */ (rawStep);
        const prompt = typeof step['prompt'] === 'string' ? step['prompt'] : '';
        if (!prompt) continue;
        const rawStepFrom = typeof step['from'] === 'string' ? step['from'] : globalFrom;
        const from = ALLOWED_FROM.has(rawStepFrom) ? rawStepFrom : globalFrom;
        const waitMs = typeof step['waitMs'] === 'number' ? step['waitMs'] : 0;
        const explicitTimeoutMs =
            typeof step['timeout'] === 'number' && Number.isFinite(step['timeout']) && step['timeout'] > 0
                ? step['timeout']
                : typeof body['timeout'] === 'number' && Number.isFinite(body['timeout']) && body['timeout'] > 0
                  ? body['timeout']
                  : undefined;
        const timeoutDecision = resolveInjectTimeout(runtimeId, explicitTimeoutMs);

        if (waitMs > 0) {
            const MAX_WAIT_MS = 30_000;
            await new Promise((r) => setTimeout(r, Math.min(waitMs, MAX_WAIT_MS)));
        }

        const t0 = Date.now();
        try {
            const reply = await sendRuntimeDialogTurn(
                prompt,
                from,
                {
                    timeout: timeoutDecision.timeoutMs,
                    traceId: `${createInjectTraceId()}-pipeline-step-${i + 1}`,
                },
                getAgent(runtimeId),
            );
            results.push({ step: i + 1, prompt, reply: reply ?? null, durationMs: Date.now() - t0 });

            if (reply === null) {
                return {
                    status: 409,
                    body: {
                        ok: false,
                        error: `Step ${i + 1} retornou null (erro interno na LLM-B) — pipeline interrompido`,
                        results,
                    },
                };
            }
        } catch (e) {
            const projection = projectAgentHttpError(e);
            return {
                status: projection.status,
                body: {
                    ...projection.body,
                    step: i + 1,
                    results,
                },
            };
        }
    }

    return { status: 200, body: { ok: true, results } };
}

/**
 * Injeta uma mensagem na LLM-B e aguarda resposta.
 *
 * @param {{
 *           runtimeId?: string;
 *           body?: {
 *               runtimeId?: string;
 *               message?: string;
 *               content?: string;
 *               from?: string;
 *               timeout?: number;
 *               context_files?: string[];
 *               attachments?: {
 *                   type?: string;
 *                   content?: string;
 *                   path?: string;
 *                   displayName?: string;
 *                   filePath?: string;
 *                   selection?: object;
 *                   text?: string;
 *               }[];
 *           };
 *           message?: string;
 *           content?: string;
 *           from?: string;
 *           timeout?: number;
 *           context_files?: string[];
 *           attachments?: {
 *               type?: string;
 *               content?: string;
 *               path?: string;
 *               displayName?: string;
 *               filePath?: string;
 *               selection?: object;
 *               text?: string;
 *           }[];
 *       }
 *     | null
 *     | undefined} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleInject(params = {}) {
    const body = resolveAgentControlInput(params);
    const runtimeId = resolveRuntimeIdParam(params);
    const traceId = createInjectTraceId();
    const rawMessage =
        typeof body['message'] === 'string'
            ? body['message']
            : typeof body['content'] === 'string'
              ? body['content']
              : '';
    const message = rawMessage.trim();
    if (!message) {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    const rawFrom = body['from'] ?? 'llm-a';
    const from = typeof rawFrom === 'string' && ALLOWED_FROM.has(rawFrom) ? rawFrom : 'llm-a';
    const explicitTimeoutMs =
        body['timeout'] === null
            ? 0
            : typeof body['timeout'] === 'number' && Number.isFinite(body['timeout']) && body['timeout'] >= 0
              ? body['timeout']
              : undefined;
    const timeoutDecision = resolveInjectTimeout(runtimeId, explicitTimeoutMs);
    const timeout = timeoutDecision.timeoutMs;
    const agent = getAgent(runtimeId);
    const agentSnapshot = readAgentStatusSnapshot(agent);
    const promptBinding =
        agentSnapshot['systemPromptBinding'] && typeof agentSnapshot['systemPromptBinding'] === 'object'
            ? /** @type {Record<string, unknown>} */ (agentSnapshot['systemPromptBinding'])
            : null;
    const promptFreshness =
        agentSnapshot['systemPromptFreshness'] && typeof agentSnapshot['systemPromptFreshness'] === 'object'
            ? /** @type {Record<string, unknown>} */ (agentSnapshot['systemPromptFreshness'])
            : null;
    log(
        'INFO',
        `[agent-control] /inject accepted (trace=${traceId}, runtime=${runtimeId ?? 'default'}, from=${from}, timeout=${timeout === null ? 'watchdog-only' : `${timeout}ms`}, strategy=${timeoutDecision.strategy}, reasons=${timeoutDecision.reasons.join('+')})`,
    );

    const injectStartedAt = Date.now();
    const preflightStartedAt = injectStartedAt;
    let contextEmbeddingDurationMs = 0;
    let attachmentEmbeddingDurationMs = 0;
    let enrichedMessage = message;
    const contextFiles = Array.isArray(body['context_files']) ? body['context_files'] : [];
    if (contextFiles.length > 0) {
        try {
            const contextStartedAt = Date.now();
            const ctxs = await Promise.all(contextFiles.map(readRuntimeFileContext));
            enrichedMessage = embedRuntimeMultiple(ctxs, message);
            contextEmbeddingDurationMs = Date.now() - contextStartedAt;
        } catch (embedErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar context_files: ${toError(embedErr).message}` },
            };
        }
    }

    const rawAttachments = Array.isArray(body['attachments']) ? body['attachments'] : [];
    if (rawAttachments.length > 0) {
        let embedParts;
        try {
            const attachmentsStartedAt = Date.now();
            embedParts = await Promise.all(rawAttachments.map(attachmentToRuntimeEmbed));
            attachmentEmbeddingDurationMs = Date.now() - attachmentsStartedAt;
        } catch (attErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar attachments: ${toError(attErr).message}` },
            };
        }
        const validParts = embedParts.filter(/** @type {(s: string | null) => s is string} */ (s) => s !== null);
        if (validParts.length > 0) {
            let totalBytes = 0;
            const limitedParts = [];
            for (const part of validParts) {
                const partBytes = Buffer.byteLength(part, 'utf8');
                if (totalBytes + partBytes > MAX_EMBED_BYTES) break;
                limitedParts.push(part);
                totalBytes += partBytes;
            }
            if (limitedParts.length > 0) {
                enrichedMessage = limitedParts.join('\n\n') + '\n\n' + enrichedMessage;
            }
        }
    }

    const t0 = Date.now();
    const preflightDurationMs = t0 - preflightStartedAt;
    const metrics = resolveMetricsStoreSafe();
    try {
        const { reply, diagnostics } = await sendRuntimeDialogTurnWithDiagnostics(
            enrichedMessage,
            from,
            { timeout, traceId },
            agent,
        );
        const durationMs = Date.now() - t0;
        const outcome = reply !== null ? 'completed' : 'null_reply';
        metrics?.recordInjectTurn?.(durationMs, reply !== null, reply !== null ? 'completed' : 'error');
        const injectDiagnostics = {
            preflightDurationMs,
            contextEmbeddingDurationMs,
            attachmentEmbeddingDurationMs,
            dialogDurationMs: durationMs,
            totalDurationMs: Date.now() - injectStartedAt,
            runtimeDialog: diagnostics,
        };
        recordRuntimeInjectHistory({
            ts: t0,
            traceId,
            from,
            message: message.slice(0, 200),
            replySnippet: reply ? reply.slice(0, 200) : null,
            durationMs,
            timeoutMs: timeout,
            timeoutStrategy: timeoutDecision.strategy,
            timeoutReasons: timeoutDecision.reasons,
            transportTimeoutMs: null,
            runtimeId: runtimeId ?? 'default',
            promptDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
            promptBindingDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
            promptIsStale: typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
            promptFreshnessReason: typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
            promptRecommendedAction:
                promptFreshness?.['recommendedAction'] === 'none' ||
                promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                promptFreshness?.['recommendedAction'] === 'resume-session'
                    ? promptFreshness['recommendedAction']
                    : null,
            diagnostics: injectDiagnostics,
            outcome,
            ok: reply !== null,
        });
        log(
            'INFO',
            `[agent-control] /inject resolved (trace=${traceId}, duration=${durationMs}ms, preflight=${preflightDurationMs}ms, autoStart=${diagnostics.autoStarted}, recovery=${diagnostics.recoveredInputChannel}, ok=${reply !== null})`,
        );
        return {
            status: reply !== null ? 200 : 409,
            body: {
                ok: reply !== null,
                reply: reply ?? null,
                durationMs,
                from,
                traceId,
                timeoutMs: timeout,
                timeoutStrategy: timeoutDecision.strategy,
                timeoutReasons: timeoutDecision.reasons,
                promptDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                promptFreshness: promptFreshness,
                diagnostics: injectDiagnostics,
            },
        };
    } catch (e) {
        const projection = projectAgentHttpError(e);
        const durationMs = Date.now() - t0;
        const runtimeDialogDiagnostics =
            e &&
            typeof e === 'object' &&
            'injectDiagnostics' in e &&
            e['injectDiagnostics'] &&
            typeof e['injectDiagnostics'] === 'object'
                ? /** @type {Record<string, unknown>} */ (e['injectDiagnostics'])
                : null;
        const injectDiagnostics = {
            preflightDurationMs,
            contextEmbeddingDurationMs,
            attachmentEmbeddingDurationMs,
            dialogDurationMs: durationMs,
            totalDurationMs: Date.now() - injectStartedAt,
            runtimeDialog: runtimeDialogDiagnostics,
        };
        const isTimeout = String(projection.body?.code ?? '') === 'DIALOG_TIMEOUT' || projection.status === 504;
        metrics?.recordInjectTurn?.(durationMs, false, isTimeout ? 'timeout' : 'error');
        recordRuntimeInjectHistory({
            ts: t0,
            traceId,
            from,
            message: message.slice(0, 200),
            replySnippet: null,
            durationMs,
            timeoutMs: timeout,
            timeoutStrategy: timeoutDecision.strategy,
            timeoutReasons: timeoutDecision.reasons,
            transportTimeoutMs: null,
            runtimeId: runtimeId ?? 'default',
            promptDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
            promptBindingDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
            promptIsStale: typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
            promptFreshnessReason: typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
            promptRecommendedAction:
                promptFreshness?.['recommendedAction'] === 'none' ||
                promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                promptFreshness?.['recommendedAction'] === 'resume-session'
                    ? promptFreshness['recommendedAction']
                    : null,
            diagnostics: injectDiagnostics,
            outcome: isTimeout ? 'timeout' : 'error',
            ok: false,
        });
        log(
            'WARN',
            `[agent-control] /inject failed (trace=${traceId}, duration=${durationMs}ms, preflight=${preflightDurationMs}ms, code=${String(projection.body?.code ?? 'unknown')})`,
        );
        return {
            ...projection,
            body:
                projection.body && typeof projection.body === 'object'
                    ? {
                          ...projection.body,
                          traceId,
                          timeoutMs: timeout,
                          timeoutStrategy: timeoutDecision.strategy,
                          timeoutReasons: timeoutDecision.reasons,
                          promptDigest: typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                          promptFreshness: promptFreshness,
                          diagnostics: injectDiagnostics,
                      }
                    : projection.body,
        };
    }
}

/**
 * Handler para POST /dialog/pause.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogPause(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const controlState = readAgentRuntimeControlState(runtimeId);
    if (!controlState.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop não está ativo.' } };
    }
    if (controlState.dialogPaused) {
        return { status: 409, body: { ok: false, error: 'Dialog loop já está pausado.' } };
    }
    try {
        await pauseAgentDialogLoop(runtimeId);
        return {
            status: 200,
            body: { ok: true, message: 'Dialog loop pausado. Use POST /dialog/resume para retomar.' },
        };
    } catch (e) {
        return projectAgentHttpError(e);
    }
}

/**
 * Handler para POST /dialog/resume.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogResume(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const controlState = readAgentRuntimeControlState(runtimeId);
    if (!controlState.dialogPaused && controlState.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop já está ativo.' } };
    }
    if (!controlState.dialogPaused && !controlState.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop não está pausado.' } };
    }
    try {
        await resumeAgentDialogLoop(runtimeId);
        return { status: 200, body: { ok: true, message: 'Dialog loop retomado.' } };
    } catch (e) {
        return projectAgentHttpError(e);
    }
}

/**
 * GET /handoff — lista handoffs pendentes e histórico.
 *
 * @returns {HandlerResult}
 */
export function handleGetHandoffs(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    return {
        status: 200,
        body: {
            ok: true,
            pending: handoffMgr.getPending(),
            history: handoffMgr.getHistory(),
        },
    };
}

/**
 * POST /handoff/:id/accept — aceita um handoff pendente.
 *
 * @param {{ runtimeId?: string; handoffId?: string } | null | undefined} params
 * @returns {HandlerResult}
 */
export function handleAcceptHandoff(params) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    const id = params?.handoffId;
    if (!id) {
        return { status: 400, body: { ok: false, error: 'handoffId é obrigatório.' } };
    }
    const result = handoffMgr.accept(id);
    return { status: result.accepted ? 200 : 404, body: { ok: result.accepted, ...result } };
}

/**
 * POST /handoff/:id/reject — rejeita um handoff pendente.
 *
 * @param {{ runtimeId?: string; handoffId?: string } | null | undefined} params
 * @param {{ reason?: string }} [body]
 * @returns {HandlerResult}
 */
export function handleRejectHandoff(params, body) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    const id = params?.handoffId;
    if (!id) {
        return { status: 400, body: { ok: false, error: 'handoffId é obrigatório.' } };
    }
    const result = handoffMgr.reject(id, body?.reason);
    return { status: 200, body: { ok: true, ...result } };
}
