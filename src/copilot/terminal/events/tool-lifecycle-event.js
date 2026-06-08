// @ts-check
/**
 * src/copilot/terminal/events/tool-lifecycle-event.js
 *
 * Schema canônico unificado do evento `tool.lifecycle` — emitido via SSE como trilha única de tools no terminal.
 *
 * **Por que este arquivo existe?**
 *
 * O pipeline de eventos de tool cresceu de forma orgânica e acumulou 3 famílias paralelas de origem:
 *
 * - `tool.start / progress / partial_result / complete` (agent-runtime-events)
 * - `external_tool.requested / completed / tool.user_requested` (sdk-session-events)
 * - `io.operation` (io-activity-events)
 *
 * `tool.lifecycle` é o evento canônico unificado que normaliza todas as fases e fontes em um schema único e coerente. O
 * terminal emite apenas `tool.lifecycle`; adapters antigos permanecem apenas como referência histórica de origem.
 *
 * **F3.2 — Correlação io_op → toolCallId:** Quando `type = 'io_op'`, se houver tools em execução no ToolCallRegistry,
 * `correlatedToolCallId` / `correlatedToolName` identificam a tool mais provável responsável pela operação de I/O.
 *
 * @module copilot/terminal/events/tool-lifecycle-event
 * @see active-registry-store.js
 * @see tool-call-registry.js
 */

import { redactSecretRecord, redactSecretText } from '#copilot/core';

/**
 * Tipos válidos de evento de lifecycle de tool.
 *
 * @typedef {'start'
 *     | 'progress'
 *     | 'partial_result'
 *     | 'complete'
 *     | 'external_requested'
 *     | 'external_completed'
 *     | 'user_requested'
 *     | 'io_op'} ToolLifecycleType
 */

/**
 * Fonte de origem do evento.
 *
 * @typedef {'sdk' | 'external' | 'io' | 'user'} ToolLifecycleSource
 */

/**
 * @typedef {object} ToolLifecycleEvent
 * @property {ToolLifecycleType} type - Tipo discriminante do evento
 * @property {ToolLifecycleSource} source - Fonte de origem
 * @property {number} timestamp - Timestamp do evento
 * @property {string | null} traceId - Identidade causal do turno terminal, quando disponível
 * @property {string | null} turnId - ID do turno SDK/terminal, quando disponível
 * @property {string | null} toolCallId - ID da chamada de tool (SDK only)
 * @property {string} toolName - Nome da tool ou tipo de operação
 * @property {string | null} rawToolName - Nome original antes de normalização
 * @property {string | null} requestId - ID da requisição (external/user tools)
 * @property {string | null} operation - Tipo de operação (read, write, etc.)
 * @property {string | null} path - Caminho principal afetado
 * @property {string | null} target - Alvo principal da operação
 * @property {string[]} fileTargets - Todos os arquivos afetados
 * @property {string[]} directoryTargets - Diretórios contextuais da operação
 * @property {string[]} urlTargets - URLs acessadas
 * @property {string[]} searchTerms - Termos de busca (se aplicável)
 * @property {{ start: number | null; end: number | null } | null} lineRange - Range de linhas
 * @property {string[]} patchFiles - Arquivos com patches
 * @property {string[]} [commands] - Previews seguros de comandos
 * @property {string[]} [filters] - Filtros estruturados da operação
 * @property {number | null} [resultCount] - Contagem de resultados materializada
 * @property {string | null} [resultSummary] - Resumo curto e seguro do resultado
 * @property {string | null} [primaryTargetKind] - Tipo do alvo operacional principal
 * @property {number | null} progress - Percentual de progresso (0-100)
 * @property {string | null} progressMessage - Mensagem de progresso
 * @property {string | null} partialOutput - Saída parcial (streaming)
 * @property {boolean | null} success - Sucesso da operação
 * @property {number | null} durationMs - Duração em milissegundos
 * @property {string | null} ioEngine - Motor de I/O (workspace-fs, etc.)
 * @property {string | null} ioTargetKind - Tipo de alvo (file, dir, etc.)
 * @property {number | null} ioBytesRead - Bytes lidos
 * @property {number | null} ioBytesWritten - Bytes escritos
 * @property {string | null} ioRiskClass - Classe de risco da operação
 * @property {boolean} ioDryRun - True quando a operação observada é simulação sem mutação persistente
 * @property {string[]} ioTargets - Alvo(s) de I/O
 * @property {{ name?: string; message?: string } | null} ioError - Erro de I/O
 * @property {string | null} correlatedToolCallId - ID da tool correlacionada (F3.2)
 * @property {string | null} correlatedToolName - Nome da tool correlacionada (F3.2)
 */

