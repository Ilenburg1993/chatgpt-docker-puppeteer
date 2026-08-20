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
    readConfiguredByokSummary,
    TERMINAL_BYOK_TURN_TIMEOUT_MS,
    TERMINAL_LIVE_STATUS_ENABLED,
} from '#copilot/config';
import { cancelTimer, container, registerInterval, sleepMs, toError } from '#copilot/core';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import {
    classifyByokProviderFailure,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    recordByokProviderModelCallFailure,
} from '#copilot/model-gateway';
import { defaultErrorTracker, log, METRICS_STORE } from '#copilot/observability';
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
import {
    describeTerminalByokGatewayAutoEffect,
    runTerminalByokGatewayPostTurnAutomation,
    runTerminalByokGatewayPreTurnAutomation,
} from '../byok/gateway/index.js';
import {
    evaluateTerminalByokTurnBudget,
    readTerminalByokAdmissionMode,
    TERMINAL_BYOK_ADMISSION_MODE_ENV,
} from '../byok/policy/index.js';
import { renderTerminalAssistantTranscript } from '../events/transcript/index.js';
import {
    readTerminalDialogStreamMeta,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    runTerminalDialogTurnDetailed,
    startTerminalAgentRuntime,
    startTerminalDialogMode,
} from '../frontend/gateways/index.js';
import { normalizeTerminalModelBillingProjection } from '../frontend/projections/index.js';
import {
    formatTerminalTimeLabel,
    markTerminalActivityIdle,
    recordTerminalActivity,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/dialog/index.js';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    completeTerminalTurnTrace,
    readTerminalTurnCorrelation,
    readTerminalTurnTraceProjection,
    recordTerminalFinalReconciliationDiagnostic,
    recordTerminalStreamDeltaDiagnostic,
    recordTerminalTurnDelta,
    reviseRecentTerminalTurnTraceStatus,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
    waitForTerminalTurnMaterializationQuiescence,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';
import { auditAssistantToolClaims, renderAssistantToolClaimAuditFindings } from './assistant-tool-claim-audit.js';
import { presentByokTurnFailure } from './byok-turn-error-presentation.js';
import {
    buildTerminalEmptyOutputDiagnosis,
    classifyTerminalEmptyOutput,
    hasTerminalPendingHumanInputOutcome,
} from './empty-output-diagnosis.js';
import { drainPendingNotifications, getPersistenceFailureCount, persistTurnToHub } from './engine-persistence.js';
import {
    BOOT_PROMPT,
    buildUserPrompt,
    buildWaitingPrompt,
    clearInlineStatus,
    deferTerminalIdlePromptRedraw,
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
const EMPTY_TURN_RECOVERY_MAX_ATTEMPTS = 1;
const EMPTY_TURN_RECOVERY_PROMPT = [
    'RECUPERAÇÃO AUTOMÁTICA DO TERMINAL:',
    'O turno imediatamente anterior encerrou sem texto público, sem tool executada e sem pergunta humana pendente.',
    'Continue exatamente a solicitação anterior do operador. Use apenas tools reais quando necessárias.',
    'Não explique a recuperação; execute o pedido anterior e entregue saída pública normal.',
].join('\n');
const TOOL_ONLY_RECOVERY_PROMPT = [
    'RECUPERAÇÃO AUTOMÁTICA DO TERMINAL:',
    'O turno imediatamente anterior executou tools reais, mas encerrou sem texto público e sem pergunta humana pendente.',
    'Não repita tools que já foram concluídas.',
    'Continue exatamente a solicitação original a partir do próximo passo pendente.',
    'Se o próximo passo exigia texto público, emita esse texto agora.',
    'Se o próximo passo exigia pergunta humana, invoque a tool real de pergunta humana agora.',
    'Não explique a recuperação e não simule tool em texto, Markdown ou JSON.',
].join('\n');

/**
 * @param {string} message
 * @returns {string | null}
 */
function extractOriginalToolAllowlist(message) {
    const match = message.match(/Não use outras tools além de (?<tools>[^.]+)\./iu);
    const tools = match?.groups?.['tools']?.trim() ?? '';
    return tools.length > 0 ? tools : null;
}

/**
 * @param {string} message
 * @returns {string | null}
 */
function extractOriginalExactAskQuestion(message) {
    const match = message.match(/ask_user perguntando exatamente "(?<question>[^"]+)"/iu);
    const question = match?.groups?.['question']?.trim() ?? '';
    return question.length > 0 ? question : null;
}

/**
 * Recovery pós-tools deve preservar o contrato do turno original. Sem isso, um modelo pode "recuperar" uma falha
 * chamando ferramenta fora da allowlist ou inventando uma pergunta diferente, o que piora a UX e quebra lives
 * canônicos.
 *
 * @param {string} originalMessage
 * @returns {string}
 */
export function buildToolOnlyRecoveryPrompt(originalMessage) {
    const allowlist = extractOriginalToolAllowlist(originalMessage);
    const exactAskQuestion = extractOriginalExactAskQuestion(originalMessage);
    return [
        TOOL_ONLY_RECOVERY_PROMPT,
        '',
        'Contrato invariável do turno original:',
        'Preserve todas as restrições explícitas do pedido original.',
        allowlist
            ? `Allowlist original de tools: ${allowlist}. Não use nenhuma tool fora dessa allowlist.`
            : 'Não introduza ferramentas alternativas se o pedido original restringia ferramentas ou fluxo.',
        exactAskQuestion
            ? `Se a continuação exigir pergunta ao operador, use exatamente esta pergunta: "${exactAskQuestion}". Não altere texto, opções nem intenção.`
            : 'Se precisar perguntar ao operador, preserve a pergunta/forma solicitada no pedido original.',
        'Se uma tool falhou, não substitua por shell, comando, pseudo-tool ou plano textual fora do contrato; continue com a próxima tool permitida ou materialize uma falha clara.',
    ]
        .filter((line) => typeof line === 'string' && line.length > 0)
        .join('\n');
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function humanizeTerminalAutomationAction(value) {
    switch (value) {
        case 'keep_current':
            return 'manter modelo atual';
        case 'apply_route':
            return 'aplicar rota alternativa';
        case 'switch_model':
            return 'trocar modelo';
        case 'switch_provider':
            return 'trocar provedor';
        case 'disable_byok':
            return 'desativar BYOK';
        case 'record_failure':
            return 'registrar falha';
        case 'none':
        case '':
        case null:
        case undefined:
            return 'nenhuma ação imediata';
        default:
            return String(value).replace(/[_-]+/gu, ' ');
    }
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralCount(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}
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
 * @returns {{
 *     message: string;
 *     errorContext: string;
 *     provider: string | null;
 *     profile: string | null;
 *     model: string | null;
 *     failure: import('../../model-gateway/health/provider-failure.js').ByokProviderFailure;
 * } | null}
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
            terminalThemeRow(
                'Seleção',
                [
                    `pós-falha ${humanizeTerminalAutomationAction(result.status.decision.action)}`,
                    result.status.decision.selectedRouteKey ? `rota ${result.status.decision.selectedRouteKey}` : null,
                    pluralCount(applied, 'efeito aplicado', 'efeitos aplicados'),
                    skipped > 0 ? pluralCount(skipped, 'efeito ignorado', 'efeitos ignorados') : null,
                    persistedEffects > 0 ? pluralCount(persistedEffects, 'persistência', 'persistências') : null,
                    handoffs > 0 ? pluralCount(handoffs, 'entrega SDK', 'entregas SDK') : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
            ),
        );
        const effectDetails = [...(result.application?.applied ?? []), ...(result.application?.skipped ?? [])]
            .map(describeTerminalByokGatewayAutoEffect)
            .slice(0, 4);
        if (effectDetails.length > 0) {
            println(terminalThemeRow('Detalhe', effectDetails.join('; ')));
        }
    } catch (error) {
        println(
            terminalThemeRow(
                'Seleção',
                `falha ao replanejar pós-falha: ${error instanceof Error ? error.message : String(error)} · use /byok auto record profile:${profile}`,
            ),
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
                `ação ${humanizeTerminalAutomationAction(decision.action)} · rota ${decision.selectedRouteKey ?? 'nenhuma'} · ` +
                `${pluralCount(applied.length, 'efeito aplicado', 'efeitos aplicados')} · ` +
                `${pluralCount(skipped.length, 'efeito ignorado', 'efeitos ignorados')} · ` +
                `${pluralCount(persistedEffects, 'persistência', 'persistências')} · ` +
                `${pluralCount(persistedHandoffs, 'entrega SDK', 'entregas SDK')}`,
            source: 'dialog',
            recordHistory: false,
        });
        if (applied.length > 0) {
            println(terminalThemeRow('Seleção', applied.map(describeTerminalByokGatewayAutoEffect).join('; ')));
            return;
        }
        if (decision.action !== 'keep_current') {
            println(terminalThemeRow('Seleção', decision.operatorSummary));
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
    return hasTerminalPendingHumanInputOutcome({
        runtimeStatus: runtimeState.status,
        pendingQuestionPresent: runtimeState.pendingQuestion !== null,
        pendingQuestionKind: runtimeState.pendingQuestionKind,
    });
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Um turno vazio antes de qualquer tool/pergunta é recuperável: não houve efeito colateral observável e a causa mais
 * provável é o modelo/adapter ter encerrado a chamada sem materializar protocolo público. Depois de tools, perguntas ou
 * transições de protocolo, retry automático deixa de ser seguro porque poderia duplicar ação ou atropelar o contrato do
 * SDK.
 *
 * @param {import('../frontend/gateways/dialog.js').TerminalDialogTurnResult} turnResult
 * @param {{
 *     actor: string;
 *     allowRecovery: boolean;
 *     runtimeState: ReturnType<typeof readTerminalRuntimeState>;
 * }} context
 * @returns {boolean}
 */
function shouldAttemptPreActionEmptyTurnRecovery(turnResult, context) {
    if (!context.allowRecovery || context.actor !== 'user') return false;
    if (typeof turnResult.reply === 'string' && turnResult.reply.trim().length > 0) return false;
    if (hasPendingHumanInputOutcome(context.runtimeState)) return false;
    if (turnResult.semanticOutcome && turnResult.semanticOutcome !== 'empty') return false;
    const diagnostics = turnResult.semanticDiagnostics;
    if (!diagnostics) return true;
    if (diagnostics.pendingHumanInput === true || diagnostics.pendingProtocolKind !== null) return false;
    if (nonNegativeFiniteNumber(diagnostics.toolSignalCount) > 0) return false;
    if (nonNegativeFiniteNumber(diagnostics.assistantMessageCount) > 0) return false;
    if (nonNegativeFiniteNumber(diagnostics.deltaChars) > 0) return false;
    return true;
}

/**
 * @param {import('../frontend/gateways/dialog.js').TerminalDialogTurnResult} turnResult
 * @param {{
 *     actor: string;
 *     allowRecovery: boolean;
 *     runtimeState: ReturnType<typeof readTerminalRuntimeState>;
 * }} context
 * @returns {boolean}
 */
function shouldAttemptPostToolOnlyRecovery(turnResult, context) {
    if (!context.allowRecovery || context.actor !== 'user') return false;
    if (typeof turnResult.reply === 'string' && turnResult.reply.trim().length > 0) return false;
    if (hasPendingHumanInputOutcome(context.runtimeState)) return false;
    if (turnResult.semanticOutcome !== 'tool_only') return false;
    const diagnostics = turnResult.semanticDiagnostics;
    if (!diagnostics) return true;
    if (diagnostics.pendingHumanInput === true || diagnostics.pendingProtocolKind !== null) return false;
    if (nonNegativeFiniteNumber(diagnostics.assistantMessageCount) > 0) return false;
    if (nonNegativeFiniteNumber(diagnostics.deltaChars) > 0) return false;
    return nonNegativeFiniteNumber(diagnostics.toolSignalCount) > 0;
}

/**
 * @param {{
 *     actor: string;
 *     byok: ReturnType<typeof readConfiguredByokSummary>;
 *     materialization: ReturnType<typeof completeTerminalTurnMaterialization>;
 *     semanticOutcome?: import('../../agent/dialog/executors/turn-executor.js').DialogTurnSemanticResult['outcome'];
 *     semanticReplySource?: import('../../agent/dialog/executors/turn-executor.js').DialogTurnSemanticResult['replySource'];
 *     semanticDiagnostics?: import('../../agent/dialog/executors/turn-executor.js').DialogTurnSemanticResult['diagnostics'];
 *     quiescence?: Awaited<ReturnType<typeof waitForTerminalTurnMaterializationQuiescence>> | null;
 *     timestamp?: number;
 * }} input
 * @returns {{ expectedPendingInput: boolean; emptyOutputFailure: boolean }}
 */
function recordTerminalExplicitEmptyOutput(input) {
    const timestamp = input.timestamp ?? Date.now();
    const runtimeState = readTerminalRuntimeState();
    const classification = classifyTerminalEmptyOutput({
        materializationSource: input.materialization.source,
        runtimeStatus: runtimeState.status,
        pendingQuestionPresent: runtimeState.pendingQuestion !== null,
        pendingQuestionKind: runtimeState.pendingQuestionKind,
        semanticOutcome: input.semanticOutcome ?? null,
        semanticDiagnostics: input.semanticDiagnostics ?? null,
    });
    const semanticOutcome = classification.semanticOutcome;
    if (classification.kind === 'not_empty') {
        return {
            expectedPendingInput: classification.expectedPendingInput,
            emptyOutputFailure: classification.emptyOutputFailure,
        };
    }
    if (classification.kind === 'pending_human_input') {
        recordTerminalActivity('question', 'Turno sem transcript final aguardando input humano', {
            detail: `pergunta humana pendente · origem ${input.materialization.sourceDetail}`,
            source: 'dialog',
            severity: 'info',
            recordHistory: false,
        });
        return {
            expectedPendingInput: classification.expectedPendingInput,
            emptyOutputFailure: classification.emptyOutputFailure,
        };
    }

    const semanticDetail =
        `resultado ${semanticOutcome} · origem agent ${input.semanticReplySource ?? 'n/d'} · ` +
        `sinais tool ${input.semanticDiagnostics?.toolSignalCount ?? 0}`;
    const failureDetail =
        `autor ${input.actor} · origem ${input.materialization.sourceDetail} · ` +
        `fragmentos ${input.materialization.diagnostics.deltaSlices}/${input.materialization.diagnostics.deltaChars} caracteres · ` +
        `mensagens assistente ${input.materialization.diagnostics.assistantMessageCount} · ${semanticDetail}` +
        (input.quiescence ? ` · quiescência ${input.quiescence.settledBy}/${input.quiescence.waitedMs}ms` : '');

    if (classification.kind === 'tool_only' || classification.kind === 'protocol_transition') {
        const toolOnly = classification.kind === 'tool_only';
        reviseRecentTerminalTurnTraceStatus({ timestamp, status: 'completed' });
        recordTerminalActivity(
            'turn',
            toolOnly ? 'Turno tool-only sem síntese pública' : 'Transição de protocolo sem transcript',
            {
                detail: failureDetail,
                source: 'dialog',
                severity: toolOnly ? 'warn' : 'info',
            },
        );
        broadcastSse(
            'terminal.turn.non_text_outcome',
            withTerminalTurnCorrelation({
                source: 'terminal-dialog/non-text-outcome',
                actor: input.actor,
                semanticOutcome,
                semanticReplySource: input.semanticReplySource ?? null,
                semanticDiagnostics: input.semanticDiagnostics ?? null,
                sourceDetail: input.materialization.sourceDetail,
                pendingQuestionKind: runtimeState.pendingQuestionKind,
                runtimeStatus: runtimeState.status,
                timestamp,
            }),
        );
        println(
            terminalThemeRow(
                toolOnly ? 'Turno concluído' : 'Transição',
                toolOnly
                    ? 'tools executadas; a LLM-B não emitiu síntese pública'
                    : 'protocolo avançou sem resposta pública',
                { role: toolOnly ? 'warn' : 'info' },
            ),
        );
        if (toolOnly) {
            println(
                terminalThemeRow('Próximo passo', 'peça uma síntese pública ou continue com o próximo objetivo', {
                    role: 'command',
                }),
            );
        }
        return {
            expectedPendingInput: classification.expectedPendingInput,
            emptyOutputFailure: classification.emptyOutputFailure,
        };
    }

    reviseRecentTerminalTurnTraceStatus({ timestamp, status: 'failed' });
    const diagnosis = buildTerminalEmptyOutputDiagnosis({
        semanticOutcome,
        semanticReplySource: input.semanticReplySource ?? null,
        semanticDiagnostics: input.semanticDiagnostics ?? null,
        materialization: input.materialization,
        quiescence: input.quiescence ?? null,
    });
    recordTerminalActivity('error', 'Turno sem saída pública materializada', {
        detail: `${diagnosis.operatorSummary} · ${failureDetail} · sem pergunta humana ou formulário pendente`,
        source: 'dialog',
        severity: 'error',
    });
    try {
        defaultErrorTracker?.trackError?.(new Error('Turno sem saída pública materializada'), {
            source: 'terminal.dialog.empty_output',
            metadata: {
                actor: input.actor,
                semanticOutcome,
                semanticReplySource: input.semanticReplySource ?? null,
                cause: diagnosis.cause,
                evidence: diagnosis.evidence,
                action: diagnosis.action,
            },
        });
    } catch {
        // O rastreador de erro não pode interromper a apresentação operacional do terminal.
    }
    broadcastSse(
        'terminal.turn.empty_output',
        withTerminalTurnCorrelation({
            source: 'terminal-dialog/empty-output',
            actor: input.actor,
            sourceDetail: input.materialization.sourceDetail,
            deltaSlices: input.materialization.diagnostics.deltaSlices,
            deltaChars: input.materialization.diagnostics.deltaChars,
            assistantMessageCount: input.materialization.diagnostics.assistantMessageCount,
            semanticOutcome,
            semanticReplySource: input.semanticReplySource ?? null,
            semanticDiagnostics: input.semanticDiagnostics ?? null,
            cause: diagnosis.cause,
            evidence: diagnosis.evidence,
            operatorSummary: diagnosis.operatorSummary,
            operatorAction: diagnosis.action,
            pendingQuestionKind: runtimeState.pendingQuestionKind,
            runtimeStatus: runtimeState.status,
            quiescenceSettledBy: input.quiescence?.settledBy ?? null,
            quiescenceWaitedMs: input.quiescence?.waitedMs ?? null,
            timestamp,
        }),
    );
    println(
        terminalThemeRow('Turno vazio', 'LLM-B encerrou sem resposta pública e sem pergunta humana pendente', {
            role: 'error',
        }),
    );
    println(terminalThemeRow('Causa', diagnosis.cause, { role: 'warn' }));
    println(terminalThemeRow('Evidências', diagnosis.evidence, { role: 'muted' }));
    println(
        terminalThemeRow('Próximo passo', `${diagnosis.action} · /activity 40 · /events 60 · /byok health`, {
            role: 'command',
        }),
    );

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

    return {
        expectedPendingInput: classification.expectedPendingInput,
        emptyOutputFailure: classification.emptyOutputFailure,
    };
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
    const now = Date.now();
    const timestamp = formatTerminalTimeLabel(now, { mode: 'iso' });
    if (runtimeState.status === 'waiting_for_input' && runtimeState.pendingQuestionKind === 'question') {
        const questionText = String(runtimeState.pendingQuestion?.question ?? 'pergunta pendente')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160);
        const choices = Array.isArray(runtimeState.pendingQuestion?.choices)
            ? runtimeState.pendingQuestion.choices.join(', ')
            : '';
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('question', 'aguardando você')}` +
            `${terminalThemeText('muted', ` · pergunta ${questionText}`)}` +
            (choices ? terminalThemeText('muted', ` · opções ${choices}`) : '') +
            `${terminalThemeText('command', ' · /answer <texto> · /status')}` +
            `${terminalThemeText('muted', ` · ${timestamp}`)}`
        );
    }
    const elapsedMs = Math.max(0, now - startedAt);
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    const elapsedRatio = timeoutMs && timeoutMs > 0 ? elapsedMs / timeoutMs : 0;
    const elapsedRole = elapsedRatio >= 0.85 ? 'error' : elapsedRatio >= 0.6 ? 'warn' : 'muted';
    const timeoutLabel = timeoutMs === null ? 'watchdog' : `${Math.max(1, Math.round(timeoutMs / 1000))}s`;
    const strategyLabel =
        timeoutStrategy === 'disabled'
            ? 'sem timeout explícito'
            : timeoutStrategy === 'adaptive'
              ? 'adaptativo'
              : timeoutStrategy === 'explicit'
                ? 'explícito'
                : timeoutStrategy;
    const quickActions =
        elapsedMs >= 30_000
            ? terminalThemeText('command', ' · /status · /errors · /restart')
            : elapsedMs >= 15_000
              ? terminalThemeText('command', ' · /status · /errors')
              : '';
    return (
        `  ${terminalThemeText('assistant', 'LLM-B')} ` +
        `${terminalThemeText('thinking', 'pensando')}` +
        `${terminalThemeText('muted', ' · modelo ')}${terminalThemeText('assistant', model)}` +
        `${terminalThemeText('muted', ' · esforço ')}${terminalThemeText('thinking', effort)}` +
        `${terminalThemeText('muted', ' · decorrido ')}${terminalThemeText(elapsedRole, elapsed)}` +
        `${terminalThemeText('muted', ` · limite ${timeoutLabel} · estratégia ${strategyLabel}`)}` +
        `${terminalThemeText('muted', ` · ${timestamp}`)}` +
        quickActions
    );
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
                recordTerminalActivity('error', 'Boot da conversa bloqueado pela policy SDK', {
                    detail: message,
                    severity: 'warn',
                    source: 'sdk',
                });
                println('');
                println(terminalThemeHeadline('error', recoveryMessage.label, [recoveryMessage.headline]));
                println(terminalThemeRow('Detalhe', recoveryMessage.detail, { role: 'muted' }));
                println(terminalThemeRow('Ação', recoveryMessage.actionHint, { role: 'command' }));
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
            detail: 'Status=starting antes de iniciar conversa',
            source: 'dialog',
        });
        println(terminalThemeRow('Inicialização', 'aguardando boot do agente concluir', { role: 'muted' }));
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
        println(terminalThemeRow('Inicialização', 'preparando agente', { role: 'muted' }));
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
            detail: 'Há trabalho em andamento antes da conversa',
            source: 'dialog',
        });
        println(terminalThemeRow('Inicialização', 'aguardando agente concluir tarefa em andamento', { role: 'muted' }));
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const s = readTerminalRuntimeControlState().status;
            if (s === 'idle') break;
            if (s === 'stopped') {
                throw new Error(`Agente parado inesperadamente antes da conversa`);
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

    recordTerminalActivity('boot', 'Conectando conversa', {
        detail: 'Iniciando protocolo READY/REPLY do terminal',
        source: 'dialog',
    });
    println(terminalThemeRow('Conversa', 'conectando sessão permanente', { role: 'muted' }));
    const resumeSessionAttach = true;
    log('INFO', '[dialog] reanexando terminal sem boot prompt automático.');
    println(terminalThemeRow('Conversa', 'retomando sessão sem prompt inicial', { role: 'muted' }));
    await startTerminalDialogMode(resumeSessionAttach ? undefined : (BOOT_PROMPT ?? undefined), {
        resumeSessionAttach,
        onReady: () => {
            println('');
            println(terminalThemeHeadline('success', 'LLM-B pronta', ['pode começar']));
            println('');
        },
    });
    if (resumeSessionAttach) {
        markTerminalActivityIdle('Sessão retomada; aguardando próxima mensagem');
        const rl = getRl();
        // The boot banner can have painted the initial readline prompt before the dialog is ready.
        // A forced paint establishes the interactive boundary after the final ready message.
        if (rl) scheduleTerminalPromptRedraw(rl, buildUserPrompt(), { force: true });
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
                terminalThemeRow(
                    'Atenção',
                    `context window em ${(u * 100).toFixed(0)}%; risco de perda de contexto. Use /compact antes de continuar`,
                    {
                        role: 'error',
                    },
                ),
            );
        } else if (u >= 0.85) {
            println(
                terminalThemeRow(
                    'Atenção',
                    `context window em ${(u * 100).toFixed(0)}%; considere usar /compact em breve`,
                    {
                        role: 'warn',
                    },
                ),
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
        const budgetRole = byokBudget.severity === 'block' && admissionMode === 'block' ? 'error' : 'warn';
        println(terminalThemeRow('Orçamento BYOK', byokBudget.label, { role: budgetRole }));
        println(
            terminalThemeRow(
                'Ação',
                `/byok recommend reasoning safe · /compact · /byok use <perfil> · /byok model <id> · ${TERMINAL_BYOK_ADMISSION_MODE_ENV}=warn`,
                { role: 'command' },
            ),
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
                terminalThemeRow(
                    'Bloqueado',
                    'turno não enviado à rota BYOK; estimativa excede o limite declarado antes do streaming',
                    {
                        role: 'error',
                    },
                ),
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
    recordTerminalActivity('turn', actor === 'llm-a' ? 'Preparando resposta da LLM-A' : 'Preparando resposta', {
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
            terminalThemeRow(
                'Headers',
                `requestHeaders por turno detectados (${Object.keys(requestHeaders).join(', ')}); usando dispatch SDK direto com reanexo`,
                {
                    role: 'muted',
                },
            ),
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
                focusMode: 'background',
            });
            if (process.env['COPILOT_TERMINAL_DURABLE_WAITING_NARRATION'] === 'true') {
                println(
                    terminalThemeRow('LLM-B', `pensando · ${elapsedSeconds}s sem resposta visível`, { role: 'muted' }),
                );
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
                        terminalThemeRow(
                            'Anexos',
                            `${limitedParts.length} ${limitedParts.length === 1 ? 'anexo embutido' : 'anexos embutidos'}: ${attachments.map(describeQueuedAttachment).join(', ')}`,
                            { role: 'muted' },
                        ),
                    );
                }
            }
        } catch (embedErr) {
            println(
                terminalThemeRow('Anexos', `falha ao embutir anexos: ${toError(embedErr).message}`, { role: 'warn' }),
            );
        }
    }

    /** @type {ReturnType<typeof createDisplayState> | null} */
    let displayState = null;

    try {
        await ensureDialogLoop();

        if (actor === 'llm-a') {
            const tsNow = formatTerminalTimeLabel(Date.now(), { mode: 'dual' });
            println(SEPARATOR);
            println(terminalThemeHeadline('system', 'LLM-A', [`[${tsNow}]`]));
            println('');
            for (const line of message.split('\n')) {
                println(`  ${terminalThemeText('system', '│')}  ${line}`);
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

        /** @type {import('../frontend/gateways/dialog.js').TerminalDialogTurnResult} */
        let turnResult = await runTerminalDialogTurnDetailed(enrichedMessage, {
            timeout: timeoutDecision.timeoutMs,
            onDelta,
            onDeltaDiagnostic,
            onReasoning,
            ...(requestHeaders ? { requestHeaders } : {}),
        });
        /** @type {{
    attempted: boolean;
    attempts: number;
    firstOutcome: string | null;
    firstReplySource: string | null;
    recovered: boolean;
    durationMs: number | null;
} | null} */
        let emptyTurnRecovery = null;
        if (
            shouldAttemptPreActionEmptyTurnRecovery(turnResult, {
                actor,
                allowRecovery: !requestHeaders,
                runtimeState: readTerminalRuntimeState(),
            })
        ) {
            const recoveryStartedAt = Date.now();
            emptyTurnRecovery = {
                attempted: true,
                attempts: EMPTY_TURN_RECOVERY_MAX_ATTEMPTS,
                firstOutcome: turnResult.semanticOutcome ?? null,
                firstReplySource: turnResult.semanticReplySource ?? turnResult.replySource ?? null,
                recovered: false,
                durationMs: null,
            };
            recordTerminalActivity('thinking', 'Recuperando turno sem saída', {
                detail: 'tentativa 1/1 · sem tool, sem delta e sem pergunta pendente',
                source: 'dialog',
                severity: 'warn',
            });
            broadcastSse(
                'terminal.turn.empty_recovery',
                withTerminalTurnCorrelation({
                    source: 'terminal-dialog/empty-recovery',
                    actor,
                    attempt: 1,
                    maxAttempts: EMPTY_TURN_RECOVERY_MAX_ATTEMPTS,
                    reason: 'pre_action_empty_output',
                    firstOutcome: turnResult.semanticOutcome ?? null,
                    firstReplySource: turnResult.semanticReplySource ?? turnResult.replySource ?? null,
                    firstDiagnostics: turnResult.semanticDiagnostics ?? null,
                    timestamp: recoveryStartedAt,
                }),
            );
            println(
                terminalThemeRow(
                    'Recuperação',
                    'turno sem saída antes de qualquer tool; reenviando continuação segura uma vez',
                    { role: 'warn' },
                ),
            );
            turnResult = await runTerminalDialogTurnDetailed(EMPTY_TURN_RECOVERY_PROMPT, {
                timeout: timeoutDecision.timeoutMs,
                onDelta,
                onDeltaDiagnostic,
                onReasoning,
            });
            emptyTurnRecovery.durationMs = Date.now() - recoveryStartedAt;
            emptyTurnRecovery.recovered = typeof turnResult.reply === 'string' && turnResult.reply.trim().length > 0;
            recordTerminalActivity(
                emptyTurnRecovery.recovered ? 'turn' : 'error',
                emptyTurnRecovery.recovered
                    ? 'Turno recuperado após saída vazia'
                    : 'Recuperação de turno sem saída falhou',
                {
                    detail:
                        `${emptyTurnRecovery.durationMs}ms · ` +
                        `resultado ${turnResult.semanticOutcome ?? 'n/d'} · origem ${turnResult.semanticReplySource ?? turnResult.replySource}`,
                    source: 'dialog',
                    severity: emptyTurnRecovery.recovered ? 'info' : 'error',
                    recordHistory: true,
                },
            );
        }
        if (
            shouldAttemptPostToolOnlyRecovery(turnResult, {
                actor,
                allowRecovery: !requestHeaders,
                runtimeState: readTerminalRuntimeState(),
            })
        ) {
            const recoveryStartedAt = Date.now();
            emptyTurnRecovery = {
                attempted: true,
                attempts: EMPTY_TURN_RECOVERY_MAX_ATTEMPTS,
                firstOutcome: turnResult.semanticOutcome ?? null,
                firstReplySource: turnResult.semanticReplySource ?? turnResult.replySource ?? null,
                recovered: false,
                durationMs: null,
            };
            recordTerminalActivity('thinking', 'Recuperando síntese pós-tools', {
                detail: 'tentativa 1/1 · tools concluídas sem texto público',
                source: 'dialog',
                severity: 'warn',
            });
            broadcastSse(
                'terminal.turn.empty_recovery',
                withTerminalTurnCorrelation({
                    source: 'terminal-dialog/empty-recovery',
                    actor,
                    attempt: 1,
                    maxAttempts: EMPTY_TURN_RECOVERY_MAX_ATTEMPTS,
                    reason: 'post_tool_only_no_public_output',
                    firstOutcome: turnResult.semanticOutcome ?? null,
                    firstReplySource: turnResult.semanticReplySource ?? turnResult.replySource ?? null,
                    firstDiagnostics: turnResult.semanticDiagnostics ?? null,
                    timestamp: recoveryStartedAt,
                }),
            );
            println(
                terminalThemeRow('Recuperação', 'tools concluídas sem síntese; pedindo continuação segura uma vez', {
                    role: 'warn',
                }),
            );
            turnResult = await runTerminalDialogTurnDetailed(buildToolOnlyRecoveryPrompt(enrichedMessage), {
                timeout: timeoutDecision.timeoutMs,
                onDelta,
                onDeltaDiagnostic,
                onReasoning,
            });
            const recoveredRuntimeState = readTerminalRuntimeState();
            emptyTurnRecovery.durationMs = Date.now() - recoveryStartedAt;
            emptyTurnRecovery.recovered =
                (typeof turnResult.reply === 'string' && turnResult.reply.trim().length > 0) ||
                hasPendingHumanInputOutcome(recoveredRuntimeState) ||
                turnResult.semanticOutcome === 'pending_human_input';
            recordTerminalActivity(
                emptyTurnRecovery.recovered
                    ? hasPendingHumanInputOutcome(recoveredRuntimeState)
                        ? 'question'
                        : 'turn'
                    : 'error',
                emptyTurnRecovery.recovered
                    ? hasPendingHumanInputOutcome(recoveredRuntimeState)
                        ? 'Pergunta humana recuperada após tools'
                        : 'Síntese recuperada após tools'
                    : 'Recuperação pós-tools falhou',
                {
                    detail:
                        `${emptyTurnRecovery.durationMs}ms · ` +
                        `resultado ${turnResult.semanticOutcome ?? 'n/d'} · origem ${turnResult.semanticReplySource ?? turnResult.replySource}`,
                    source: 'dialog',
                    severity: emptyTurnRecovery.recovered ? 'info' : 'error',
                    recordHistory: true,
                },
            );
        }
        const quiescence =
            turnResult.reply.trim().length === 0 && !hasPendingHumanInputOutcome(readTerminalRuntimeState())
                ? await waitForTerminalTurnMaterializationQuiescence()
                : null;
        if (quiescence && quiescence.waitedMs > 0) {
            recordTerminalActivity('turn', 'Reconciliação de saída pública concluída', {
                detail: `${quiescence.settledBy} · ${quiescence.waitedMs}ms`,
                source: 'dialog',
                recordHistory: false,
                updateCurrent: false,
            });
        }
        const materializedReply = completeTerminalTurnMaterialization({
            directReply: turnResult.reply,
            directSource: turnResult.replySource,
        });
        const emptyOutput = recordTerminalExplicitEmptyOutput({
            actor,
            byok: byokSummary,
            materialization: materializedReply,
            ...(turnResult.semanticOutcome !== undefined ? { semanticOutcome: turnResult.semanticOutcome } : {}),
            ...(turnResult.semanticReplySource !== undefined
                ? { semanticReplySource: turnResult.semanticReplySource }
                : {}),
            ...(turnResult.semanticDiagnostics !== undefined
                ? { semanticDiagnostics: turnResult.semanticDiagnostics }
                : {}),
            quiescence,
        });
        const reply = materializedReply.reply ?? turnResult.reply;
        const effectiveReplySource = materializedReply.source;
        const durationMs = Date.now() - t0;
        const replyVisibleChars = typeof reply === 'string' ? measureVisibleTerminalChars(reply) : 0;

        recordTerminalActivity('turn', 'Reply do turno explícito resolvido', {
            detail:
                `canal ${turnResult.channel} · origem ${effectiveReplySource} · ` +
                `detalhe ${materializedReply.sourceDetail} · caracteres ${typeof reply === 'string' ? reply.length : 0} · ` +
                `visíveis ${replyVisibleChars} · fragmentos ${materializedReply.diagnostics.deltaSlices}/${materializedReply.diagnostics.deltaChars} caracteres · ` +
                `mensagens assistente ${materializedReply.diagnostics.assistantMessageCount}`,
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

        const toolClaimAuditFindings = auditAssistantToolClaims({
            reply: typeof reply === 'string' ? reply : null,
            projection: readTerminalTurnTraceProjection(20),
        });

        renderStreamingFooter(displayState, durationMs);
        if (renderAssistantToolClaimAuditFindings(toolClaimAuditFindings)) {
            recordTerminalActivity('system', 'Verificação de tools encontrou divergência', {
                detail: `${toolClaimAuditFindings.length} alegação sem lifecycle comprovado`,
                source: 'dialog/tool-claim-audit',
                severity: 'warn',
                recordHistory: true,
            });
            broadcastSse(
                'assistant.tool_claim_audit',
                withTerminalTurnCorrelation({
                    findings: toolClaimAuditFindings,
                    timestamp: Date.now(),
                    source: 'terminal.dialog.engine/tool-claim-audit',
                }),
            );
        }
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
                quiescenceSettledBy: quiescence?.settledBy ?? null,
                quiescenceWaitedMs: quiescence?.waitedMs ?? null,
                semanticOutcome: turnResult.semanticOutcome ?? null,
                semanticReplySource: turnResult.semanticReplySource ?? null,
                semanticDiagnostics: turnResult.semanticDiagnostics ?? null,
                emptyTurnRecovery,
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
            // `assistant.usage` é a telemetria canônica no billing usage-based. `lastPrInfo` permanece somente como
            // fallback para snapshots persistidos por versões antigas do runtime.
            const usageInfo = llmUsage ?? prInfo;
            if (ctxWin || usageInfo) {
                const parts = [];
                if (usageInfo) {
                    const modelBilling = normalizeTerminalModelBillingProjection(usageInfo, latestRuntimeState.model);
                    if (llmUsage === null && readConfiguredByokSummary().enabled) {
                        parts.push('billing/quota legacy');
                    }
                    if (modelBilling.mismatch) {
                        if (modelBilling.configuredModel) {
                            parts.push(`modeloCfg=${terminalThemeText('thinking', modelBilling.configuredModel)}`);
                        }
                        if (modelBilling.billedModel) {
                            parts.push(`modeloCobrado=${terminalThemeText('assistant', modelBilling.billedModel)}`);
                        }
                    } else if (modelBilling.displayModel !== '-') {
                        parts.push(
                            `${llmUsage !== null ? 'LLM' : 'modelo legacy'} ${terminalThemeText('assistant', modelBilling.displayModel)}`,
                        );
                    }
                    if (modelBilling.cost !== null) {
                        parts.push(`custo ${terminalThemeText('warn', modelBilling.cost.toFixed(4))}`);
                    }
                }
                if (ctxWin) {
                    parts.push(`contexto ${(ctxWin.utilization * 100).toFixed(0)}%`);
                    parts.push(
                        `${ctxWin.tokens.toLocaleString('pt-BR')}/${ctxWin.tokenLimit.toLocaleString('pt-BR')} tokens`,
                    );
                }
                println(terminalThemeRow('Uso', parts.join(' · '), { role: 'muted' }));
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
            const byokFailurePresentation = presentByokTurnFailure(byokFailure);
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
            recordTerminalActivity('error', 'Falha da rota BYOK no turno', {
                detail: `${byokFailurePresentation.summary} · ${byokFailurePresentation.destination} · ${byokFailurePresentation.technicalDetail}`,
                severity: 'error',
                source: 'dialog',
            });
            println(
                terminalThemeRow(byokFailurePresentation.title, byokFailurePresentation.summary, { role: 'error' }),
            );
            println(terminalThemeRow('Destino', byokFailurePresentation.destination, { role: 'muted' }));
            if (byokFailurePresentation.window) {
                println(terminalThemeRow('Janela', byokFailurePresentation.window, { role: 'warn' }));
            }
            println(terminalThemeRow('Ação', byokFailurePresentation.action, { role: 'command' }));
            await printByokAutoAfterFailureHint(byokFailure);
        } else {
            clearTerminalTurnMaterialization();
            recordTerminalActivity('error', 'Erro no turno', {
                detail: err.message,
                severity: 'error',
                source: 'dialog',
            });
            println(terminalThemeRow('Erro', err.message, { role: 'error' }));
        }
        if (byokFailure) {
            log(
                'WARN',
                `[TerminalServer] Turno BYOK encerrado após apresentação operacional ao usuário: ${err.message}`,
            );
        } else {
            log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${err.message}`);
        }
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
            deferTerminalIdlePromptRedraw();
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
