// @ts-check
/**
 * @module copilot/presentation/agent-control
 * @file Superfície compartilhada de controle do agente consumida por `server` e `terminal`.
 *
 *   Esta camada concentra os handlers de context, inject, pipeline, dialog control e handoff, preservando o terminal como
 *   interface operacional da LLM-B, mas removendo a dependência direta de `server/` em `terminal/handlers/agent.js`.
 */

import { getInjectInterventionPolicy } from '#copilot/config';
import { container, toError } from '#copilot/core';
import { log, METRICS_STORE } from '#copilot/observability';
import { resolveOptionalDialogTimeout } from '../../dialog-timeout-policy.js';
import { readRuntimeIdFromParams } from '../../routing/index.js';
import {
    abortAgentRuntimeCurrentMessage,
    answerAgentPendingQuestion,
    attachmentToRuntimeEmbed,
    embedRuntimeMultiple,
    getAgentHandoffManager,
    getAgentRuntimeControlsTarget,
    MAX_EMBED_BYTES,
    pauseAgentDialogLoop,
    readAgentRuntimeControlState,
    readAgentRuntimeOverview,
    readAgentRuntimeOverviewProjection,
    readAgentStatusSnapshot,
    readRuntimeFileContext,
    resumeAgentDialogLoop,
    sendRuntimeDialogTurn,
    sendRuntimeDialogTurnWithDiagnostics,
    steerAgentRuntimeMessage,
} from '../../runtime/index.js';
import {
    enqueueRuntimeIntervention,
    readRuntimeInterventionSummary,
    recordRuntimeInjectHistory,
} from '../../state/index.js';
import { projectAgentHttpError } from '../http-errors.js';

/**
 * @typedef {import('../../contracts/index.js').HandlerResult} HandlerResult
 */

/**
 * Valores válidos para o campo `from` nos endpoints /inject e /pipeline.
 *
 * @type {ReadonlySet<string>}
 */
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);

/**
 * `/inject` expõe nomes legados e nomes novos, mas eles são separados por risco de PR:
 *
 * - mailbox aliases: nunca chamam `session.send()`; aguardam `ask_user(kind=question)`;
 * - turn aliases: chamam o dialog loop canônico e podem consumir PR;
 * - sdk-immediate aliases: chamam `session.send({ mode: 'immediate' })` apenas quando a política permite.
 *
 * O modo interno `queue` abaixo é legado do handler e significa "turno do dialog loop". No contrato externo, `queue`
 * significa mailbox zero-PR.
 *
 * @typedef {'queue' | 'intervene' | 'steer' | 'interrupt' | 'abort'} InjectInternalMode
 *
 * @typedef {'queue' | 'intervene' | 'steer'} InjectTextDirectiveMode
 */

/** @type {ReadonlySet<string>} */
const ZERO_PR_MAILBOX_MODE_ALIASES = new Set(['queue', 'mailbox', 'defer', 'deferred']);

/** @type {ReadonlySet<string>} */
const EXPLICIT_TURN_MODE_ALIASES = new Set(['turn', 'dialog']);

/** @type {ReadonlySet<string>} */
const SDK_IMMEDIATE_MODE_ALIASES = new Set(['steer', 'immediate']);

/** @type {ReadonlySet<string>} */
const INTERRUPT_MODE_ALIASES = new Set(['interrupt', 'abort-and-queue', 'abort_and_queue']);

/** @type {ReadonlySet<string>} */
const INJECT_MODE_ALIASES = new Set([
    ...ZERO_PR_MAILBOX_MODE_ALIASES,
    ...EXPLICIT_TURN_MODE_ALIASES,
    ...SDK_IMMEDIATE_MODE_ALIASES,
    ...INTERRUPT_MODE_ALIASES,
    'auto',
    'intervene',
    'abort',
]);

/** @type {Map<string, Promise<void>>} */
const _injectInterventionQueues = new Map();

/**
 * @param {string} message
 * @returns {{ mode: InjectTextDirectiveMode | null; strippedMessage: string }}
 */
