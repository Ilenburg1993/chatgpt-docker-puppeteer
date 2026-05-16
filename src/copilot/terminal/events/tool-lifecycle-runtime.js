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

import { getShowToolActivity } from '../../presentation/state/index.js';
import { broadcastSse, clearInlineStatus, println, writeInlineStatus } from '../dialog/index.js';
import {
    completeTerminalTurnToolCall,
    getTerminalDetailLevel,
    recordTerminalActivity,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
    terminalThemeBadge,
    terminalThemeText,
} from '../state/events/index.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalToolText,
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
import { renderTerminalIntent } from './intent-renderer.js';

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
    const operationRole = mapTerminalToolOperationRole(presentation.operation);
    const opLabel = presentation.operation.toUpperCase();
    println(
        compactDetail
            ? `  ${terminalThemeBadge('tool', 'TOOL')} ${terminalThemeBadge(operationRole, opLabel)} ${terminalThemeText('tool', compactTerminalToolText(presentation.displayToolName, 28))} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, compactTerminalToolText(presentation.startLine, 86))}`
            : `  ${terminalThemeBadge('tool', 'TOOL')} ${terminalThemeBadge(operationRole, opLabel)} ${terminalThemeText('tool', presentation.displayToolName)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, presentation.startLine)}`,
    );
}

/**
 * @param {import('./tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
 * @param {number | null} progress
 * @param {string | null} progressMessage
 * @returns {void}
 */
