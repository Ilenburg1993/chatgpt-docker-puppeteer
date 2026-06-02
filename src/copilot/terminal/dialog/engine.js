// @ts-check
/**
 * src/copilot/terminal/dialog/engine.js
 *
 * @module copilot/terminal/dialog/engine
 * @see EventBus
 */

import { emitNerv } from '#copilot/bridges';
import {
    LLM_B_BOOT_TIMEOUT_MS,
    TERMINAL_BYOK_TURN_TIMEOUT_MS,
    TERMINAL_LIVE_STATUS_ENABLED,
    readConfiguredByokSummary,
} from '#copilot/config';
import { cancelTimer, container, registerInterval, sleepMs, toError } from '#copilot/core';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { log, METRICS_STORE } from '#copilot/observability';
import { resolveOptionalDialogTimeout } from '../../presentation/dialog-timeout-policy.js';
import { MAX_EMBED_BYTES } from '../../presentation/files/index.js';
import { attachmentToRuntimeEmbed } from '../../presentation/runtime/index.js';
import { describeSdkRecoveryPolicy, getSdkRecoveryPolicy } from '../../presentation/sdk/index.js';
import {
    clearAttachments,
    clearNextTurnRequestHeaders,
    getAttachmentQueue,
    getHubSessionId,
    getNextTurnRequestHeaders,
    getRl,
    getShowStreaming,
    getShowThinking,
    getShowUsage,
    setBusy,
} from '../../presentation/state/index.js';
import { renderTerminalAssistantTranscript } from '../events/index.js';
import {
    readTerminalDialogStreamMeta,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    runTerminalDialogTurnDetailed,
    startTerminalAgentRuntime,
    startTerminalDialogMode,
} from '../frontend/gateways/index.js';
import { normalizeTerminalModelBillingProjection } from '../frontend/projections/index.js';
import { formatTerminalIsoTimestamp, markTerminalActivityIdle, recordTerminalActivity } from '../state/dialog/index.js';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    completeTerminalTurnTrace,
    recordTerminalFinalReconciliationDiagnostic,
    recordTerminalStreamDeltaDiagnostic,
    recordTerminalTurnDelta,
    readTerminalTurnCorrelation,
    reviseRecentTerminalTurnTraceStatus,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';
import {
    TERMINAL_BYOK_ADMISSION_MODE_ENV,
    evaluateTerminalByokTurnBudget,
    readTerminalByokAdmissionMode,
    describeTerminalByokGatewayAutoEffect,
    runTerminalByokGatewayPostTurnAutomation,
    runTerminalByokGatewayPreTurnAutomation,
} from '../byok/index.js';
import {
    classifyByokProviderFailure,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    recordByokProviderModelCallFailure,
} from '#copilot/model-gateway';
import { drainPendingNotifications, getPersistenceFailureCount, persistTurnToHub } from './engine-persistence.js';
import {
    BOOT_PROMPT,
    buildUserPrompt,
    buildWaitingPrompt,
    clearInlineStatus,
    printExchange,
    println,
    scheduleTerminalPromptRedraw,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    writeInlineStatus,
} from './output.js';
import { broadcastSse } from './sse.js';
import {
    createDeltaCallback,
    createDisplayState,
    createReasoningCallback,
    measureVisibleTerminalChars,
    releaseDisplayState,
    renderStreamingFooter,
} from './turn-display.js';
import { decideFinalTranscriptRender } from './turn-reconciliation.js';

export { drainPendingNotifications, getPersistenceFailureCount };

/**
 * @typedef {string
 *     | {
 *           type?: string;
 *           path?: string;
 *           filePath?: string;
 *           displayName?: string;
 *           content?: string;
 *           text?: string;
 *           data?: string;
 *           mimeType?: string;
 *           selection?: Record<string, unknown>;
 *       }} TerminalQueuedAttachment
 */

const MAX_TURN_QUEUE_SIZE = 10;
/** @type {number} */
let _turnQueueDepth = 0;

/**
 * @param {TerminalQueuedAttachment} attachment
 * @returns {Parameters<typeof attachmentToRuntimeEmbed>[0]}
 */
function normalizeQueuedAttachment(attachment) {
    return typeof attachment === 'string' ? { type: 'file', path: attachment } : attachment;
}

/**
 * @param {TerminalQueuedAttachment} attachment
 * @returns {string}
 */
function describeQueuedAttachment(attachment) {
    if (typeof attachment === 'string') return attachment;
    const type = typeof attachment?.type === 'string' ? attachment.type : 'file';
    if ((type === 'file' || type === 'directory') && typeof attachment?.path === 'string') return attachment.path;
    if (type === 'selection' && typeof attachment?.filePath === 'string') {
        return `${attachment.filePath} [selection]`;
    }
    if (type === 'blob') {
        const displayName = typeof attachment?.displayName === 'string' ? attachment.displayName : 'blob';
        const mimeType = typeof attachment?.mimeType === 'string' ? attachment.mimeType : 'application/octet-stream';
        return `${displayName} [blob:${mimeType}]`;
    }
    if (typeof attachment?.displayName === 'string') return attachment.displayName;
    return 'attachment';
}

/**
 * @param {unknown} value
 * @param {number} fallbackMs
 * @returns {number}
 */
function resolveBoundedTimeoutMs(value, fallbackMs) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
    return Math.max(15_000, Math.min(120_000, Math.round(base * 0.5)));
}

const IDLE_TRANSITION_TIMEOUT_MS = resolveBoundedTimeoutMs(LLM_B_BOOT_TIMEOUT_MS, 60_000);

/**
 * Retorna a profundidade atual da fila de turnos.
 *
 * @returns {number}
 */
export function getTurnQueueDepth() {
    return _turnQueueDepth;
}
/** @type {Promise<string | null>} */
let _sendTurnMutex = Promise.resolve(null);
/** @type {Promise<void> | null} */
let _ensureDialogLoopInFlight = null;

const WAITING_FRAMES = ['⏳', '⌛', '⏳'];
const LIVE_TURN_NARRATION_INTERVAL_MS = 10_000;
const BYOK_TURN_TIMEOUT_ENV = 'TERMINAL_BYOK_TURN_TIMEOUT_MS';
export { evaluateTerminalByokTurnBudget, readTerminalByokAdmissionMode };

/**
 * @param {string | undefined} raw
 * @returns {{ kind: 'unset' } | { kind: 'disabled' } | { kind: 'explicit'; timeoutMs: number }}
 */
