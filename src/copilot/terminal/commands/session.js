// @ts-check
/**
 * src/copilot/terminal/commands/session.js
 *
 * Comandos de sessão do REPL terminal LLM-B: /status, /history, /db-history, /db-sessions, /who, /count, /clear,
 * /answer, /clear-shadow, /restart, /quit, /exit
 *
 * @module copilot/terminal/commands/session
 * @see EventBus
 */

import { COPILOT_OPERATIONAL_PROFILE, getEffectiveSdkAgentSelection, listTerminalSdkCommandSpecs } from '#copilot/config';
import { toError } from '#copilot/core';
import {
    clearPendingTerminalQuestionShadow,
    clearTerminalHistory,
    deleteTerminalSdkSession,
    listTerminalSnapshotsProjection,
    listTerminalSdkSessionInventory,
    loadTerminalSnapshotProjection,
    readTerminalActivityProjection,
    readTerminalConfigProjection,
    readTerminalCountProjection,
    readTerminalDbHistoryProjection,
    readTerminalDbSessionsProjection,
    readTerminalDisplayProjection,
    readTerminalLiveFlowProjection,
    readTerminalStatusProjection,
    readTerminalTimelineProjection,
    readTerminalSdkSessionBootSelection,
    readTerminalByokProjection,
    saveTerminalSnapshotProjection,
    scheduleTerminalSdkSessionBootSelection,
} from '../frontend/index.js';
import { buildTerminalOperationalGuidance } from '../frontend/operational-guidance/index.js';
import {
    shouldConsumeTerminalPendingAnswerInput,
    tryAnswerTerminalPendingQuestionInput,
} from '../state/repl-runtime/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget, withRuntimeTarget } from './runtime-target.js';
import {
    classifyTerminalByokSdkBinding,
    renderTerminalSdkProviderBinding,
} from '../byok/index.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalToolText,
    isTerminalInternalCallIdentifier,
} from '../events/tool-activity-presenter.js';
import {
    readTerminalSseEventArchiveTail,
    terminalPermissionModeSkipsSdkPrompts,
    terminalThemeText,
} from '../state/index.js';