/**
 * @typedef {object} ToolLifecycleEventInput
 * @property {string | null} [toolCallId]
 * @property {string | null} [traceId]
 * @property {string | null} [turnId]
 * @property {string | null} [toolName]
 * @property {string | null} [rawToolName]
 * @property {string | null} [requestId]
 * @property {string | null} [operation]
 * @property {string | null} [path]
 * @property {string | null} [target]
 * @property {string[]} [fileTargets]
 * @property {string[]} [directoryTargets]
 * @property {string[]} [urlTargets]
 * @property {string[]} [searchTerms]
 * @property {{ start: number | null; end: number | null } | null} [lineRange]
 * @property {string[]} [patchFiles]
 * @property {string[]} [commands]
 * @property {string[]} [filters]
 * @property {number | null} [resultCount]
 * @property {string | null} [resultSummary]
 * @property {string | null} [primaryTargetKind]
 * @property {number | null} [progress]
 * @property {string | null} [progressMessage]
 * @property {string | null} [partialOutput]
 * @property {boolean | null} [success]
 * @property {number | null} [durationMs]
 * @property {string | null} [ioEngine]
 * @property {string | null} [ioTargetKind]
 * @property {number | null} [ioBytesRead]
 * @property {number | null} [ioBytesWritten]
 * @property {string | null} [ioRiskClass]
 * @property {boolean} [ioDryRun]
 * @property {string[]} [ioTargets]
 * @property {{ name?: string; message?: string } | null} [ioError]
 * @property {string | null} [correlatedToolCallId]
 * @property {string | null} [correlatedToolName]
 * @property {number | null} [timestamp]
 */