function printToolProgress(presentation, progress, progressMessage) {
    if (!getShowToolActivity()) return;
    const compactDetail = getTerminalDetailLevel() === 'compact';
    const suffix = progressMessage ?? (progress !== null ? `${progress}%` : '');
    const progressLine =
        `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(presentation.progressLinePrefix, 56) : presentation.progressLinePrefix)} ${terminalThemeText('muted', suffix)}`.trimEnd();
    if (compactDetail) writeInlineStatus(progressLine);
    else println(progressLine);
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
    const icon = success ? terminalThemeText('success', '✅') : terminalThemeText('error', '❌');
    const statusBadge = success ? terminalThemeBadge('success', 'DONE') : terminalThemeBadge('error', 'FAIL');
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
        lowFidelityGeneric && fallbackToolCallId ? ` · callId=${compactTerminalToolText(fallbackToolCallId, 28)}` : '';
    const completionDetail = `${presentation.completeLine(success, durationLabel)}${lowFidelitySuffix}`;
    const renderedName =
        lowFidelityGeneric && fallbackToolCallId
            ? `tool#${fallbackToolCallId.slice(-8)}`
            : presentation.displayToolName;
    println(
        compactDetail
            ? `  ${icon} ${statusBadge} ${terminalThemeText('tool', compactTerminalToolText(renderedName, 28))} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, compactTerminalToolText(completionDetail, 88))}`
            : `  ${icon} ${statusBadge} ${terminalThemeText('tool', renderedName)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, completionDetail)}`,
    );
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
    const name = /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
    if (shouldSuppressTerminalToolNarration(name)) return;
    const rawArgs = objectArgsOrEmpty(evt?.['args'] ?? evt?.['arguments'] ?? evt?.['input'] ?? null);
    renderReportIntentToolPayload({ toolName: name, evt: { ...evt, args: rawArgs }, source: `tool/${name}`, toolCallId });
    const presentation = buildTerminalToolActivityPresentation(evt, name);
    const canonicalName = presentation.canonicalToolName ?? name;
    if (toolCallId && registry.isInFlight(toolCallId)) {
        registry.touch(toolCallId, { rawArgs, presentation });
        return;
    }
    if (registry.isNameInFlight(name)) return;
    if (toolCallId) {
        registry.register(toolCallId, name, 'native', {
            canonicalName,
            rawArgs,
            presentation,
        });
    }
    recordToolTurnProjection(presentation, 'started', toolCallId, null);
    recordTerminalActivity('tool', 'Executando tool', {
        detail: presentation.detail,
        toolName: canonicalName,
        source: 'sdk',
    });
    printToolStart(presentation);
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleStart({
            toolCallId,
            toolName: name,
            canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
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
        getShowToolActivity() &&
        ((progress !== null &&
            (entry?.lastProgress == null || Math.abs(progress - entry.lastProgress) >= 5 || progress === 100)) ||
            (progressMessage !== null && progressMessage !== entry?.lastProgressMessage));
    if (toolCallId) {
        registry.touch(toolCallId, {
            presentation,
            progress,
            progressMessage,
        });
    }
    const effectiveDetail =
        progressMessage ?? (progress !== null ? `${presentation.detail} · ${progress}%` : presentation.detail);
    recordTerminalActivity('tool', 'Executando tool', {
        detail: effectiveDetail,
        toolName: name,
        progress,
        source: 'sdk',
        recordHistory: false,
    });
    if (shouldPrint) {
        printToolProgress(presentation, progress, progressMessage);
    }
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleProgress({
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
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
    recordTerminalActivity('tool', 'Resultado parcial de tool', {
        detail: partialOutput,
        toolName: name,
        source: 'sdk',
        recordHistory: false,
    });
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecyclePartialResult({
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
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
    const entry = toolCallId ? registry.getEntry(toolCallId) : null;
    const eventName =
        typeof evt?.['toolName'] === 'string' && evt['toolName'].length > 0
            ? evt['toolName']
            : typeof evt?.['name'] === 'string' && evt['name'].length > 0
              ? evt['name']
              : null;
    const name = entry?.canonicalName ?? entry?.toolName ?? eventName ?? 'tool';
    if (shouldSuppressTerminalToolNarration(name)) return;
    renderReportIntentToolPayload({
        toolName: name,
        evt: { ...evt, args: objectArgsOrEmpty(evt?.['args'] ?? evt?.['arguments'] ?? evt?.['input'] ?? entry?.rawArgs ?? null) },
        source: `tool/${name}`,
        toolCallId,
    });
    const suppressByInFlightName = entry ? false : registry.isNameInFlight(name);
    if (
        suppressByInFlightName ||
        registry.wasNameRecentlyCompleted(name, requestId) ||
        registry.wasRecentlyCompleted(toolCallId, requestId)
    ) {
        return;
    }
    if (toolCallId && registry.getEntry(toolCallId)?.kind === 'native') {
        registry.complete(toolCallId, success);
    }
    const completionPresentation = buildTerminalToolActivityPresentation(
        {
            ...evt,
            args: objectArgsOrEmpty(evt?.['args'] ?? evt?.['arguments'] ?? evt?.['input'] ?? entry?.rawArgs ?? null),
        },
        name,
    );
    const presentation =
        completionPresentation.target || completionPresentation.path || completionPresentation.lineRange
            ? completionPresentation
            : (entry?.presentation ?? completionPresentation);
    const canonicalName = presentation.canonicalToolName ?? name;
    const durationMs = entry
        ? Date.now() - entry.t0
        : Number.isFinite(Number(evt?.['durationMs']))
          ? Number(evt?.['durationMs'])
          : 0;
    const durationLabel = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : 'n/d';
    if (toolCallId) completeTerminalTurnToolCall({ toolCallId, success });
    const activityLabel = success ? 'Tool concluída' : 'Tool falhou';
    recordTerminalActivity('tool', activityLabel, {
        detail: presentation.completeLine(success, durationLabel),
        toolName: canonicalName,
        progress: success ? 100 : null,
        severity: success ? 'info' : 'error',
        source: 'sdk',
    });
    printToolComplete(presentation, success, durationLabel, toolCallId || null);
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleComplete({
            toolCallId,
            toolName: name,
            canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
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
    const toolName = /** @type {string} */ (evt?.['toolName'] ?? 'tool');
    const requestId = typeof evt?.['requestId'] === 'string' ? evt['requestId'] : null;
    recordTerminalTurnToolActivity({
        toolName,
        operation: 'run',
        target: requestId,
        source: 'sdk',
        status: 'user_requested',
    });
    recordTerminalActivity('tool', 'Tool solicitou ação do usuário', {
        detail: `${toolName}${requestId ? ` · ${requestId}` : ''}`,
        toolName,
        source: 'sdk',
        severity: 'warn',
    });
    println(
        `\n  \x1b[33m🧩 Tool aguarda usuário:\x1b[0m ${toolName}${requestId ? ` \x1b[90m(${requestId})\x1b[0m` : ''}`,
    );
    broadcastSse('tool.lifecycle', buildToolLifecycleUserRequested({ toolName, requestId: requestId ?? null }));
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
    const toolName = evt?.toolName ?? 'external_tool';
    const requestId = evt?.requestId ?? null;
    const toolCallId = evt?.toolCallId ?? (requestId ? `ext:${requestId}` : `ext:${toolName}:${Date.now()}`);
    const presentation = buildTerminalToolActivityPresentation(evt ?? {}, toolName);
    renderReportIntentToolPayload({ toolName, evt: /** @type {Record<string, unknown>} */ (evt ?? {}), source: `sdk/external/${toolName}`, toolCallId });
    const displayToolName = presentation.canonicalToolName ?? toolName;
    registry.register(toolCallId, displayToolName, 'external', {
        requestId,
        canonicalName: presentation.canonicalToolName,
        presentation,
    });
    recordToolTurnProjection(presentation, 'requested', toolCallId, null);
    recordTerminalActivity('tool', 'External tool solicitada', {
        detail: presentation.detail || `${displayToolName}${requestId ? ` · ${requestId}` : ''}`,
        toolName: displayToolName,
        source: 'sdk',
    });
    if (getShowToolActivity()) {
        printToolStart({ ...presentation, displayToolName, startLine: presentation.startLine });
    } else if (verboseNarration) {
        const targetLabel = presentation.target || presentation.path || requestId || '';
        println(`  \x1b[90m↗ external tool: ${displayToolName}${targetLabel ? ` · ${targetLabel}` : ''}\x1b[0m`);
    }
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleExternalRequested({
            toolName: displayToolName,
            requestId: requestId ?? '',
            toolCallId,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
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
    const originalToolName = evt?.toolName ?? 'external_tool';
    const requestId = evt?.requestId ?? null;
    const success = evt?.success !== false;
    const evtToolCallId = evt?.toolCallId ?? null;
    /** @type {string | null} */
    let resolvedToolCallId = evtToolCallId;
    const resolvedEntry = registry.resolveByRequestId(requestId);
    const resolvedName = resolvedEntry?.toolName ?? registry.resolveNameByRequestId(requestId);
    const toolName = originalToolName === 'external_tool' && resolvedName ? resolvedName : originalToolName;
    renderReportIntentToolPayload({
        toolName,
        evt: /** @type {Record<string, unknown>} */ (evt ?? {}),
        source: `sdk/external/${toolName}`,
        toolCallId: resolvedToolCallId,
    });
    if (resolvedEntry) {
        resolvedToolCallId = resolvedEntry.toolCallId;
        registry.complete(resolvedEntry.toolCallId, success);
    }
    const completionPresentation = buildTerminalToolActivityPresentation(evt ?? {}, toolName);
    const presentation =
        completionPresentation.target || completionPresentation.path || completionPresentation.lineRange
            ? completionPresentation
            : (resolvedEntry?.presentation ?? completionPresentation);
    const displayToolName = presentation.canonicalToolName ?? toolName;
    recordToolTurnProjection(presentation, success ? 'completed' : 'failed', resolvedToolCallId, success);
    recordTerminalActivity('tool', success ? 'External tool concluída' : 'External tool falhou', {
        detail: presentation.detail || `${displayToolName}${requestId ? ` · ${requestId}` : ''}`,
        toolName: displayToolName,
        source: 'sdk',
        severity: success ? 'info' : 'error',
    });
    if (getShowToolActivity()) {
        printToolComplete(presentation, success, 'n/d', resolvedToolCallId);
    } else if (verboseNarration) {
        println(
            `  ${success ? '\x1b[32m✓' : '\x1b[31m✗'} external tool:\x1b[0m ${displayToolName}${requestId ? ` \x1b[90m(${requestId})\x1b[0m` : ''}`,
        );
    }
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleExternalCompleted({
            toolName: displayToolName,
            requestId: requestId ?? '',
            toolCallId: resolvedToolCallId,
            success,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
        }),
    );
}

/**
 * @param {{
 *     registry: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null;
 *     entry: import('./io-activity-events.js').TerminalIoActivityEntry;
 * }} input
 * @returns {void}
 */
export function handleTerminalIoToolLifecycle({ registry, entry }) {
    const inFlight = registry ? registry.getAllInFlight() : [];
    const correlated = inFlight.length > 0 ? inFlight[0] : null;
    broadcastSse(
        'tool.lifecycle',
        buildToolLifecycleIoOp(entry, {
            correlatedToolCallId: correlated?.toolCallId ?? null,
            correlatedToolName: correlated?.toolName ?? null,
        }),
    );
}