function parseByokTurnTimeoutOverride(raw) {
    if (typeof raw !== 'string' || raw.trim().length === 0) return { kind: 'unset' };
    const normalized = raw.trim().toLowerCase();
    if (['0', 'off', 'false', 'disabled', 'none', 'watchdog', 'watchdog-only'].includes(normalized)) {
        return { kind: 'disabled' };
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return { kind: 'unset' };
    return { kind: 'explicit', timeoutMs: Math.max(15_000, Math.round(parsed)) };
}

/**
 * Resolve a janela de inatividade do turno do terminal.
 *
 * O fluxo SDK/Copilot continua `watchdog-only` por contrato histórico. BYOK e providers externos têm outro modo de
 * falha: podem emitir retry/deltas parciais e depois ficar mudos sem `session.error`. Para BYOK, portanto, usamos a
 * política de timeout de inatividade do executor: o relógio reinicia a cada progresso observável e só falha quando o
 * provider para de se mover.
 *
 * @param {{
 *     byok: ReturnType<typeof readConfiguredByokSummary>;
 *     runtimeState: ReturnType<typeof readTerminalRuntimeState>;
 *     metricsSummary: any;
 *     message: string;
 * }} input
 * @returns {ReturnType<typeof resolveOptionalDialogTimeout>}
 */
export function resolveTerminalDialogTurnTimeout(input) {
    const recentLatency = input.metricsSummary?.dialog?.turnLatency ?? {};
    const common = {
        defaultTimeoutMs: TURN_TIMEOUT_MS,
        queueDepth: input.runtimeState.queueSize,
        contextUtilization: input.runtimeState.contextWindow?.utilization,
        recentP50Ms: Number(recentLatency?.p50 ?? 0),
        recentP95Ms: Number(recentLatency?.p95 ?? 0),
        recentP99Ms: Number(recentLatency?.p99 ?? 0),
        payloadChars: input.message.length,
        phase: /** @type {'dialog'} */ ('dialog'),
    };
    const byokActive = input.byok.enabled === true && input.byok.ready === true;
    if (!byokActive) {
        return resolveOptionalDialogTimeout({
            ...common,
            explicitTimeoutMs: 0,
            allowDisabled: true,
        });
    }

    const override = parseByokTurnTimeoutOverride(TERMINAL_BYOK_TURN_TIMEOUT_MS);
    if (override.kind === 'disabled') {
        const advisory = resolveOptionalDialogTimeout({
            ...common,
            allowDisabled: false,
        });
        return {
            timeoutMs: null,
            strategy: 'disabled',
            reasons: [`${BYOK_TURN_TIMEOUT_ENV}:disabled`, 'byok_provider_watchdog_only'],
            advisoryTimeoutMs: advisory.timeoutMs ?? TURN_TIMEOUT_MS,
        };
    }

    return resolveOptionalDialogTimeout({
        ...common,
        explicitTimeoutMs: override.kind === 'explicit' ? override.timeoutMs : undefined,
        allowDisabled: false,
    });
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorCodeOf(error) {
    if (!error || typeof error !== 'object') return '';
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : '';
}

/**
 * @param {unknown} error
 * @param {ReturnType<typeof readConfiguredByokSummary>} byok
 * @returns {{ message: string; errorContext: string; provider: string | null; profile: string | null; model: string | null; failure: import('../../model-gateway/health/provider-failure.js').ByokProviderFailure } | null}
 */
function resolveByokTurnErrorDescriptor(error, byok) {
    if (byok.enabled !== true || byok.ready !== true) return null;
    const err = toError(error);
    const message = err.message || 'erro no turno BYOK';
    const failure = classifyByokProviderFailure(error);
    const code = errorCodeOf(error);
    const timeoutLike = code === 'DIALOG_TIMEOUT' || /sendTurn sem progresso|inactivity timeout|timeout/i.test(message);
    const providerLike =
        timeoutLike ||
        failure.kind !== 'unknown' ||
        /failed to get response|ai model|provider|model_call|rate limit|quota|retry|retried/i.test(message);
    if (!providerLike) return null;
    return {
        message,
        errorContext: timeoutLike
            ? 'dialog.byok_inactivity_timeout'
            : failure.kind === 'unknown'
              ? 'dialog.byok_turn_error'
              : `dialog.byok_${failure.errorContext.replace(/^provider\./u, 'provider_').replace(/\./gu, '_')}`,
        provider:
            byok.preset ??
            byok.providerType ??
            (typeof Reflect.get(byok, 'provider') === 'string' ? Reflect.get(byok, 'provider') : null),
        profile: byok.profile ?? null,
        model: byok.model ?? null,
        failure,
    };
}

/**
 * @param {ReturnType<typeof resolveByokTurnErrorDescriptor>} byokFailure
 * @returns {Promise<void>}
 */
async function printByokAutoAfterFailureHint(byokFailure) {
    if (!byokFailure) return;
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy();
    if (policy.enabled !== true) return;
    const profile = byokFailure.profile ?? policy.profiles[0] ?? 'repo_agent';
    try {
        const result = await runTerminalByokGatewayPostTurnAutomation({
            profile,
            provider: byokFailure.provider,
            model: byokFailure.model,
            failureKind: byokFailure.failure.kind,
            message: byokFailure.message,
            errorContext: byokFailure.errorContext,
        });
        if (result.ran !== true || !result.status) return;
        const applied = result.application?.applied.length ?? 0;
        const skipped = result.application?.skipped.length ?? 0;
        const persistedEffects = result.effectPersistence?.automationEffectApplications ?? 0;
        const handoffs = result.effectPersistence?.sdkSessionHandoffs ?? 0;
        println(
            `\x1b[90m       auto pós-falha: action=${result.status.decision.action} · route=${result.status.decision.selectedRouteKey ?? '-'} · applied=${applied} · skipped=${skipped} · effects=${persistedEffects} · handoffs=${handoffs}\x1b[0m`,
        );
        const effectDetails = [...(result.application?.applied ?? []), ...(result.application?.skipped ?? [])]
            .map(describeTerminalByokGatewayAutoEffect)
            .slice(0, 4);
        if (effectDetails.length > 0) {
            println(`\x1b[90m       auto pós-falha detalhe: ${effectDetails.join('; ')}\x1b[0m`);
        }
    } catch (error) {
        println(
            `\x1b[90m       auto: falha ao replanejar pós-falha (${error instanceof Error ? error.message : String(error)}); use /byok auto record profile:${profile}.\x1b[0m`,
        );
    }
}

/**
 * @returns {Promise<void>}
 */
async function runByokGatewayPreTurnAutomation() {
    try {
        const result = await runTerminalByokGatewayPreTurnAutomation();
        if (result.ran !== true || !result.status) return;
        const { decision } = result.status;
        const applied = result.application?.applied ?? [];
        const skipped = result.application?.skipped ?? [];
        const persistedEffects = result.effectPersistence?.automationEffectApplications ?? 0;
        const persistedHandoffs = result.effectPersistence?.sdkSessionHandoffs ?? 0;
        recordTerminalActivity('system', 'Model-gateway auto pre-turn avaliado', {
            detail:
                `action=${decision.action} · route=${decision.selectedRouteKey ?? '-'} · ` +
                `applied=${applied.length} · skipped=${skipped.length} · persistedEffects=${persistedEffects} · handoffs=${persistedHandoffs}`,
            source: 'dialog',
            recordHistory: false,
        });
        if (applied.length > 0) {
            println(
                `\x1b[90m  ↳ model-gateway auto: ${applied.map(describeTerminalByokGatewayAutoEffect).join('; ')}\x1b[0m`,
            );
            return;
        }
        if (decision.action !== 'keep_current') {
            println(`\x1b[90m  ↳ model-gateway auto: ${decision.operatorSummary}\x1b[0m`);
        }
    } catch (error) {
        recordTerminalActivity('system', 'Model-gateway auto pre-turn falhou em modo seguro', {
            detail: toError(error).message,
            source: 'dialog',
            severity: 'warn',
            recordHistory: false,
        });
    }
}

/**
 * Input humano pendente e uma saida terminal valida do turno: ask_user/elicitation podem encerrar o turno sem texto
 * final do assistente porque a proxima acao pertence ao operador. Fora desse caso, um reply vazio de turno explicito
 * nao pode virar `idle` silencioso.
 *
 * @param {ReturnType<typeof readTerminalRuntimeState>} runtimeState
 * @returns {boolean}
 */
function hasPendingHumanInputOutcome(runtimeState) {
    return (
        runtimeState.status === 'waiting_for_input' &&
        runtimeState.pendingQuestion !== null &&
        runtimeState.pendingQuestionKind !== 'ready'
    );
}

/**
 * @param {{
 *     actor: string;
 *     byok: ReturnType<typeof readConfiguredByokSummary>;
 *     materialization: ReturnType<typeof completeTerminalTurnMaterialization>;
 *     timestamp?: number;
 * }} input
 * @returns {{ expectedPendingInput: boolean; emptyOutputFailure: boolean }}
 */
function recordTerminalExplicitEmptyOutput(input) {
    if (input.materialization.source !== 'empty') {
        return { expectedPendingInput: false, emptyOutputFailure: false };
    }

    const timestamp = input.timestamp ?? Date.now();
    const runtimeState = readTerminalRuntimeState();
    if (hasPendingHumanInputOutcome(runtimeState)) {
        recordTerminalActivity('question', 'Turno sem transcript final aguardando input humano', {
            detail: `kind=${runtimeState.pendingQuestionKind ?? 'question'} · source=${input.materialization.sourceDetail}`,
            source: 'dialog',
            severity: 'info',
            recordHistory: false,
        });
        return { expectedPendingInput: true, emptyOutputFailure: false };
    }

    const failureDetail =
        `actor=${input.actor} · source=${input.materialization.sourceDetail} · ` +
        `deltas=${input.materialization.diagnostics.deltaSlices}/${input.materialization.diagnostics.deltaChars}ch · ` +
        `assistantMessages=${input.materialization.diagnostics.assistantMessageCount}`;
    reviseRecentTerminalTurnTraceStatus({ timestamp, status: 'failed' });
    recordTerminalActivity('error', 'Turno sem saída pública materializada', {
        detail: `${failureDetail} · sem ask_user/elicitation pendente`,
        source: 'dialog',
        severity: 'error',
    });
    broadcastSse(
        'terminal.turn.empty_output',
        withTerminalTurnCorrelation({
            source: 'terminal-dialog/empty-output',
            actor: input.actor,
            sourceDetail: input.materialization.sourceDetail,
            deltaSlices: input.materialization.diagnostics.deltaSlices,
            deltaChars: input.materialization.diagnostics.deltaChars,
            assistantMessageCount: input.materialization.diagnostics.assistantMessageCount,
            pendingQuestionKind: runtimeState.pendingQuestionKind,
            runtimeStatus: runtimeState.status,
            timestamp,
        }),
    );
    println(
        '\x1b[31m  ⛔ Turno terminou sem saída pública, sem delta materializado e sem ask_user/elicitation pendente.\x1b[0m',
    );
    println('\x1b[90m     Consulte /activity, /live e /byok health para separar provider, SDK e transcript.\x1b[0m');

    if (input.byok.enabled === true && input.byok.ready === true) {
        recordByokProviderModelCallFailure({
            routeProfile: input.byok.profile ?? null,
            providerId:
                input.byok.preset ??
                input.byok.providerType ??
                (typeof Reflect.get(input.byok, 'provider') === 'string' ? Reflect.get(input.byok, 'provider') : null),
            providerModel: input.byok.model ?? null,
            message: 'turno explícito encerrou sem saída pública materializada',
            errorContext: 'dialog.byok_empty_output',
            timestamp,
        });
    }

    return { expectedPendingInput: false, emptyOutputFailure: true };
}

/**
 * @param {ReturnType<typeof evaluateTerminalByokTurnBudget>} budget
 * @param {'block' | 'warn' | 'off'} [mode]
 * @returns {boolean}
 */
export function shouldBlockTerminalByokTurnBudget(budget, mode = readTerminalByokAdmissionMode()) {
    return mode === 'block' && budget.shouldBlock;
}

/**
 * @param {{
 *     startedAt: number;
 *     model: string;
 *     effort: string;
 *     timeoutMs: number | null;
 *     timeoutStrategy: 'explicit' | 'adaptive' | 'disabled';
 * }} opts
 * @returns {string}
 */
function formatLiveWaitingStatus({ startedAt, model, effort, timeoutMs, timeoutStrategy }) {
    const runtimeState = readTerminalRuntimeState();
    if (runtimeState.status === 'waiting_for_input' && runtimeState.pendingQuestionKind === 'question') {
        const questionText = String(runtimeState.pendingQuestion?.question ?? 'pergunta pendente')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160);
        const choices = Array.isArray(runtimeState.pendingQuestion?.choices)
            ? runtimeState.pendingQuestion.choices.join('|')
            : '';
        return `  \x1b[90m⏸ aguardando resposta humana\x1b[0m\x1b[90m · ${questionText}${choices ? ` · opções ${choices}` : ''} · [/answer <texto>] [/status]\x1b[0m`;
    }
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    const frame = WAITING_FRAMES[Math.floor(elapsedMs / 600) % WAITING_FRAMES.length] ?? '⏳';
    const elapsedRatio = timeoutMs && timeoutMs > 0 ? elapsedMs / timeoutMs : 0;
    const elapsedColor = elapsedRatio >= 0.85 ? '\x1b[31m' : elapsedRatio >= 0.6 ? '\x1b[33m' : '\x1b[90m';
    const timeoutLabel = timeoutMs === null ? 'watchdog' : `${Math.max(1, Math.round(timeoutMs / 1000))}s`;
    const strategyLabel = timeoutStrategy === 'disabled' ? 'no-timeout' : timeoutStrategy;
    const quickActions =
        elapsedMs >= 30_000
            ? ' \x1b[90m[/status] [/errors] [/restart]\x1b[0m'
            : elapsedMs >= 15_000
              ? ' \x1b[90m[/status] [/errors]\x1b[0m'
              : '';
    return `  \x1b[90m${frame} aguardando \x1b[36m${model}\x1b[90m · \x1b[35m${effort}\x1b[90m · ${elapsedColor}${elapsed}\x1b[0m\x1b[90m · ${timeoutLabel}/${strategyLabel}…\x1b[0m${quickActions}`;
}

/**
 * READY pendente significa que o SDK já entregou o `ask_user` controlado pelo protocolo e o loop está semanticamente
 * vivo, mesmo que um snapshot operacional ainda esteja se atualizando após timeout/recovery.
 *
 * @returns {boolean}
 */
function hasReadyProtocolQuestion() {
    const state = readTerminalRuntimeState();
    return state.status === 'waiting_for_input' && state.pendingQuestionKind === 'ready';
}

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
export function ensureDialogLoop() {
    const runtimeState = readTerminalRuntimeControlState();
    if (runtimeState.dialogLoopActive) {
        return Promise.resolve();
    }
    if (hasReadyProtocolQuestion()) {
        log('WARN', '[dialog] ensureDialogLoop() tratou READY pendente como loop ativo recuperado.');
        return Promise.resolve();
    }
    if (runtimeState.dialogPaused) {
        log('INFO', '[dialog] ensureDialogLoop() ignorado — dialogPaused=true (pausado pelo usuário)');
        return Promise.resolve();
    }
    if (_ensureDialogLoopInFlight !== null) {
        return _ensureDialogLoopInFlight;
    }
    _ensureDialogLoopInFlight = _doEnsureDialogLoop().finally(() => {
        _ensureDialogLoopInFlight = null;
    });
    return _ensureDialogLoopInFlight;
}

/**
 * Implementação interna de ensureDialogLoop com retry.
 *
 * @returns {Promise<void>}
 */
async function _doEnsureDialogLoop() {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
        try {
            await _tryStartDialogLoop();
            return;
        } catch (err) {
            attempt++;
            const sdkRecoveryPolicy = getSdkRecoveryPolicy(err, 'session');
            if (sdkRecoveryPolicy.kind !== 'unknown' && !sdkRecoveryPolicy.allowReconnect) {
                const message = toError(err).message;
                const recoveryMessage = describeSdkRecoveryPolicy(sdkRecoveryPolicy, err);
                log(
                    'WARN',
                    `[dialog] ensureDialogLoop pausado por policy SDK (kind=${sdkRecoveryPolicy.kind}): ${message}`,
                );
                recordTerminalActivity('error', 'Boot do dialog loop bloqueado pela policy SDK', {
                    detail: message,
                    severity: 'warn',
                    source: 'sdk',
                });
                println(`\n\x1b[31m  ${recoveryMessage.label}\x1b[0m ${recoveryMessage.headline}`);
                println(`  \x1b[90m${recoveryMessage.detail}\x1b[0m`);
                println(`  \x1b[90m${recoveryMessage.actionHint}\x1b[0m`);
                emitNerv('copilot:dialog:boot_blocked', {
                    error: message,
                    reason: `sdk_${sdkRecoveryPolicy.kind}`,
                    actionHint: recoveryMessage.actionHint,
                    severity: 'warn',
                });
                return;
            }
            if (attempt > MAX_RETRIES) {
                log(
                    'ERROR',
                    `[dialog] ensureDialogLoop falhou após ${MAX_RETRIES} tentativas: ${toError(err).message}`,
                );
                emitNerv('copilot:dialog:boot_failed', {
                    error: toError(err).message,
                    attempts: MAX_RETRIES,
                    severity: 'error',
                });
                throw err;
            }
            const delay = 2000 * 2 ** (attempt - 1);
            log(
                'WARN',
                `[dialog] ensureDialogLoop falhou (tentativa ${attempt}/${MAX_RETRIES}) — retry em ${delay}ms: ${toError(err).message}`,
            );
            await sleepMs(delay, { id: `terminal.dialog.ensure-retry:${attempt}`, unref: true });
        }
    }
}