/**
 * Constrói um `ToolLifecycleEvent` com todos os campos normalizados e defaults aplicados. Garante que o evento seja
 * sempre um objeto válido e completo, independente de quais campos foram fornecidos.
 *
 * @param {ToolLifecycleType} type - Tipo discriminante do evento
 * @param {ToolLifecycleSource} source - Fonte de origem
 * @param {ToolLifecycleEventInput} fields - Campos específicos do evento
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleEvent(type, source, fields) {
    const redactText = (/** @type {string | null | undefined} */ value) =>
        typeof value === 'string' ? redactSecretText(value) : null;
    const redactTexts = (/** @type {string[] | undefined} */ values) =>
        Array.isArray(values) ? values.map((value) => redactSecretText(value)) : [];
    const safeIoError =
        fields.ioError && typeof fields.ioError === 'object'
            ? /** @type {{ name?: string; message?: string }} */ (
                  redactSecretRecord(/** @type {Record<string, unknown>} */ (fields.ioError))
              )
            : null;
    return {
        type,
        source,
        timestamp: fields.timestamp ?? Date.now(),
        traceId: redactText(fields.traceId),
        turnId: redactText(fields.turnId),

        toolCallId: redactText(fields.toolCallId),
        toolName: redactSecretText(fields.toolName ?? 'tool'),
        rawToolName: redactText(fields.rawToolName),
        requestId: redactText(fields.requestId),

        operation: redactText(fields.operation),
        path: redactText(fields.path),
        target: redactText(fields.target),
        fileTargets: redactTexts(fields.fileTargets),
        directoryTargets: redactTexts(fields.directoryTargets),
        urlTargets: redactTexts(fields.urlTargets),
        searchTerms: redactTexts(fields.searchTerms),
        lineRange: fields.lineRange ?? null,
        patchFiles: redactTexts(fields.patchFiles),
        commands: redactTexts(fields.commands),
        filters: redactTexts(fields.filters),
        resultCount: fields.resultCount ?? null,
        resultSummary: redactText(fields.resultSummary),
        primaryTargetKind: redactText(fields.primaryTargetKind),

        progress: fields.progress ?? null,
        progressMessage: redactText(fields.progressMessage),
        partialOutput: redactText(fields.partialOutput),

        success: fields.success ?? null,
        durationMs: fields.durationMs ?? null,

        ioEngine: redactText(fields.ioEngine),
        ioTargetKind: redactText(fields.ioTargetKind),
        ioBytesRead: fields.ioBytesRead ?? null,
        ioBytesWritten: fields.ioBytesWritten ?? null,
        ioRiskClass: redactText(fields.ioRiskClass),
        ioDryRun: fields.ioDryRun === true,
        ioTargets: redactTexts(fields.ioTargets),
        ioError: safeIoError,

        correlatedToolCallId: redactText(fields.correlatedToolCallId),
        correlatedToolName: redactText(fields.correlatedToolName),
    };
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `start` a partir dos campos brutos do evento `tool.start` existente.
 *
 * @param {{
 *     toolCallId: string;
 *     toolName: string;
 *     canonicalName?: string;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleStart(fields) {
    return buildToolLifecycleEvent('start', 'sdk', {
        toolCallId: fields.toolCallId,
        toolName: fields.canonicalName ?? fields.toolName,
        rawToolName: fields.toolName !== (fields.canonicalName ?? fields.toolName) ? fields.toolName : null,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `progress`.
 *
 * @param {{
 *     toolCallId: string;
 *     toolName: string;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 *     progress?: number | null;
 *     progressMessage?: string | null;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleProgress(fields) {
    return buildToolLifecycleEvent('progress', 'sdk', {
        toolCallId: fields.toolCallId,
        toolName: fields.toolName,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
        progress: fields.progress ?? null,
        progressMessage: fields.progressMessage ?? null,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `partial_result`.
 *
 * @param {{
 *     toolCallId: string;
 *     toolName: string;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 *     partialOutput: string;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecyclePartialResult(fields) {
    return buildToolLifecycleEvent('partial_result', 'sdk', {
        toolCallId: fields.toolCallId,
        toolName: fields.toolName,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
        partialOutput: fields.partialOutput,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `complete`.
 *
 * @param {{
 *     toolCallId: string;
 *     toolName: string;
 *     canonicalName?: string;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 *     success: boolean;
 *     durationMs: number;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleComplete(fields) {
    return buildToolLifecycleEvent('complete', 'sdk', {
        toolCallId: fields.toolCallId,
        toolName: fields.canonicalName ?? fields.toolName,
        rawToolName: fields.toolName !== (fields.canonicalName ?? fields.toolName) ? fields.toolName : null,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
        success: fields.success,
        durationMs: fields.durationMs,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `external_requested`.
 *
 * @param {{
 *     toolName: string;
 *     requestId: string;
 *     toolCallId?: string | null;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleExternalRequested(fields) {
    return buildToolLifecycleEvent('external_requested', 'external', {
        toolName: fields.toolName,
        requestId: fields.requestId,
        toolCallId: fields.toolCallId ?? null,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `external_completed`.
 *
 * @param {{
 *     toolName: string;
 *     requestId: string;
 *     success: boolean;
 *     toolCallId?: string | null;
 *     operation?: string | null;
 *     path?: string | null;
 *     target?: string | null;
 *     fileTargets?: string[];
 *     directoryTargets?: string[];
 *     urlTargets?: string[];
 *     searchTerms?: string[];
 *     lineRange?: { start: number | null; end: number | null } | null;
 *     patchFiles?: string[];
 *     commands?: string[];
 *     filters?: string[];
 *     resultCount?: number | null;
 *     resultSummary?: string | null;
 *     primaryTargetKind?: string | null;
 * }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleExternalCompleted(fields) {
    return buildToolLifecycleEvent('external_completed', 'external', {
        toolName: fields.toolName,
        requestId: fields.requestId,
        toolCallId: fields.toolCallId ?? null,
        success: fields.success,
        operation: fields.operation ?? null,
        path: fields.path ?? null,
        target: fields.target ?? null,
        fileTargets: fields.fileTargets ?? [],
        directoryTargets: fields.directoryTargets ?? [],
        urlTargets: fields.urlTargets ?? [],
        searchTerms: fields.searchTerms ?? [],
        lineRange: fields.lineRange ?? null,
        patchFiles: fields.patchFiles ?? [],
        commands: fields.commands ?? [],
        filters: fields.filters ?? [],
        resultCount: fields.resultCount ?? null,
        resultSummary: fields.resultSummary ?? null,
        primaryTargetKind: fields.primaryTargetKind ?? null,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `user_requested`.
 *
 * @param {{ toolName: string; requestId?: string | null }} fields
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleUserRequested(fields) {
    return buildToolLifecycleEvent('user_requested', 'user', {
        toolName: fields.toolName,
        requestId: fields.requestId ?? null,
    });
}

/**
 * Constrói um evento `tool.lifecycle` do tipo `io_op` a partir de uma entrada TerminalIoActivityEntry normalizada.
 * Inclui campos de correlação F3.2 quando uma tool está em voo no ToolCallRegistry.
 *
 * @param {{
 *     timestamp?: number | null;
 *     operation: string;
 *     target: string;
 *     targets: string[];
 *     engine: string | null;
 *     targetKind: string | null;
 *     durationMs: number | null;
 *     bytesRead: number | null;
 *     bytesWritten: number | null;
 *     riskClass: string | null;
 *     dryRun: boolean;
 *     success: boolean;
 *     error: { name?: string; message?: string } | null;
 * }} ioEntry
 * @param {{ correlatedToolCallId?: string | null; correlatedToolName?: string | null }} [correlation]
 * @returns {ToolLifecycleEvent}
 */
export function buildToolLifecycleIoOp(ioEntry, correlation) {
    return buildToolLifecycleEvent('io_op', 'io', {
        timestamp: ioEntry.timestamp ?? null,
        toolName: `io.${ioEntry.operation}`,
        operation: ioEntry.operation,
        target: ioEntry.target,
        fileTargets: ioEntry.targets,
        ioEngine: ioEntry.engine,
        ioTargetKind: ioEntry.targetKind,
        ioBytesRead: ioEntry.bytesRead,
        ioBytesWritten: ioEntry.bytesWritten,
        ioRiskClass: ioEntry.riskClass,
        ioDryRun: ioEntry.dryRun === true,
        ioTargets: ioEntry.targets,
        ioError: ioEntry.error,
        success: ioEntry.success,
        durationMs: ioEntry.durationMs,
        correlatedToolCallId: correlation?.correlatedToolCallId ?? null,
        correlatedToolName: correlation?.correlatedToolName ?? null,
    });
}
