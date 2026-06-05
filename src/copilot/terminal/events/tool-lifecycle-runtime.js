// @ts-check
/**
 * Runtime canônico de apresentação/narração de tools no terminal.
 *
 * Este módulo concentra o fluxo único de tool UX no terminal:
 *
 * - atualiza ToolCallRegistry session-scoped;
 * - grava activity-state e turn-trace;
 * - imprime narrativa rica no stdout local;
 * - emite exclusivamente `tool.lifecycle` via SSE.
 *
 * Os adapters (`agent-runtime-events`, `sdk-session-events`, `io-activity-events`) viram camadas finas de tradução da
 * origem do evento para este runtime canônico.
 *
 * @module copilot/terminal/tool-lifecycle-runtime
 */

import { recordToolCall } from '#copilot/observability';
import { getShowToolActivity } from '../../presentation/state/index.js';
import { broadcastSse, clearInlineStatus, println, writeInlineStatus } from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/index.js';
import {
    completeTerminalTurnToolCall,
    getTerminalDetailLevel,
    recordTerminalActivity,
    recordTerminalToolLifecycleDiagnostic,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
    terminalThemeRow,
    terminalThemeText,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';
import { printTerminalHumanQuestionCard } from './human-question-renderer.js';
import { renderTerminalIntent } from './intent-renderer.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalDiagnosticId,
    compactTerminalToolText,
    extractTerminalToolArgsPayload,
    extractTerminalToolResultPayload,
    isGenericTerminalToolName,
    mapTerminalToolOperationRole,
} from './tool-activity-presenter.js';
import {
    buildToolLifecycleComplete,
    buildToolLifecycleExternalCompleted,
    buildToolLifecycleExternalRequested,
    buildToolLifecycleIoOp,
    buildToolLifecyclePartialResult,
    buildToolLifecycleProgress,
    buildToolLifecycleStart,
    buildToolLifecycleUserRequested,
} from './tool-lifecycle-event.js';