const DISABLED_BYOK_SUMMARY = Object.freeze({
    enabled: false,
    ready: false,
    preset: null,
    providerType: null,
    model: null,
    auth: {
        apiKeyConfigured: false,
        bearerTokenConfigured: false,
        headersConfigured: false,
    },
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderHumanTerminalStatus(value) {
    const status = String(value ?? 'unknown');
    if (status === 'waiting_for_input') return 'aguardando você';
    if (status === 'idle') return 'ocioso';
    if (status === 'processing') return 'trabalhando';
    if (status === 'starting') return 'iniciando';
    if (status === 'stopped') return 'parado';
    return status;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderHumanTerminalHealth(value) {
    const status = String(value ?? 'unknown');
    if (status === 'healthy') return 'ok';
    if (status === 'degraded') return 'atenção';
    if (status === 'unhealthy' || status === 'error') return 'problema';
    return status;
}

/**
 * @param {number} value
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralPt(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactHumanTerminalText(value) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return compactTerminalToolText(text.replace(/\s+/gu, ' ').trim(), 120);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderLiveFlowStateLabel(value) {
    const state = String(value ?? '');
    if (state === 'ready') return 'pronto';
    if (state === 'active-turn') return 'turno ativo';
    if (state === 'waiting-human') return 'aguardando você';
    if (state === 'paused') return 'pausado';
    if (state === 'offline') return 'fora do ar';
    if (state === 'recovering') return 'recuperando';
    return state || 'indefinido';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderLivePhaseLabel(value) {
    const phase = String(value ?? '');
    if (phase === 'idle') return 'pronto';
    if (phase === 'turn') return 'turno';
    if (phase === 'thinking') return 'pensando';
    if (phase === 'streaming') return 'respondendo';
    if (phase === 'tool') return 'ferramenta';
    if (phase === 'ask' || phase === 'user-input') return 'pergunta';
    if (phase === 'error') return 'erro';
    return phase || 'atividade';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderLiveOperationLabel(value) {
    const operation = String(value ?? '');
    if (operation === 'ask') return 'pergunta';
    if (operation === 'intent') return 'intenção';
    if (operation === 'read') return 'leitura';
    if (operation === 'write') return 'escrita';
    if (operation === 'edit') return 'edição';
    if (operation === 'copy') return 'cópia';
    if (operation === 'move' || operation === 'rename') return 'movimento';
    if (operation === 'delete' || operation === 'unlink') return 'exclusão';
    if (operation === 'list') return 'listagem';
    if (operation === 'run' || operation === 'exec') return 'execução';
    if (operation === 'inspect' || operation === 'stat') return 'inspeção';
    if (operation === 'mkdir') return 'criação de pasta';
    return operation || 'operação';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderLiveStatusLabel(value) {
    const status = String(value ?? '');
    if (status === 'active' || status === 'running' || status === 'started') return 'em andamento';
    if (status === 'completed' || status === 'done' || status === 'success' || status === 'ok') return 'concluída';
    if (status === 'failed' || status === 'fail' || status === 'error') return 'falhou';
    if (status === 'requested' || status === 'pending') return 'pendente';
    if (status === 'answered') return 'respondida';
    return status || 'registrada';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderLiveSourceLabel(value) {
    const source = String(value ?? '').trim().toLowerCase();
    if (!source) return 'terminal';
    if (source === 'sdk' || source.startsWith('sdk/')) return 'SDK';
    if (source === 'agent' || source.startsWith('agent/')) return 'agente';
    if (source === 'dialog' || source.startsWith('dialog')) return 'diálogo';
    if (source === 'io') return 'I/O real';
    if (source.includes('terminal')) return 'terminal';
    return compactHumanTerminalText(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactLiveLabel(value) {
    return compactHumanTerminalText(value)
        .replace(/^idle$/iu, 'pronto')
        .replace(/^Pending messages alteradas$/iu, 'Contexto da conversa atualizado')
        .replace(/^Tool concluída\b/iu, 'Ferramenta concluída')
        .replace(/^Tool falhou\b/iu, 'Ferramenta falhou')
        .replace(/^I\/O read concluído\b/iu, 'I/O leitura concluída')
        .replace(/^I\/O write concluído\b/iu, 'I/O escrita concluída')
        .replace(/^ask_user SDK solicitado\b/iu, 'Pergunta ao operador solicitada')
        .replace(/^request_user_input\b/iu, 'Pergunta ao operador');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactLiveDetail(value) {
    return compactHumanTerminalText(value)
        .replace(/\bmodelo=/giu, 'modelo ')
        .replace(/\bcusto=/giu, 'custo ')
        .replace(/\bstatus=success\b/giu, 'concluída')
        .replace(/\bstatus=completed\b/giu, 'concluída')
        .replace(/\bstatus=failed\b/giu, 'falhou')
        .replace(/\bchoices=/giu, 'opções ')
        .replace(/\bread\s+·/giu, 'leitura ·')
        .replace(/\bwrite\s+·/giu, 'escrita ·');
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function renderLiveBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {boolean} value
 * @returns {string}
 */
function renderLiveToggle(value) {
    return value ? 'ativo' : 'inativo';
}

/**
 * @param {unknown} mode
 * @returns {string}
 */
function renderLiveSdkMode(mode) {
    const value = String(mode ?? 'interactive');
    if (value === 'interactive') return 'interativo';
    if (value === 'plan') return 'plano';
    if (value === 'autopilot') return 'autopiloto';
    return value;
}

/**
 * @param {{ phase?: unknown; label?: unknown; detail?: unknown }} activity
 * @param {{ includePhase?: boolean }} [options]
 * @returns {string}
 */
function renderLiveActivitySummary(activity, options = {}) {
    const label = compactLiveLabel(activity.label ?? activity.phase ?? 'sem atividade recente');
    const detail = activity.detail ? ` · ${compactLiveDetail(activity.detail)}` : '';
    return options.includePhase ? `${renderLivePhaseLabel(activity.phase)} · ${label}${detail}` : `${label}${detail}`;
}

/**
 * @param {{ toolName?: string; operation?: string; path?: string | null; target?: string | null; status?: string | null; source?: string | null }} tool
 * @param {{ detail: boolean }} options
 * @returns {string}
 */
function renderLiveToolSummary(tool, options) {
    const operation = renderLiveOperationLabel(tool.operation);
    const targetCandidate = tool.path ?? tool.target ?? null;
    const targetIsInternal = isTerminalInternalCallIdentifier(targetCandidate);
    const presentation = buildTerminalToolActivityPresentation(
        {
            toolName: String(tool.toolName ?? ''),
            operation: String(tool.operation ?? ''),
            args: targetCandidate && !targetIsInternal ? { path: targetCandidate } : {},
        },
        String(tool.toolName ?? 'tool'),
    );
    const target =
        targetCandidate && !targetIsInternal
            ? ` · ${compactTerminalToolText(targetCandidate, 96)}`
            : targetCandidate && options.detail
              ? ` · id ${compactTerminalToolText(targetCandidate, 32)}`
              : '';
    const status = tool.status ? ` · ${renderLiveStatusLabel(tool.status)}` : '';
    const source = options.detail ? ` · ${renderLiveSourceLabel(tool.source)}` : '';
    return `${presentation.displayToolName} · ${operation}${target}${status}${source}`;
}

/**
 * Referência ao _hubSessionId gerenciado pelo terminal server. É passado como parâmetro pois não pode ser importado
 * estaticamente (é mutável).
 *
 * @typedef {object} SessionContext
 * @property {string | null} [hubSessionId] - ID da hub session ativa
 * @property {number} [injectPort] - Porta do inject server
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Exibe snapshot de status do agente.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdStatus({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId, arg: restArg } = extractRuntimeTarget(arg);
    const detailMode = /\b(full|detail|detalhe|debug|--full|--detail)\b/iu.test(restArg);
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    const activityProjection = readTerminalActivityProjection(3);
    const projection = readTerminalStatusProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
            },
            runtimeId,
        ),
    );
    const { snap, health } = projection;
    const active = projection.dialogLoopActive;
    const statusColor =
        snap['status'] === 'waiting_for_input' ? '\x1b[32m' : snap['status'] === 'idle' ? '\x1b[33m' : '\x1b[31m';
    if (!detailMode) {
        const healthColor =
            health?.['status'] === 'healthy' ? '\x1b[32m' : health?.['status'] === 'degraded' ? '\x1b[33m' : '\x1b[31m';
        const waitCount =
            projection.pendingElicitations +
            projection.pendingPermissions +
            projection.pendingUserInputs +
            projection.pendingStructuredUserInputs;
        const waitLine =
            waitCount > 0
                ? `\x1b[33m${waitCount} pendência(s)\x1b[0m \x1b[90m/sdk waits\x1b[0m`
                : '\x1b[32mnenhuma pendência\x1b[0m';
        const queue = Number(snap['queueSize'] ?? 0);
        const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
        const byokLabel = byok.enabled
            ? `${byok.ready ? '\x1b[32mpronto\x1b[0m' : '\x1b[33mincompleto\x1b[0m'} \x1b[90m${byok.providerType ?? '-'} · ${byok.model ?? '-'}\x1b[0m`
            : '\x1b[90mSDK Copilot\x1b[0m';
        const modelBilling = projection.modelBilling;
        const modelLabel = modelBilling.mismatch
            ? `\x1b[33m${modelBilling.displayModel}\x1b[0m \x1b[90m(ver /status full)\x1b[0m`
            : `\x1b[36m${modelBilling.displayModel}\x1b[0m`;
        const gatewayProjection = configProjection.modelGatewayProjection ?? {
            providerCount: 0,
            modelCount: 0,
            enabledModelCount: 0,
        };
        const rawAction = projection.recommendedAction === 'none' ? null : projection.recommendedAction;
        const action = rawAction ?? (waitCount > 0 ? '/sdk waits' : '/menu');

        println(`
  ${terminalThemeText('assistant', 'Status do Terminal LLM-B')}
  ─────────────────────────────────────
  Conversa     ${statusColor}${renderHumanTerminalStatus(snap['status'])}\x1b[0m · ${active ? '\x1b[32mativa\x1b[0m' : '\x1b[31minativa\x1b[0m'} · fila ${queue}
  Saúde        ${health ? `${healthColor}${renderHumanTerminalHealth(health['status'])}\x1b[0m` : '\x1b[90msem leitura\x1b[0m'}
  Entrada      ${waitLine}
  Modelo       ${modelLabel} \x1b[90m· raciocínio ${configProjection.currentReasoningEffort}\x1b[0m
  Acesso       ${byokLabel}
  Catálogo     \x1b[90m${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados\x1b[0m
  Atividade    \x1b[90m${renderLiveActivitySummary(projection.activity)}\x1b[0m
  Próximo      \x1b[33m${action}\x1b[0m
  Detalhe      \x1b[90m/status full · /now · /health · /menu\x1b[0m
  ─────────────────────────────────────
`);
        return;
    }
    const effort = configProjection.currentReasoningEffort;
    const sdkMode = projection.sdkSessionMode ?? 'interactive';
    const sdkModeColor = sdkMode === 'plan' ? '\x1b[35m' : sdkMode === 'autopilot' ? '\x1b[36m' : '\x1b[90m';
    const sdkPlanOpLabel = projection.sdkPlanOperation
        ? `${projection.sdkPlanOperation}${projection.sdkPlanChangedAt ? ` @ ${new Date(projection.sdkPlanChangedAt).toLocaleTimeString('pt-BR')}` : ''}`
        : '\x1b[90m(sem alterações)\x1b[0m';
    const healthColor =
        health?.['status'] === 'healthy' ? '\x1b[32m' : health?.['status'] === 'degraded' ? '\x1b[33m' : '\x1b[31m';
    const ws = projection.workspace;
    const branchStr = ws.currentBranch ? `\x1b[32m${ws.currentBranch}\x1b[0m` : '\x1b[90m(sem branch)\x1b[0m';
    const shadowState = projection.pendingQuestionShadowState;
    const askUserStatus = projection.pendingQuestion
        ? `\x1b[32mvivo\x1b[0m${projection.pendingQuestionKind ? ` [${projection.pendingQuestionKind}]` : ''}`
        : projection.pendingQuestionShadowExpired
          ? '\x1b[31mpergunta restaurada expirada\x1b[0m'
          : projection.pendingQuestionShadow
            ? `${shadowState === 'expired' ? '\x1b[31mpergunta restaurada expirada\x1b[0m' : shadowState === 'expiring_soon' ? '\x1b[33mpergunta restaurada expirando\x1b[0m' : shadowState === 'fresh' ? '\x1b[36mpergunta recém-restaurada\x1b[0m' : '\x1b[33mpergunta restaurada\x1b[0m'}${projection.pendingQuestionShadowKind ? ` [${projection.pendingQuestionShadowKind}]` : ''}`
            : '\x1b[90m(nenhum)\x1b[0m';
    const pendingPreview = projection.pendingQuestionText
        ? projection.pendingQuestionText.slice(0, 80) + (projection.pendingQuestionText.length > 80 ? '…' : '')
        : projection.pendingQuestionShadowText
          ? projection.pendingQuestionShadowText.slice(0, 80) +
            (projection.pendingQuestionShadowText.length > 80 ? '…' : '')
          : null;
    const inputChannel = projection.dialogInputChannel;
    const inputChannelColor =
        inputChannel.state === 'ready' || inputChannel.state === 'standby'
            ? '\x1b[32m'
            : inputChannel.state === 'waiting-human' || inputChannel.state === 'shadow' || inputChannel.state === 'paused'
              ? '\x1b[33m'
              : inputChannel.state === 'offline' || inputChannel.state === 'missing'
                ? '\x1b[31m'
                : '\x1b[90m';
    const shadowExpiry =
        typeof projection.pendingQuestionShadowExpiresAt === 'number'
            ? new Date(projection.pendingQuestionShadowExpiresAt).toISOString()
            : null;
    const shadowAgeLabel =
        typeof projection.pendingQuestionShadowAgeMs === 'number'
            ? `${Math.round(projection.pendingQuestionShadowAgeMs / 1000)}s`
            : null;
    const shadowRemainingLabel =
        typeof projection.pendingQuestionShadowRemainingMs === 'number'
            ? `${Math.round(projection.pendingQuestionShadowRemainingMs / 1000)}s`
            : null;
    const activity = projection.activity;
    const lifecycle = projection.lifecycleSummary;
    const bootDetail =
        lifecycle.boot &&
        (lifecycle.boot.skippedCount > 0 || lifecycle.boot.failedCount > 0 || lifecycle.boot.timeoutCount > 0)
            ? ` · ok=${lifecycle.boot.okCount} skipped=${lifecycle.boot.skippedCount} failed=${lifecycle.boot.failedCount} timeout=${lifecycle.boot.timeoutCount}`
            : '';
    const bootLine = lifecycle.boot
        ? `${lifecycle.boot.status === 'ok' ? '\x1b[32m' : '\x1b[31m'}${lifecycle.boot.status}\x1b[0m \x1b[90m${lifecycle.boot.phases} fases · ${lifecycle.boot.durationMs}ms${bootDetail}${lifecycle.boot.failedPhase ? ` · falha=${lifecycle.boot.failedPhase}` : ''}\x1b[0m`
        : '\x1b[90m(n/d)\x1b[0m';
    const shutdownLine = lifecycle.shuttingDown
        ? `\x1b[33mem andamento\x1b[0m \x1b[90m${lifecycle.registeredShutdownHandlers} handlers\x1b[0m`
        : lifecycle.shutdown
          ? `${lifecycle.shutdown.status === 'ok' ? '\x1b[32m' : '\x1b[31m'}${lifecycle.shutdown.status}\x1b[0m \x1b[90m${lifecycle.shutdown.handlers} handlers · ${lifecycle.shutdown.durationMs}ms${lifecycle.shutdown.failedHandler ? ` · falha=${lifecycle.shutdown.failedHandler}` : ''}\x1b[0m`
          : `\x1b[90mparado · ${lifecycle.registeredShutdownHandlers} handlers registrados\x1b[0m`;
    const modelMeta = configProjection.modelMeta ?? configProjection.observedModelMeta;
    const autoPolicy = configProjection.autoModelPolicy;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
    const autoPolicyLine =
        configProjection.currentModel === 'auto'
            ? `        auto policy      \x1b[90mpref=${autoPolicy.preferredModel}/${autoPolicy.preferredReasoningEffort} · autoridade=GitHub Copilot · último=${autoPolicy.observedModel ?? 'n/d'}\x1b[0m`
            : '';
    const byokLine = byok.enabled
        ? `    BYOK provider    ${byok.ready ? '\x1b[32mpronto\x1b[0m' : '\x1b[31mincompleto\x1b[0m'} \x1b[90mpreset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · auth ${byok.auth.bearerTokenConfigured ? 'bearer' : byok.auth.apiKeyConfigured ? 'apiKey' : byok.auth.headersConfigured ? 'headers' : 'none'} · /byok\x1b[0m`
        : '';
    const modelBilling = projection.modelBilling;
    const display = readTerminalDisplayProjection();
    const activitySeverityColor =
        activity.severity === 'error' ? '\x1b[31m' : activity.severity === 'warn' ? '\x1b[33m' : '\x1b[32m';
    const activityProgress = typeof activity.progress === 'number' ? ` (${activity.progress}%)` : '';
    const sdkInterruptions = [
        projection.pendingElicitations > 0
            ? `${projection.pendingElicitations} formulário(s)${projection.latestElicitationMode ? ` (${projection.latestElicitationMode})` : ''}`
            : null,
        projection.pendingPermissions > 0
            ? `${projection.pendingPermissions} permissão(ões)${projection.latestPermissionType ? ` (${projection.latestPermissionType})` : ''}`
            : null,
        projection.pendingUserInputs > 0
            ? `${projection.pendingUserInputs} pergunta(s)${projection.latestUserInputKind ? ` (${projection.latestUserInputKind})` : ''}`
            : null,
        projection.pendingStructuredUserInputs > 0
            ? `${projection.pendingStructuredUserInputs} input(s) estruturado(s)`
            : null,
    ].filter(Boolean);
    const sdkCapabilitiesUi =
        projection.sdkCapabilities && typeof projection.sdkCapabilities['ui'] === 'object'
            ? /** @type {Record<string, unknown>} */ (projection.sdkCapabilities['ui'])
            : null;
    const uiElicitationFlag = sdkCapabilitiesUi ? sdkCapabilitiesUi['elicitation'] === true : null;
    const timelineSyncLabel =
        projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight'
            ? ` · sync=${projection.timelineSyncStatus}:${projection.timelineSyncPendingCount}`
            : projection.timelineSyncStatus === 'synced'
              ? ` · sync=synced:${projection.timelineSyncSyncedCount}`
              : projection.timelineSyncStatus === 'failed'
                ? ` · sync=failed:${projection.timelineSyncFailedCount}`
                : ` · sync=${projection.timelineSyncStatus}`;
    const promptBindingDigest =
        typeof projection.systemPromptBinding?.['digest'] === 'string'
            ? projection.systemPromptBinding['digest']
            : null;
    const promptFreshness = projection.systemPromptFreshness;
    const promptIsStale = typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null;
    const promptFreshnessReason = typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null;
    const promptRecommendedAction =
        promptFreshness?.['recommendedAction'] === 'none' ||
        promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
        promptFreshness?.['recommendedAction'] === 'resume-session'
            ? promptFreshness['recommendedAction']
            : 'none';
    const promptFreshnessLabel =
        promptIsStale === true
            ? '\x1b[31mstale\x1b[0m'
            : promptRecommendedAction === 'observe-live-reload'
              ? '\x1b[33mlive-reload\x1b[0m'
              : promptIsStale === false
                ? '\x1b[32mok\x1b[0m'
                : '\x1b[90m(n/d)\x1b[0m';
    const toolLoad = projection.toolLoad;
    const toolLoadColor = toolLoad.hasCanonicalLocalFsTools ? '\x1b[32m' : '\x1b[33m';
    const toolContract = toolLoad.toolContract;
    const toolContractColor =
        toolContract.errorCount > 0 ? '\x1b[31m' : toolContract.warningCount > 0 ? '\x1b[33m' : '\x1b[32m';
    const instructionLoad = projection.instructionLoad;
    const instructionLoadColor =
        instructionLoad.sectionsMissingFileCount === 0 && instructionLoad.appendFileMissingCount === 0
            ? '\x1b[32m'
            : '\x1b[33m';
    const sdkFsRouting = projection.sdkFsRouting;
    const operationalGuidance = buildTerminalOperationalGuidance({
        sdkFsRouting,
        toolLoad,
        instructionLoad,
    });
    const sdkFsRoutingColor =
        sdkFsRouting.mode === 'local-fs-primary'
            ? '\x1b[32m'
            : sdkFsRouting.mode === 'sdk-workspace-only'
              ? '\x1b[33m'
              : '\x1b[31m';
    const ioRuntime = projection.ioRuntime;
    const ioHitRatio = Number(ioRuntime.cache.aggregate.hitRatio || 0).toFixed(3);
    const ioL1 = ioRuntime.cache.l1;
    const ioL2 = ioRuntime.cache.l2;
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const ioCacheLine = `l1=${ioL1['enabled'] ? 'on' : 'off'} entries=${ioL1['size'] ?? 0} bytes=${ioL1['bytesStored'] ?? 0} · l2=${ioL2['enabled'] ? 'on' : 'off'} entries=${ioL2['size'] ?? 0} · hitRatio=${ioHitRatio}`;
    const ioScopeLine = `scopes=${ioRuntime.scopes.active} · parser=${ioRuntime.parser.size}/${ioRuntime.parser.maxSize} · index=${ioIndex['available'] ? 'on' : 'empty'}:${ioIndex['files'] ?? 0}`;
    const agentSelection = getEffectiveSdkAgentSelection();
    const customAgentsLine = agentSelection.enabled.length
        ? `${agentSelection.enabled.join(', ')}${agentSelection.disabled.length ? ` · disabled=${agentSelection.disabled.join(', ')}` : ''}`
        : '(none)';
    const permissionModeSkipsSdkPrompts = terminalPermissionModeSkipsSdkPrompts(projection.permissionMode);
    const permissionModeDetail = `${projection.permissionMode} · sdk prompts=${permissionModeSkipsSdkPrompts ? 'skip' : 'selective'}`;
    println(`
  \x1b[36mStatus do Terminal LLM-B\x1b[0m
  ─────────────────────────────────────
  agente           ${statusColor}${snap['status']}\x1b[0m
        health           ${health ? `${healthColor}${health['status']}\x1b[0m` : '\x1b[90m(n/d)\x1b[0m'}
  dialog loop      ${active ? '\x1b[32m● ativo\x1b[0m' : '\x1b[31m○ inativo\x1b[0m'}
  pergunta humana ${askUserStatus}
  canal input      ${inputChannelColor}${inputChannel.label}\x1b[0m \x1b[90m(${inputChannel.state}${inputChannel.recoveryExpected ? ' · recovery sob demanda' : ''})\x1b[0m
  esperas SDK      ${sdkInterruptions.length > 0 ? `\x1b[33m${sdkInterruptions.join(' · ')}\x1b[0m` : '\x1b[90m(nenhuma)\x1b[0m'}
    UI SDK           \x1b[90mformulários ${uiElicitationFlag == null ? 'n/d' : uiElicitationFlag ? 'disponíveis' : 'indisponíveis'}\x1b[0m
  modelo           \x1b[36m${snap['model']}\x1b[0m
${byokLine ? `${byokLine}\n` : ''}  reasoning        \x1b[35m${effort}\x1b[0m
    modo SDK         ${sdkModeColor}${sdkMode}\x1b[0m
        permission mode  \x1b[33m${permissionModeDetail}\x1b[0m
    plan arquivo     ${sdkPlanOpLabel}
        bg tasks         ${health?.['backgroundPendingCount'] ?? 0}
        issues           ${Array.isArray(health?.['issues']) ? health['issues'].length : 0}
        ação sugerida    ${projection.recommendedAction ?? 'none'}
    runtime session  \x1b[90m${projection.runtimeSessionId ?? '(sem runtime)'}\x1b[0m
    runtime id       \x1b[90m${projection.runtimeId}\x1b[0m
    runtime profile  \x1b[90m${projection.agentProfileId ?? '(sem profile)'}\x1b[0m
    runtimes         \x1b[90m${projection.runtimeTopologyLabel}\x1b[0m
    timeline         \x1b[90m${projection.timelineSource} · ${projection.timelineAuthority} · ${projection.timelineReconciliationStatus} · ${projection.timelineTurnCount} turns${timelineSyncLabel}\x1b[0m
    prompt digest    \x1b[90m${promptBindingDigest ?? '(sem binding)'}\x1b[0m
    prompt frescor   ${promptFreshnessLabel} \x1b[90m(${promptRecommendedAction})\x1b[0m
    tools load       ${toolLoadColor}${toolLoad.total} registradas\x1b[0m \x1b[90m(fsCanônico=${toolLoad.hasCanonicalLocalFsTools} · execCanônico=${toolLoad.hasCanonicalLocalExecTools} · sdkWorkspace=${toolLoad.hasSdkWorkspaceTooling} · legacyShellLoaded=${toolLoad.hasLegacySdkShellToolsLoaded} · disabled=${toolLoad.disabled.length})\x1b[0m
    tool contract   ${toolContractColor}${toolContract.ok ? 'ok' : 'attention'}\x1b[0m \x1b[90m(errors=${toolContract.errorCount} · warnings=${toolContract.warningCount} · desc=${toolContract.metadataCoverage.descriptionPct}% · schema=${toolContract.metadataCoverage.parametersPct}% · category=${toolContract.metadataCoverage.categoryPct}% · tags=${toolContract.metadataCoverage.tagsPct}% · instructions=${toolContract.metadataCoverage.instructionsPct}%)\x1b[0m
    instr. load      ${instructionLoadColor}${instructionLoad.liveReloadMechanism}\x1b[0m \x1b[90m(sections=${instructionLoad.sectionCount} · missingSectionFile=${instructionLoad.sectionsMissingFileCount} · missingAppendFile=${instructionLoad.appendFileMissingCount} · sourcesRpc=${instructionLoad.sdkSupportsInstructionSourcesRpc})\x1b[0m
    sdk↔fs route     ${sdkFsRoutingColor}${sdkFsRouting.mode}\x1b[0m \x1b[90m${sdkFsRouting.reason}\x1b[0m
    custom agents   \x1b[90mperfil ${COPILOT_OPERATIONAL_PROFILE} · ${customAgentsLine}\x1b[0m
    io cache         \x1b[90m${ioCacheLine}\x1b[0m
    io scope         \x1b[90m${ioScopeLine}\x1b[0m
    sdk session      \x1b[90m${projection.sdkSessionId ?? '(sem sdk)'}\x1b[0m
    hub session      \x1b[90m${projection.hubSessionId ?? '(sem hub)'}\x1b[0m
    turnos canon     ${projection.turnCount} \x1b[90m(persistidos=${projection.persistedTimelineTurnCount} · bridge=${projection.bridgeTurnCount} · live-tail=${projection.liveBridgeTailCount})\x1b[0m
    inject port      ${projection.injectPort}
        atividade atual  ${activitySeverityColor}${activity.label}\x1b[0m${activityProgress}
        fase/source      \x1b[90m${activity.phase} · ${activity.source}\x1b[0m
        boot             ${bootLine}
        shutdown         ${shutdownLine}
        display          \x1b[90mraciocínio ${display.thinking ? 'ativo' : 'inativo'} · streaming ${display.streaming ? 'ativo' : 'inativo'} · uso ${display.usage ? 'ativo' : 'inativo'} · ferramentas ${display.tools ? 'ativo' : 'inativo'} · intenção ${display.intent ? 'ativo' : 'inativo'}\x1b[0m
          último PR         \x1b[90m${modelBilling.at ?? '(sem consumo ainda)'}\x1b[0m
          billing/modelo    ${modelBilling.mismatch ? `\x1b[31mdivergente\x1b[0m \x1b[90m(configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'})\x1b[0m` : `\x1b[32mok\x1b[0m \x1b[90m(${modelBilling.displayModel})\x1b[0m`}
          custo último PR   \x1b[90m${modelBilling.cost == null ? '(n/d)' : modelBilling.cost.toFixed(4)}\x1b[0m
        perfil modelo    \x1b[90m${modelMeta ? `custo ${modelMeta.costTier ?? 'n/a'} · velocidade ${modelMeta.speedTier ?? 'n/a'} · contexto ${typeof modelMeta.contextWindow === 'number' ? modelMeta.contextWindow.toLocaleString('pt-BR') : 'n/a'}` : '(sem metadados locais)'}\x1b[0m
${autoPolicyLine ? `${autoPolicyLine}\n` : ''}  ─────────────────────────────────────
  workspace        \x1b[90m${ws.cwd}\x1b[0m
  git root         \x1b[90m${ws.gitRoot ?? '(não é git repo)'}\x1b[0m
  branch           ${branchStr}
  ─────────────────────────────────────
`);
    if (pendingPreview) {
        println(`  pergunta salva  \x1b[90m${pendingPreview}\x1b[0m`);
    }
    if (shadowExpiry) {
        println(`  salva expira em \x1b[90m${shadowExpiry}\x1b[0m`);
    }
    if (shadowAgeLabel) {
        println(`  salva idade     \x1b[90m${shadowAgeLabel}\x1b[0m`);
    }
    if (shadowRemainingLabel && !projection.pendingQuestionShadowExpired) {
        println(`  salva restante  \x1b[90m${shadowRemainingLabel}\x1b[0m`);
    }
    if (activity.detail) {
        println(`  atividade info  \x1b[90m${activity.detail}\x1b[0m`);
    }
    if (inputChannel.detail) {
        println(`  canal detalhe  \x1b[90m${inputChannel.detail}\x1b[0m`);
    }
    if (promptFreshnessReason) {
        println(`  prompt reason   \x1b[90m${promptFreshnessReason}\x1b[0m`);
    }
    println(`  guia operação  \x1b[90m${operationalGuidance.summary}\x1b[0m`);
    println(`  domínio ativo  \x1b[90m${operationalGuidance.domainHint}\x1b[0m`);
    println(`  coleta ctx     \x1b[90m${operationalGuidance.contextHint}\x1b[0m`);
    if (operationalGuidance.warnings.length > 0) {
        println(`  atenção boot   \x1b[33m${operationalGuidance.warnings.join(' | ')}\x1b[0m`);
    }
    if (activityProjection.history.length > 0) {
        println(
            '  atividade rec.  \x1b[90m' +
                activityProjection.history
                    .map((entry) => {
                        const progress = typeof entry.progress === 'number' ? ` ${entry.progress}%` : '';
                        return `${entry.phase}:${entry.label}${progress}`;
                    })
                    .join('  •  ') +
                '\x1b[0m',
        );
    }
    if (projection.pendingQuestionShadowExpired) {
        println(
            '  \x1b[33mDica: a pergunta restaurada não é mais respondível; mantenha a limpeza no próximo fluxo operacional.\x1b[0m',
        );
    } else if (projection.pendingQuestionShadowState === 'expiring_soon') {
        println(
            '  \x1b[33mDica: a pergunta restaurada está perto de expirar; revise ou limpe antes que o estado fique ambíguo.\x1b[0m',
        );
    }
    if (projection.sdkSessionMode === 'plan') {
        println(
            '  \x1b[90mNota: a sessão SDK está em plan mode vanilla; use /plan off para voltar a interactive.\x1b[0m',
        );
    }
    if (projection.pendingElicitations > 0) {
        println('  \x1b[33mAção: há elicitation pendente; use /elicitation list e /elicitation show latest.\x1b[0m');
    }
    if (projection.pendingPermissions > 0) {
        println(
            '  \x1b[33mAção: há permissão SDK pendente; acompanhe /activity e aguarde o hook/runtime decidir.\x1b[0m',
        );
    }
    if (projection.pendingUserInputs > 0) {
        println(
            '  \x1b[33mAção: há pergunta humana pendente; responda via conversa normal ou use /answer <texto>.\x1b[0m',
        );
        if (projection.latestUserInput) {
            const latest = projection.latestUserInput;
            const question =
                typeof latest.question === 'string' ? latest.question.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
            const choices =
                Array.isArray(latest.choices) && latest.choices.length > 0
                    ? ` opções ${latest.choices.join(' | ')}`
                    : '';
            println(`  \x1b[90mUltima pergunta SDK:${choices} ${question}\x1b[0m`);
        }
    }
    if (projection.pendingStructuredUserInputs > 0) {
        println(
            '  \x1b[33mAção: há input estruturado pendente; digite a resposta normalmente ou use /answer <texto>.\x1b[0m',
        );
        if (projection.latestStructuredUserInput) {
            const latest = projection.latestStructuredUserInput;
            const question =
                typeof latest.question === 'string' ? latest.question.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
            const choices =
                Array.isArray(latest.choices) && latest.choices.length > 0
                    ? ` opções ${latest.choices.join(' | ')}`
                    : '';
            println(`  \x1b[90mUltimo input estruturado:${choices} ${question}\x1b[0m`);
        }
    }
    if (modelBilling.mismatch) {
        println(
            '  \x1b[33mAção recomendada: valide fallback/model switch com /sdk quota, /status e um turno curto de confirmação.\x1b[0m',
        );
    }
    if (projection.usedDefaultRuntimeFallback) {
        println(
            `  \x1b[33mNota: runtime solicitado ${projection.requestedRuntimeId ?? '(desconhecido)'} não encontrado; usando runtime default (${projection.runtimeId}).\x1b[0m`,
        );
    }
    if (projection.timelineReconciliationStatus === 'diverged') {
        println(
            '  \x1b[33mNota: timeline do bridge divergiu da persistência; a UX está priorizando o hub como autoridade canônica.\x1b[0m',
        );
    }
    if (projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight') {
        println(
            `  \x1b[90mTimeline sync: ${projection.timelineSyncStatus} (${projection.timelineSyncPendingCount} turnos pendentes para materializar no Hub).\x1b[0m`,
        );
    }
    if (projection.timelineSyncStatus === 'failed') {
        const retryLabel =
            typeof projection.timelineSyncNextRetryAt === 'number'
                ? ` próxima tentativa=${new Date(projection.timelineSyncNextRetryAt).toLocaleTimeString('pt-BR')}`
                : '';
        println(
            `  \x1b[33mTimeline sync falhou: ${projection.timelineSyncLastError ?? 'erro desconhecido'}${retryLabel}.\x1b[0m`,
        );
    }
}

/**
 * Snapshot operacional rápido para uso frequente durante investigação/live-debug.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdNow({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId, arg: restArg } = extractRuntimeTarget(arg);
    const detailMode = /\b(full|detail|detalhe|debug|--full|--detail)\b/iu.test(restArg);
    const projection = readTerminalStatusProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
            },
            runtimeId,
        ),
    );
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, projection.runtimeId);
    const mode = projection.sdkSessionMode ?? 'interactive';
    const state = String(projection.snap['status'] ?? 'unknown');
    const ask = projection.pendingQuestion
        ? `ASK:${projection.pendingQuestionKind ?? 'question'}`
        : projection.pendingQuestionShadowState
          ? `SHADOW:${projection.pendingQuestionShadowState}`
          : 'ASK:none';
    const channel = projection.dialogInputChannel;
    const sdkWait = [
        projection.pendingElicitations > 0 ? `ELICIT:${projection.pendingElicitations}` : null,
        projection.pendingPermissions > 0 ? `PERM:${projection.pendingPermissions}` : null,
        projection.pendingUserInputs > 0 ? `ASK:${projection.pendingUserInputs}` : null,
        `PM:${projection.permissionMode}`,
    ]
        .filter(Boolean)
        .join(' ');
    const queue = Number(projection.snap['queueSize'] ?? 0);
    const modelBilling = projection.modelBilling;
    const live = readTerminalLiveFlowProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
                limit: 4,
            },
            runtimeId,
        ),
    );
    const mismatchLabel = modelBilling.mismatch
        ? `mismatch(cfg=${modelBilling.configuredModel ?? '-'}|bill=${modelBilling.billedModel ?? '-'})`
        : `model=${modelBilling.displayModel}`;
    const gatewayProjection = configProjection.modelGatewayProjection ?? {
        providerCount: 0,
        modelCount: 0,
        enabledModelCount: 0,
        active: null,
    };
    const gatewayActive =
        gatewayProjection.active && typeof gatewayProjection.active === 'object' ? gatewayProjection.active : null;

    if (!detailMode) {
        const waitCount =
            projection.pendingElicitations +
            projection.pendingPermissions +
            projection.pendingUserInputs +
            projection.pendingStructuredUserInputs;
        const askLine = projection.pendingQuestion
            ? `pergunta pendente (${projection.pendingQuestionKind ?? 'geral'})`
            : projection.pendingQuestionShadowState
              ? `pergunta salva (${projection.pendingQuestionShadowState})`
              : 'sem pergunta pendente';
        const waitLine =
            waitCount > 0 ? `${waitCount} pendência(s) humanas · /sdk waits` : 'sem pendências humanas';
        const modelLine = modelBilling.mismatch
            ? `${modelBilling.displayModel} · revisar /status full`
            : modelBilling.displayModel;
        println(
            `\x1b[36m[agora]\x1b[0m ${renderHumanTerminalStatus(state)} · conversa ${projection.dialogLoopActive ? 'ativa' : 'inativa'} · fila ${queue} · ${askLine}`,
        );
        println(
            `\x1b[90m[agora]\x1b[0m entrada ${channel.label} · ${waitLine} · modelo ${modelLine}`,
        );
        if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
            println(
                `\x1b[90m[agora]\x1b[0m catálogo ${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ativo ${gatewayActive?.['modelId'] ?? '-'}`,
            );
        }
        if (projection.activity?.label) {
            const detail = projection.activity.detail ? ` · ${projection.activity.detail}` : '';
            println(`\x1b[90m[agora]\x1b[0m atividade ${projection.activity.label}${detail}`);
        }
        if (projection.recommendedAction && projection.recommendedAction !== 'none') {
            println(`\x1b[90m[agora]\x1b[0m próximo ${projection.recommendedAction}`);
        }
        return;
    }

    println(
        `\x1b[36m[now]\x1b[0m runtime=${projection.runtimeId} live=${live.state} status=${state} loop=${projection.dialogLoopActive ? 'on' : 'off'} channel=${channel.state} mode=${mode} queue=${queue} ${ask}${sdkWait ? ` ${sdkWait}` : ''} timeline=${projection.timelineSource}:${projection.timelineReconciliationStatus}:sync=${projection.timelineSyncStatus} sse=${live.sse.clients}/${live.sse.criticalClients} ${mismatchLabel}`,
    );
    if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
        println(
            `\x1b[90m[now]\x1b[0m gateway=providers:${gatewayProjection.providerCount} models:${gatewayProjection.modelCount} enabled:${gatewayProjection.enabledModelCount} active=${gatewayActive?.['modelId'] ?? '-'}${gatewayActive?.['providerId'] ? `@${gatewayActive['providerId']}` : ''}`,
        );
    }
    if (projection.activity?.label) {
        const detail = projection.activity.detail ? ` · ${projection.activity.detail}` : '';
        println(`\x1b[90m[now]\x1b[0m atividade=${projection.activity.phase}:${projection.activity.label}${detail}`);
    }
    if (projection.recommendedAction) {
        println(`\x1b[90m[now]\x1b[0m recommended=${projection.recommendedAction}`);
    }
}

/**
 * Exibe a linha do tempo operacional live do terminal: loop, streaming, SSE, tools, arquivos e I/O real.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdLive({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId, arg: rest } = extractRuntimeTarget(arg);
    const tokens = rest.trim().split(/\s+/u).filter(Boolean);
    const requestedLimit = Number(tokens.find((token) => /^\d+$/u.test(token)) ?? '') || 6;
    const detailMode = tokens.some((token) => /^(full|detail|detalhe|debug|--full|--detail)$/iu.test(token));
    const projection = readTerminalLiveFlowProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
                limit: requestedLimit,
            },
            runtimeId,
        ),
    );
    const status = projection.status;
    const current = projection.activity.current;
    const activeTrace = projection.turnTrace.current ?? projection.turnTrace.recent[0] ?? null;
    const stateColor =
        projection.state === 'ready'
            ? '\x1b[32m'
            : projection.state === 'active-turn'
              ? '\x1b[36m'
              : projection.state === 'waiting-human' || projection.state === 'paused'
                ? '\x1b[33m'
                : '\x1b[31m';
    const streamFlags = [
        `resposta ${renderLiveToggle(projection.stream.streaming)}`,
        `raciocínio ${renderLiveToggle(projection.stream.thinking)}`,
        `ferramentas ${renderLiveToggle(projection.stream.toolActivity)}`,
        `intenção ${renderLiveToggle(projection.stream.intent)}`,
        `uso ${renderLiveToggle(projection.stream.usage)}`,
    ].join(' · ');
    const ioRuntime = status.ioRuntime;
    const cacheHitRatio = Number(ioRuntime.cache.aggregate.hitRatio || 0).toFixed(3);
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});

    if (!detailMode) {
        const streamBits = [
            projection.stream.streaming ? 'resposta ao vivo' : null,
            projection.stream.thinking ? 'raciocínio visível' : null,
            projection.stream.toolActivity ? 'ferramentas visíveis' : null,
            projection.stream.usage ? 'uso visível' : null,
        ].filter(Boolean);
        const traceSummary = [
            projection.counters.toolCount > 0 ? `${projection.counters.toolCount} ferramenta(s)` : null,
            projection.counters.fileCount > 0 ? `${projection.counters.fileCount} arquivo(s)` : null,
            projection.counters.recentIoCount > 0 ? `${projection.counters.recentIoCount} I/O recente` : null,
        ].filter(Boolean);
        const stateLabel = renderLiveFlowStateLabel(projection.state);
        const activityLine = renderLiveActivitySummary(current);
        println(`
  ${terminalThemeText('assistant', 'Fluxo da conversa')}
  ─────────────────────────────────────
  Estado       ${stateColor}${stateLabel}\x1b[0m \x1b[90m${projection.summary}\x1b[0m
  Conversa     \x1b[90m${status.dialogLoopActive ? 'ativa' : 'inativa'} · ${renderHumanTerminalStatus(status.snap['status'])}${status.snap['dialogPaused'] ? ' · pausada' : ''}\x1b[0m
  Sinais       \x1b[90m${streamBits.join(' · ') || 'sinais reduzidos'}\x1b[0m
  Atividade    \x1b[90m${activityLine}\x1b[0m
  Turno        \x1b[90m${traceSummary.join(' · ') || 'sem ações recentes'}\x1b[0m
  Conexões     \x1b[90mSSE ${projection.sse.clients}/${projection.sse.criticalClients} · timeline ${projection.counters.timelineTurns} turno(s)\x1b[0m
  Detalhe      \x1b[90m/live full · /activity ${requestedLimit} detail · /events ${requestedLimit}\x1b[0m
  ─────────────────────────────────────
`);
        return;
    }

    println(`
  \x1b[36mFluxo detalhado da conversa\x1b[0m
  ─────────────────────────────────────
  estado          ${stateColor}${renderLiveFlowStateLabel(projection.state)}\x1b[0m \x1b[90m${projection.summary}\x1b[0m
  runtime         \x1b[90m${status.runtimeId} · ${renderHumanTerminalStatus(status.snap['status'])} · conversa ${status.dialogLoopActive ? 'ativa' : 'inativa'} · ${status.snap['dialogPaused'] ? 'pausada' : 'não pausada'}\x1b[0m
  sessão SDK      \x1b[90m${renderLiveSdkMode(status.sdkSessionMode)} · ${status.sdkSessionId ?? 'sem sessão SDK'} · permissões ${status.permissionMode}\x1b[0m
  sinais          \x1b[90m${streamFlags}\x1b[0m
  conexões        \x1b[90m${projection.sse.clients} cliente(s) SSE · ${projection.sse.criticalClients} crítico(s) · replay ${projection.sse.replayLastId}\x1b[0m
  timeline        \x1b[90m${projection.timeline.timelineSource} · ${projection.timeline.reconciliationStatus} · sync ${projection.timeline.sync.status} · ${projection.counters.timelineTurns} turno(s)\x1b[0m
  cache/escopo    \x1b[90mL1 ${renderLiveToggle(Boolean(ioRuntime.cache.l1['enabled']))}:${ioRuntime.cache.l1['size'] ?? 0} · L2 ${renderLiveToggle(Boolean(ioRuntime.cache.l2['enabled']))}:${ioRuntime.cache.l2['size'] ?? 0} · acerto ${cacheHitRatio} · índice ${ioIndex['available'] ? 'ativo' : 'vazio'}:${ioIndex['files'] ?? 0} · escopos ${ioRuntime.scopes.active} · parser ${ioRuntime.parser.size}/${ioRuntime.parser.maxSize}\x1b[0m
  atividade       \x1b[90m${renderLiveActivitySummary(current, { includePhase: true })}\x1b[0m
  trace           \x1b[90m${projection.counters.toolCount} ferramenta(s) · ${projection.counters.fileCount} arquivo(s) · ${projection.counters.recentIoCount} I/O recente\x1b[0m
  ─────────────────────────────────────`);

    if (activeTrace && (activeTrace.tools.length > 0 || activeTrace.files.length > 0)) {
        println('  turno observado');
        for (const tool of activeTrace.tools.slice(0, 5)) {
            println(`    - ${renderLiveToolSummary(tool, { detail: true })}`);
        }
        for (const file of activeTrace.files.slice(0, 5)) {
            println(
                `    - arquivo · ${renderLiveOperationLabel(file.operation)} · ${compactHumanTerminalText(file.path)} · ${renderLiveSourceLabel(file.source)}${file.count > 1 ? ` ×${file.count}` : ''}`,
            );
        }
    }

    if (projection.recentIo.length > 0) {
        println('  I/O real');
        for (const entry of projection.recentIo.slice(0, 6)) {
            const ts = new Date(entry.timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const statusLabel = entry.success ? 'concluída' : 'falhou';
            const bytes =
                typeof entry.bytesRead === 'number'
                    ? ` · ${renderLiveBytes(entry.bytesRead)} lidos`
                    : typeof entry.bytesWritten === 'number'
                      ? ` · ${renderLiveBytes(entry.bytesWritten)} escritos`
                      : '';
            const duration = typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : '';
            println(
                `    - [${ts}] ${statusLabel} · ${renderLiveOperationLabel(entry.operation)} · ${compactHumanTerminalText(entry.target)}${bytes}${duration}`,
            );
        }
    }

    if (projection.activity.history.length > 0) {
        println('  eventos recentes');
        for (const entry of projection.activity.history.slice(0, 6)) {
            const ts = new Date(entry.ts).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
            println(`    - [${ts}] ${renderLiveActivitySummary(entry, { includePhase: true })}${progress}`);
        }
    }

    println('');
}

/**
 * Exibe o histórico de conversa local.
 *
 * @param {SessionContext} ctx
 * @param {number | string} [n] - Número de pares a exibir ou argumento cru do REPL
 * @returns {void}
 */
export function cmdHistory({ println }, n = 10) {
    const rawArg = typeof n === 'number' ? String(n) : n;
    const { runtimeId, arg } = extractRuntimeTarget(rawArg ?? '');
    const requestedLimit = typeof n === 'number' ? n : Number(arg) || 10;
    const timeline = readTerminalTimelineProjection({ limitPairs: requestedLimit, runtimeId });
    const hist = timeline.turns;
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    println(
        `\n── Histórico (${timeline.timelineSource} · ${timeline.timelineAuthority} · ${timeline.reconciliationStatus}) ──`,
    );
    for (const turn of hist) {
        const ts = new Date(turn.timestamp).toLocaleTimeString('pt-BR');
        const roleLabel =
            turn.role === 'user'
                ? '👤'
                : turn.role === 'system' || turn.rawRole === 'ask_user'
                  ? '🧭'
                  : turn.rawRole === 'llm_a'
                    ? '🤖'
                    : '🧠';
        const sourceLabel = turn.persisted ? '' : ' \x1b[33m[live]\x1b[0m';
        const preview = turn.content.slice(0, 160) + (turn.content.length > 160 ? '…' : '');
        println(`  [${ts}] ${roleLabel}${sourceLabel} ${preview}`);
    }
    if (timeline.reconciliationStatus === 'diverged') {
        println(
            `  \x1b[33mNota: histórico do bridge divergiu; live-tail preservado=${timeline.liveBridgeTailCount} e sync bloqueado${timeline.syncBlockedReason ? ` (${timeline.syncBlockedReason})` : ''}.\x1b[0m`,
        );
    }
    if (timeline.sync.status === 'scheduled' || timeline.sync.status === 'inflight') {
        println(
            `  \x1b[90mSync Hub: ${timeline.sync.status} (${timeline.sync.pendingCount} turnos live aguardando persistência).\x1b[0m`,
        );
    } else if (timeline.sync.status === 'failed') {
        println(`  \x1b[33mSync Hub falhou: ${timeline.sync.lastError ?? 'erro desconhecido'}.\x1b[0m`);
    }
    println('─────────────────────────────────');
}

/**
 * Exibe o histórico SQLite persistido.
 *
 * @param {SessionContext} ctx
 * @param {number} [n] - Número de turnos a exibir (padrão: 20)
 * @param {number} [offset] - Offset de paginação (UPG-PROP-13)
 * @returns {void}
 */
export function cmdDbHistory({ hubSessionId, println }, n = 20, offset = 0) {
    const projection = readTerminalDbHistoryProjection({ hubSessionId: hubSessionId ?? null, limit: n, offset });
    if (!projection.available) {
        println('\x1b[90m  /db-history: Hub session não disponível (sem persistência).\x1b[0m');
        return;
    }
    try {
        const turns = projection.turns;
        if (turns.length === 0) {
            println('\x1b[90m  /db-history: Nenhum turno persistido ainda.\x1b[0m');
            return;
        }
        const offsetLabel = offset > 0 ? ` (offset recente ${offset})` : '';
        println(`\n  \x1b[36mÚltimos ${turns.length} turnos da sessão atual${offsetLabel}\x1b[0m`);
        println('  ─────────────────────────────────────────────────');
        for (const t of turns) {
            const ts = new Date(String(t['created_at'] ?? '')).toLocaleTimeString('pt-BR');
            const role = String(t['role'] ?? 'user');
            const content = String(t['content'] ?? '');
            const emoji = role === 'llm_b' ? '🧠' : role === 'llm_a' ? '🤖' : '👤';
            const preview = content.slice(0, 160) + (content.length > 160 ? '…' : '');
            println(`  \x1b[90m[${ts}]\x1b[0m ${emoji}  ${preview}`);
        }
        println(
            `  \x1b[90mwindow=${projection.effectiveOffset}..${projection.effectiveOffset + turns.length - 1} de ${projection.totalTurns} turnos persistidos\x1b[0m`,
        );
        println('  ─────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-history erro: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Lista as hub_sessions persistidas no DB.
 *
 * @param {SessionContext} ctx
 * @param {number} [n]
 * @returns {void}
 */
export function cmdDbSessions({ hubSessionId, println }, n = 10) {
    try {
        const { sessions, currentHubSessionId } = readTerminalDbSessionsProjection({
            currentHubSessionId: hubSessionId ?? null,
            limit: n,
        });
        if (sessions.length === 0) {
            println('\x1b[90m  /db-sessions: Nenhuma sessão persistida ainda.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mÚltimas ${sessions.length} hub sessions\x1b[0m`);
        println('  ──────────────────────────────────────────────────────────────');
        for (const s of sessions) {
            const createdAt = new Date(String(s['created_at'] ?? '')).toLocaleString('pt-BR');
            const sessionId = String(s['id'] ?? '');
            const sessionStatus = String(s['status'] ?? 'unknown');
            const title = String(s['title'] ?? '(sem título)');
            const isCurrent = sessionId === currentHubSessionId;
            const statusColor = sessionStatus === 'active' ? '\x1b[32m' : '\x1b[90m';
            const marker = isCurrent ? ' \x1b[33m← atual\x1b[0m' : '';
            println(
                `  ${statusColor}${sessionStatus}\x1b[0m  \x1b[90m${createdAt}\x1b[0m  \x1b[2m${sessionId.slice(0, 8)}\x1b[0m  ${title}${marker}`,
            );
        }
        println('  ──────────────────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-sessions erro: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Exibe atores ativos na sessão.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdWho({ injectPort, println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const { currentModel, currentReasoningEffort } = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    println(`
  \x1b[36mAtores ativos nesta sessão:\x1b[0m
  👤  \x1b[32mVocê\x1b[0m          — stdin (digitar diretamente aqui)
  🤖  \x1b[34mLLM-A\x1b[0m         — POST http://localhost:${injectPort}/inject
    🧠  \x1b[35mLLM-B\x1b[0m         — AlwaysAliveAgent (Copilot SDK · ${currentModel} · ${currentReasoningEffort})
  📡  \x1b[90mSSE stream\x1b[0m    — GET  http://localhost:${injectPort}/events
`);
}

/**
 * Exibe estatísticas da sessão atual.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdCount({ hubSessionId, println }) {
    const projection = readTerminalCountProjection({ hubSessionId: hubSessionId ?? null });
    if (!projection.available) {
        println('\x1b[33m  Nenhuma hub session ativa.\x1b[0m');
        return;
    }
    println(`
  \x1b[36mEstatísticas da sessão\x1b[0m
  ─────────────────────────────────────────────
    Turnos (usuário):   ${String(projection.userTurns).padStart(4)}
    Turnos (LLM-B):     ${String(projection.llmBTurns).padStart(4)}
    Turnos (total):     ${String(projection.turns).padStart(4)}
    Memórias salvas:    ${String(projection.memories).padStart(4)}
    Hub session:        ${projection.hubSessionId?.slice(0, 8) ?? '—'}…
    SDK session:        ${projection.sdkSessionId?.slice(0, 8) ?? '—'}…
  ─────────────────────────────────────────────\n`);
}

/**
 * Limpa histórico em memória.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClear({ println }) {
    clearTerminalHistory();
    println('\x1b[90m  Histórico em memória limpo.\x1b[0m');
}

/**
 * Responde pergunta pendente do LLM-B.
 *
 * @param {SessionContext} ctx
 * @param {string} arg
 * @returns {void}
 */
export function cmdAnswer({ println }, arg) {
    const { runtimeId, arg: answer } = extractRuntimeTarget(arg);
    const result = tryAnswerTerminalPendingQuestionInput(answer, runtimeId);
    if (result.ok) {
        const runtimeSuffix = result.runtimeId && result.runtimeId !== 'default' ? ` · runtime ${result.runtimeId}` : '';
        println(`Resposta enviada para pergunta pendente${runtimeSuffix}: "${result.answer}"`);
        return;
    }
    if (result.reason === 'empty') {
        println('[answer] Uso: /answer <texto>');
        return;
    }
    if (result.reason === 'protocol_controlled') {
        println('[answer] O runtime aguarda uma mensagem de diálogo. Digite o texto normalmente, sem /answer.');
        return;
    }
    if (shouldConsumeTerminalPendingAnswerInput(result)) {
        const choices =
            result.pendingQuestionChoices.length > 0 ? ` Opções: ${result.pendingQuestionChoices.join(' | ')}.` : '';
        println(`[answer] Resposta inválida para a pergunta pendente.${choices}`);
        return;
    }
    const projection = readTerminalStatusProjection(withRuntimeTarget({}, runtimeId));
    if (result.shadowExpired || projection.pendingQuestionShadowExpired) {
        println('[answer] Nenhuma pergunta viva. Há uma pergunta restaurada expirada pendente de limpeza.');
        return;
    }
    println('[answer] Nenhuma pergunta pendente.');
}

/**
 * Limpa explicitamente a shadow persistida de `ask_user` restaurada do disco.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClearShadow({ println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const ok = callWithRuntimeTarget(clearPendingTerminalQuestionShadow, runtimeId);
    println(
        ok
            ? '[clear-shadow] Pergunta restaurada do disco limpa.'
            : '[clear-shadow] Nenhuma pergunta restaurada pendente no momento.',
    );
}

const SDK_SESSION_PROBE_SUMMARY_RE =
    /\bBYOK_(?:AGENT_)?PROBE\b|\bterminal_byok_probe_marker\b|\bBYOK_AGENT_PROBE_ASK\b/iu;

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeSessionMetadata} entry
 * @returns {boolean}
 */
function isTerminalProbeSdkSession(entry) {
    return typeof entry.summary === 'string' && SDK_SESSION_PROBE_SUMMARY_RE.test(entry.summary);
}

/**
 * Resolve atalhos do inventário sem trocar a sessão viva por fora do initializer.
 *
 * @param {string} target
 * @param {{
 *     currentSessionId: string | null;
 *     lastSessionId: string | null;
 *     foregroundSessionId: string | null;
 *     sessions: import('../../presentation/contracts/index.js').RuntimeSessionMetadata[];
 * }} inventory
 * @returns {{ sessionId: string; source: string } | null}
 */
function resolveSdkSessionResumeTarget(target, inventory) {
    const clean = target.trim();
    const normalized = clean.toLowerCase();
    if (normalized === 'current' && inventory.currentSessionId) {
        return { sessionId: inventory.currentSessionId, source: 'current' };
    }
    if (normalized === 'last' && inventory.lastSessionId) {
        return { sessionId: inventory.lastSessionId, source: 'last' };
    }
    if (normalized === 'foreground' && inventory.foregroundSessionId) {
        return { sessionId: inventory.foregroundSessionId, source: 'foreground' };
    }
    const indexed = /^#(?<index>\d+)$/u.exec(clean);
    if (indexed?.groups?.['index']) {
        const index = Number.parseInt(indexed.groups['index'], 10) - 1;
        const entry = inventory.sessions[index];
        return entry ? { sessionId: entry.sessionId, source: clean } : null;
    }
    return clean ? { sessionId: clean, source: 'id' } : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} decision
 * @returns {string | null}
 */
function renderSdkSessionBootDecision(decision) {
    if (!decision) return null;
    const outcome = decision['outcome'] === 'created' || decision['outcome'] === 'resumed' ? decision['outcome'] : null;
    const requestedMode =
        decision['requestedMode'] === 'auto' || decision['requestedMode'] === 'new' || decision['requestedMode'] === 'resume'
            ? decision['requestedMode']
            : null;
    const selectedSessionId =
        typeof decision['selectedSessionId'] === 'string' && decision['selectedSessionId']
            ? decision['selectedSessionId']
            : null;
    const reason = typeof decision['reason'] === 'string' && decision['reason'] ? decision['reason'] : null;
    if (!outcome || !requestedMode || !selectedSessionId || !reason) return null;
    const candidate =
        typeof decision['resumeCandidateSessionId'] === 'string' && decision['resumeCandidateSessionId']
            ? ` · candidato ${decision['resumeCandidateSessionId']}`
            : '';
    const outcomeLabel = outcome === 'created' ? 'criada' : 'retomada';
    const requestedLabel = requestedMode === 'new' ? 'nova' : requestedMode === 'resume' ? 'retomar' : 'automática';
    return `${outcomeLabel} · pedido ${requestedLabel} · sessão ${selectedSessionId}${candidate} · motivo ${reason}`;
}

/**
 * @param {unknown} summary
 * @returns {string}
 */
function renderSdkSessionSummaryPreview(summary) {
    if (typeof summary !== 'string') return '';
    const compact = summary.replace(/\s+/gu, ' ').trim();
    if (!compact) return '';
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

/**
 * @param {string} action
 * @param {string} rawAction
 * @param {string[]} rest
 * @returns {{ limit: number; offset: number; filter: import('../../presentation/contracts/index.js').RuntimeSessionListFilter | undefined; filterLabel: string }}
 */
function parseSdkSessionInventoryArgs(action, rawAction, rest) {
    const tokens = action === 'status' || action === 'list' || action === 'ls' ? rest : [rawAction, ...rest];
    let limit = 12;
    let offset = 0;
    /** @type {import('../../presentation/contracts/index.js').RuntimeSessionListFilter} */
    const filter = {};
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) {
            limit = Math.min(100, Math.max(1, Number.parseInt(token, 10)));
            continue;
        }
        const [key, ...valueParts] = token.split('=');
        const value = valueParts.join('=').trim();
        if (!key || !value) continue;
        if (key === 'offset' && /^\d+$/u.test(value)) {
            offset = Math.max(0, Number.parseInt(value, 10));
        } else if (key === 'cwd') {
            filter.cwd = value;
        } else if (key === 'gitRoot') {
            filter.gitRoot = value;
        } else if (key === 'repository' || key === 'repo') {
            filter.repository = value;
        } else if (key === 'branch') {
            filter.branch = value;
        }
    }
    const filterEntries = Object.entries(filter);
    return {
        limit,
        offset,
        filter: filterEntries.length > 0 ? filter : undefined,
        filterLabel: filterEntries.length > 0 ? filterEntries.map(([key, value]) => `${key} ${value}`).join(' · ') : 'nenhum',
    };
}

/**
 * @param {unknown} state
 * @returns {string}
 */
function renderSdkSessionFsState(state) {
    if (!state || typeof state !== 'object') return 'n/d';
    const record = /** @type {Record<string, unknown>} */ (state);
    if (record['enabled'] !== true) return 'desativado';
    const root = record['storageRoot'] && typeof record['storageRoot'] === 'object'
        ? /** @type {Record<string, unknown>} */ (record['storageRoot'])
        : null;
    const session = record['session'] && typeof record['session'] === 'object'
        ? /** @type {Record<string, unknown>} */ (record['session'])
        : null;
    const rootDisplay = typeof root?.['display'] === 'string' ? root['display'] : '(root n/d)';
    const rootExists = root?.['exists'] === true ? 'existe' : root?.['exists'] === false ? 'ausente' : 'desconhecido';
    const sessionDisplay = typeof session?.['display'] === 'string' ? session['display'] : null;
    const sessionExists =
        session?.['exists'] === true ? 'existe' : session?.['exists'] === false ? 'ausente' : session ? 'desconhecido' : null;
    const statePath = typeof record['sessionStatePath'] === 'string' ? record['sessionStatePath'] : '(state n/d)';
    return `ativo · raiz ${rootDisplay} (${rootExists}) · estado ${statePath}${
        sessionDisplay ? ` · sessão ${sessionDisplay} (${sessionExists ?? 'desconhecido'})` : ''
    }`;
}

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 * @returns {string | null}
 */
function renderSdkSessionLocalMetadata(metadata) {
    if (!metadata) return null;
    const model = typeof metadata['model'] === 'string' && metadata['model'] ? metadata['model'] : null;
    const provider = metadata['provider'] && typeof metadata['provider'] === 'object'
        ? /** @type {Record<string, unknown>} */ (metadata['provider'])
        : null;
    const boundary = metadata['boundary'] && typeof metadata['boundary'] === 'object'
        ? /** @type {Record<string, unknown>} */ (metadata['boundary'])
        : null;
    const providerKind = typeof provider?.['kind'] === 'string' ? provider['kind'] : null;
    const providerModel = typeof provider?.['model'] === 'string' ? provider['model'] : null;
    const reason = typeof boundary?.['reason'] === 'string' ? boundary['reason'] : null;
    const parts = [
        model ? `modelo ${model}` : null,
        providerKind ? `provedor ${providerKind}${providerModel && providerModel !== model ? `:${providerModel}` : ''}` : null,
        reason ? `limite ${reason}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * @param {string} event
 * @returns {string}
 */
function renderSdkArchiveEventLabel(event) {
    if (event === 'sdk.lifecycle') return 'Ciclo de vida SDK';
    if (event === 'sdk.command.executed') return 'Comando SDK executado';
    if (event === 'user_input.requested') return 'Pergunta ao operador';
    if (event === 'user_input.completed') return 'Resposta do operador';
    if (event === 'elicitation.pending') return 'Formulário pendente';
    if (event === 'elicitation.completed') return 'Formulário concluído';
    if (event === 'permission.requested') return 'Permissão solicitada';
    if (event === 'permission.completed') return 'Permissão concluída';
    if (event === 'permission.mode_changed') return 'Modo de permissão alterado';
    return event.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function compactSdkSessionEventValue(value, max = 96) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    const compact = text.replace(/\s+/gu, ' ').trim();
    return compact.length > max ? `${compact.slice(0, Math.max(0, max - 3))}...` : compact;
}

/**
 * @param {unknown} payload
 * @param {string[]} keys
 * @returns {string | null}
 */
function readPayloadString(payload, keys) {
    if (!payload || typeof payload !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (payload);
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * @param {import('../state/sse-event-archive.js').TerminalSseEventArchiveEntry} entry
 * @returns {{ key: string; line: string }}
 */
function summarizeSdkSessionArchiveEntry(entry) {
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    const event = entry.event;
    const type = readPayloadString(payload, ['type', 'eventType', 'lifecycleType', 'status']) ?? '-';
    const sessionId = readPayloadString(payload, ['sessionId', 'sdkSessionId', 'foregroundSessionId']);
    const commandName = readPayloadString(payload, ['commandName', 'name', 'command']);
    const localCommand = readPayloadString(payload, ['localCommand']);
    const source = compactSdkSessionEventValue(entry.eventSource ?? entry.source ?? '-', 48);
    const detailParts = [
        `tipo ${compactSdkSessionEventValue(type, 42)}`,
        sessionId ? `sessão ${compactSdkSessionEventValue(sessionId, 54)}` : null,
        commandName ? `comando ${compactSdkSessionEventValue(commandName, 42)}` : null,
        localCommand ? `local ${compactSdkSessionEventValue(localCommand, 42)}` : null,
    ].filter(Boolean);
    return {
        key: [event, type, sessionId ?? '', commandName ?? '', localCommand ?? '', source].join('\u001f'),
        line: `#${entry.eventId ?? '-'} ${renderSdkArchiveEventLabel(event)} · ${source} · ${detailParts.join(' · ')}`,
    };
}

const SDK_SESSION_WAIT_ARCHIVE_EVENTS = Object.freeze([
    'user_input.requested',
    'user_input.completed',
    'elicitation.pending',
    'elicitation.completed',
    'permission.requested',
    'permission.completed',
    'permission.mode_changed',
]);

/**
 * @param {Record<string, unknown>} payload
 * @param {string[]} keys
 * @returns {unknown}
 */
function readPayloadValue(payload, keys) {
    for (const key of keys) {
        if (payload[key] !== undefined) return payload[key];
    }
    return undefined;
}

/**
 * @param {import('../state/sse-event-archive.js').TerminalSseEventArchiveEntry} entry
 * @returns {{ key: string; line: string }}
 */
function summarizeSdkWaitArchiveEntry(entry) {
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    const record = /** @type {Record<string, unknown>} */ (payload);
    const requestId = readPayloadString(record, ['requestId', 'id', 'pendingRequestId']);
    const sessionId = readPayloadString(record, ['sessionId', 'sdkSessionId']);
    const type =
        readPayloadString(record, ['permissionType', 'mode', 'action', 'kind', 'type']) ??
        (entry.event.includes('.') ? entry.event.split('.').at(-1) ?? entry.event : entry.event);
    const message = readPayloadString(record, ['question', 'message']);
    const answer = readPayloadString(record, ['answer', 'result']);
    const source = compactSdkSessionEventValue(entry.eventSource ?? entry.source ?? '-', 48);
    const choices = readPayloadValue(record, ['choices']);
    const choiceCount = Array.isArray(choices) ? choices.length : null;
    const content = readPayloadValue(record, ['content']);
    const contentKeys =
        content && typeof content === 'object'
            ? Object.keys(/** @type {Record<string, unknown>} */ (content)).slice(0, 4).join(',')
            : '';
    const detailParts = [
        `tipo ${compactSdkSessionEventValue(type, 42)}`,
        requestId ? `pedido ${compactSdkSessionEventValue(requestId, 54)}` : null,
        sessionId ? `sessão ${compactSdkSessionEventValue(sessionId, 42)}` : null,
        choiceCount != null ? `${choiceCount} opção(ões)` : null,
        message ? `mensagem ${compactSdkSessionEventValue(message, 70)}` : null,
        answer ? `resposta ${compactSdkSessionEventValue(answer, 52)}` : null,
        contentKeys ? `campos ${compactSdkSessionEventValue(contentKeys, 40)}` : null,
    ].filter(Boolean);
    return {
        key: [entry.event, type, requestId ?? '', sessionId ?? '', message ?? '', answer ?? '', source].join('\u001f'),
        line: `#${entry.eventId ?? '-'} ${renderSdkArchiveEventLabel(entry.event)} · ${source} · ${detailParts.join(' · ')}`,
    };
}

/**
 * @param {string[]} tokens
 * @returns {number}
 */
function parseSdkSessionEventsLimit(tokens) {
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) return Math.min(100, Math.max(1, Number(token)));
        if (token.startsWith('limit=') && /^\d+$/u.test(token.slice('limit='.length))) {
            return Math.min(100, Math.max(1, Number(token.slice('limit='.length))));
        }
    }
    return 20;
}

/**
 * Exibe uma lente de operador sobre eventos SDK canônicos já arquivados pelo fanout SSE.
 *
 * @param {SessionContext} ctx
 * @param {string[]} tokens
 * @returns {Promise<void>}
 */
async function cmdSessionSdkEvents({ println }, tokens) {
    const limit = parseSdkSessionEventsLimit(tokens);
    const [lifecycle, commands] = await Promise.all([
        readTerminalSseEventArchiveTail({ event: 'sdk.lifecycle', limit }),
        readTerminalSseEventArchiveTail({ event: 'sdk.command.executed', limit }),
    ]);
    const merged = [...lifecycle.entries, ...commands.entries]
        .sort((a, b) => {
            const ts = Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0);
            return ts || Number(a.eventId ?? 0) - Number(b.eventId ?? 0);
        })
        .slice(-limit);
    const state = lifecycle.state.path || commands.state.path ? lifecycle.state : commands.state;
    println('\n  \x1b[36mEventos SDK da sessão\x1b[0m');
    println(
        `  \x1b[90mfonte archive SSE canônico · arquivo ${state.path ?? '(sem arquivo)'} · janela ${limit} · ciclo de vida ${lifecycle.entries.length} · comandos ${commands.entries.length}\x1b[0m`,
    );
    if (lifecycle.state.error || commands.state.error) {
        println(`  \x1b[31merro ${lifecycle.state.error ?? commands.state.error}\x1b[0m`);
    }
    if (merged.length === 0) {
        println('  \x1b[33mNenhum sdk.lifecycle ou sdk.command.executed arquivado ainda.\x1b[0m');
        println('  \x1b[90mRode /events event=sdk.lifecycle 20 ou /events event=sdk.command.executed 20 para diagnóstico bruto.\x1b[0m\n');
        return;
    }
    /** @type {{ key: string; line: string; firstTimestamp: number; count: number }[]} */
    const collapsed = [];
    for (const entry of merged) {
        const summary = summarizeSdkSessionArchiveEntry(entry);
        const last = collapsed[collapsed.length - 1];
        if (last && last.key === summary.key) {
            last.count += 1;
            continue;
        }
        collapsed.push({
            key: summary.key,
            line: summary.line,
            firstTimestamp: Number(entry.timestamp ?? 0),
            count: 1,
        });
    }
    for (const entry of collapsed) {
        const time = entry.firstTimestamp ? new Date(entry.firstTimestamp).toLocaleTimeString('pt-BR') : '--:--:--';
        const repeats = entry.count > 1 ? ` \x1b[90m×${entry.count}\x1b[0m` : '';
        println(`    \x1b[90m${time}\x1b[0m  \x1b[33m${entry.line}\x1b[0m${repeats}`);
    }
    println('  \x1b[90mEste comando não cria eventos; ele resume o mesmo JSONL usado por /events e pelos testes live.\x1b[0m\n');
}

/**
 * Exibe waits/interações SDK publicados no fanout único: ask_user, elicitation e permission.
 *
 * @param {SessionContext} ctx
 * @param {string[]} tokens
 * @returns {Promise<void>}
 */
async function cmdSessionSdkWaits({ println }, tokens) {
    const limit = parseSdkSessionEventsLimit(tokens);
    const projections = await Promise.all(
        SDK_SESSION_WAIT_ARCHIVE_EVENTS.map((event) => readTerminalSseEventArchiveTail({ event, limit })),
    );
    const merged = projections
        .flatMap((projection) => projection.entries)
        .sort((a, b) => {
            const ts = Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0);
            return ts || Number(a.eventId ?? 0) - Number(b.eventId ?? 0);
        })
        .slice(-limit);
    const state = projections.find((projection) => projection.state.path)?.state ?? projections[0]?.state;
    const counts = new Map(SDK_SESSION_WAIT_ARCHIVE_EVENTS.map((event) => [event, 0]));
    for (const entry of merged) counts.set(entry.event, (counts.get(entry.event) ?? 0) + 1);
    println('\n  \x1b[36mWaits SDK da sessão\x1b[0m');
    println(
        `  \x1b[90mfonte archive SSE canônico · arquivo ${state?.path ?? '(sem arquivo)'} · janela ${limit} · perguntas ${(counts.get('user_input.requested') ?? 0) + (counts.get('user_input.completed') ?? 0)} · formulários ${(counts.get('elicitation.pending') ?? 0) + (counts.get('elicitation.completed') ?? 0)} · permissões ${(counts.get('permission.requested') ?? 0) + (counts.get('permission.completed') ?? 0) + (counts.get('permission.mode_changed') ?? 0)}\x1b[0m`,
    );
    const error = projections.find((projection) => projection.state.error)?.state.error;
    if (error) println(`  \x1b[31merro ${error}\x1b[0m`);
    if (merged.length === 0) {
        println('  \x1b[33mNenhum wait SDK arquivado ainda.\x1b[0m');
        println('  \x1b[90mUse /sdk waits para pendências vivas e /events event=user_input.requested 20 para bruto.\x1b[0m\n');
        return;
    }
    /** @type {{ key: string; line: string; firstTimestamp: number; count: number }[]} */
    const collapsed = [];
    for (const entry of merged) {
        const summary = summarizeSdkWaitArchiveEntry(entry);
        const last = collapsed[collapsed.length - 1];
        if (last && last.key === summary.key) {
            last.count += 1;
            continue;
        }
        collapsed.push({
            key: summary.key,
            line: summary.line,
            firstTimestamp: Number(entry.timestamp ?? 0),
            count: 1,
        });
    }
    for (const entry of collapsed) {
        const time = entry.firstTimestamp ? new Date(entry.firstTimestamp).toLocaleTimeString('pt-BR') : '--:--:--';
        const repeats = entry.count > 1 ? ` \x1b[90m×${entry.count}\x1b[0m` : '';
        println(`    \x1b[90m${time}\x1b[0m  \x1b[33m${entry.line}\x1b[0m${repeats}`);
    }
    println('  \x1b[90mPerguntas humanas, formulários e permissões continuam com comandos próprios; esta é só a trilha agregada.\x1b[0m\n');
}

/**
 * Lista os CommandDefinition[] locais registrados no SDK.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
function cmdSessionSdkCommands({ println }) {
    const specs = listTerminalSdkCommandSpecs();
    println('\n  \x1b[36mComandos SDK expostos ao Copilot\x1b[0m');
    println(
        `  \x1b[90mfonte agent/session/commands · ${specs.length} comando(s) · safelist observável; execução local continua no REPL\x1b[0m`,
    );
    for (const spec of specs) {
        println(`    \x1b[33m${spec.name}\x1b[0m → \x1b[90m${spec.localCommand}${spec.safe ? ' · safe' : ''}\x1b[0m`);
        println(`      \x1b[90m${spec.description}\x1b[0m`);
    }
    println('  \x1b[90mQuando o SDK chama um desses comandos, o terminal publica sdk.command.executed no fanout canônico.\x1b[0m\n');
}

/**
 * Cockpit de sessão SDK persistente. Diferencia sessão SDK, dialog loop, hub e snapshots locais sem trocar a sessão viva
 * por um caminho paralelo.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdSessionSdk({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const [rawAction = 'status', ...rest] = cleanArg.trim().split(/\s+/u).filter(Boolean);
    const action = rawAction.toLowerCase();
    if (action === 'events' || action === 'eventos' || action === 'lifecycle' || action === 'command-events') {
        await cmdSessionSdkEvents({ println }, [rawAction, ...rest]);
        return;
    }
    if (action === 'waits' || action === 'wait' || action === 'ui' || action === 'interactions') {
        await cmdSessionSdkWaits({ println }, [rawAction, ...rest]);
        return;
    }
    if (action === 'commands' || action === 'command' || action === 'catalog' || action === 'catalogo') {
        cmdSessionSdkCommands({ println });
        return;
    }
    if (action === 'next') {
        const [rawMode = '', ...modeRest] = rest;
        const mode = rawMode.toLowerCase();
        if (mode === 'new') {
            const result = await scheduleTerminalSdkSessionBootSelection({ mode: 'new' });
            if (!result.ok) throw result.error;
            println('  \x1b[32mPróximo boot: criar nova sessão SDK.\x1b[0m');
        } else if (mode === 'resume') {
            const target = modeRest.join(' ').trim();
            if (!target) {
                println('  \x1b[33mUso: /session sdk next resume <sessionId|#n|current|last|foreground>\x1b[0m');
                return;
            }
            let resolved;
            if (/^(?:#\d+|current|last|foreground)$/iu.test(target)) {
                let inventory;
                try {
                    inventory = await listTerminalSdkSessionInventory(runtimeId);
                } catch (error) {
                    println(`  \x1b[31mNão foi possível resolver o atalho de sessão SDK: ${toError(error).message}\x1b[0m`);
                    return;
                }
                resolved = resolveSdkSessionResumeTarget(target, inventory);
                if (!resolved) {
                    println(`  \x1b[33mAtalho de sessão SDK indisponível: ${target}. Rode /session sdk para ver o inventário.\x1b[0m`);
                    return;
                }
            } else {
                resolved = resolveSdkSessionResumeTarget(target, {
                    currentSessionId: null,
                    lastSessionId: null,
                    foregroundSessionId: null,
                    sessions: [],
                });
            }
            if (!resolved) {
                println(`  \x1b[33mSessão SDK não resolvida para ${target}. Rode /session sdk para ver o inventário.\x1b[0m`);
                return;
            }
            const result = await scheduleTerminalSdkSessionBootSelection({
                mode: 'resume',
                sessionId: resolved.sessionId,
            });
            if (!result.ok) throw result.error;
            println(
                `  \x1b[32mPróximo boot: tentar retomar sessão SDK ${resolved.sessionId}${resolved.source === 'id' ? '' : ` (${resolved.source})`}.\x1b[0m`,
            );
        } else if (mode === 'auto' || mode === 'clear') {
            const result = await scheduleTerminalSdkSessionBootSelection(null);
            if (!result.ok) throw result.error;
            println('  \x1b[32mPróximo boot: seleção automática restaurada; a sessão persistida anterior volta a ser o padrão.\x1b[0m');
        } else {
            println('  \x1b[33mUso: /session sdk next <new|resume <sessionId|#n|current|last|foreground>|auto>\x1b[0m');
            return;
        }
        println('  \x1b[90mA diretiva é consumida pelo initializer no próximo boot; /restart reinicia só o dialog loop.\x1b[0m');
        return;
    }
    if (action === 'delete' || action === 'remove') {
        const target = rest.join(' ').trim();
        if (!target) {
            println('  \x1b[33mUso: /session sdk delete <sessionId|#n>\x1b[0m');
            println('  \x1b[90mA sessão SDK viva é protegida; para sair dela, agende /session sdk next new.\x1b[0m');
            return;
        }
        let inventory;
        try {
            inventory = await listTerminalSdkSessionInventory(runtimeId);
        } catch (error) {
            println(`  \x1b[31mNão foi possível listar sessões SDK antes da exclusão: ${toError(error).message}\x1b[0m`);
            return;
        }
        const resolved = resolveSdkSessionResumeTarget(target, inventory);
        if (!resolved) {
            println(`  \x1b[33mSessão SDK não resolvida para exclusão: ${target}. Rode /session sdk para ver o inventário.\x1b[0m`);
            return;
        }
        if (resolved.sessionId === inventory.currentSessionId) {
            println(`  \x1b[31mSessão SDK viva não apagada: ${resolved.sessionId}.\x1b[0m`);
            println('  \x1b[90mAgende /session sdk next new ou retome outra sessão no próximo boot antes de apagar esta.\x1b[0m');
            return;
        }
        try {
            await deleteTerminalSdkSession(resolved.sessionId, runtimeId);
        } catch (error) {
            println(`  \x1b[31mFalha ao apagar sessão SDK ${resolved.sessionId}: ${toError(error).message}\x1b[0m`);
            return;
        }
        println(
            `  \x1b[32mSessão SDK apagada: ${resolved.sessionId}${resolved.source === 'id' ? '' : ` (${resolved.source})`}.\x1b[0m`,
        );
        println('  \x1b[90mdeleteSession remove estado persistido; /session sdk next controla apenas o próximo attach/create.\x1b[0m');
        return;
    }

    const inventoryArgs = parseSdkSessionInventoryArgs(action, rawAction, rest);
    const bootSelection = await readTerminalSdkSessionBootSelection();
    let inventory;
    try {
        inventory = await listTerminalSdkSessionInventory(runtimeId, inventoryArgs.filter, {
            enrichOffset: inventoryArgs.offset,
            enrichLimit: inventoryArgs.limit,
        });
    } catch (error) {
        println(`  \x1b[31mNão foi possível listar sessões SDK: ${toError(error).message}\x1b[0m`);
        println('  \x1b[90mAinda assim: /resume atua no hub; /session save|list|restore atua em snapshots locais.\x1b[0m');
        return;
    }

    const nextLabel =
        bootSelection?.mode === 'resume'
            ? `retomar ${bootSelection.sessionId}`
            : bootSelection?.mode === 'new'
              ? 'criar nova sessão'
              : 'automático';
    println('\n  \x1b[36mSessão SDK\x1b[0m');
    println(`    atual:          \x1b[33m${inventory.currentSessionId ?? '(sem sessão viva)'}\x1b[0m`);
    println(`    última SDK:     \x1b[33m${inventory.lastSessionId ?? '-'}\x1b[0m`);
    println(`    foreground:     \x1b[33m${inventory.foregroundSessionId ?? '-'}\x1b[0m`);
    println(`    próximo boot:   \x1b[33m${nextLabel}\x1b[0m`);
    println(`    arquivos:       \x1b[90m${renderSdkSessionFsState(inventory.sessionFs)}\x1b[0m`);
    const byokBinding = classifyTerminalByokSdkBinding(
        readTerminalByokProjection().summary,
        inventory.persistedByokBinding,
        inventory.currentSessionId,
    );
    println(`    vínculo BYOK:   \x1b[33m${renderTerminalSdkProviderBinding(inventory.persistedByokBinding)}\x1b[0m`);
    println(`    BYOK pronto:    \x1b[33m${byokBinding.preparedLabel}\x1b[0m`);
    println(`    limite BYOK:    \x1b[90m${byokBinding.headline}\x1b[0m`);
    if (byokBinding.action) {
        println(`      \x1b[90m${byokBinding.action}\x1b[0m`);
    }
    const bootDecision = renderSdkSessionBootDecision(inventory.lastBootDecision);
    if (bootDecision) {
        println(`    último boot:    \x1b[90m${bootDecision}\x1b[0m`);
    }
    println(
        '    \x1b[90m/session sdk controla sessão SDK; /restart reinicia só dialog loop; /resume injeta histórico do hub; /session save|list|restore são snapshots locais.\x1b[0m',
    );
    if (inventory.sessions.length === 0) {
        println('    \x1b[90mNenhuma sessão SDK listada pelo client atual.\x1b[0m\n');
        return;
    }
    println(
        `\n  \x1b[36mSessões SDK listadas\x1b[0m (${inventory.sessions.length}) \x1b[90mfiltro ${inventoryArgs.filterLabel} · deslocamento ${inventoryArgs.offset} · limite ${inventoryArgs.limit}\x1b[0m`,
    );
    const visibleSessions = inventory.sessions.slice(inventoryArgs.offset, inventoryArgs.offset + inventoryArgs.limit);
    for (const [index, entry] of visibleSessions.entries()) {
        const absoluteIndex = inventoryArgs.offset + index;
        const flags = [
            entry.sessionId === inventory.currentSessionId ? 'atual' : null,
            entry.sessionId === inventory.lastSessionId ? 'last' : null,
            entry.sessionId === inventory.foregroundSessionId ? 'foreground' : null,
            isTerminalProbeSdkSession(entry) ? 'probe-residue' : null,
            entry.isRemote ? 'remote' : 'local',
        ]
            .filter(Boolean)
            .join(',');
        const start = entry.startTime instanceof Date ? entry.startTime.toISOString() : String(entry.startTime ?? '-');
        const modified =
            entry.modifiedTime instanceof Date ? entry.modifiedTime.toISOString() : String(entry.modifiedTime ?? '-');
        const summary = renderSdkSessionSummaryPreview(entry.summary);
        const localMetadata = renderSdkSessionLocalMetadata(
            entry.localMetadata && typeof entry.localMetadata === 'object'
                ? /** @type {Record<string, unknown>} */ (entry.localMetadata)
                : null,
        );
        println(`    \x1b[90m#${absoluteIndex + 1}\x1b[0m \x1b[33m${entry.sessionId}\x1b[0m  \x1b[90m${flags || '-'}\x1b[0m`);
        println(`      \x1b[90minício ${start} · alterada ${modified}${summary ? ` · ${summary}` : ''}\x1b[0m`);
        if (localMetadata) {
            println(`      \x1b[90mmetadados locais: ${localMetadata}\x1b[0m`);
        }
        if (entry.sessionFs) {
            println(`      \x1b[90marquivos da sessão: ${renderSdkSessionFsState(entry.sessionFs)}\x1b[0m`);
        }
    }
    if (inventory.sessions.length > inventoryArgs.offset + visibleSessions.length) {
        println(
            `    \x1b[90m... ${inventory.sessions.length - inventoryArgs.offset - visibleSessions.length} sessão(ões) omitida(s). Use /session sdk ${inventoryArgs.limit} offset=${inventoryArgs.offset + visibleSessions.length}.\x1b[0m`,
        );
    }
    println(
        '\n  \x1b[90mPróximo boot: /session sdk next new | /session sdk next resume <id|#n|current|last|foreground> | /session sdk next auto\x1b[0m',
    );
    println('  \x1b[90mFiltros: /session sdk <n> offset=<n> cwd=<path> gitRoot=<path> repo=<owner/repo> branch=<nome>.\x1b[0m');
    println('  \x1b[90mLimpeza persistida: /session sdk delete <id|#n>; sessão viva é protegida contra exclusão.\x1b[0m');
    println('  \x1b[90mprobe-residue marca canários persistidos por diagnósticos antigos; probes novos usam sessão efêmera.\x1b[0m\n');
}

/**
 * F41.5: Salva snapshot da sessão atual.
 *
 * @param {SessionContext} ctx
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export async function cmdSessionSave({ println }, reason) {
    const { runtimeId, arg: cleanReason } = extractRuntimeTarget(reason);
    const { data, path } = await callWithRuntimeTarget(
        saveTerminalSnapshotProjection,
        runtimeId,
        cleanReason || undefined,
    );
    println(`\x1b[32m  ✓ Snapshot salvo: ${String(data['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    println(`\x1b[90m    Path: ${path}\x1b[0m`);
}

/**
 * F41.5: Lista snapshots disponíveis.
 *
 * @param {SessionContext} ctx
 * @returns {Promise<void>}
 */
export async function cmdSessionList({ println }) {
    const snaps = await listTerminalSnapshotsProjection();
    if (snaps.length === 0) {
        println('\x1b[90m  Nenhum snapshot encontrado.\x1b[0m');
        return;
    }
    println(`\x1b[36m  Snapshots disponíveis (${snaps.length}):\x1b[0m`);
    for (const s of snaps) {
        const createdAt = s['createdAt'];
        const date =
            typeof createdAt === 'number' || typeof createdAt === 'string'
                ? new Date(createdAt).toISOString().replace('T', ' ').slice(0, 19)
                : 'invalid-date';
        println(
            `    ${String(s['snapshotId'] ?? '')}  ${date}  modelo ${String(s['model'] ?? '')}  ${String(s['reason'] ?? '')}`,
        );
    }
}

/**
 * F41.5: Exibe detalhes de um snapshot.
 *
 * @param {SessionContext} ctx
 * @param {string} snapshotId
 * @returns {Promise<void>}
 */
export async function cmdSessionRestore({ println }, snapshotId) {
    if (!snapshotId) {
        println('\x1b[33m  Uso: /session restore <snapshotId>\x1b[0m');
        println('\x1b[90m  Use /session list para ver snapshots disponíveis.\x1b[0m');
        return;
    }

    const snap = await loadTerminalSnapshotProjection(snapshotId);
    if (!snap) {
        println(`\x1b[31m  Snapshot não encontrado: ${snapshotId}\x1b[0m`);
        return;
    }

    println(`\x1b[36m  Snapshot: ${String(snap['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    const createdAt = snap['createdAt'];
    const createdAtIso =
        typeof createdAt === 'number' || typeof createdAt === 'string'
            ? new Date(createdAt).toISOString()
            : 'invalid-date';
    println(`    Criado: ${createdAtIso}`);
    println(`    Sessão: ${String(snap['sessionId'] ?? '(nenhuma)')}`);
    println(`    Modelo: ${String(snap['model'] ?? 'desconhecido')}  Status: ${String(snap['status'] ?? 'desconhecido')}`);
    println(`    Envios: ${Number(snap['sendCount'] ?? 0)}`);
    println(
        `    Conversa: ${snap['dialogLoopActive'] ? 'ativa' : 'inativa'}${snap['dialogPaused'] ? ' (pausada)' : ''}`,
    );
    if (snap['pendingQuestion']) {
        const pendingMeta =
            snap['pendingQuestionMeta'] && typeof snap['pendingQuestionMeta'] === 'object'
                ? /** @type {{ kind?: string }} */ (snap['pendingQuestionMeta'])
                : null;
        const pendingKind = pendingMeta?.kind ? ` [${pendingMeta.kind}]` : '';
        println(`    Pergunta pendente${pendingKind}: ${String(snap['pendingQuestion'])}`);
    }
    if (snap['pendingQuestionShadow'] && typeof snap['pendingQuestionShadow'] === 'object') {
        const shadow =
            /** @type {{ question?: unknown; meta?: { kind?: unknown }; restoredAt?: unknown; expiresAt?: unknown }} */ (
                snap['pendingQuestionShadow']
            );
        const shadowKind = typeof shadow.meta?.kind === 'string' ? ` [${shadow.meta.kind}]` : '';
        println(`    Pergunta restaurada${shadowKind}: ${String(shadow.question ?? '(sem texto)')}`);
        if (typeof shadow.restoredAt === 'number') {
            println(`    Shadow restoredAt: ${new Date(shadow.restoredAt).toISOString()}`);
        }
        if (typeof shadow.expiresAt === 'number') {
            println(`    Shadow expiresAt: ${new Date(shadow.expiresAt).toISOString()}`);
        }
    }
    if (snap['prMetrics']) {
        const prMetrics = /** @type {{ boots?: number; resumesWithPR?: number; resumesZeroPR?: number }} */ (
            snap['prMetrics']
        );
        println(
            `    PR metrics: boots=${Number(prMetrics.boots ?? 0)} resumePR=${Number(prMetrics.resumesWithPR ?? 0)} zeroPR=${Number(prMetrics.resumesZeroPR ?? 0)}`,
        );
    }
    println('\x1b[90m    (Restore automático ocorre no boot via PM2 — use /session save antes de reiniciar)\x1b[0m');
}