function parseInjectTextModeDirective(message) {
    const trimmed = message.trim();
    const bangDirective = trimmed.match(/^!!([a-z_-]+)(?::|\s+)([\s\S]*)$/i);
    if (bangDirective && typeof bangDirective[1] === 'string') {
        const token = bangDirective[1].toLowerCase();
        const mode =
            token === 'immediate' || token === 'imediato' || token === 'steer'
                ? 'steer'
                : token === 'turn' || token === 'dialog'
                  ? 'queue'
                  : token === 'queue' || token === 'fila' || token === 'mailbox' || token === 'intervene'
                    ? 'intervene'
                    : null;
        if (mode !== null) {
            return {
                mode,
                strippedMessage: String(bangDirective[2] ?? '').trim(),
            };
        }
    }
    const bracket = trimmed.match(/^\[(queue|fila|mailbox|turn|dialog|immediate|imediato|intervene|steer)\](?::|\s*)/i);
    if (bracket && typeof bracket[1] === 'string') {
        const token = bracket[1].toLowerCase();
        const mode =
            token === 'turn' || token === 'dialog'
                ? 'queue'
                : token === 'immediate' || token === 'imediato' || token === 'steer'
                  ? 'steer'
                  : 'intervene';
        return {
            mode,
            strippedMessage: trimmed.slice(bracket[0].length).trim(),
        };
    }
    return { mode: null, strippedMessage: trimmed };
}

/**
 * Preserva conteúdo quando um cliente já enviou `mode` explícito e o texto começa com uma diretiva conflitante.
 *
 * Ex.: `{ mode: 'turn', message: '!!queue literal' }` deve abrir turno com o texto literal, não apagar `!!queue`.
 *
 * @param {InjectInternalMode} internalMode
 * @param {{ mode: InjectTextDirectiveMode | null; strippedMessage: string }} parsedText
 * @param {string} originalMessage
 * @returns {string}
 */
function resolveExplicitModeMessage(internalMode, parsedText, originalMessage) {
    return parsedText.mode === internalMode ? parsedText.strippedMessage : originalMessage.trim();
}

/**
 * @param {unknown} rawMode
 * @param {string} message
 * @returns {{ mode: InjectInternalMode; message: string }}
 */
function resolveInjectMode(rawMode, message) {
    const policy = getInjectInterventionPolicy();
    const parsedText = policy.allowTextModeDirectives
        ? parseInjectTextModeDirective(message)
        : { mode: null, strippedMessage: message.trim() };

    /** @type {InjectTextDirectiveMode} */
    const fallbackMode =
        policy.userDefaultMode === 'intervene'
            ? 'intervene'
            : policy.userDefaultSteer && policy.allowSteer
              ? 'steer'
              : 'queue';

    if (typeof rawMode !== 'string') {
        return {
            mode: parsedText.mode ?? fallbackMode,
            message: parsedText.strippedMessage,
        };
    }

    const normalized = rawMode.trim().toLowerCase();
    if (!INJECT_MODE_ALIASES.has(normalized)) {
        return {
            mode: parsedText.mode ?? fallbackMode,
            message: parsedText.strippedMessage,
        };
    }

    if (normalized === 'auto') {
        return {
            mode: parsedText.mode ?? fallbackMode,
            message: parsedText.strippedMessage,
        };
    }

    if (ZERO_PR_MAILBOX_MODE_ALIASES.has(normalized)) {
        return {
            mode: 'intervene',
            message: resolveExplicitModeMessage('intervene', parsedText, message),
        };
    }
    if (EXPLICIT_TURN_MODE_ALIASES.has(normalized)) {
        return { mode: 'queue', message: resolveExplicitModeMessage('queue', parsedText, message) };
    }
    if (normalized === 'intervene') {
        return { mode: 'intervene', message: resolveExplicitModeMessage('intervene', parsedText, message) };
    }
    if (SDK_IMMEDIATE_MODE_ALIASES.has(normalized)) {
        return { mode: 'steer', message: resolveExplicitModeMessage('steer', parsedText, message) };
    }
    if (INTERRUPT_MODE_ALIASES.has(normalized)) {
        return { mode: 'interrupt', message: resolveExplicitModeMessage('interrupt', parsedText, message) };
    }
    if (normalized === 'abort') {
        return { mode: 'abort', message: resolveExplicitModeMessage('abort', parsedText, message) };
    }
    return {
        mode: fallbackMode,
        message: parsedText.strippedMessage,
    };
}

/**
 * @param {string} from
 * @returns {'llm-a' | 'user' | 'system' | 'inject'}
 */
function resolveMailboxSource(from) {
    if (from === 'llm-a' || from === 'llm_a') return 'llm-a';
    if (from === 'user') return 'user';
    if (from === 'system') return 'system';
    return 'inject';
}