const DURABLE_TOOL_PROGRESS_INTERVAL_MS = 4_000;
const DURABLE_TOOL_PROGRESS_PERCENT_STEP = 25;

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function shouldSuppressTerminalToolNarration(toolName) {
    return toolName === 'ask_user';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function objectArgsOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {Record<string, unknown>} evt
 * @param {Record<string, unknown>} [fallback]
 * @returns {Record<string, unknown>}
 */
function extractToolArgsOrFallback(evt, fallback = {}) {
    const args = extractTerminalToolArgsPayload(evt);
    return Object.keys(args).length > 0 ? args : fallback;
}

/**
 * @param {string | null | undefined} requestId
 * @returns {string | null}
 */
function renderToolRequestLabel(requestId) {
    const compacted = compactTerminalDiagnosticId(requestId, 18);
    return compacted ? `pedido ${compacted}` : null;
}

/**
 * @param {string | null | undefined} requestId
 * @returns {string}
 */
function renderOptionalToolRequestDetail(requestId) {
    const label = renderToolRequestLabel(requestId);
    return label ? ` · ${label}` : '';
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {boolean}
 */
function isHumanQuestionPresentation(presentation) {
    return presentation.operation === 'ask';
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {boolean}
 */
function isIntentPresentation(presentation) {
    return (
        presentation.operation === 'intent' ||
        isReportIntentTool(presentation.canonicalToolName ?? presentation.toolName)
    );
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {import('../state/activity-state.js').TerminalActivityPhase}
 */
function terminalActivityPhaseForPresentation(presentation) {
    if (isHumanQuestionPresentation(presentation)) return 'question';
    if (isIntentPresentation(presentation)) return 'turn';
    return 'tool';
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {'start' | 'progress' | 'partial' | 'complete' | 'user_requested'} stage
 * @param {boolean | null} [success=null]
 * @returns {string}
 */
function terminalActivityLabelForPresentation(presentation, stage, success = null) {
    if (isHumanQuestionPresentation(presentation)) {
        if (stage === 'complete') return success === false ? 'Pergunta falhou' : 'Pergunta respondida';
        if (stage === 'user_requested') return 'Pergunta ao operador aguardando resposta';
        return 'Pergunta ao operador';
    }
    if (isIntentPresentation(presentation)) {
        if (stage === 'complete') return success === false ? 'Intenção falhou' : 'Intenção registrada';
        return 'Intenção capturada';
    }
    if (stage === 'progress') return 'Progresso da ferramenta';
    if (stage === 'partial') return 'Resultado parcial da ferramenta';
    if (stage === 'complete') return success === false ? 'Ferramenta falhou' : 'Ferramenta concluída';
    if (stage === 'user_requested') return 'Ferramenta aguarda operador';
    return 'Ferramenta em uso';
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {string}
 */
function terminalActivityToolNameForPresentation(presentation) {
    return presentation.displayToolName;
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
function isReportIntentTool(toolName) {
    const normalized = toolName.trim().toLowerCase();
    return (
        normalized === 'report_intent' ||
        normalized === 'report_intent_local' ||
        normalized.endsWith('.report_intent') ||
        normalized.endsWith('.report_intent_local')
    );
}

/**
 * Tools diagnosticas nativas do SDK nao passam necessariamente pelo wrapper canonico de tools locais, mas ainda sao
 * atividade operacional real da LLM-B e devem aparecer em `/tools diag`.
 *
 * @param {string} toolName
 * @param {number} durationMs
 * @param {boolean} success
 * @returns {void}
 */
function recordTerminalDiagnosticToolStats(toolName, durationMs, success) {
    if (!isReportIntentTool(toolName)) return;
    recordToolCall(toolName, durationMs, success);
}

/**
 * @param {import('./tool-lifecycle-event.js').ToolLifecycleEvent} event
 * @returns {void}
 */
function broadcastToolLifecycle(event) {
    recordTerminalToolLifecycleDiagnostic(event);
    broadcastSse('tool.lifecycle', withTerminalTurnCorrelation(event));
}

/**
 * @param {number} bytes
 * @returns {string | null}
 */
function formatToolBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {number} durationMs
 * @returns {string | null}
 */
function formatToolDurationMs(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    return durationMs < 1000 ? `${Math.max(1, Math.round(durationMs))}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * @param {import('../state/tool-call-registry.js').ToolCallEntry | null | undefined} entry
 * @param {number} sdkDurationMs
 * @returns {string}
 */
function buildToolCompletionDurationLabel(entry, sdkDurationMs) {
    const sdkLabel = formatToolDurationMs(sdkDurationMs);
    const io = entry?.io ?? null;
    if (!io || io.count <= 0) return sdkLabel ?? 'n/d';

    const ioDurationLabel = formatToolDurationMs(io.totalDurationMs);
    const bytesLabel = formatToolBytes(io.bytesRead + io.bytesWritten);
    const ioParts = [`io ${io.count} op${io.count === 1 ? '' : 's'}`, ioDurationLabel, bytesLabel].filter(Boolean);
    return [sdkLabel ?? null, ioParts.join(' · ')].filter(Boolean).join(' · ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrParsedJson(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {Record<string, unknown>} */ (value);
    }
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} keys
 * @returns {string | null}
 */
function readFirstString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {{ envelope: Record<string, unknown>; parsed: Record<string, unknown> | null } | null}
 */
function extractToolResultEnvelope(evt) {
    const envelope =
        objectOrParsedJson(evt['toolResult']) ??
        objectOrParsedJson(evt['result']) ??
        objectOrParsedJson(evt['output']) ??
        objectOrParsedJson(objectOrParsedJson(evt['input'])?.['toolResult']) ??
        null;
    if (!envelope) return null;
    const parsed =
        objectOrParsedJson(envelope['textResultForLlm']) ??
        objectOrParsedJson(envelope['result']) ??
        objectOrParsedJson(envelope['output']) ??
        null;
    return { envelope, parsed };
}

/**
 * @param {Record<string, unknown>} evt
 * @param {boolean} fallback
 * @returns {{ success: boolean; exitCode: number | null; durationMs: number | null; hasStructuredResult: boolean }}
 */
function inferToolResultSuccess(evt, fallback) {
    const result = extractToolResultEnvelope(evt);
    const explicitSuccess = typeof evt['success'] === 'boolean' ? evt['success'] : null;
    const envelopeSuccess =
        result?.envelope && typeof result.envelope['success'] === 'boolean'
            ? /** @type {boolean} */ (result.envelope['success'])
            : null;
    const parsedSuccess =
        result?.parsed && typeof result.parsed['success'] === 'boolean'
            ? /** @type {boolean} */ (result.parsed['success'])
            : null;
    const resultType = typeof result?.envelope?.['resultType'] === 'string' ? result.envelope['resultType'] : null;
    const exitCode =
        numberOrNull(result?.parsed?.['exitCode']) ??
        numberOrNull(result?.envelope?.['exitCode']) ??
        numberOrNull(evt['exitCode']);
    const durationMs =
        numberOrNull(result?.parsed?.['durationMs']) ??
        numberOrNull(result?.envelope?.['durationMs']) ??
        numberOrNull(evt['durationMs']);
    const failed =
        explicitSuccess === false ||
        envelopeSuccess === false ||
        parsedSuccess === false ||
        resultType === 'error' ||
        (exitCode !== null && exitCode !== 0);
    const succeeded =
        explicitSuccess === true ||
        envelopeSuccess === true ||
        parsedSuccess === true ||
        resultType === 'success' ||
        exitCode === 0;
    return {
        success: failed ? false : succeeded ? true : fallback,
        exitCode,
        durationMs,
        hasStructuredResult: Boolean(result),
    };
}

/**
 * @param {string} durationLabel
 * @param {number | null} exitCode
 * @returns {string}
 */
function appendExitCodeToDurationLabel(durationLabel, exitCode) {
    if (exitCode === null) return durationLabel;
    return `${durationLabel} · saída ${exitCode}`;
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} fallbackName
 * @returns {string}
 */
function resolveEffectiveExternalToolName(evt, fallbackName) {
    const candidates = [
        evt,
        evt['data'],
        evt['payload'],
        evt['input'],
        objectOrParsedJson(evt['data']),
        objectOrParsedJson(evt['payload']),
        objectOrParsedJson(evt['input']),
    ];
    for (const candidate of candidates) {
        const object = objectOrParsedJson(candidate);
        if (!object) continue;
        const name = readFirstString(object, [
            'toolName',
            'tool_name',
            'name',
            'mcpToolName',
            'requestedTool',
            'targetTool',
            'tool',
        ]);
        if (name && !isGenericTerminalToolName(name)) return name;
    }
    return fallbackName;
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {Record<string, unknown>[]}
 */
function collectIntentPayloadCandidates(evt) {
    const candidates = [
        evt,
        evt['data'],
        evt['args'],
        evt['arguments'],
        evt['input'],
        evt['result'],
        evt['output'],
        objectOrParsedJson(evt['result']),
        objectOrParsedJson(evt['output']),
        objectOrParsedJson(evt['data']),
    ];
    return candidates.flatMap((candidate) => {
        const object = objectOrParsedJson(candidate);
        if (!object) return [];
        const nested = [object['data'], object['payload'], object['result'], object['output']]
            .map(objectOrParsedJson)
            .filter(Boolean);
        return [object, .../** @type {Record<string, unknown>[]} */ (nested)];
    });
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} fallbackToolName
 * @returns {{ intent: string; tool: string | null; risk: unknown } | null}
 */
function extractReportIntentPayload(evt, fallbackToolName) {
    for (const candidate of collectIntentPayloadCandidates(evt)) {
        const intent = readFirstString(candidate, ['intent', 'message', 'summary', 'description']);
        if (!intent) continue;
        const tool =
            readFirstString(candidate, ['tool', 'toolName', 'tool_name', 'targetTool', 'requestedTool', 'operation']) ??
            fallbackToolName;
        return {
            intent,
            tool,
            risk: candidate['risk'] ?? candidate['riskLevel'] ?? candidate['severity'] ?? 'unknown',
        };
    }
    return null;
}

/**
 * @param {{
 *     toolName: string;
 *     evt: Record<string, unknown>;
 *     source: string;
 *     toolCallId?: string | null;
 * }} input
 * @returns {void}
 */
function renderReportIntentToolPayload(input) {
    if (!isReportIntentTool(input.toolName)) return;
    const payload = extractReportIntentPayload(input.evt, input.toolName);
    if (!payload) return;
    renderTerminalIntent({
        intent: payload.intent,
        tool: payload.tool,
        risk: payload.risk,
        source: input.source,
        toolCallId: input.toolCallId ?? null,
    });
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {'started' | 'requested' | 'completed' | 'failed' | 'user_requested'} status
 * @param {string | null} toolCallId
 * @param {boolean | null} [success]
 * @returns {void}
 */
function recordToolTurnProjection(presentation, status, toolCallId, success = null) {
    recordTerminalTurnToolActivity({
        toolName: presentation.canonicalToolName ?? presentation.toolName,
        operation: presentation.operation,
        path: presentation.path,
        target: presentation.target,
        source: 'sdk',
        status,
        ...(toolCallId ? { toolCallId } : {}),
        ...(success !== null ? { success } : {}),
    });
    for (const fileTarget of presentation.fileTargets) {
        if (!fileTarget || fileTarget === presentation.path) continue;
        recordTerminalTurnFileActivity({
            path: fileTarget,
            operation: presentation.operation,
            source: 'sdk',
            dedupeKey: toolCallId ? `${toolCallId}\u241fextra\u241f${fileTarget}` : null,
        });
    }
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {void}
 */
function printToolStart(presentation) {
    if (!getShowToolActivity()) return;
    const compactDetail = getTerminalDetailLevel() === 'compact';
    if (presentation.operation === 'ask') {
        const question = presentation.target ?? presentation.startLine.replace(/^aguardando decisão humana:\s*/iu, '');
        printTerminalHumanQuestionCard(println, {
            question,
            choices: presentation.questionChoices,
            allowFreeform: presentation.allowFreeformQuestion ?? true,
            source: 'tool',
            state: 'aguardando resposta',
            compact: compactDetail,
            includeDivider: false,
            includeShortcuts: !compactDetail,
            maxQuestionChars: compactDetail ? 96 : 160,
        });
        return;
    }
    const operationRole = mapTerminalToolOperationRole(presentation.operation);
    println(
        compactDetail
            ? terminalThemeRow(
                  'Ferramenta',
                  `${terminalThemeText('tool', compactTerminalToolText(presentation.displayToolName, 28))} · ${terminalThemeText(operationRole, compactTerminalToolText(presentation.startLine, 86))}`,
                  { role: operationRole },
              )
            : terminalThemeRow(
                  'Ferramenta',
                  `${terminalThemeText('tool', presentation.displayToolName)} · ${terminalThemeText(operationRole, presentation.startLine)}`,
                  { role: operationRole },
              ),
    );
}

/**
 * @param {import('../state/tool-call-registry.js').ToolCallEntry | null} entry
 * @param {number | null} progress
 * @param {string | null} progressMessage
 * @returns {boolean}
 */
function shouldPersistToolProgressMilestone(entry, progress, progressMessage) {
    if (getTerminalDetailLevel() !== 'compact') return false;
    if (progress === null && !progressMessage) return false;
    const now = Date.now();
    const lastDurableAt = entry?.lastDurableProgressAt ?? 0;
    const intervalElapsed = lastDurableAt <= 0 || now - lastDurableAt >= DURABLE_TOOL_PROGRESS_INTERVAL_MS;
    const messageChanged = Boolean(progressMessage) && progressMessage !== entry?.lastDurableProgressMessage;
    const progressJumpedEnough =
        progress !== null &&
        (entry?.lastProgress == null || Math.abs(progress - entry.lastProgress) >= DURABLE_TOOL_PROGRESS_PERCENT_STEP);
    if (progress === 100) return true;
    if (!entry) return true;
    if (progressMessage && entry.lastDurableProgressAt <= 0) return true;
    if (messageChanged && intervalElapsed) return true;
    if (progressJumpedEnough && intervalElapsed) return true;
    return false;
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {number | null} progress
 * @param {string | null} progressMessage
 * @param {{ persistInHistory?: boolean }} [options]
 * @returns {void}
 */
function printToolProgress(presentation, progress, progressMessage, options = {}) {
    if (!getShowToolActivity()) return;
    const compactDetail = getTerminalDetailLevel() === 'compact';
    const suffix = progressMessage ?? (progress !== null ? `${progress}%` : '');
    const progressLine =
        `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(presentation.progressLinePrefix, 56) : presentation.progressLinePrefix)} ${terminalThemeText('muted', suffix)}`.trimEnd();
    if (compactDetail) {
        if (options.persistInHistory) println(progressLine);
        writeInlineStatus(progressLine);
        return;
    }
    println(progressLine);
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {boolean} success
 * @param {string} durationLabel
 * @param {string | null} [fallbackToolCallId]
 * @returns {void}
 */
function printToolComplete(presentation, success, durationLabel, fallbackToolCallId = null) {
    if (!getShowToolActivity()) return;
    const compactDetail = getTerminalDetailLevel() === 'compact';
    const operationRole = mapTerminalToolOperationRole(presentation.operation);
    if (compactDetail) clearInlineStatus();
    const hasOnlyCallIdTarget =
        typeof presentation.target === 'string' &&
        presentation.target.length > 0 &&
        fallbackToolCallId !== null &&
        presentation.target === fallbackToolCallId;
    const lowFidelityGeneric =
        (presentation.canonicalToolName ?? presentation.toolName) === 'tool' &&
        presentation.operation === 'unknown' &&
        presentation.fileTargets.length === 0 &&
        presentation.urlTargets.length === 0 &&
        presentation.searchTerms.length === 0 &&
        (hasOnlyCallIdTarget || !presentation.target);
    const lowFidelitySuffix =
        lowFidelityGeneric && fallbackToolCallId ? ' · detalhes técnicos disponíveis em /tools diag' : '';
    const completionDetail = `${presentation.completeLine(success, durationLabel)}${lowFidelitySuffix}`;
    const renderedName = lowFidelityGeneric && fallbackToolCallId ? 'Ferramenta interna' : presentation.displayToolName;
    println(
        compactDetail
            ? terminalThemeRow(
                  success ? 'Concluído' : 'Falhou',
                  `${terminalThemeText('tool', compactTerminalToolText(renderedName, 28))} · ${terminalThemeText(operationRole, compactTerminalToolText(completionDetail, 88))}`,
                  { role: success ? 'success' : 'error' },
              )
            : terminalThemeRow(
                  success ? 'Concluído' : 'Falhou',
                  `${terminalThemeText('tool', renderedName)} · ${terminalThemeText(operationRole, completionDetail)}`,
                  { role: success ? 'success' : 'error' },
              ),
    );
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @returns {boolean}
 */
function hasSemanticToolTarget(presentation) {
    return Boolean(
        presentation.path ||
        presentation.lineRange ||
        presentation.fileTargets.length > 0 ||
        presentation.urlTargets.length > 0 ||
        presentation.searchTerms.length > 0 ||
        presentation.patchFiles.length > 0 ||
        presentation.commands.length > 0 ||
        presentation.filters.length > 0 ||
        presentation.resultCount !== null ||
        presentation.resultSummary,
    );
}

/**
 * @returns {boolean}
 */
function isTerminalWaitingForHumanQuestion() {
    const runtime = readTerminalRuntimeState();
    return runtime.status === 'waiting_for_input' && runtime.pendingQuestionKind === 'question';
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {{ success: boolean; hasStructuredResult: boolean }} result
 * @returns {boolean}
 */
function shouldDeferExternalCompletionUntilPostToolUse(presentation, result) {
    if (!result.success || result.hasStructuredResult) return false;
    return presentation.operation === 'run';
}

/**
 * @param {import('../state/tool-call-registry.js').ToolCallEntry | null | undefined} entry
 * @param {string | null | undefined} toolCallId
 * @param {ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>} registry
 * @returns {boolean}
 */
function shouldPrintToolNarration(entry, toolCallId, registry) {
    if (!getShowToolActivity()) return false;
    if (entry?.suppressLiveNarration === true) return false;
    if (toolCallId && registry.shouldSuppressLiveNarration(toolCallId)) return false;
    if (isTerminalWaitingForHumanQuestion()) return false;
    return true;
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: Record<string, unknown>;
 * }} input
 * @returns {void}
 */
export function handleTerminalNativeToolStart({ registry, evt }) {
    const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
    const rawName = /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
    const rawArgs = extractTerminalToolArgsPayload(evt);
    const presentation = buildTerminalToolActivityPresentation(evt, rawName);
    const name = presentation.toolName;
    if (shouldSuppressTerminalToolNarration(name)) return;
    renderReportIntentToolPayload({
        toolName: name,
        evt: { ...evt, args: rawArgs },
        source: `tool/${name}`,
        toolCallId,
    });
    const canonicalName = presentation.canonicalToolName ?? name;
    if (toolCallId && registry.isInFlight(toolCallId)) {
        registry.touch(toolCallId, { rawArgs, presentation });
        return;
    }
    /** @type {import('../state/tool-call-registry.js').ToolCallEntry | null} */
    let entry = null;
    if (registry.isNameInFlight(name)) {
        if (toolCallId) {
            registry.register(toolCallId, name, 'native', {
                canonicalName,
                rawArgs,
                presentation,
            });
        }
        return;
    }
    if (toolCallId) {
        entry = registry.register(toolCallId, name, 'native', {
            canonicalName,
            rawArgs,
            presentation,
        });
    }
    recordToolTurnProjection(presentation, 'started', toolCallId, null);
    recordTerminalActivity(
        terminalActivityPhaseForPresentation(presentation),
        terminalActivityLabelForPresentation(presentation, 'start'),
        {
            detail: presentation.detail,
            toolName: terminalActivityToolNameForPresentation(presentation),
            toolTarget: presentation.target,
            source: 'sdk',
        },
    );
    if (shouldPrintToolNarration(entry, toolCallId, registry)) printToolStart(presentation);
    broadcastToolLifecycle(
        buildToolLifecycleStart({
            toolCallId,
            toolName: name,
            canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: Record<string, unknown>;
 * }} input
 * @returns {void}
 */
export function handleTerminalNativeToolProgress({ registry, evt }) {
    const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
    const entry = toolCallId ? registry.getEntry(toolCallId) : null;
    const name =
        entry?.canonicalName ?? entry?.toolName ?? /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
    if (shouldSuppressTerminalToolNarration(name)) return;
    const presentation = entry?.presentation ?? buildTerminalToolActivityPresentation(evt, name);
    const progress = typeof evt?.['progress'] === 'number' ? Number(evt['progress']) : null;
    const progressMessage = typeof evt?.['progressMessage'] === 'string' ? evt['progressMessage'] : null;
    const shouldPrint =
        shouldPrintToolNarration(entry, toolCallId, registry) &&
        ((progress !== null &&
            (entry?.lastProgress == null || Math.abs(progress - entry.lastProgress) >= 5 || progress === 100)) ||
            (progressMessage !== null && progressMessage !== entry?.lastProgressMessage));
    const persistMilestone = shouldPrint && shouldPersistToolProgressMilestone(entry, progress, progressMessage);
    const now = persistMilestone ? Date.now() : 0;
    if (toolCallId) {
        registry.touch(toolCallId, {
            presentation,
            progress,
            progressMessage,
            ...(persistMilestone
                ? {
                      lastDurableProgressAt: now,
                      lastDurableProgressMessage: progressMessage ?? entry?.lastDurableProgressMessage ?? null,
                  }
                : {}),
        });
    }
    const effectiveDetail =
        progressMessage ?? (progress !== null ? `${presentation.detail} · ${progress}%` : presentation.detail);
    const activityLabel = persistMilestone
        ? terminalActivityLabelForPresentation(presentation, 'progress')
        : terminalActivityLabelForPresentation(presentation, 'start');
    recordTerminalActivity(terminalActivityPhaseForPresentation(presentation), activityLabel, {
        detail: effectiveDetail,
        toolName: terminalActivityToolNameForPresentation(presentation),
        toolTarget: presentation.target,
        progress,
        source: 'sdk',
        recordHistory: persistMilestone,
    });
    if (shouldPrint) {
        printToolProgress(presentation, progress, progressMessage, { persistInHistory: persistMilestone });
    }
    broadcastToolLifecycle(
        buildToolLifecycleProgress({
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
            progress,
            progressMessage,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: Record<string, unknown>;
 * }} input
 * @returns {void}
 */
export function handleTerminalNativeToolPartialResult({ registry, evt }) {
    const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
    const entry = toolCallId ? registry.getEntry(toolCallId) : null;
    const name =
        entry?.canonicalName ?? entry?.toolName ?? /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
    if (shouldSuppressTerminalToolNarration(name)) return;
    const partialOutput = typeof evt?.['partialOutput'] === 'string' ? evt['partialOutput'] : '';
    if (!partialOutput) return;
    const presentation = entry?.presentation ?? buildTerminalToolActivityPresentation({}, name);
    if (toolCallId) {
        registry.touch(toolCallId, { presentation });
    }
    recordTerminalActivity(
        terminalActivityPhaseForPresentation(presentation),
        terminalActivityLabelForPresentation(presentation, 'partial'),
        {
            detail: partialOutput,
            toolName: terminalActivityToolNameForPresentation(presentation),
            toolTarget: presentation.target,
            source: 'sdk',
            recordHistory: false,
        },
    );
    broadcastToolLifecycle(
        buildToolLifecyclePartialResult({
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
            partialOutput,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: Record<string, unknown>;
 * }} input
 * @returns {void}
 */
export function handleTerminalNativeToolComplete({ registry, evt }) {
    const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
    const success = Boolean(evt?.['success']);
    const requestId = typeof evt?.['requestId'] === 'string' ? evt['requestId'] : null;
    const eventName =
        typeof evt?.['toolName'] === 'string' && evt['toolName'].length > 0
            ? evt['toolName']
            : typeof evt?.['name'] === 'string' && evt['name'].length > 0
              ? evt['name']
              : null;
    const entry =
        (toolCallId ? registry.getEntry(toolCallId) : null) ??
        registry.resolveByName(eventName) ??
        (eventName ? null : registry.resolveSingleInFlight('native'));
    const name = entry?.canonicalName ?? entry?.toolName ?? eventName ?? 'tool';
    if (shouldSuppressTerminalToolNarration(name) && success) {
        const suppressedToolCallId = entry?.toolCallId ?? toolCallId;
        if (entry?.toolCallId) registry.complete(entry.toolCallId, success);
        if (suppressedToolCallId) completeTerminalTurnToolCall({ toolCallId: suppressedToolCallId, success });
        return;
    }
    const suppressByInFlightName = entry ? false : registry.isNameInFlight(name);
    if (
        suppressByInFlightName ||
        registry.wasNameRecentlyCompleted(name, requestId) ||
        registry.wasRecentlyCompleted(toolCallId, requestId)
    ) {
        return;
    }
    renderReportIntentToolPayload({
        toolName: name,
        evt: {
            ...evt,
            args: extractToolArgsOrFallback(evt, entry?.rawArgs ?? {}),
        },
        source: `tool/${name}`,
        toolCallId,
    });
    const effectiveToolCallId = entry?.toolCallId ?? toolCallId;
    const completedEntry =
        effectiveToolCallId && registry.getEntry(effectiveToolCallId)?.kind === 'native'
            ? registry.complete(effectiveToolCallId, success)
            : null;
    const metricEntry = completedEntry ?? entry;
    const completionPresentation = buildTerminalToolActivityPresentation(
        {
            ...evt,
            args: extractToolArgsOrFallback(evt, entry?.rawArgs ?? {}),
            result: extractTerminalToolResultPayload(evt),
        },
        name,
    );
    const presentation = hasSemanticToolTarget(completionPresentation)
        ? completionPresentation
        : (entry?.presentation ?? completionPresentation);
    const canonicalName = presentation.canonicalToolName ?? presentation.toolName;
    const durationMs = metricEntry
        ? Date.now() - metricEntry.t0
        : Number.isFinite(Number(evt?.['durationMs']))
          ? Number(evt?.['durationMs'])
          : 0;
    recordTerminalDiagnosticToolStats(canonicalName, durationMs, success);
    const durationLabel = buildToolCompletionDurationLabel(metricEntry, durationMs);
    if (effectiveToolCallId) completeTerminalTurnToolCall({ toolCallId: effectiveToolCallId, success });
    const activityLabel = terminalActivityLabelForPresentation(presentation, 'complete', success);
    recordTerminalActivity(terminalActivityPhaseForPresentation(presentation), activityLabel, {
        detail: presentation.completeLine(success, durationLabel),
        toolName: terminalActivityToolNameForPresentation(presentation),
        toolTarget: presentation.target,
        progress: success ? 100 : null,
        severity: success ? 'info' : 'error',
        source: 'sdk',
    });
    if (shouldPrintToolNarration(metricEntry, effectiveToolCallId || toolCallId, registry)) {
        printToolComplete(presentation, success, durationLabel, effectiveToolCallId || null);
    }
    broadcastToolLifecycle(
        buildToolLifecycleComplete({
            toolCallId: effectiveToolCallId || toolCallId,
            toolName: name,
            canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
            success,
            durationMs: durationMs > 0 ? durationMs : 0,
        }),
    );
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {void}
 */
export function handleTerminalToolUserRequested(evt) {
    const presentation = buildTerminalToolActivityPresentation(
        evt,
        /** @type {string} */ (evt?.['toolName'] ?? 'tool'),
    );
    const toolName = presentation.canonicalToolName ?? presentation.toolName;
    const requestId = typeof evt?.['requestId'] === 'string' ? evt['requestId'] : null;
    recordTerminalTurnToolActivity({
        toolName,
        operation: presentation.operation,
        target: presentation.target,
        source: 'sdk',
        status: 'user_requested',
    });
    recordTerminalActivity(
        terminalActivityPhaseForPresentation(presentation),
        terminalActivityLabelForPresentation(presentation, 'user_requested'),
        {
            detail: presentation.detail,
            toolName: terminalActivityToolNameForPresentation(presentation),
            toolTarget: presentation.target,
            source: 'sdk',
            severity: 'warn',
        },
    );
    println('');
    if (isHumanQuestionPresentation(presentation)) {
        printTerminalHumanQuestionCard(println, {
            question: presentation.target ?? 'Aguardando resposta do operador',
            choices: presentation.questionChoices,
            allowFreeform: presentation.allowFreeformQuestion ?? true,
            source: 'tool',
            state: 'aguardando resposta',
            compact: getTerminalDetailLevel() === 'compact',
            includeDivider: false,
            includeShortcuts: getTerminalDetailLevel() !== 'compact',
        });
    } else {
        println(
            terminalThemeRow(
                isIntentPresentation(presentation) ? 'Intenção' : 'Ferramenta',
                `${presentation.displayToolName} aguarda operador${
                    presentation.target ? ` · ${presentation.target}` : renderOptionalToolRequestDetail(requestId)
                }`,
                {
                    role: 'question',
                },
            ),
        );
    }
    broadcastToolLifecycle(buildToolLifecycleUserRequested({ toolName, requestId: requestId ?? null }));
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: { toolName?: string; requestId?: string; toolCallId?: string; data?: Record<string, unknown> };
 *     verboseNarration?: boolean;
 * }} input
 * @returns {void}
 */
export function handleTerminalExternalToolRequested({ registry, evt, verboseNarration = false }) {
    const originalToolName = evt?.toolName ?? 'external_tool';
    const toolName = resolveEffectiveExternalToolName(
        /** @type {Record<string, unknown>} */ (evt ?? {}),
        originalToolName,
    );
    const requestId = evt?.requestId ?? null;
    const toolCallId = evt?.toolCallId ?? (requestId ? `ext:${requestId}` : `ext:${toolName}:${Date.now()}`);
    const presentation = buildTerminalToolActivityPresentation(evt ?? {}, toolName);
    renderReportIntentToolPayload({
        toolName,
        evt: /** @type {Record<string, unknown>} */ (evt ?? {}),
        source: `sdk/external/${toolName}`,
        toolCallId,
    });
    const registryToolName = presentation.canonicalToolName ?? toolName;
    const displayToolName = presentation.displayToolName;
    if (registry.isNameInFlight(registryToolName)) {
        registry.markRequestIdForExternalTool(requestId ?? toolCallId, registryToolName);
        return;
    }
    registry.register(toolCallId, registryToolName, 'external', {
        requestId,
        canonicalName: presentation.canonicalToolName,
        rawArgs: extractTerminalToolArgsPayload(/** @type {Record<string, unknown>} */ (evt ?? {})),
        presentation,
    });
    recordToolTurnProjection(presentation, 'requested', toolCallId, null);
    recordTerminalActivity('tool', 'Integração externa solicitada', {
        detail: presentation.detail || `${displayToolName}${renderOptionalToolRequestDetail(requestId)}`,
        toolName: displayToolName,
        toolTarget: presentation.target,
        source: 'sdk',
    });
    const canPrintExternalStart = shouldPrintToolNarration(null, toolCallId, registry);
    if (canPrintExternalStart) {
        printToolStart({ ...presentation, displayToolName, startLine: presentation.startLine });
    } else if (
        verboseNarration &&
        !registry.shouldSuppressLiveNarration(toolCallId) &&
        !isTerminalWaitingForHumanQuestion()
    ) {
        const targetLabel = presentation.target || presentation.path || renderToolRequestLabel(requestId) || '';
        println(
            terminalThemeRow('Integração', `${displayToolName}${targetLabel ? ` · ${targetLabel}` : ''}`, {
                role: 'tool',
            }),
        );
    }
    broadcastToolLifecycle(
        buildToolLifecycleExternalRequested({
            toolName: displayToolName,
            requestId: requestId ?? '',
            toolCallId,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: {
 *         toolName?: string;
 *         requestId?: string;
 *         toolCallId?: string;
 *         success?: boolean;
 *         data?: Record<string, unknown>;
 *     };
 *     verboseNarration?: boolean;
 * }} input
 * @returns {void}
 */
export function handleTerminalExternalToolCompleted({ registry, evt, verboseNarration = false }) {
    const eventRecord = /** @type {Record<string, unknown>} */ (evt ?? {});
    const originalToolName = evt?.toolName ?? 'external_tool';
    const effectiveOriginalToolName = resolveEffectiveExternalToolName(eventRecord, originalToolName);
    const requestId = evt?.requestId ?? null;
    const inferredResult = inferToolResultSuccess(eventRecord, evt?.success !== false);
    const success = inferredResult.success;
    const evtToolCallId = evt?.toolCallId ?? null;
    /** @type {string | null} */
    let resolvedToolCallId = evtToolCallId;
    const resolvedByRequest = registry.resolveByRequestId(requestId);
    const resolvedName = resolvedByRequest?.toolName ?? registry.resolveNameByRequestId(requestId);
    const toolName =
        isGenericTerminalToolName(effectiveOriginalToolName) && resolvedName ? resolvedName : effectiveOriginalToolName;
    const resolvedEntry = resolvedByRequest ?? registry.resolveByName(toolName);
    renderReportIntentToolPayload({
        toolName,
        evt: eventRecord,
        source: `sdk/external/${toolName}`,
        toolCallId: resolvedToolCallId,
    });
    if (resolvedEntry) {
        resolvedToolCallId = resolvedEntry.toolCallId;
    }
    const completionPresentation = buildTerminalToolActivityPresentation(
        {
            ...(evt ?? {}),
            args: extractToolArgsOrFallback(eventRecord, resolvedEntry?.rawArgs ?? {}),
            result: extractTerminalToolResultPayload(eventRecord),
        },
        toolName,
    );
    const presentation = hasSemanticToolTarget(completionPresentation)
        ? completionPresentation
        : (resolvedEntry?.presentation ?? completionPresentation);
    const statsToolName = presentation.canonicalToolName ?? toolName;
    const displayToolName = presentation.displayToolName;
    if (shouldDeferExternalCompletionUntilPostToolUse(presentation, inferredResult)) {
        if (resolvedToolCallId) {
            registry.touch(resolvedToolCallId, { presentation, lastSignalAt: Date.now() });
        }
        return;
    }
    const completedEntry = resolvedEntry ? registry.complete(resolvedEntry.toolCallId, success) : null;
    const durationMs = completedEntry
        ? Date.now() - completedEntry.t0
        : typeof inferredResult.durationMs === 'number'
          ? inferredResult.durationMs
          : 0;
    recordTerminalDiagnosticToolStats(statsToolName, durationMs, success);
    const durationLabel = appendExitCodeToDurationLabel(
        buildToolCompletionDurationLabel(completedEntry ?? resolvedEntry, durationMs),
        inferredResult.exitCode,
    );
    recordToolTurnProjection(presentation, success ? 'completed' : 'failed', resolvedToolCallId, success);
    recordTerminalActivity('tool', success ? 'Integração externa concluída' : 'Integração externa falhou', {
        detail:
            presentation.completeLine(success, durationLabel) ||
            `${displayToolName}${renderOptionalToolRequestDetail(requestId)}`,
        toolName: displayToolName,
        toolTarget: presentation.target,
        source: 'sdk',
        severity: success ? 'info' : 'error',
    });
    const canPrintExternalComplete = shouldPrintToolNarration(completedEntry ?? resolvedEntry, resolvedToolCallId, registry);
    if (canPrintExternalComplete) {
        printToolComplete(presentation, success, durationLabel, resolvedToolCallId);
    } else if (
        verboseNarration &&
        !registry.shouldSuppressLiveNarration(resolvedToolCallId) &&
        !isTerminalWaitingForHumanQuestion()
    ) {
        println(
            terminalThemeRow(
                'Integração',
                `${displayToolName}${requestId ? ` · ${renderToolRequestLabel(requestId)}` : ''}`,
                { role: success ? 'success' : 'error' },
            ),
        );
    }
    broadcastToolLifecycle(
        buildToolLifecycleExternalCompleted({
            toolName: displayToolName,
            requestId: requestId ?? '',
            toolCallId: resolvedToolCallId,
            success,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
        }),
    );
}

/**
 * Reconciliacao tardia do hook `postToolUse`.
 *
 * Alguns eventos SDK marcam `external_completed` antes de o hook `postToolUse` expor o resultado real. Para tools de
 * shell/comando, isso pode significar `external_completed success=true` seguido por `textResultForLlm` com
 * `{ success:false, exitCode:7 }`. A tela humana deve refletir o resultado real da tool.
 *
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     evt: Record<string, unknown>;
 * }} input
 * @returns {void}
 */
export function reconcileTerminalPostToolUseResult({ registry, evt }) {
    const result = inferToolResultSuccess(evt, true);
    if (!result.hasStructuredResult || result.success) return;
    const toolName = typeof evt['toolName'] === 'string' && evt['toolName'].trim() ? evt['toolName'].trim() : 'tool';
    const args = extractTerminalToolArgsPayload(evt);
    const presentation = buildTerminalToolActivityPresentation(
        {
            toolName,
            args,
            result:
                extractTerminalToolResultPayload(evt) ??
                extractToolResultEnvelope(evt)?.parsed ??
                evt['toolResult'] ??
                null,
        },
        toolName,
    );
    const canonicalName = presentation.canonicalToolName ?? presentation.toolName;
    const resolvedEntry = registry.resolveByName(toolName);
    const toolCallId = resolvedEntry?.toolCallId ?? '';
    const completedEntry = toolCallId ? registry.complete(toolCallId, false) : null;
    const durationMs = result.durationMs ?? 0;
    const durationLabel = appendExitCodeToDurationLabel(
        buildToolCompletionDurationLabel(completedEntry ?? resolvedEntry, durationMs),
        result.exitCode,
    );
    recordTerminalDiagnosticToolStats(canonicalName, durationMs, false);
    recordToolTurnProjection(presentation, 'failed', toolCallId || null, false);
    if (toolCallId) completeTerminalTurnToolCall({ toolCallId, success: false });
    recordTerminalActivity('tool', 'Integração externa falhou', {
        detail: presentation.completeLine(false, durationLabel),
        toolName: presentation.displayToolName,
        toolTarget: presentation.target,
        source: 'sdk',
        severity: 'error',
    });
    printToolComplete(presentation, false, durationLabel, toolCallId || null);
    broadcastToolLifecycle(
        buildToolLifecycleComplete({
            toolCallId,
            toolName,
            canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            directoryTargets: presentation.directoryTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            commands: presentation.commands,
            filters: presentation.filters,
            resultCount: presentation.resultCount,
            resultSummary: presentation.resultSummary,
            primaryTargetKind: presentation.primaryTargetKind,
            success: false,
            durationMs,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null;
 *     entry: import('./io-activity-events.js').TerminalIoActivityEntry;
 *     correlated?: import('../state/tool-call-registry.js').ToolCallEntry | null;
 * }} input
 * @returns {void}
 */
export function handleTerminalIoToolLifecycle({ registry, entry, correlated = null }) {
    const effectiveCorrelated = correlated ?? (registry ? registry.attachIoActivity(entry) : null);
    broadcastToolLifecycle(
        buildToolLifecycleIoOp(entry, {
            correlatedToolCallId: effectiveCorrelated?.toolCallId ?? null,
            correlatedToolName: effectiveCorrelated?.toolName ?? null,
        }),
    );
}

/**
 * Reconcilia tools que o SDK deixou sem completion explícito quando o turno terminou.
 *
 * Isso é deliberadamente visível como `warn`: o terminal não deve mascarar perda de evento de lifecycle, mas também não
 * pode manter `/activity` preso em uma tool fantasma depois de `assistant.turn_end`.
 *
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry>;
 *     reason?: string;
 * }} input
 * @returns {number}
 */
export function reconcileTerminalInFlightToolsAtTurnEnd({ registry, reason = 'assistant.turn_end' }) {
    const entries = registry.getAllInFlight();
    let reconciled = 0;
    for (const entry of entries) {
        const presentation =
            entry.presentation ??
            buildTerminalToolActivityPresentation(
                {
                    toolName: entry.toolName,
                    args: entry.rawArgs,
                },
                entry.canonicalName ?? entry.toolName,
            );
        const completedEntry = registry.complete(entry.toolCallId, true) ?? entry;
        const durationMs = Math.max(0, Date.now() - completedEntry.t0);
        const durationLabel = buildToolCompletionDurationLabel(completedEntry, durationMs);
        const canonicalName = presentation.canonicalToolName ?? entry.canonicalName ?? entry.toolName;
        recordTerminalDiagnosticToolStats(canonicalName, durationMs, true);
        completeTerminalTurnToolCall({ toolCallId: entry.toolCallId, success: true });
        recordToolTurnProjection(presentation, 'completed', entry.toolCallId, true);
        recordTerminalActivity('tool', 'Ferramenta reconciliada no fim do turno', {
            detail: `${presentation.displayToolName} sem conclusão explícita (${reason}) · ${durationLabel}`,
            toolName: presentation.displayToolName,
            toolTarget: presentation.target,
            severity: 'warn',
            source: 'sdk',
        });
        if (getShowToolActivity()) {
            println(
                terminalThemeRow(
                    'Sincronização',
                    `${terminalThemeText('tool', presentation.displayToolName)} · ${terminalThemeText('warn', `conclusão inferida no fim do turno · ${durationLabel}`)}`,
                    { role: 'warn' },
                ),
            );
        }
        broadcastToolLifecycle(
            buildToolLifecycleComplete({
                toolCallId: entry.toolCallId,
                toolName: entry.toolName,
                canonicalName,
                operation: presentation.operation,
                path: presentation.path,
                target: presentation.target,
                fileTargets: presentation.fileTargets,
                directoryTargets: presentation.directoryTargets,
                urlTargets: presentation.urlTargets,
                searchTerms: presentation.searchTerms,
                lineRange: presentation.lineRange,
                patchFiles: presentation.patchFiles,
                commands: presentation.commands,
                filters: presentation.filters,
                resultCount: presentation.resultCount,
                resultSummary: presentation.resultSummary,
                primaryTargetKind: presentation.primaryTargetKind,
                success: true,
                durationMs,
            }),
        );
        reconciled++;
    }
    return reconciled;
}