/**
 * Tenta iniciar o dialog loop uma vez.
 *
 * @returns {Promise<void>}
 */
async function _tryStartDialogLoop() {
    let status = readTerminalRuntimeControlState().status;
    if (status === 'starting') {
        recordTerminalActivity('boot', 'Aguardando boot do agente', {
            detail: 'Status=starting antes de iniciar dialog loop',
            source: 'dialog',
        });
        println('\x1b[90m  Aguardando boot do agente concluir…\x1b[0m');
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            status = readTerminalRuntimeControlState().status;
            if (status !== 'starting') break;
            await sleepMs(500, { id: 'terminal.dialog.wait-starting-transition', unref: true });
        }
        status = readTerminalRuntimeControlState().status;
        if (status === 'starting') {
            throw new Error(`Timeout aguardando transição de status 'starting' (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (status === 'stopped') {
        recordTerminalActivity('boot', 'Iniciando agente', {
            detail: 'Inicializando ambiente da conversa',
            source: 'dialog',
        });
        println('\x1b[90m  Preparando agente…\x1b[0m');
        await startTerminalAgentRuntime();
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (readTerminalRuntimeControlState().status === 'idle') break;
            await sleepMs(500, { id: 'terminal.dialog.wait-idle.after-start', unref: true });
        }
        if (readTerminalRuntimeControlState().status !== 'idle') {
            throw new Error(`Timeout aguardando idle (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (readTerminalRuntimeControlState().status === 'processing') {
        recordTerminalActivity('boot', 'Aguardando agente ficar idle', {
            detail: 'Há trabalho em andamento antes do dialog loop',
            source: 'dialog',
        });
        println('\x1b[90m  Aguardando agente concluir tarefa em andamento…\x1b[0m');
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const s = readTerminalRuntimeControlState().status;
            if (s === 'idle') break;
            if (s === 'stopped') {
                throw new Error(`Agente parado inesperadamente antes de dialog loop`);
            }
            await sleepMs(500, { id: 'terminal.dialog.wait-idle.after-processing', unref: true });
        }
        if (readTerminalRuntimeControlState().status !== 'idle') {
            throw new Error(`Timeout aguardando idle após processing (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (hasReadyProtocolQuestion()) {
        markTerminalActivityIdle('Aguardando próxima mensagem');
        log('WARN', '[dialog] startDialogLoop() pulado — READY pendente já está aguardando input.');
        return;
    }

    recordTerminalActivity('boot', 'Conectando ao dialog loop', {
        detail: 'Iniciando protocolo READY/REPLY do terminal',
        source: 'dialog',
    });
    println('\x1b[90m  Conectando conversa…\x1b[0m');
    const resumeSessionAttach = true;
    log('INFO', '[dialog] reanexando terminal sem boot prompt automático.');
    println('\x1b[90m  Retomando sessão sem prompt inicial…\x1b[0m');
    await startTerminalDialogMode(resumeSessionAttach ? undefined : (BOOT_PROMPT ?? undefined), {
        resumeSessionAttach,
        onReady: () => println('\n  \x1b[32m●\x1b[0m  LLM-B pronta — pode começar\n'),
    });
    if (resumeSessionAttach) {
        markTerminalActivityIdle('Sessão retomada; aguardando próxima mensagem');
    }
}

/**
 * Envia um turno de diálogo para a LLM-B e exibe a resposta.
 *
 * @param {string} message - Mensagem a enviar
 * @param {string} [actor] - Quem está enviando ('user' | 'llm-a')
 * @returns {Promise<string | null>}
 */
export function sendTurn(message, actor = 'user') {
    if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) {
        log(
            'WARN',
            `[TerminalServer] Fila de turnos cheia (${_turnQueueDepth}/${MAX_TURN_QUEUE_SIZE}) — rejeitando mensagem de ${actor}.`,
        );
        return Promise.resolve(null);
    }

    const attachments = actor === 'user' ? getAttachmentQueue() : [];
    const requestHeaders = actor === 'user' ? getNextTurnRequestHeaders() : null;
    if (attachments.length > 0) {
        clearAttachments();
    }
    if (requestHeaders) {
        clearNextTurnRequestHeaders();
    }

    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor, attachments, requestHeaders)).catch(() => null);
    _sendTurnMutex = next.then(
        () => null,
        () => null,
    );
    void next.finally(() => {
        _turnQueueDepth--;
        if (_turnQueueDepth === 0) {
            _sendTurnMutex = Promise.resolve(null);
        }
    });
    return next;
}

/**
 * Implementação interna do turno.
 *
 * @param {string} message
 * @param {string} actor
 * @param {TerminalQueuedAttachment[]} attachments
 * @param {Record<string, string> | null} [requestHeaders]
 * @returns {Promise<string | null>}
 */
async function _executeTurn(message, actor, attachments = [], requestHeaders = null) {
    const t0 = Date.now();
    const runtimeState = readTerminalRuntimeState();
    const ctxState = runtimeState.contextWindow;
    if (ctxState) {
        const u = ctxState.utilization;
        if (u >= 0.95) {
            println(
                `\x1b[31m  ⛔ Context window em ${(u * 100).toFixed(0)}% — risco de perda de contexto. Use /compact antes de continuar.\x1b[0m`,
            );
        } else if (u >= 0.85) {
            println(
                `\x1b[33m  ⚠️  Context window em ${(u * 100).toFixed(0)}% — considere usar /compact em breve.\x1b[0m`,
            );
        }
    }

    const byokSummary = readConfiguredByokSummary();
    const byokBudget = evaluateTerminalByokTurnBudget(byokSummary, runtimeState, message);
    if (byokBudget.shouldWarn) {
        const admissionMode = readTerminalByokAdmissionMode();
        recordTerminalActivity('system', 'Orçamento BYOK apertado', {
            detail: `${byokBudget.label}; admission=${admissionMode}`,
            source: 'dialog',
            severity: byokBudget.severity === 'block' && admissionMode === 'block' ? 'error' : 'warn',
        });
        const budgetColor = byokBudget.severity === 'block' && admissionMode === 'block' ? '\x1b[31m' : '\x1b[33m';
        println(`${budgetColor}  ⚠️  BYOK budget: ${byokBudget.label}.\x1b[0m`);
        println(
            `\x1b[90m     Dica: /byok recommend reasoning safe · /compact · /byok use <perfil> · /byok model <id> · ${TERMINAL_BYOK_ADMISSION_MODE_ENV}=warn para permitir mesmo assim\x1b[0m`,
        );
        if (shouldBlockTerminalByokTurnBudget(byokBudget, admissionMode)) {
            recordTerminalActivity('system', 'Turno BYOK bloqueado por admission control', {
                detail: byokBudget.label,
                source: 'dialog',
                severity: 'error',
            });
            broadcastSse(
                'terminal.byok.admission_blocked',
                withTerminalTurnCorrelation({
                    source: 'terminal-dialog/byok-admission',
                    reason: 'estimated_request_exceeds_provider_limit',
                    label: byokBudget.label,
                    estimatedRequestTokens: byokBudget.estimatedRequestTokens,
                    limit: byokBudget.limit,
                    admissionMode,
                    timestamp: Date.now(),
                }),
            );
            println(
                '\x1b[31m  ⛔ Turno não enviado ao provider BYOK: a estimativa excede o limite declarado antes do streaming.\x1b[0m',
            );
            return null;
        }
    }

    const metricsSummary = (() => {
        try {
            return container.resolve(METRICS_STORE).getSummary();
        } catch {
            return null;
        }
    })();
    const timeoutDecision = resolveTerminalDialogTurnTimeout({
        byok: byokSummary,
        runtimeState,
        metricsSummary,
        message,
    });

    await runByokGatewayPreTurnAutomation();

    setBusy(true);
    beginTerminalTurnMaterialization({ timestamp: t0, source: 'terminal/explicit-turn' });
    recordTerminalActivity('turn', actor === 'llm-a' ? 'Processando mensagem da LLM-A' : 'Processando mensagem', {
        detail: message.slice(0, 120),
        source: 'dialog',
    });
    if (requestHeaders && Object.keys(requestHeaders).length > 0) {
        recordTerminalActivity('system', 'Turno com requestHeaders', {
            detail: Object.keys(requestHeaders).join(', '),
            source: 'dialog',
            severity: 'warn',
        });
        println(
            `\x1b[90m  ↳ requestHeaders por turno detectados (${Object.keys(requestHeaders).join(', ')}); usando dispatch SDK direto com reanexo do dialog loop.\x1b[0m`,
        );
    }
    broadcastSse(
        'busy',
        withTerminalTurnCorrelation({
            busy: true,
            actor,
            source: 'terminal-dialog/busy',
            timestamp: Date.now(),
        }),
    );
    const rl = getRl();
    /** @type {NodeJS.Timeout | null} */
    let waitingTicker = null;
    /** @type {string | null} */
    let waitingTickerId = null;
    /** @type {{ firstOutputAt: number; lastNarrationAt: number; model: string; effort: string }} */
    const liveTurnSignal = { firstOutputAt: 0, lastNarrationAt: 0, model: '-', effort: '-' };
    if (rl) {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        const effort = reasoningEffort;
        liveTurnSignal.model = model;
        liveTurnSignal.effort = effort;
        const renderWaitingStatus = () => {
            if (TERMINAL_LIVE_STATUS_ENABLED) return;
            writeInlineStatus(
                formatLiveWaitingStatus({
                    startedAt: t0,
                    model,
                    effort,
                    timeoutMs: timeoutDecision.timeoutMs,
                    timeoutStrategy: timeoutDecision.strategy,
                }),
            );
        };
        const narrateWaitingStatus = () => {
            const runtimeState = readTerminalRuntimeState();
            if (runtimeState.status === 'waiting_for_input' && runtimeState.pendingQuestionKind === 'question') return;
            const now = Date.now();
            const elapsedMs = Math.max(0, now - t0);
            if (liveTurnSignal.firstOutputAt > 0 || elapsedMs < LIVE_TURN_NARRATION_INTERVAL_MS) return;
            if (now - liveTurnSignal.lastNarrationAt < LIVE_TURN_NARRATION_INTERVAL_MS) return;
            liveTurnSignal.lastNarrationAt = now;
            const elapsedSeconds = (elapsedMs / 1000).toFixed(0);
            recordTerminalActivity('thinking', 'LLM-B trabalhando', {
                detail: `${elapsedSeconds}s sem resposta visível`,
                source: 'dialog',
                recordHistory: false,
            });
            if (process.env['COPILOT_TERMINAL_DURABLE_WAITING_NARRATION'] === 'true') {
                println(`  \x1b[90m↳ LLM-B pensando · ${elapsedSeconds}s sem resposta visível\x1b[0m`);
            }
        };
        renderWaitingStatus();
        rl.setPrompt(buildWaitingPrompt());
        waitingTickerId = `terminal.dialog.waiting:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        waitingTicker = registerInterval(
            waitingTickerId,
            () => {
                renderWaitingStatus();
                narrateWaitingStatus();
            },
            1000,
        );
        if (typeof waitingTicker.unref === 'function') waitingTicker.unref();
    }

    let enrichedMessage = message;

    if (attachments.length > 0) {
        try {
            const embedParts = await Promise.all(
                attachments.map((attachment) => attachmentToRuntimeEmbed(normalizeQueuedAttachment(attachment))),
            );
            const validParts = embedParts.filter(/** @type {(s: string | null) => s is string} */ (s) => s !== null);
            if (validParts.length > 0) {
                let totalBytes = 0;
                const limitedParts = [];
                for (const part of validParts) {
                    const partBytes = utf8ByteLength(part, 'terminal dialog attachment embed');
                    if (totalBytes + partBytes > MAX_EMBED_BYTES) break;
                    limitedParts.push(part);
                    totalBytes += partBytes;
                }
                if (limitedParts.length > 0) {
                    enrichedMessage = limitedParts.join('\n\n') + '\n\n' + enrichedMessage;
                    println(
                        `\x1b[90m  📎 ${limitedParts.length} attachment(s) embutido(s): ${attachments.map(describeQueuedAttachment).join(', ')}\x1b[0m`,
                    );
                }
            }
        } catch (embedErr) {
            println(`\x1b[33m  ⚠️  Falha ao embutir arquivo(s): ${toError(embedErr).message}\x1b[0m`);
        }
    }

    /** @type {ReturnType<typeof createDisplayState> | null} */
    let displayState = null;

    try {
        await ensureDialogLoop();

        if (actor === 'llm-a') {
            const tsNow = formatTerminalIsoTimestamp(Date.now());
            println(SEPARATOR);
            println(`  \x1b[90m[${tsNow}]\x1b[0m  🤖  \x1b[34mLLM-A\x1b[0m`);
            println('');
            for (const line of message.split('\n')) {
                println(`  \x1b[34m│\x1b[0m  ${line}`);
            }
            println('');
        }

        const showThinking = getShowThinking();
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        const effort = reasoningEffort;
        displayState = createDisplayState({
            model,
            effort,
            turnStartTime: t0,
            showStreaming: getShowStreaming(),
            showThinking,
        });
        displayState.timeoutMs = timeoutDecision.timeoutMs;
        displayState.timeoutStrategy = timeoutDecision.strategy;

        const renderReasoningChunk = createReasoningCallback(displayState);
        /** @type {(chunk: string, reasoningId: string | null) => void} */
        const onReasoning = (chunk, reasoningId) => {
            if (liveTurnSignal.firstOutputAt === 0) liveTurnSignal.firstOutputAt = Date.now();
            renderReasoningChunk(chunk, reasoningId);
        };

        const renderDeltaChunk = createDeltaCallback(displayState);
        /** @type {(chunk: string, envelope?: Record<string, unknown>) => void} */
        const onDelta = (chunk, envelope = {}) => {
            if (shouldSuppressTerminalAssistantMessageAsUserInputEcho({ content: chunk })) {
                recordTerminalStreamDeltaDiagnostic({
                    action: 'suppressed',
                    reason: 'human_answer_echo',
                    source: typeof envelope['source'] === 'string' ? envelope['source'] : 'dialog/onDelta',
                    causalKey: null,
                    rawChars: chunk.length,
                    normalizedChars: 0,
                    streamId: envelope['streamId'],
                    chunkSeq: envelope['chunkSeq'],
                    eventId: envelope['eventId'],
                    causationId: envelope['causationId'],
                });
                recordTerminalActivity('question', 'Eco de resposta humana suprimido no streaming', {
                    detail: chunk.slice(0, 160),
                    source: 'sdk.assistant.message_delta',
                    recordHistory: false,
                    updateCurrent: false,
                });
                return;
            }
            if (liveTurnSignal.firstOutputAt === 0) liveTurnSignal.firstOutputAt = Date.now();
            recordTerminalTurnDelta({
                chunk,
                source: 'dialog/onDelta',
                sdkSource: typeof envelope['source'] === 'string' ? envelope['source'] : null,
                streamId: typeof envelope['streamId'] === 'string' ? envelope['streamId'] : null,
                chunkSeq: typeof envelope['chunkSeq'] === 'number' ? envelope['chunkSeq'] : null,
                eventId: typeof envelope['eventId'] === 'string' ? envelope['eventId'] : null,
                causationId: typeof envelope['causationId'] === 'string' ? envelope['causationId'] : null,
                timestamp: typeof envelope['ts'] === 'number' ? envelope['ts'] : Date.now(),
            });
            renderDeltaChunk(chunk, envelope);
        };

        const onDeltaDiagnostic = (/** @type {Record<string, any>} */ event) => {
            const correlation = readTerminalTurnCorrelation();
            recordTerminalStreamDeltaDiagnostic({
                action: event['action'],
                reason: event['reason'],
                source: event['source'],
                causalKey: event['causalKey'],
                rawChars: event['rawChars'],
                normalizedChars: event['normalizedChars'],
                traceId: correlation.traceId,
                turnId: correlation.turnId,
                streamId: event['streamId'],
                chunkSeq: event['chunkSeq'],
                eventId: event['eventId'],
                causationId: event['causationId'],
                timestamp: event['at'],
            });
        };

        const turnResult = await runTerminalDialogTurnDetailed(enrichedMessage, {
            timeout: timeoutDecision.timeoutMs,
            onDelta,
            onDeltaDiagnostic,
            onReasoning,
            ...(requestHeaders ? { requestHeaders } : {}),
        });
        const materializedReply = completeTerminalTurnMaterialization({
            directReply: turnResult.reply,
            directSource: turnResult.replySource,
        });
        const emptyOutput = recordTerminalExplicitEmptyOutput({
            actor,
            byok: byokSummary,
            materialization: materializedReply,
        });
        const reply = materializedReply.reply ?? turnResult.reply;
        const effectiveReplySource = materializedReply.source;
        const durationMs = Date.now() - t0;
        const replyVisibleChars = typeof reply === 'string' ? measureVisibleTerminalChars(reply) : 0;

        recordTerminalActivity('turn', 'Reply do turno explícito resolvido', {
            detail:
                `canal=${turnResult.channel} · source=${effectiveReplySource} · ` +
                `detail=${materializedReply.sourceDetail} · chars=${typeof reply === 'string' ? reply.length : 0} · ` +
                `visíveis=${replyVisibleChars} · deltas=${materializedReply.diagnostics.deltaSlices}/${materializedReply.diagnostics.deltaChars}ch · ` +
                `assistantMessages=${materializedReply.diagnostics.assistantMessageCount}`,
            source: 'dialog',
            recordHistory: false,
        });

        if (effectiveReplySource === 'direct_reply') {
            log('INFO', '[TerminalServer] Turno explícito renderizado usando reply direto do transporte.');
        } else if (effectiveReplySource === 'assistant_message') {
            log('INFO', '[TerminalServer] Turno explícito renderizado usando materialização de assistant.message.');
        } else if (effectiveReplySource === 'stream_delta') {
            log('WARN', '[TerminalServer] Turno explícito renderizado usando materialização de deltas incrementais.');
        } else if (effectiveReplySource === 'empty') {
            log('WARN', '[TerminalServer] Turno explícito concluído sem reply textual materializado no transporte.');
        }

        renderStreamingFooter(displayState, durationMs);
        const finalRenderDecision = decideFinalTranscriptRender({
            reply: typeof reply === 'string' ? reply : null,
            streamedContent: displayState.streamingContent,
            streamingStarted: displayState.streamingStarted,
            streamingVisibleChars: displayState.streamingVisibleChars,
        });
        recordTerminalFinalReconciliationDiagnostic({
            mode: finalRenderDecision.mode,
            reason: finalRenderDecision.reason,
            source: 'dialog/turn-final',
            streamedChars: displayState.streamingChars,
            streamingVisibleChars: displayState.streamingVisibleChars,
            finalChars: typeof reply === 'string' ? reply.length : 0,
            renderedChars: finalRenderDecision.content.length,
            severity: finalRenderDecision.severity,
        });
        const terminalStreamingDiagnostics = {
            schemaVersion: 1,
            source: 'terminal.dialog.engine',
            turnKey: materializedReply.snapshot?.turnKey ?? null,
            turnId: materializedReply.snapshot?.turnId ?? null,
            materialization: {
                source: effectiveReplySource,
                sourceDetail: materializedReply.sourceDetail,
                expectedPendingInput: emptyOutput.expectedPendingInput,
                emptyOutputFailure: emptyOutput.emptyOutputFailure,
                deltaSlices: materializedReply.diagnostics.deltaSlices,
                deltaChars: materializedReply.diagnostics.deltaChars,
                assistantMessageCount: materializedReply.diagnostics.assistantMessageCount,
                droppedDeltaSlices: materializedReply.diagnostics.droppedDeltaSlices,
                droppedDeltaChars: materializedReply.diagnostics.droppedDeltaChars,
            },
            finalReconciliation: {
                mode: finalRenderDecision.mode,
                reason: finalRenderDecision.reason,
                severity: finalRenderDecision.severity,
                renderedChars: finalRenderDecision.content.length,
            },
            publicStream: {
                started: displayState.streamingStarted,
                chars: displayState.streamingChars,
                visibleChars: displayState.streamingVisibleChars,
                firstChunkMs: displayState.firstChunkTime > 0 ? displayState.firstChunkTime - t0 : null,
            },
        };
        if (finalRenderDecision.mode !== 'none') {
            if (finalRenderDecision.reason === 'stream_mismatch') {
                recordTerminalActivity('system', 'Transcript final limpo renderizado', {
                    detail: 'stream live divergiu da mensagem final do SDK',
                    source: 'dialog',
                    severity: 'warn',
                    recordHistory: false,
                });
            } else if (finalRenderDecision.reason === 'stream_suffix') {
                recordTerminalActivity('streaming', 'Transcript final completou stream parcial', {
                    detail: `${measureVisibleTerminalChars(finalRenderDecision.content)} caracteres visíveis restantes`,
                    source: 'dialog',
                    severity: 'info',
                    recordHistory: false,
                });
            } else if (finalRenderDecision.reason === 'no_visible_stream') {
                recordTerminalActivity('streaming', 'Resposta final sem delta público visível', {
                    detail: 'SDK concluiu o turno antes de entregar assistant.message_delta público ao renderer',
                    source: 'dialog',
                    severity: 'info',
                    recordHistory: true,
                });
            }
            const rendered =
                finalRenderDecision.content.trim().length > 0
                    ? renderTerminalAssistantTranscript({
                          content: finalRenderDecision.content,
                          title:
                              finalRenderDecision.mode === 'suffix'
                                  ? 'Complemento da LLM-B'
                                  : actor === 'llm-a'
                                    ? 'Resposta da LLM-B para LLM-A'
                                    : 'Resposta da LLM-B',
                          source:
                              finalRenderDecision.mode === 'suffix'
                                  ? 'dialog/turn-suffix'
                                  : finalRenderDecision.reason === 'stream_mismatch'
                                    ? 'dialog/turn-final'
                                    : 'dialog/turn',
                          status: 'completed',
                          detail: `${(durationMs / 1000).toFixed(1)}s · ${finalRenderDecision.reason}`,
                          metadata: {
                              terminalStreamingDiagnostics,
                          },
                      })
                    : false;
            if (!rendered) {
                printExchange(actor, message, reply, durationMs);
            }
        }

        if (displayState.firstChunkTime > 0) {
            const ttftMs = displayState.firstChunkTime - t0;
            emitNerv('copilot:turn:streaming_metrics', {
                timeToFirstTokenMs: ttftMs,
                totalDurationMs: durationMs,
                streamedChars: displayState.streamingChars,
                reasoningChars: displayState.reasoningChars,
            });
        }

        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        if (getShowUsage()) {
            const latestRuntimeState = readTerminalRuntimeState();
            const ctxWin = latestRuntimeState.contextWindow;
            const prInfo = /** @type {Record<string, unknown> | null} */ (latestRuntimeState.lastPrInfo);
            const llmUsage = /** @type {Record<string, unknown> | null} */ (latestRuntimeState.lastLlmUsage ?? null);
            const prefersLlmUsage =
                llmUsage !== null && (llmUsage['premiumRequest'] === false || llmUsage['byokProvider'] === true);
            const usageInfo = prefersLlmUsage ? llmUsage : prInfo;
            if (ctxWin || usageInfo) {
                const parts = [];
                if (usageInfo) {
                    const modelBilling = normalizeTerminalModelBillingProjection(usageInfo, latestRuntimeState.model);
                    if (!prefersLlmUsage && readConfiguredByokSummary().enabled) {
                        parts.push('quota/PR histórico');
                    }
                    if (modelBilling.mismatch) {
                        if (modelBilling.configuredModel) {
                            parts.push(`modeloCfg=\x1b[35m${modelBilling.configuredModel}\x1b[0m`);
                        }
                        if (modelBilling.billedModel) {
                            parts.push(`modeloCobrado=\x1b[36m${modelBilling.billedModel}\x1b[0m`);
                        }
                    } else if (modelBilling.displayModel !== '-') {
                        parts.push(
                            `${prefersLlmUsage ? 'LLM' : 'modelo'} \x1b[36m${modelBilling.displayModel}\x1b[0m`,
                        );
                    }
                    if (modelBilling.cost !== null) {
                        parts.push(`custo \x1b[33m${modelBilling.cost.toFixed(4)}\x1b[0m`);
                    }
                }
                if (ctxWin) {
                    parts.push(`contexto ${(ctxWin.utilization * 100).toFixed(0)}%`);
                    parts.push(
                        `${ctxWin.tokens.toLocaleString('pt-BR')}/${ctxWin.tokenLimit.toLocaleString('pt-BR')} tokens`,
                    );
                }
                println(`  \x1b[90m📊 ${parts.join(' · ')}\x1b[0m`);
            }
        }

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await persistTurnToHub(_hubSessionId, message, reply, actor, durationMs, {
                    terminalStreamingDiagnostics,
                });
            } catch (hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${toError(hubErr).message}`);
            }
        }

        return reply;
    } catch (e) {
        const err = toError(e);
        const byokFailure = resolveByokTurnErrorDescriptor(e, readConfiguredByokSummary());
        if (byokFailure) {
            const now = Date.now();
            recordByokProviderModelCallFailure({
                routeProfile: byokFailure.profile,
                providerId: byokFailure.provider,
                providerModel: byokFailure.model,
                message: byokFailure.message,
                errorContext: byokFailure.errorContext,
                failureKind: byokFailure.failure.kind,
                failureStatusCode: byokFailure.failure.statusCode,
                retryAfterSeconds: byokFailure.failure.retryAfterSeconds,
                resetAt: byokFailure.failure.resetAt,
                timestamp: now,
            });
            completeTerminalTurnMaterialization({ timestamp: now, status: 'failed' });
            const revisedTrace = reviseRecentTerminalTurnTraceStatus({ timestamp: now, status: 'failed' });
            if (!revisedTrace) {
                completeTerminalTurnTrace({ timestamp: now, status: 'failed' });
            }
            recordTerminalActivity('error', 'Falha de provider BYOK no turno', {
                detail:
                    `${byokFailure.errorContext} · perfil ${byokFailure.profile ?? '-'} · ` +
                    `provider ${byokFailure.provider ?? '-'} · modelo ${byokFailure.model ?? '-'} · ` +
                    'sem Premium Request',
                severity: 'error',
                source: 'dialog',
            });
            println(
                `\x1b[31m[byok] ${byokFailure.errorContext}: ${byokFailure.message} · ${byokFailure.failure.operatorLabel} · sem Premium Request\x1b[0m`,
            );
            println(`\x1b[90m       ação: ${byokFailure.failure.operatorAction}\x1b[0m`);
            await printByokAutoAfterFailureHint(byokFailure);
        } else {
            clearTerminalTurnMaterialization();
            recordTerminalActivity('error', 'Erro no turno', {
                detail: err.message,
                severity: 'error',
                source: 'dialog',
            });
            println(`[erro] ${err.message}`);
        }
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${err.message}`);
        if (!readTerminalRuntimeControlState().dialogLoopActive) {
            log('WARN', '[TerminalServer] Dialog loop inativo após erro — reagendando ensureDialogLoop');
            void (async () => {
                await sleepMs(2_000, { id: 'terminal.dialog.restart-after-turn-error', unref: true });
                ensureDialogLoop().catch((restartErr) => {
                    log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${restartErr.message}`);
                });
            })();
        }
        return null;
    } finally {
        releaseDisplayState(displayState);
        if (waitingTicker !== null) {
            if (waitingTickerId) cancelTimer(waitingTickerId);
        }
        setBusy(false);
        if (readTerminalRuntimeControlState().dialogLoopActive) {
            markTerminalActivityIdle();
        }
        broadcastSse(
            'busy',
            withTerminalTurnCorrelation({
                busy: false,
                source: 'terminal-dialog/busy',
                timestamp: Date.now(),
            }),
        );
        const rl = getRl();
        if (rl) {
            clearInlineStatus();
            scheduleTerminalPromptRedraw(rl, buildUserPrompt());
        }
    }
}
