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
    formatTerminalIsoTimestamp,
    terminalPermissionModeSkipsSdkPrompts,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
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
function renderHumanInputChannelState(value) {
    const state = String(value ?? '');
    if (state === 'ready') return 'pronto';
    if (state === 'standby') return 'standby';
    if (state === 'waiting-human') return 'aguardando operador';
    if (state === 'shadow') return 'pergunta restaurada';
    if (state === 'paused') return 'pausado';
    if (state === 'offline') return 'offline';
    if (state === 'missing') return 'ausente';
    return state || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderHumanInputChannelText(value) {
    return String(value ?? '')
        .replace(/\bask_user\b/giu, 'pergunta humana')
        .replace(/\brecovery\b/giu, 'recuperação')
        .replace(/\bdirect dispatch\b/giu, 'envio direto')
        .replace(/\bruntime\b/giu, 'ambiente');
}

/**
 * @param {string | null | undefined} role
 * @param {string | null | undefined} rawRole
 * @returns {{ label: string; role: 'user' | 'assistant' | 'system' | 'question' | 'muted' }}
 */
function renderTerminalActorLabel(role, rawRole = null) {
    if (role === 'user') return { label: 'Você', role: 'user' };
    if (role === 'system' || rawRole === 'ask_user') return { label: 'Sistema', role: 'system' };
    if (rawRole === 'llm_a' || role === 'llm_a') return { label: 'LLM-A', role: 'system' };
    if (role === 'llm_b' || rawRole === 'llm_b') return { label: 'LLM-B', role: 'assistant' };
    return { label: String(role ?? rawRole ?? 'Turno'), role: 'muted' };
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function renderTerminalActionLabel(action) {
    const value = typeof action === 'string' ? action.trim() : '';
    if (!value || value === 'none') return 'nenhuma ação imediata';
    if (value === 'clear_pending_question_shadow') return 'limpar pergunta restaurada';
    if (value === 'answer_pending_question') return 'responder pergunta pendente';
    if (value === 'inspect_boot_report') return 'verificar relatório de inicialização';
    if (value === 'try_model_alternative') return 'testar modelo alternativo';
    if (value === 'check_quota') return 'verificar quota/limites';
    if (value === 'observe-live-reload') return 'observar recarregamento vivo';
    if (value === 'resume-session') return 'retomar sessão';
    return value.replace(/_/gu, ' ');
}

/**
 * @param {{ bearerTokenConfigured?: boolean; apiKeyConfigured?: boolean; headersConfigured?: boolean }} auth
 * @returns {string}
 */
function renderTerminalAuthLabel(auth) {
    if (auth.bearerTokenConfigured) return 'token bearer';
    if (auth.apiKeyConfigured) return 'chave API';
    if (auth.headersConfigured) return 'headers';
    return 'ausente';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalSyncStatusLabel(value) {
    const status = String(value ?? '');
    if (status === 'scheduled') return 'agendada';
    if (status === 'inflight') return 'em andamento';
    if (status === 'synced') return 'sincronizada';
    if (status === 'failed') return 'falhou';
    if (status === 'idle') return 'ociosa';
    return status || 'n/d';
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
 * @param {string[]} commands
 * @returns {string}
 */
function renderCommandList(commands) {
    return commands.map((command) => terminalThemeText('command', command)).join(terminalThemeText('muted', ' · '));
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
 * @param {{ clients: number; criticalClients: number }} sse
 * @returns {string}
 */
function renderCompactSseLine(sse) {
    if (sse.clients <= 0 && sse.criticalClients <= 0) return 'SSE sem clientes';
    return `SSE ${sse.clients}/${sse.criticalClients}`;
}

/**
 * @param {Record<string, unknown> | null} active
 * @returns {string}
 */
function renderCompactGatewayActive(active) {
    if (!active) return '-';
    const provider = typeof active['providerId'] === 'string' ? active['providerId'] : '';
    const rawModel = typeof active['modelId'] === 'string' ? active['modelId'] : '-';
    const model = provider && rawModel.startsWith(`${provider}:`) ? rawModel.slice(provider.length + 1) : rawModel;
    return provider ? `${provider} · ${model}` : model;
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
    if (!detailMode) {
        const waitCount =
            projection.pendingElicitations +
            projection.pendingPermissions +
            projection.pendingUserInputs +
            projection.pendingStructuredUserInputs;
        const waitLine = waitCount > 0 ? `${waitCount} pendência(s) · /sdk waits` : 'nenhuma pendência';
        const queue = Number(snap['queueSize'] ?? 0);
        const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
        const byokLabel = byok.enabled
            ? `${byok.ready ? 'pronto' : 'incompleto'} · ${byok.providerType ?? '-'} · ${byok.model ?? '-'}`
            : 'SDK Copilot';
        const modelBilling = projection.modelBilling;
        const modelLabel = modelBilling.mismatch ? `${modelBilling.displayModel} · ver /status full` : modelBilling.displayModel;
        const gatewayProjection = configProjection.modelGatewayProjection ?? {
            providerCount: 0,
            modelCount: 0,
            enabledModelCount: 0,
        };
        const rawAction = projection.recommendedAction === 'none' ? null : projection.recommendedAction;
        const action = rawAction ?? (waitCount > 0 ? '/sdk waits' : '/menu');

        println('');
        println(terminalThemeHeadline('assistant', 'Status do Terminal LLM-B'));
        println(terminalThemeDivider(37));
        println(
            terminalThemeRow(
                'Conversa',
                `${renderHumanTerminalStatus(snap['status'])} · ${active ? 'ativa' : 'inativa'} · fila ${queue}`,
                { role: active ? 'success' : 'warn' },
            ),
        );
        println(terminalThemeRow('Saúde', health ? renderHumanTerminalHealth(health['status']) : 'sem leitura', { role: health?.['status'] === 'healthy' ? 'success' : 'warn' }));
        println(terminalThemeRow('Entrada', waitLine, { role: waitCount > 0 ? 'warn' : 'success' }));
        println(terminalThemeRow('Modelo', `${modelLabel} · raciocínio ${configProjection.currentReasoningEffort}`, { role: modelBilling.mismatch ? 'warn' : 'assistant' }));
        println(terminalThemeRow('Acesso', byokLabel, { role: byok.enabled && !byok.ready ? 'warn' : 'success' }));
        println(
            terminalThemeRow(
                'Catálogo',
                `${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados`,
            ),
        );
        println(terminalThemeRow('Atividade', renderLiveActivitySummary(projection.activity)));
        println(terminalThemeRow('Próximo', action, { role: 'command' }));
        println(terminalThemeRow('Detalhe', renderCommandList(['/status full', '/now', '/health', '/menu'])));
        println(terminalThemeDivider(37));
        println('');
        return;
    }
    const effort = configProjection.currentReasoningEffort;
    const sdkMode = projection.sdkSessionMode ?? 'interactive';
    const sdkPlanOpLabel = projection.sdkPlanOperation
        ? `${projection.sdkPlanOperation}${projection.sdkPlanChangedAt ? ` @ ${formatTerminalIsoTimestamp(projection.sdkPlanChangedAt)}` : ''}`
        : 'sem alterações';
    const ws = projection.workspace;
    const branchStr = ws.currentBranch ? ws.currentBranch : 'sem branch';
    const shadowState = projection.pendingQuestionShadowState;
    const askUserStatus = projection.pendingQuestion
        ? `viva${projection.pendingQuestionKind ? ` (${projection.pendingQuestionKind})` : ''}`
        : projection.pendingQuestionShadowExpired
          ? 'pergunta restaurada expirada'
          : projection.pendingQuestionShadow
            ? `${shadowState === 'expired' ? 'pergunta restaurada expirada' : shadowState === 'expiring_soon' ? 'pergunta restaurada expirando' : shadowState === 'fresh' ? 'pergunta recém-restaurada' : 'pergunta restaurada'}${projection.pendingQuestionShadowKind ? ` (${projection.pendingQuestionShadowKind})` : ''}`
            : 'nenhuma';
    const pendingPreview = projection.pendingQuestionText
        ? projection.pendingQuestionText.slice(0, 80) + (projection.pendingQuestionText.length > 80 ? '…' : '')
        : projection.pendingQuestionShadowText
          ? projection.pendingQuestionShadowText.slice(0, 80) +
            (projection.pendingQuestionShadowText.length > 80 ? '…' : '')
          : null;
    const inputChannel = projection.dialogInputChannel;
    const shadowExpiry =
        typeof projection.pendingQuestionShadowExpiresAt === 'number'
            ? formatTerminalIsoTimestamp(projection.pendingQuestionShadowExpiresAt)
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
            ? ` · ok ${lifecycle.boot.okCount} · pulados ${lifecycle.boot.skippedCount} · falhas ${lifecycle.boot.failedCount} · timeouts ${lifecycle.boot.timeoutCount}`
            : '';
    const bootLine = lifecycle.boot
        ? `${lifecycle.boot.status} · ${lifecycle.boot.phases} fases · ${lifecycle.boot.durationMs}ms${bootDetail}${lifecycle.boot.failedPhase ? ` · falha ${lifecycle.boot.failedPhase}` : ''}`
        : 'n/d';
    const shutdownLine = lifecycle.shuttingDown
        ? `em andamento · ${lifecycle.registeredShutdownHandlers} handlers`
        : lifecycle.shutdown
          ? `${lifecycle.shutdown.status} · ${lifecycle.shutdown.handlers} handlers · ${lifecycle.shutdown.durationMs}ms${lifecycle.shutdown.failedHandler ? ` · falha ${lifecycle.shutdown.failedHandler}` : ''}`
          : `parado · ${lifecycle.registeredShutdownHandlers} handlers registrados`;
    const modelMeta = configProjection.modelMeta ?? configProjection.observedModelMeta;
    const autoPolicy = configProjection.autoModelPolicy;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
    const autoPolicyLine =
        configProjection.currentModel === 'auto'
            ? `preferido ${autoPolicy.preferredModel}/${autoPolicy.preferredReasoningEffort} · autoridade GitHub Copilot · último ${autoPolicy.observedModel ?? 'n/d'}`
            : '';
    const byokLine = byok.enabled
        ? `${byok.ready ? 'pronto' : 'incompleto'} · preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · autenticação ${renderTerminalAuthLabel(byok.auth)} · /byok`
        : '';
    const modelBilling = projection.modelBilling;
    const display = readTerminalDisplayProjection();
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
            ? ` · sincronização ${renderTerminalSyncStatusLabel(projection.timelineSyncStatus)}:${projection.timelineSyncPendingCount}`
            : projection.timelineSyncStatus === 'synced'
              ? ` · sincronização sincronizada:${projection.timelineSyncSyncedCount}`
              : projection.timelineSyncStatus === 'failed'
                ? ` · sincronização falhou:${projection.timelineSyncFailedCount}`
                : ` · sincronização ${renderTerminalSyncStatusLabel(projection.timelineSyncStatus)}`;
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
            ? 'desatualizado'
            : promptRecommendedAction === 'observe-live-reload'
              ? 'recarregamento vivo'
              : promptIsStale === false
                ? 'ok'
                : 'n/d';
    const toolLoad = projection.toolLoad;
    const toolContract = toolLoad.toolContract;
    const instructionLoad = projection.instructionLoad;
    const sdkFsRouting = projection.sdkFsRouting;
    const operationalGuidance = buildTerminalOperationalGuidance({
        sdkFsRouting,
        toolLoad,
        instructionLoad,
    });
    const ioRuntime = projection.ioRuntime;
    const ioHitRatio = Number(ioRuntime.cache.aggregate.hitRatio || 0).toFixed(3);
    const ioL1 = ioRuntime.cache.l1;
    const ioL2 = ioRuntime.cache.l2;
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const ioCacheLine = `L1 ${ioL1['enabled'] ? 'ativo' : 'off'} · entradas ${ioL1['size'] ?? 0} · bytes ${ioL1['bytesStored'] ?? 0} · L2 ${ioL2['enabled'] ? 'ativo' : 'off'} · entradas ${ioL2['size'] ?? 0} · acerto ${ioHitRatio}`;
    const ioScopeLine = `escopos ${ioRuntime.scopes.active} · parser ${ioRuntime.parser.size}/${ioRuntime.parser.maxSize} · índice ${ioIndex['available'] ? 'ativo' : 'vazio'}:${ioIndex['files'] ?? 0}`;
    const agentSelection = getEffectiveSdkAgentSelection();
    const customAgentsLine = agentSelection.enabled.length
        ? `${agentSelection.enabled.join(', ')}${agentSelection.disabled.length ? ` · desativados ${agentSelection.disabled.join(', ')}` : ''}`
        : 'nenhum';
    const permissionModeSkipsSdkPrompts = terminalPermissionModeSkipsSdkPrompts(projection.permissionMode);
    const permissionModeDetail = `${projection.permissionMode} · prompts SDK ${permissionModeSkipsSdkPrompts ? 'ignorados' : 'seletivos'}`;
    println('');
    println(terminalThemeHeadline('assistant', 'Status do Terminal LLM-B', ['detalhado']));
    println(terminalThemeRow('Agente', `${renderHumanTerminalStatus(snap['status'])} · saúde ${health ? renderHumanTerminalHealth(health['status']) : 'sem leitura'}`));
    println(terminalThemeRow('Conversa', `${active ? 'ativa' : 'inativa'} · fila ${snap['queueSize'] ?? 0}`));
    println(terminalThemeRow('Pergunta', askUserStatus));
    println(
        terminalThemeRow(
            'Entrada',
            `${renderHumanInputChannelText(inputChannel.label)} · ${renderHumanInputChannelState(inputChannel.state)}${inputChannel.recoveryExpected ? ' · recuperação sob demanda' : ''}`,
        ),
    );
    println(terminalThemeRow('Esperas SDK', sdkInterruptions.length > 0 ? sdkInterruptions.join(' · ') : 'nenhuma'));
    println(terminalThemeRow('UI SDK', `formulários ${uiElicitationFlag == null ? 'n/d' : uiElicitationFlag ? 'disponíveis' : 'indisponíveis'}`));
    println(terminalThemeRow('Modelo', `${snap['model']} · raciocínio ${effort}`));
    if (byokLine) println(terminalThemeRow('BYOK provedor', byokLine, { role: byok.ready ? 'success' : 'warn' }));
    println(terminalThemeRow('Modo SDK', renderLiveSdkMode(sdkMode)));
    println(terminalThemeRow('Permissões', permissionModeDetail));
    println(terminalThemeRow('Plan arquivo', sdkPlanOpLabel));
    println(terminalThemeRow('Tarefas fundo', String(health?.['backgroundPendingCount'] ?? 0)));
    println(terminalThemeRow('Alertas', String(Array.isArray(health?.['issues']) ? health['issues'].length : 0)));
    println(terminalThemeRow('Próximo passo', renderTerminalActionLabel(projection.recommendedAction), { role: 'command' }));
    println(terminalThemeRow('Sessão runtime', projection.runtimeSessionId ?? 'sem runtime'));
    println(terminalThemeRow('Runtime alvo', projection.runtimeId));
    println(terminalThemeRow('Perfil runtime', projection.agentProfileId ?? 'sem perfil'));
    println(terminalThemeRow('Mapa runtime', projection.runtimeTopologyLabel));
    println(
        terminalThemeRow(
            'Timeline',
            `${projection.timelineSource} · ${projection.timelineAuthority} · ${projection.timelineReconciliationStatus} · ${projection.timelineTurnCount} turnos${timelineSyncLabel}`,
        ),
    );
    println(terminalThemeRow('Prompt digest', promptBindingDigest ?? 'sem binding'));
    println(terminalThemeRow('Prompt frescor', `${promptFreshnessLabel} · ${renderTerminalActionLabel(promptRecommendedAction)}`));
    println(
        terminalThemeRow(
            'Ferramentas',
            `${toolLoad.total} registradas · arquivos locais ${toolLoad.hasCanonicalLocalFsTools ? 'sim' : 'não'} · terminal local ${toolLoad.hasCanonicalLocalExecTools ? 'sim' : 'não'} · workspace SDK ${toolLoad.hasSdkWorkspaceTooling ? 'sim' : 'não'} · shell legado ${toolLoad.hasLegacySdkShellToolsLoaded ? 'sim' : 'não'} · desativadas ${toolLoad.disabled.length}`,
            { role: toolLoad.hasCanonicalLocalFsTools ? 'success' : 'warn' },
        ),
    );
    println(
        terminalThemeRow(
            'Contrato tools',
            `${toolContract.ok ? 'ok' : 'atenção'} · falhas ${toolContract.errorCount} · avisos ${toolContract.warningCount} · descrições ${toolContract.metadataCoverage.descriptionPct}% · schema ${toolContract.metadataCoverage.parametersPct}% · categoria ${toolContract.metadataCoverage.categoryPct}% · tags ${toolContract.metadataCoverage.tagsPct}% · instruções ${toolContract.metadataCoverage.instructionsPct}%`,
            { role: toolContract.ok ? 'success' : 'warn' },
        ),
    );
    println(
        terminalThemeRow(
            'Instruções',
            `${instructionLoad.liveReloadMechanism} · seções ${instructionLoad.sectionCount} · seções ausentes ${instructionLoad.sectionsMissingFileCount} · anexos ausentes ${instructionLoad.appendFileMissingCount} · fontes RPC ${instructionLoad.sdkSupportsInstructionSourcesRpc ? 'sim' : 'não'}`,
        ),
    );
    println(terminalThemeRow('Rota SDK/FS', `${sdkFsRouting.mode} · ${sdkFsRouting.reason}`));
    println(terminalThemeRow('Agentes extras', `perfil ${COPILOT_OPERATIONAL_PROFILE} · ${customAgentsLine}`));
    println(terminalThemeRow('I/O cache', ioCacheLine));
    println(terminalThemeRow('I/O scope', ioScopeLine));
    println(terminalThemeRow('Sessão SDK', projection.sdkSessionId ?? 'sem sdk'));
    println(terminalThemeRow('Sessão hub', projection.hubSessionId ?? 'sem hub'));
    println(
        terminalThemeRow(
            'Turnos canon',
            `${projection.turnCount} · persistidos ${projection.persistedTimelineTurnCount} · bridge ${projection.bridgeTurnCount} · live-tail ${projection.liveBridgeTailCount}`,
        ),
    );
    println(terminalThemeRow('Inject port', String(projection.injectPort)));
    println(terminalThemeRow('Atividade', `${activity.label}${activityProgress}`));
    println(terminalThemeRow('Origem', `${activity.phase} · ${activity.source}`));
    println(terminalThemeRow('Boot', bootLine));
    println(terminalThemeRow('Shutdown', shutdownLine));
    println(
        terminalThemeRow(
            'Display',
            `raciocínio ${display.thinking ? 'ativo' : 'inativo'} · streaming ${display.streaming ? 'ativo' : 'inativo'} · uso ${display.usage ? 'ativo' : 'inativo'} · ferramentas ${display.tools ? 'ativo' : 'inativo'} · intenção ${display.intent ? 'ativo' : 'inativo'}`,
        ),
    );
    println(terminalThemeRow('Último PR', modelBilling.at ?? 'sem consumo ainda'));
    println(
        terminalThemeRow(
            'Billing/modelo',
            modelBilling.mismatch
                ? `divergente · configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'}`
                : `ok · ${modelBilling.displayModel}`,
            { role: modelBilling.mismatch ? 'error' : 'success' },
        ),
    );
    println(terminalThemeRow('Custo último PR', modelBilling.cost == null ? 'n/d' : modelBilling.cost.toFixed(4)));
    println(
        terminalThemeRow(
            'Perfil modelo',
            modelMeta
                ? `custo ${modelMeta.costTier ?? 'n/a'} · velocidade ${modelMeta.speedTier ?? 'n/a'} · contexto ${typeof modelMeta.contextWindow === 'number' ? modelMeta.contextWindow.toLocaleString('pt-BR') : 'n/a'}`
                : 'sem metadados locais',
        ),
    );
    if (autoPolicyLine) println(terminalThemeRow('Política auto', autoPolicyLine));
    println(terminalThemeDivider(37));
    println(terminalThemeRow('Workspace', ws.cwd));
    println(terminalThemeRow('Git root', ws.gitRoot ?? 'não é git repo'));
    println(terminalThemeRow('Branch', branchStr));
    println(terminalThemeDivider(37));
    if (pendingPreview) {
        println(terminalThemeRow('Pergunta salva', pendingPreview));
    }
    if (shadowExpiry) {
        println(terminalThemeRow('Expira em', shadowExpiry));
    }
    if (shadowAgeLabel) {
        println(terminalThemeRow('Idade salva', shadowAgeLabel));
    }
    if (shadowRemainingLabel && !projection.pendingQuestionShadowExpired) {
        println(terminalThemeRow('Tempo restante', shadowRemainingLabel));
    }
    if (activity.detail) {
        println(terminalThemeRow('Atividade info', activity.detail));
    }
    if (inputChannel.detail) {
        println(terminalThemeRow('Canal detalhe', renderHumanInputChannelText(inputChannel.detail)));
    }
    if (promptFreshnessReason) {
        println(terminalThemeRow('Prompt motivo', promptFreshnessReason));
    }
    println(terminalThemeRow('Guia operação', operationalGuidance.summary));
    println(terminalThemeRow('Domínio ativo', operationalGuidance.domainHint));
    println(terminalThemeRow('Coleta ctx', operationalGuidance.contextHint));
    if (operationalGuidance.warnings.length > 0) {
        println(terminalThemeRow('Atenção boot', operationalGuidance.warnings.join(' | '), { role: 'warn' }));
    }
    if (activityProjection.history.length > 0) {
        println(
            terminalThemeRow(
                'Atividade rec.',
                activityProjection.history
                    .map((entry) => {
                        const progress = typeof entry.progress === 'number' ? ` ${entry.progress}%` : '';
                        return `${entry.phase}:${entry.label}${progress}`;
                    })
                    .join('  •  '),
            ),
        );
    }
    if (projection.pendingQuestionShadowExpired) {
        println(
            terminalThemeRow(
                'Dica',
                'a pergunta restaurada não é mais respondível; mantenha a limpeza no próximo fluxo operacional.',
                { role: 'warn' },
            ),
        );
    } else if (projection.pendingQuestionShadowState === 'expiring_soon') {
        println(
            terminalThemeRow(
                'Dica',
                'a pergunta restaurada está perto de expirar; revise ou limpe antes que o estado fique ambíguo.',
                { role: 'warn' },
            ),
        );
    }
    if (projection.sdkSessionMode === 'plan') {
        println(terminalThemeRow('Nota', 'a sessão SDK está em modo plano; use /plan off para voltar ao modo interativo.'));
    }
    if (projection.pendingElicitations > 0) {
        println(terminalThemeRow('Ação', 'há formulário pendente; use /elicitation list e /elicitation show latest.', { role: 'warn' }));
    }
    if (projection.pendingPermissions > 0) {
        println(
            terminalThemeRow('Ação', 'há permissão SDK pendente; acompanhe /activity e aguarde o runtime decidir.', {
                role: 'warn',
            }),
        );
    }
    if (projection.pendingUserInputs > 0) {
        println(
            terminalThemeRow('Ação', 'há pergunta humana pendente; responda via conversa normal ou use /answer <texto>.', {
                role: 'warn',
            }),
        );
        if (projection.latestUserInput) {
            const latest = projection.latestUserInput;
            const question =
                typeof latest.question === 'string' ? latest.question.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
            const choices =
                Array.isArray(latest.choices) && latest.choices.length > 0
                    ? ` opções ${latest.choices.join(' | ')}`
                    : '';
            println(terminalThemeRow('Última pergunta', `${choices} ${question}`.trim()));
        }
    }
    if (projection.pendingStructuredUserInputs > 0) {
        println(
            terminalThemeRow(
                'Ação',
                'há pergunta estruturada pendente; digite a resposta normalmente ou use /answer <texto>.',
                { role: 'warn' },
            ),
        );
        if (projection.latestStructuredUserInput) {
            const latest = projection.latestStructuredUserInput;
            const question =
                typeof latest.question === 'string' ? latest.question.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
            const choices =
                Array.isArray(latest.choices) && latest.choices.length > 0
                    ? ` opções ${latest.choices.join(' | ')}`
                    : '';
            println(terminalThemeRow('Última estrutura', `${choices} ${question}`.trim()));
        }
    }
    if (modelBilling.mismatch) {
        println(
            terminalThemeRow(
                'Ação recomendada',
                'valide fallback/troca de modelo com /sdk quota, /status e um turno curto de confirmação.',
                { role: 'warn' },
            ),
        );
    }
    if (projection.usedDefaultRuntimeFallback) {
        println(
            terminalThemeRow(
                'Nota',
                `runtime solicitado ${projection.requestedRuntimeId ?? 'desconhecido'} não encontrado; usando runtime default (${projection.runtimeId}).`,
                { role: 'warn' },
            ),
        );
    }
    if (projection.timelineReconciliationStatus === 'diverged') {
        println(
            terminalThemeRow(
                'Nota',
                'timeline do bridge divergiu da persistência; a UX está priorizando o hub como autoridade canônica.',
                { role: 'warn' },
            ),
        );
    }
    if (projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight') {
        println(
            terminalThemeRow(
                'Sync Hub',
                `${renderTerminalSyncStatusLabel(projection.timelineSyncStatus)} · ${projection.timelineSyncPendingCount} turnos pendentes para materializar no Hub`,
            ),
        );
    }
    if (projection.timelineSyncStatus === 'failed') {
        const retryLabel =
            typeof projection.timelineSyncNextRetryAt === 'number'
                ? ` próxima tentativa ${formatTerminalIsoTimestamp(projection.timelineSyncNextRetryAt)}`
                : '';
        println(
            terminalThemeRow('Sync Hub', `falhou: ${projection.timelineSyncLastError ?? 'erro desconhecido'}${retryLabel}`, {
                role: 'warn',
            }),
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
    const state = String(projection.snap['status'] ?? 'unknown');
    const channel = projection.dialogInputChannel;
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
        println(`\n  ${terminalThemeText('assistant', 'Agora')}`);
        println('  ─────────────────────────────────────');
        println(
            `  Conversa     \x1b[90m${renderHumanTerminalStatus(state)} · ${projection.dialogLoopActive ? 'ativa' : 'inativa'} · fila ${queue} · ${askLine}\x1b[0m`,
        );
        println(`  Entrada      \x1b[90m${channel.label} · ${waitLine}\x1b[0m`);
        println(`  Modelo       \x1b[90m${modelLine}\x1b[0m`);
        if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
            println(
                `  Catálogo     \x1b[90m${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ativo ${renderCompactGatewayActive(gatewayActive)}\x1b[0m`,
            );
        }
        if (projection.activity?.label) {
            const detail = projection.activity.detail ? ` · ${projection.activity.detail}` : '';
            println(`  Atividade    \x1b[90m${projection.activity.label}${detail}\x1b[0m`);
        }
        if (projection.recommendedAction && projection.recommendedAction !== 'none') {
            println(`  Próximo      ${terminalThemeText('command', projection.recommendedAction)}`);
        }
        println('  ─────────────────────────────────────');
        return;
    }

    const waitSummary = [
        projection.pendingElicitations > 0 ? `elicitações ${projection.pendingElicitations}` : null,
        projection.pendingPermissions > 0 ? `permissões ${projection.pendingPermissions}` : null,
        projection.pendingUserInputs > 0 ? `perguntas ${projection.pendingUserInputs}` : null,
        projection.pendingStructuredUserInputs > 0 ? `formulários ${projection.pendingStructuredUserInputs}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    const askLine = projection.pendingQuestion
        ? `pergunta pendente (${projection.pendingQuestionKind ?? 'geral'})`
        : projection.pendingQuestionShadowState
          ? `pergunta salva (${projection.pendingQuestionShadowState})`
          : 'sem pergunta pendente';
    const modelLine = modelBilling.mismatch
        ? `configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'} · divergente`
        : modelBilling.displayModel;
    println(`\n  ${terminalThemeText('assistant', 'Agora - Detalhe')}`);
    println('  ─────────────────────────────────────');
    println(
        `  Runtime      \x1b[90m${projection.runtimeId} · sessão ${projection.runtimeSessionId ?? '(sem sessão)'}\x1b[0m`,
    );
    println(
        `  Conversa     \x1b[90m${renderHumanTerminalStatus(state)} · ${projection.dialogLoopActive ? 'ativa' : 'inativa'} · fila ${queue} · ${askLine}\x1b[0m`,
    );
    println(
        `  Entrada      \x1b[90m${channel.label} · modo SDK ${projection.sdkSessionMode ?? 'interactive'} · prompts ${projection.permissionMode} · ${waitSummary || 'sem pendências humanas'}\x1b[0m`,
    );
    println(
        `  Timeline     \x1b[90m${projection.timelineSource} · ${projection.timelineReconciliationStatus} · sync ${projection.timelineSyncStatus}\x1b[0m`,
    );
    println(
        `  SSE          \x1b[90m${pluralPt(live.sse.clients, 'cliente', 'clientes')} · ${pluralPt(live.sse.criticalClients, 'cliente crítico', 'clientes críticos')} · estado ${live.state}\x1b[0m`,
    );
    println(`  Modelo       \x1b[90m${modelLine}\x1b[0m`);
    if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
        println(
            `  Catálogo     \x1b[90m${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados · ativo ${renderCompactGatewayActive(gatewayActive)}\x1b[0m`,
        );
    }
    if (projection.activity?.label) {
        const detail = projection.activity.detail ? ` · ${projection.activity.detail}` : '';
        println(`  Atividade    \x1b[90m${projection.activity.phase} · ${projection.activity.label}${detail}\x1b[0m`);
    }
    if (projection.recommendedAction) {
        println(`  Próximo      ${terminalThemeText('command', projection.recommendedAction)}`);
    }
    println('  ─────────────────────────────────────');
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
  Conexões     \x1b[90m${renderCompactSseLine(projection.sse)} · timeline ${projection.counters.timelineTurns} turno(s)\x1b[0m
  Detalhe      ${renderCommandList(['/live full', `/activity ${requestedLimit} detail`, `/events ${requestedLimit}`])}
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
            const ts = formatTerminalIsoTimestamp(entry.timestamp);
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
            const ts = formatTerminalIsoTimestamp(entry.ts);
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
        println(terminalThemeRow('Histórico', 'vazio'));
        return;
    }
    println('');
    println(terminalThemeHeadline('assistant', 'Histórico', [timeline.timelineSource, timeline.timelineAuthority, timeline.reconciliationStatus]));
    println(terminalThemeDivider(64));
    for (const turn of hist) {
        const ts = formatTerminalIsoTimestamp(turn.timestamp);
        const actor = renderTerminalActorLabel(turn.role, turn.rawRole);
        const sourceLabel = turn.persisted ? '' : ` ${terminalThemeText('warn', '[live]')}`;
        const preview = turn.content.slice(0, 160) + (turn.content.length > 160 ? '…' : '');
        println(`  ${terminalThemeText('muted', `[${ts}]`)} ${terminalThemeText(actor.role, actor.label.padEnd(7))}${sourceLabel} ${preview}`);
    }
    if (timeline.reconciliationStatus === 'diverged') {
        println(
            terminalThemeRow('Nota', `histórico do bridge divergiu; live-tail preservado=${timeline.liveBridgeTailCount} e sync bloqueado${timeline.syncBlockedReason ? ` (${timeline.syncBlockedReason})` : ''}.`, { role: 'warn' }),
        );
    }
    if (timeline.sync.status === 'scheduled' || timeline.sync.status === 'inflight') {
        println(
            terminalThemeRow('Sync Hub', `${timeline.sync.status} (${timeline.sync.pendingCount} turnos live aguardando persistência).`),
        );
    } else if (timeline.sync.status === 'failed') {
        println(terminalThemeRow('Sync Hub', `falhou: ${timeline.sync.lastError ?? 'erro desconhecido'}.`, { role: 'warn' }));
    }
    println(terminalThemeDivider(64));
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
        println(terminalThemeRow('/db-history', 'Hub session não disponível (sem persistência).'));
        return;
    }
    try {
        const turns = projection.turns;
        if (turns.length === 0) {
            println(terminalThemeRow('/db-history', 'Nenhum turno persistido ainda.'));
            return;
        }
        const offsetLabel = offset > 0 ? ` (offset recente ${offset})` : '';
        println('');
        println(terminalThemeHeadline('assistant', `Últimos ${turns.length} turnos da sessão atual${offsetLabel}`));
        println(terminalThemeDivider(52));
        for (const t of turns) {
            const ts = formatTerminalIsoTimestamp(String(t['created_at'] ?? ''));
            const role = String(t['role'] ?? 'user');
            const content = String(t['content'] ?? '');
            const actor = renderTerminalActorLabel(role, role);
            const preview = content.slice(0, 160) + (content.length > 160 ? '…' : '');
            println(`  ${terminalThemeText('muted', `[${ts}]`)} ${terminalThemeText(actor.role, actor.label.padEnd(7))} ${preview}`);
        }
        println(
            terminalThemeRow('Janela', `${projection.effectiveOffset}..${projection.effectiveOffset + turns.length - 1} de ${projection.totalTurns} turnos persistidos`),
        );
        println(terminalThemeDivider(52));
        println('');
    } catch (e) {
        println(terminalThemeRow('/db-history', `erro: ${toError(e).message}`, { role: 'error' }));
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
            println(terminalThemeRow('/db-sessions', 'Nenhuma sessão persistida ainda.'));
            return;
        }
        println('');
        println(terminalThemeHeadline('assistant', `Últimas ${sessions.length} hub sessions`));
        println(terminalThemeDivider(62));
        for (const s of sessions) {
            const createdAt = formatTerminalIsoTimestamp(String(s['created_at'] ?? ''));
            const sessionId = String(s['id'] ?? '');
            const sessionStatus = String(s['status'] ?? 'unknown');
            const title = String(s['title'] ?? '(sem título)');
            const isCurrent = sessionId === currentHubSessionId;
            const statusRole = sessionStatus === 'active' ? 'success' : 'muted';
            const marker = isCurrent ? ` ${terminalThemeText('warn', 'atual')}` : '';
            println(
                `  ${terminalThemeText(statusRole, sessionStatus.padEnd(8))} ${terminalThemeText('muted', createdAt)}  ${terminalThemeText('muted', sessionId.slice(0, 8))}  ${title}${marker}`,
            );
        }
        println(terminalThemeDivider(62));
        println('');
    } catch (e) {
        println(terminalThemeRow('/db-sessions', `erro: ${toError(e).message}`, { role: 'error' }));
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
    println('');
    println(terminalThemeHeadline('assistant', 'Atores ativos nesta sessão'));
    println(terminalThemeRow('Você', 'stdin (digitar diretamente aqui)', { role: 'user' }));
    println(terminalThemeRow('LLM-A', `POST http://localhost:${injectPort}/inject`, { role: 'system' }));
    println(terminalThemeRow('LLM-B', `AlwaysAliveAgent (Copilot SDK · ${currentModel} · ${currentReasoningEffort})`, { role: 'assistant' }));
    println(terminalThemeRow('SSE', `GET http://localhost:${injectPort}/events`));
    println('');
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
    println('');
    println(terminalThemeHeadline('assistant', 'Eventos SDK da sessão'));
    println(
        terminalThemeRow(
            'Archive',
            `arquivo ${state.path ?? 'sem arquivo'} · janela ${limit} · ciclo de vida ${lifecycle.entries.length} · comandos ${commands.entries.length}`,
        ),
    );
    if (lifecycle.state.error || commands.state.error) {
        println(terminalThemeRow('Erro', lifecycle.state.error ?? commands.state.error ?? 'erro desconhecido', { role: 'error' }));
    }
    if (merged.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhum ciclo de vida SDK ou comando SDK arquivado ainda', { role: 'warn' }));
        println(terminalThemeRow('Detalhe', '/events event=sdk.lifecycle 20 · /events event=sdk.command.executed 20'));
        println('');
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
        const time = entry.firstTimestamp ? formatTerminalIsoTimestamp(entry.firstTimestamp) : 'sem horário';
        const repeats = entry.count > 1 ? ` ×${entry.count}` : '';
        println(terminalThemeRow(time, `${entry.line}${repeats}`));
    }
    println(terminalThemeRow('Nota', 'este comando não cria eventos; ele resume o mesmo JSONL usado por /events e pelos testes live'));
    println('');
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
    println('');
    println(terminalThemeHeadline('assistant', 'Esperas SDK da sessão'));
    println(
        terminalThemeRow(
            'Archive',
            `arquivo ${state?.path ?? 'sem arquivo'} · janela ${limit} · perguntas ${(counts.get('user_input.requested') ?? 0) + (counts.get('user_input.completed') ?? 0)} · formulários ${(counts.get('elicitation.pending') ?? 0) + (counts.get('elicitation.completed') ?? 0)} · permissões ${(counts.get('permission.requested') ?? 0) + (counts.get('permission.completed') ?? 0) + (counts.get('permission.mode_changed') ?? 0)}`,
        ),
    );
    const error = projections.find((projection) => projection.state.error)?.state.error;
    if (error) println(terminalThemeRow('Erro', error, { role: 'error' }));
    if (merged.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhuma espera SDK arquivada ainda', { role: 'warn' }));
        println(terminalThemeRow('Detalhe', '/sdk waits para pendências vivas · /events event=user_input.requested 20 para bruto'));
        println('');
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
        const time = entry.firstTimestamp ? formatTerminalIsoTimestamp(entry.firstTimestamp) : 'sem horário';
        const repeats = entry.count > 1 ? ` ×${entry.count}` : '';
        println(terminalThemeRow(time, `${entry.line}${repeats}`));
    }
    println(terminalThemeRow('Nota', 'perguntas humanas, formulários e permissões continuam com comandos próprios; esta é só a trilha agregada'));
    println('');
}

/**
 * Lista os CommandDefinition[] locais registrados no SDK.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
function cmdSessionSdkCommands({ println }) {
    const specs = listTerminalSdkCommandSpecs();
    println('');
    println(terminalThemeHeadline('assistant', 'Comandos SDK expostos ao Copilot'));
    println(terminalThemeRow('Fonte', `agent/session/commands · ${specs.length} comando(s) · safelist observável; execução local continua no REPL`));
    for (const spec of specs) {
        println(terminalThemeRow(spec.name, `${spec.localCommand}${spec.safe ? ' · seguro' : ''}`));
        println(terminalThemeRow('Descrição', spec.description));
    }
    println(terminalThemeRow('Nota', 'quando o SDK chama um desses comandos, o terminal publica sdk.command.executed no fanout canônico'));
    println('');
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
            println(terminalThemeRow('Próximo boot', 'criar nova sessão SDK', { role: 'success' }));
        } else if (mode === 'resume') {
            const target = modeRest.join(' ').trim();
            if (!target) {
                println(terminalThemeRow('Uso', '/session sdk next resume <sessionId|#n|current|last|foreground>', { role: 'warn' }));
                return;
            }
            let resolved;
            if (/^(?:#\d+|current|last|foreground)$/iu.test(target)) {
                let inventory;
                try {
                    inventory = await listTerminalSdkSessionInventory(runtimeId);
                } catch (error) {
                    println(terminalThemeRow('Erro', `não foi possível resolver o atalho de sessão SDK: ${toError(error).message}`, { role: 'error' }));
                    return;
                }
                resolved = resolveSdkSessionResumeTarget(target, inventory);
                if (!resolved) {
                    println(terminalThemeRow('Atalho', `${target} indisponível · rode /session sdk para ver o inventário`, { role: 'warn' }));
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
                println(terminalThemeRow('Sessão SDK', `não resolvida para ${target} · rode /session sdk para ver o inventário`, { role: 'warn' }));
                return;
            }
            const result = await scheduleTerminalSdkSessionBootSelection({
                mode: 'resume',
                sessionId: resolved.sessionId,
            });
            if (!result.ok) throw result.error;
            println(
                terminalThemeRow(
                    'Próximo boot',
                    `tentar retomar sessão SDK ${resolved.sessionId}${resolved.source === 'id' ? '' : ` (${resolved.source})`}`,
                    { role: 'success' },
                ),
            );
        } else if (mode === 'auto' || mode === 'clear') {
            const result = await scheduleTerminalSdkSessionBootSelection(null);
            if (!result.ok) throw result.error;
            println(terminalThemeRow('Próximo boot', 'seleção automática restaurada; a sessão persistida anterior volta a ser o padrão', { role: 'success' }));
        } else {
            println(terminalThemeRow('Uso', '/session sdk next <new|resume <sessionId|#n|current|last|foreground>|auto>', { role: 'warn' }));
            return;
        }
        println(terminalThemeRow('Nota', 'a diretiva é consumida pelo initializer no próximo boot; /restart reinicia só a conversa'));
        return;
    }
    if (action === 'delete' || action === 'remove') {
        const target = rest.join(' ').trim();
        if (!target) {
            println(terminalThemeRow('Uso', '/session sdk delete <sessionId|#n>', { role: 'warn' }));
            println(terminalThemeRow('Proteção', 'a sessão SDK viva é protegida; para sair dela, agende /session sdk next new'));
            return;
        }
        let inventory;
        try {
            inventory = await listTerminalSdkSessionInventory(runtimeId);
        } catch (error) {
            println(terminalThemeRow('Erro', `não foi possível listar sessões SDK antes da exclusão: ${toError(error).message}`, { role: 'error' }));
            return;
        }
        const resolved = resolveSdkSessionResumeTarget(target, inventory);
        if (!resolved) {
            println(terminalThemeRow('Sessão SDK', `não resolvida para exclusão: ${target} · rode /session sdk para ver o inventário`, { role: 'warn' }));
            return;
        }
        if (resolved.sessionId === inventory.currentSessionId) {
            println(terminalThemeRow('Proteção', `sessão SDK viva não apagada: ${resolved.sessionId}`, { role: 'error' }));
            println(terminalThemeRow('Ação', 'agende /session sdk next new ou retome outra sessão no próximo boot antes de apagar esta'));
            return;
        }
        try {
            await deleteTerminalSdkSession(resolved.sessionId, runtimeId);
        } catch (error) {
            println(terminalThemeRow('Erro', `falha ao apagar sessão SDK ${resolved.sessionId}: ${toError(error).message}`, { role: 'error' }));
            return;
        }
        println(
            terminalThemeRow(
                'Sessão SDK',
                `apagada: ${resolved.sessionId}${resolved.source === 'id' ? '' : ` (${resolved.source})`}`,
                { role: 'success' },
            ),
        );
        println(terminalThemeRow('Nota', 'deleteSession remove estado persistido; /session sdk next controla apenas o próximo attach/create'));
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
        println(terminalThemeRow('Erro', `não foi possível listar sessões SDK: ${toError(error).message}`, { role: 'error' }));
        println(terminalThemeRow('Nota', '/resume atua no hub; /session save|list|restore atua em snapshots locais'));
        return;
    }

    const nextLabel =
        bootSelection?.mode === 'resume'
            ? `retomar ${bootSelection.sessionId}`
            : bootSelection?.mode === 'new'
              ? 'criar nova sessão'
              : 'automático';
    println('');
    println(terminalThemeHeadline('assistant', 'Sessão SDK'));
    println(terminalThemeRow('Atual', inventory.currentSessionId ?? 'sem sessão viva'));
    println(terminalThemeRow('Última SDK', inventory.lastSessionId ?? '-'));
    println(terminalThemeRow('Foreground', inventory.foregroundSessionId ?? '-'));
    println(terminalThemeRow('Próximo boot', nextLabel));
    println(terminalThemeRow('Arquivos', renderSdkSessionFsState(inventory.sessionFs)));
    const byokBinding = classifyTerminalByokSdkBinding(
        readTerminalByokProjection().summary,
        inventory.persistedByokBinding,
        inventory.currentSessionId,
    );
    println(terminalThemeRow('Vínculo BYOK', renderTerminalSdkProviderBinding(inventory.persistedByokBinding)));
    println(terminalThemeRow('BYOK pronto', byokBinding.preparedLabel));
    println(terminalThemeRow('Limite BYOK', byokBinding.headline));
    if (byokBinding.action) {
        println(terminalThemeRow('Ação BYOK', byokBinding.action));
    }
    const bootDecision = renderSdkSessionBootDecision(inventory.lastBootDecision);
    if (bootDecision) {
        println(terminalThemeRow('Último boot', bootDecision));
    }
    println(
        terminalThemeRow(
            'Comandos',
            '/session sdk controla sessão SDK; /restart reinicia só a conversa; /resume injeta histórico do hub; /session save|list|restore são snapshots locais',
        ),
    );
    if (inventory.sessions.length === 0) {
        println(terminalThemeRow('Sessões', 'nenhuma sessão SDK listada pelo client atual'));
        println('');
        return;
    }
    println('');
    println(
        terminalThemeHeadline('assistant', 'Sessões SDK listadas', [
            `${inventory.sessions.length}`,
            `filtro ${inventoryArgs.filterLabel}`,
            `deslocamento ${inventoryArgs.offset}`,
            `limite ${inventoryArgs.limit}`,
        ]),
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
        println(terminalThemeRow(`#${absoluteIndex + 1}`, `${entry.sessionId} · ${flags || '-'}`));
        println(terminalThemeRow('Tempo', `início ${start} · alterada ${modified}${summary ? ` · ${summary}` : ''}`));
        if (localMetadata) {
            println(terminalThemeRow('Metadados', localMetadata));
        }
        if (entry.sessionFs) {
            println(terminalThemeRow('Arquivos', renderSdkSessionFsState(entry.sessionFs)));
        }
    }
    if (inventory.sessions.length > inventoryArgs.offset + visibleSessions.length) {
        println(
            terminalThemeRow(
                'Mais',
                `${inventory.sessions.length - inventoryArgs.offset - visibleSessions.length} sessão(ões) omitida(s). Use /session sdk ${inventoryArgs.limit} offset=${inventoryArgs.offset + visibleSessions.length}.`,
            ),
        );
    }
    println('');
    println(terminalThemeRow('Próximo boot', '/session sdk next new | /session sdk next resume <id|#n|current|last|foreground> | /session sdk next auto'));
    println(terminalThemeRow('Filtros', '/session sdk <n> offset=<n> cwd=<path> gitRoot=<path> repo=<owner/repo> branch=<nome>'));
    println(terminalThemeRow('Limpeza', '/session sdk delete <id|#n>; sessão viva é protegida contra exclusão'));
    println(terminalThemeRow('Probes', 'probe-residue marca canários persistidos por diagnósticos antigos; probes novos usam sessão efêmera'));
    println('');
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
                ? formatTerminalIsoTimestamp(createdAt)
                : 'data inválida';
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
            ? formatTerminalIsoTimestamp(createdAt)
            : 'data inválida';
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
            println(`    Restaurada em: ${formatTerminalIsoTimestamp(shadow.restoredAt)}`);
        }
        if (typeof shadow.expiresAt === 'number') {
            println(`    Expira em: ${formatTerminalIsoTimestamp(shadow.expiresAt)}`);
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