/**
 * Serializa sequências curtas de intervenção por runtime para evitar interleaving entre `abort` e envio substituto.
 *
 * @template T
 * @param {string | null | undefined} runtimeId
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function runInjectInterventionSequence(runtimeId, operation) {
    const key = runtimeId ?? 'default';
    const previous = _injectInterventionQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const guard = next.then(
        () => {},
        () => {},
    );
    _injectInterventionQueues.set(key, guard);
    try {
        return await next;
    } finally {
        if (_injectInterventionQueues.get(key) === guard) {
            _injectInterventionQueues.delete(key);
        }
    }
}

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
        defaultTimeoutMs: 0,
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
 * Tenta aplicar intervenção imediatamente sem PR quando já existe `ask_user` pendente do tipo pergunta humana.
 *
 * @param {string | null | undefined} runtimeId
 * @param {string} message
 * @returns {{
 *     applied: boolean;
 *     pendingQuestionKind: import('../../contracts/index.js').RuntimePendingQuestionKind | null;
 * }}
 */
function tryApplyImmediateZeroPrIntervention(runtimeId, message) {
    const interaction = readAgentRuntimeOverviewProjection(runtimeId);
    const pendingQuestion = interaction.pendingQuestion;
    const pendingQuestionKind = interaction.pendingQuestionKind;
    const protocolControlled = Boolean(
        pendingQuestion &&
        (pendingQuestion.protocolControlled === true ||
            (pendingQuestionKind !== null && pendingQuestionKind !== 'question')),
    );
    if (!pendingQuestion || protocolControlled) {
        return { applied: false, pendingQuestionKind };
    }
    const applied = answerAgentPendingQuestion(message, runtimeId);
    return { applied, pendingQuestionKind };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../../../agent/always-alive.js').AlwaysAliveAgent}
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
            await new Promise((r) => setTimeout(r, waitMs));
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
 *               mode?:
 *                   | 'queue'
 *                   | 'mailbox'
 *                   | 'defer'
 *                   | 'deferred'
 *                   | 'turn'
 *                   | 'dialog'
 *                   | 'auto'
 *                   | 'steer'
 *                   | 'immediate'
 *                   | 'intervene'
 *                   | 'interrupt'
 *                   | 'abort'
 *                   | 'abort-and-queue'
 *                   | 'abort_and_queue';
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
 *           mode?:
 *               | 'queue'
 *               | 'mailbox'
 *               | 'defer'
 *               | 'deferred'
 *               | 'turn'
 *               | 'dialog'
 *               | 'auto'
 *               | 'steer'
 *               | 'immediate'
 *               | 'intervene'
 *               | 'interrupt'
 *               | 'abort'
 *               | 'abort-and-queue'
 *               | 'abort_and_queue';
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
    const rawFrom = body['from'] ?? 'llm-a';
    const from = typeof rawFrom === 'string' && ALLOWED_FROM.has(rawFrom) ? rawFrom : 'llm-a';
    const zeroPrInterventionSource = from === 'user' || from === 'llm-a' || from === 'llm_a' || from === 'system';
    const rawMessage =
        typeof body['message'] === 'string'
            ? body['message']
            : typeof body['content'] === 'string'
              ? body['content']
              : '';
    const resolvedInject = resolveInjectMode(body['mode'] ?? body['delivery'] ?? body['strategy'], rawMessage);
    const injectMode = resolvedInject.mode;
    const message = resolvedInject.message;
    if (!message && injectMode !== 'abort') {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    const explicitTimeoutMs =
        body['timeout'] === null
            ? 0
            : typeof body['timeout'] === 'number' && Number.isFinite(body['timeout']) && body['timeout'] >= 0
              ? body['timeout']
              : undefined;
    const timeoutDecision = resolveInjectTimeout(runtimeId, explicitTimeoutMs);
    const injectInterventionPolicy = getInjectInterventionPolicy();
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
        `[agent-control] /inject accepted (trace=${traceId}, runtime=${runtimeId ?? 'default'}, from=${from}, mode=${injectMode}, timeout=${timeout === null ? 'watchdog-only' : `${timeout}ms`}, strategy=${timeoutDecision.strategy}, reasons=${timeoutDecision.reasons.join('+')})`,
    );

    const injectStartedAt = Date.now();
    const preflightStartedAt = injectStartedAt;
    let contextEmbeddingDurationMs = 0;
    let attachmentEmbeddingDurationMs = 0;
    let enrichedMessage = message;
    const contextFiles = Array.isArray(body['context_files']) ? body['context_files'] : [];
    if (injectMode !== 'abort' && contextFiles.length > 0) {
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
    if (injectMode !== 'abort' && rawAttachments.length > 0) {
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
        if (injectMode === 'intervene') {
            return await runInjectInterventionSequence(runtimeId, async () => {
                const immediate = tryApplyImmediateZeroPrIntervention(runtimeId, enrichedMessage);
                if (immediate.applied) {
                    const durationMs = Date.now() - t0;
                    const injectDiagnostics = {
                        preflightDurationMs,
                        contextEmbeddingDurationMs,
                        attachmentEmbeddingDurationMs,
                        dialogDurationMs: 0,
                        totalDurationMs: Date.now() - injectStartedAt,
                        mode: 'intervene_immediate',
                        runtimeDialog: null,
                    };
                    metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                    metrics?.recordCounter?.('zero_pr.intervene.immediate_answer');
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
                        promptBindingDigest:
                            typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                        promptIsStale:
                            typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                        promptFreshnessReason:
                            typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                        promptRecommendedAction:
                            promptFreshness?.['recommendedAction'] === 'none' ||
                            promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                            promptFreshness?.['recommendedAction'] === 'resume-session'
                                ? promptFreshness['recommendedAction']
                                : null,
                        diagnostics: injectDiagnostics,
                        outcome: 'completed',
                        ok: true,
                    });
                    return {
                        status: 202,
                        body: {
                            ok: true,
                            code: 'ZERO_PR_ANSWER_IMMEDIATE',
                            mode: 'answer',
                            deferred: false,
                            note: 'Intervenção imediata aplicada no ask_user pendente sem abrir novo PR.',
                            reply: null,
                            durationMs,
                            from,
                            traceId,
                            timeoutMs: timeout,
                            timeoutStrategy: timeoutDecision.strategy,
                            timeoutReasons: timeoutDecision.reasons,
                            promptDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptFreshness: promptFreshness,
                            diagnostics: injectDiagnostics,
                        },
                    };
                }

                const deferred = enqueueRuntimeIntervention({
                    runtimeId,
                    source: resolveMailboxSource(from),
                    modeHint: 'queue',
                    message: enrichedMessage,
                });
                const mailbox = readRuntimeInterventionSummary(runtimeId);
                const durationMs = Date.now() - t0;
                const injectDiagnostics = {
                    preflightDurationMs,
                    contextEmbeddingDurationMs,
                    attachmentEmbeddingDurationMs,
                    dialogDurationMs: 0,
                    totalDurationMs: Date.now() - injectStartedAt,
                    mode: 'mailbox_queue',
                    runtimeDialog: null,
                };
                metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                metrics?.recordCounter?.('zero_pr.intervene.deferred_mailbox');
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
                    promptIsStale:
                        typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                    promptFreshnessReason:
                        typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                    promptRecommendedAction:
                        promptFreshness?.['recommendedAction'] === 'none' ||
                        promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                        promptFreshness?.['recommendedAction'] === 'resume-session'
                            ? promptFreshness['recommendedAction']
                            : null,
                    diagnostics: injectDiagnostics,
                    outcome: 'completed',
                    ok: true,
                });
                return {
                    status: 202,
                    body: {
                        ok: true,
                        code: 'ZERO_PR_MAILBOX_QUEUED',
                        mode: 'mailbox_queue',
                        deferred: true,
                        mailbox: {
                            queueSize: mailbox.queueSize,
                            dropped: mailbox.dropped,
                            merged: deferred.merged,
                        },
                        note: 'Mensagem registrada na fila mailbox zero-PR para aplicação na próxima ask_user.',
                        reply: null,
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
            });
        }

        if (injectMode === 'steer') {
            return await runInjectInterventionSequence(runtimeId, async () => {
                if (zeroPrInterventionSource && !injectInterventionPolicy.allowSteer) {
                    const interaction = readAgentRuntimeOverviewProjection(runtimeId);
                    const pendingQuestion = interaction.pendingQuestion;
                    const pendingKind = interaction.pendingQuestionKind;
                    let answerAttemptFailed = false;
                    const protocolControlled = Boolean(
                        pendingQuestion &&
                        (pendingQuestion.protocolControlled === true ||
                            (pendingKind !== null && pendingKind !== 'question')),
                    );
                    if (pendingQuestion && !protocolControlled) {
                        const answered = answerAgentPendingQuestion(enrichedMessage, runtimeId);
                        const durationMs = Date.now() - t0;
                        const injectDiagnostics = {
                            preflightDurationMs,
                            contextEmbeddingDurationMs,
                            attachmentEmbeddingDurationMs,
                            dialogDurationMs: 0,
                            totalDurationMs: Date.now() - injectStartedAt,
                            mode: 'answer',
                            sdkMessageId: null,
                            runtimeDialog: null,
                        };
                        if (!answered) {
                            answerAttemptFailed = true;
                            metrics?.recordCounter?.('zero_pr.steer.answer_failed_requeued');
                            log(
                                'WARN',
                                `[agent-control] /inject zero-pr answer failed; preserving in mailbox (trace=${traceId}, runtime=${runtimeId ?? 'default'})`,
                            );
                        } else {
                            metrics?.recordInjectTurn?.(durationMs, true, 'completed');
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
                                promptDigest:
                                    typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                promptBindingDigest:
                                    typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                promptIsStale:
                                    typeof promptFreshness?.['isStale'] === 'boolean'
                                        ? promptFreshness['isStale']
                                        : null,
                                promptFreshnessReason:
                                    typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                                promptRecommendedAction:
                                    promptFreshness?.['recommendedAction'] === 'none' ||
                                    promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                                    promptFreshness?.['recommendedAction'] === 'resume-session'
                                        ? promptFreshness['recommendedAction']
                                        : null,
                                diagnostics: injectDiagnostics,
                                outcome: 'completed',
                                ok: true,
                            });
                            return {
                                status: 202,
                                body: {
                                    ok: true,
                                    mode: 'answer',
                                    reply: null,
                                    durationMs,
                                    from,
                                    traceId,
                                    timeoutMs: timeout,
                                    timeoutStrategy: timeoutDecision.strategy,
                                    timeoutReasons: timeoutDecision.reasons,
                                    promptDigest:
                                        typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                    promptFreshness: promptFreshness,
                                    diagnostics: injectDiagnostics,
                                },
                            };
                        }
                    }

                    const immediate = answerAttemptFailed
                        ? { applied: false, pendingQuestionKind: pendingKind }
                        : tryApplyImmediateZeroPrIntervention(runtimeId, enrichedMessage);
                    if (immediate.applied) {
                        const durationMs = Date.now() - t0;
                        const injectDiagnostics = {
                            preflightDurationMs,
                            contextEmbeddingDurationMs,
                            attachmentEmbeddingDurationMs,
                            dialogDurationMs: 0,
                            totalDurationMs: Date.now() - injectStartedAt,
                            mode: 'answer_immediate',
                            sdkMessageId: null,
                            runtimeDialog: null,
                        };
                        metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                        metrics?.recordCounter?.('zero_pr.steer.immediate_answer');
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
                            promptDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptBindingDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptIsStale:
                                typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                            promptFreshnessReason:
                                typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                            promptRecommendedAction:
                                promptFreshness?.['recommendedAction'] === 'none' ||
                                promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                                promptFreshness?.['recommendedAction'] === 'resume-session'
                                    ? promptFreshness['recommendedAction']
                                    : null,
                            diagnostics: injectDiagnostics,
                            outcome: 'completed',
                            ok: true,
                        });
                        return {
                            status: 202,
                            body: {
                                ok: true,
                                code: 'ZERO_PR_ANSWER_IMMEDIATE',
                                mode: 'answer',
                                deferred: false,
                                note: 'Steer bloqueado por política zero-PR; resposta aplicada imediatamente no ask_user pendente.',
                                reply: null,
                                durationMs,
                                from,
                                traceId,
                                timeoutMs: timeout,
                                timeoutStrategy: timeoutDecision.strategy,
                                timeoutReasons: timeoutDecision.reasons,
                                promptDigest:
                                    typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                promptFreshness: promptFreshness,
                                diagnostics: injectDiagnostics,
                            },
                        };
                    }
                    const durationMs = Date.now() - t0;
                    const injectDiagnostics = {
                        preflightDurationMs,
                        contextEmbeddingDurationMs,
                        attachmentEmbeddingDurationMs,
                        dialogDurationMs: 0,
                        totalDurationMs: Date.now() - injectStartedAt,
                        mode: 'steer_blocked',
                        sdkMessageId: null,
                        runtimeDialog: null,
                    };
                    const deferred = enqueueRuntimeIntervention({
                        runtimeId,
                        source: resolveMailboxSource(from),
                        modeHint: 'steer',
                        message: enrichedMessage,
                    });
                    const mailbox = readRuntimeInterventionSummary(runtimeId);
                    metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                    metrics?.recordCounter?.('zero_pr.steer.deferred_mailbox');
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
                        promptBindingDigest:
                            typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                        promptIsStale:
                            typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                        promptFreshnessReason:
                            typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                        promptRecommendedAction:
                            promptFreshness?.['recommendedAction'] === 'none' ||
                            promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                            promptFreshness?.['recommendedAction'] === 'resume-session'
                                ? promptFreshness['recommendedAction']
                                : null,
                        diagnostics: injectDiagnostics,
                        outcome: 'completed',
                        ok: true,
                    });
                    return {
                        status: 202,
                        body: {
                            ok: true,
                            code: 'ZERO_PR_DEFERRED_MAILBOX',
                            mode: 'deferred_mailbox',
                            deferred: true,
                            mailbox: {
                                queueSize: mailbox.queueSize,
                                dropped: mailbox.dropped,
                                merged: deferred.merged,
                            },
                            note: 'Steer bloqueado por política zero-PR; intervenção registrada para próxima ask_user.',
                            reply: null,
                            durationMs,
                            from,
                            traceId,
                            timeoutMs: timeout,
                            timeoutStrategy: timeoutDecision.strategy,
                            timeoutReasons: timeoutDecision.reasons,
                            promptDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptFreshness: promptFreshness,
                            diagnostics: injectDiagnostics,
                        },
                    };
                }

                /** @type {string | undefined} */
                let messageId;
                try {
                    messageId = await steerAgentRuntimeMessage(enrichedMessage, runtimeId);
                } catch (e) {
                    if (zeroPrInterventionSource && !injectInterventionPolicy.allowQueueFallback) {
                        const immediate = tryApplyImmediateZeroPrIntervention(runtimeId, enrichedMessage);
                        if (immediate.applied) {
                            const durationMs = Date.now() - t0;
                            const injectDiagnostics = {
                                preflightDurationMs,
                                contextEmbeddingDurationMs,
                                attachmentEmbeddingDurationMs,
                                dialogDurationMs: 0,
                                totalDurationMs: Date.now() - injectStartedAt,
                                mode: 'answer_immediate',
                                sdkMessageId: null,
                                runtimeDialog: null,
                            };
                            metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                            metrics?.recordCounter?.('zero_pr.no_active_turn.immediate_answer');
                            return {
                                status: 202,
                                body: {
                                    ok: true,
                                    code: 'ZERO_PR_ANSWER_IMMEDIATE',
                                    mode: 'answer',
                                    deferred: false,
                                    note: 'Sem turno ativo para steer; resposta aplicada imediatamente no ask_user pendente.',
                                    reply: null,
                                    durationMs,
                                    from,
                                    traceId,
                                    timeoutMs: timeout,
                                    timeoutStrategy: timeoutDecision.strategy,
                                    timeoutReasons: timeoutDecision.reasons,
                                    promptDigest:
                                        typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                    promptFreshness: promptFreshness,
                                    diagnostics: injectDiagnostics,
                                },
                            };
                        }
                        const durationMs = Date.now() - t0;
                        const injectDiagnostics = {
                            preflightDurationMs,
                            contextEmbeddingDurationMs,
                            attachmentEmbeddingDurationMs,
                            dialogDurationMs: 0,
                            totalDurationMs: Date.now() - injectStartedAt,
                            mode: injectMode,
                            sdkMessageId: null,
                            runtimeDialog: null,
                        };
                        const deferred = enqueueRuntimeIntervention({
                            runtimeId,
                            source: resolveMailboxSource(from),
                            modeHint: 'steer',
                            message: enrichedMessage,
                        });
                        const mailbox = readRuntimeInterventionSummary(runtimeId);
                        metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                        metrics?.recordCounter?.('zero_pr.no_active_turn.deferred_mailbox');
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
                            promptDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptBindingDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptIsStale:
                                typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                            promptFreshnessReason:
                                typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                            promptRecommendedAction:
                                promptFreshness?.['recommendedAction'] === 'none' ||
                                promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                                promptFreshness?.['recommendedAction'] === 'resume-session'
                                    ? promptFreshness['recommendedAction']
                                    : null,
                            diagnostics: injectDiagnostics,
                            outcome: 'completed',
                            ok: true,
                        });
                        return {
                            status: 202,
                            body: {
                                ok: true,
                                code: 'ZERO_PR_DEFERRED_MAILBOX',
                                mode: 'deferred_mailbox',
                                deferred: true,
                                mailbox: {
                                    queueSize: mailbox.queueSize,
                                    dropped: mailbox.dropped,
                                    merged: deferred.merged,
                                },
                                note: 'Sem turno ativo para steer; intervenção registrada no mailbox para próxima ask_user.',
                                reply: null,
                                durationMs,
                                from,
                                traceId,
                                timeoutMs: timeout,
                                timeoutStrategy: timeoutDecision.strategy,
                                timeoutReasons: timeoutDecision.reasons,
                                promptDigest:
                                    typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                promptFreshness: promptFreshness,
                                diagnostics: injectDiagnostics,
                            },
                        };
                    }
                    throw e;
                }
                const durationMs = Date.now() - t0;
                const injectDiagnostics = {
                    preflightDurationMs,
                    contextEmbeddingDurationMs,
                    attachmentEmbeddingDurationMs,
                    dialogDurationMs: 0,
                    totalDurationMs: Date.now() - injectStartedAt,
                    mode: injectMode,
                    sdkMessageId: messageId,
                    runtimeDialog: null,
                };
                metrics?.recordInjectTurn?.(durationMs, true, 'completed');
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
                    promptIsStale:
                        typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                    promptFreshnessReason:
                        typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                    promptRecommendedAction:
                        promptFreshness?.['recommendedAction'] === 'none' ||
                        promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                        promptFreshness?.['recommendedAction'] === 'resume-session'
                            ? promptFreshness['recommendedAction']
                            : null,
                    diagnostics: injectDiagnostics,
                    outcome: 'steered',
                    ok: true,
                });
                log(
                    'INFO',
                    `[agent-control] /inject steered current turn (trace=${traceId}, duration=${durationMs}ms, messageId=${messageId || '-'})`,
                );
                return {
                    status: 202,
                    body: {
                        ok: true,
                        mode: injectMode,
                        messageId,
                        reply: null,
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
            });
        }

        if (injectMode === 'abort') {
            return await runInjectInterventionSequence(runtimeId, async () => {
                const abortStartedAt = Date.now();
                await abortAgentRuntimeCurrentMessage(runtimeId);
                const abortDurationMs = Date.now() - abortStartedAt;
                const durationMs = Date.now() - t0;
                const injectDiagnostics = {
                    preflightDurationMs,
                    contextEmbeddingDurationMs,
                    attachmentEmbeddingDurationMs,
                    dialogDurationMs: 0,
                    totalDurationMs: Date.now() - injectStartedAt,
                    mode: injectMode,
                    abortDurationMs,
                    runtimeDialog: null,
                };
                metrics?.recordInjectTurn?.(durationMs, true, 'completed');
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
                    promptIsStale:
                        typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                    promptFreshnessReason:
                        typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                    promptRecommendedAction:
                        promptFreshness?.['recommendedAction'] === 'none' ||
                        promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                        promptFreshness?.['recommendedAction'] === 'resume-session'
                            ? promptFreshness['recommendedAction']
                            : null,
                    diagnostics: injectDiagnostics,
                    outcome: 'interrupted',
                    ok: true,
                });
                log(
                    'INFO',
                    `[agent-control] /inject aborted current turn (trace=${traceId}, abort=${abortDurationMs}ms, duration=${durationMs}ms)`,
                );
                return {
                    status: 202,
                    body: {
                        ok: true,
                        mode: injectMode,
                        reply: null,
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
            });
        }

        /**
         * @param {number} abortDurationMs
         * @returns {Promise<HandlerResult>}
         */
        const executeQueuedInjectTurn = async (abortDurationMs = 0) => {
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
                mode: injectMode,
                abortDurationMs,
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
                promptFreshnessReason:
                    typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
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
                `[agent-control] /inject resolved (trace=${traceId}, mode=${injectMode}, duration=${durationMs}ms, preflight=${preflightDurationMs}ms, autoStart=${diagnostics.autoStarted}, recovery=${diagnostics.recoveredInputChannel}, ok=${reply !== null})`,
            );
            return {
                status: reply !== null ? 200 : 409,
                body: {
                    ok: reply !== null,
                    mode: injectMode,
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
        };

        if (injectMode === 'interrupt') {
            if (zeroPrInterventionSource && !injectInterventionPolicy.allowQueueFallback) {
                return await runInjectInterventionSequence(runtimeId, async () => {
                    const immediate = tryApplyImmediateZeroPrIntervention(runtimeId, enrichedMessage);
                    if (immediate.applied) {
                        const durationMs = Date.now() - t0;
                        const injectDiagnostics = {
                            preflightDurationMs,
                            contextEmbeddingDurationMs,
                            attachmentEmbeddingDurationMs,
                            dialogDurationMs: 0,
                            totalDurationMs: Date.now() - injectStartedAt,
                            mode: 'answer_immediate',
                            abortDurationMs: 0,
                            runtimeDialog: null,
                        };
                        metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                        metrics?.recordCounter?.('zero_pr.interrupt.immediate_answer');
                        return {
                            status: 202,
                            body: {
                                ok: true,
                                code: 'ZERO_PR_ANSWER_IMMEDIATE',
                                mode: 'answer',
                                deferred: false,
                                note: 'Intervenção aplicada imediatamente no ask_user pendente sem abort/queue.',
                                reply: null,
                                durationMs,
                                from,
                                traceId,
                                timeoutMs: timeout,
                                timeoutStrategy: timeoutDecision.strategy,
                                timeoutReasons: timeoutDecision.reasons,
                                promptDigest:
                                    typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                                promptFreshness: promptFreshness,
                                diagnostics: injectDiagnostics,
                            },
                        };
                    }
                    const abortStartedAt = Date.now();
                    await abortAgentRuntimeCurrentMessage(runtimeId);
                    const abortDurationMs = Date.now() - abortStartedAt;
                    const deferred = enqueueRuntimeIntervention({
                        runtimeId,
                        source: resolveMailboxSource(from),
                        modeHint: 'interrupt',
                        message: enrichedMessage,
                    });
                    const mailbox = readRuntimeInterventionSummary(runtimeId);
                    const durationMs = Date.now() - t0;
                    const injectDiagnostics = {
                        preflightDurationMs,
                        contextEmbeddingDurationMs,
                        attachmentEmbeddingDurationMs,
                        dialogDurationMs: 0,
                        totalDurationMs: Date.now() - injectStartedAt,
                        mode: 'interrupt_deferred_mailbox',
                        abortDurationMs,
                        runtimeDialog: null,
                    };
                    metrics?.recordInjectTurn?.(durationMs, true, 'completed');
                    metrics?.recordCounter?.('zero_pr.interrupt.deferred_mailbox');
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
                        promptBindingDigest:
                            typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                        promptIsStale:
                            typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null,
                        promptFreshnessReason:
                            typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null,
                        promptRecommendedAction:
                            promptFreshness?.['recommendedAction'] === 'none' ||
                            promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
                            promptFreshness?.['recommendedAction'] === 'resume-session'
                                ? promptFreshness['recommendedAction']
                                : null,
                        diagnostics: injectDiagnostics,
                        outcome: 'interrupted',
                        ok: true,
                    });
                    return {
                        status: 202,
                        body: {
                            ok: true,
                            code: 'ZERO_PR_DEFERRED_MAILBOX',
                            mode: 'interrupt_deferred_mailbox',
                            deferred: true,
                            mailbox: {
                                queueSize: mailbox.queueSize,
                                dropped: mailbox.dropped,
                                merged: deferred.merged,
                            },
                            note: 'Turno abortado; mensagem substituta foi registrada no mailbox para próxima ask_user.',
                            reply: null,
                            durationMs,
                            from,
                            traceId,
                            timeoutMs: timeout,
                            timeoutStrategy: timeoutDecision.strategy,
                            timeoutReasons: timeoutDecision.reasons,
                            promptDigest:
                                typeof promptBinding?.['digest'] === 'string' ? promptBinding['digest'] : null,
                            promptFreshness: promptFreshness,
                            diagnostics: injectDiagnostics,
                        },
                    };
                });
            }
            return await runInjectInterventionSequence(runtimeId, async () => {
                const abortStartedAt = Date.now();
                await abortAgentRuntimeCurrentMessage(runtimeId);
                const abortDurationMs = Date.now() - abortStartedAt;
                log(
                    'INFO',
                    `[agent-control] /inject interrupted current turn before queueing replacement (trace=${traceId}, abort=${abortDurationMs}ms)`,
                );
                return executeQueuedInjectTurn(abortDurationMs);
            });
        }

        return await executeQueuedInjectTurn(0);
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
            mode: injectMode,
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
            `[agent-control] /inject failed (trace=${traceId}, mode=${injectMode}, duration=${durationMs}ms, preflight=${preflightDurationMs}ms, code=${String(projection.body?.code ?? 'unknown')})`,
        );
        return {
            ...projection,
            body:
                projection.body && typeof projection.body === 'object'
                    ? {
                          ...projection.body,
                          mode: injectMode,
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
