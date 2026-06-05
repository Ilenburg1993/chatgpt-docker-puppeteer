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
import { callWithRuntimeTarget, extractRuntimeTarget, renderRuntimeTargetLabel, withRuntimeTarget } from './runtime-target.js';
import {
    classifyTerminalByokSdkBinding,
    renderTerminalSdkProviderBinding,
} from '../byok/index.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalOperatorToolText,
    compactTerminalToolText,
    formatTerminalToolPathForOperator,
    humanizeTerminalToolSurfaceText,
    isTerminalInternalCallIdentifier,
} from '../events/tool-activity-presenter.js';
import {
    readTerminalSseEventArchiveTail,
    formatTerminalTimeLabel,
    renderTerminalPendingQuestionKindLabel,
    terminalPermissionModeSkipsSdkPrompts,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeRows,
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
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {import('../frontend/projections/shared.js').TerminalModelBillingProjection} modelBilling
 * @param {string} action
 * @returns {string}
 */
function renderTerminalModelSelectionLine(modelBilling, action) {
    if (!modelBilling.mismatch) return modelBilling.displayModel;
    const configured = modelBilling.configuredModel ?? modelBilling.displayModel ?? '-';
    const observed = modelBilling.effectiveModel ?? modelBilling.billedModel ?? modelBilling.observedModel ?? '-';
    return `${configured} → ${observed} · ${action}`;
}

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
    if (role === 'assistant' || rawRole === 'assistant') return { label: 'LLM-B', role: 'assistant' };
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
    if (status === 'not_needed') return 'dispensada';
    if (status === 'blocked') return 'bloqueada';
    return status || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalTimelineSourceLabel(value) {
    const source = String(value ?? '');
    if (!source || source === 'empty') return 'sem histórico';
    if (source === 'hub') return 'hub persistido';
    if (source === 'bridge') return 'conversa viva';
    if (source === 'mixed') return 'mista';
    if (source === 'live') return 'ao vivo';
    return source.replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalTimelineAuthorityLabel(value) {
    const authority = String(value ?? '');
    if (!authority || authority === 'none') return 'sem autoridade';
    if (authority === 'persistent') return 'persistência';
    if (authority === 'transport') return 'transporte vivo';
    if (authority === 'reconciled') return 'reconciliada';
    return authority.replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalTimelineReconciliationLabel(value) {
    const status = String(value ?? '');
    if (!status || status === 'empty') return 'sem divergência';
    if (status === 'synced') return 'sincronizada';
    if (status === 'reconciled') return 'reconciliada';
    if (status === 'diverged') return 'divergente';
    if (status === 'pending') return 'pendente';
    if (status === 'persistent_only') return 'histórico persistido';
    if (status === 'bridge_only') return 'só conversa viva';
    if (status === 'bridge_tail') return 'cauda viva';
    return status.replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalTimelineReasonLabel(value) {
    const reason = String(value ?? '').trim();
    if (!reason) return 'sem motivo registrado';
    if (reason === 'diverged-no-overlap') return 'sem sobreposição segura entre conversa viva e persistência';
    if (reason === 'bridge_tail') return 'cauda viva pendente';
    if (reason === 'aligned') return 'timeline alinhada';
    return reason.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalRuntimeTopologyLabel(value) {
    return String(value ?? '')
        .split(/\s+•\s+|\s*\|\s*/u)
        .filter(Boolean)
        .map((entry) => {
            const marker = entry.startsWith('*') ? 'ativo ' : '';
            const clean = entry.replace(/^\*/u, '');
            const match = clean.match(/^([^:]+):([^/]+)\/(.+)$/u);
            if (!match) return `${marker}${renderRuntimeTargetLabel(clean)}`.trim();
            const [, runtime, model, status] = match;
            return `${marker}${renderRuntimeTargetLabel(runtime)} · ${model} · ${renderHumanTerminalStatus(status)}`.trim();
        })
        .join(' · ');
}

/**
 * @param {{ mode: unknown; reason?: unknown }} routing
 * @returns {string}
 */
function renderTerminalSdkFsRoutingLine(routing) {
    const mode = String(routing.mode ?? '').trim();
    const reason = String(routing.reason ?? '').trim();
    const modeLabel =
        mode === 'local-fs-primary'
            ? 'arquivos locais primeiro'
            : mode === 'sdk-workspace-only'
              ? 'workspace SDK temporário'
              : mode === 'degraded'
                ? 'rota degradada'
                : mode.replace(/[._-]+/gu, ' ') || 'n/d';
    const reasonLabel =
        reason === 'ready'
            ? 'FS local canônico disponível; workspace SDK fica como superfície auxiliar'
            : reason.replace(/[._-]+/gu, ' ') || 'sem motivo registrado';
    return `${modeLabel} · ${reasonLabel}`;
}

/**
 * @param {{ cache: { l1: Record<string, unknown>; l2: Record<string, unknown>; aggregate: Record<string, unknown> }; index?: unknown; scopes: { active: number }; parser: { size: number; maxSize: number } }} ioRuntime
 * @returns {{ cache: string; scope: string }}
 */
function renderTerminalIoStatusLines(ioRuntime) {
    const ioHitRatio = Number(ioRuntime.cache.aggregate['hitRatio'] || 0);
    const hitPercent = Number.isFinite(ioHitRatio) ? `${Math.round(ioHitRatio * 100)}%` : '-';
    const ioL1 = ioRuntime.cache.l1;
    const ioL2 = ioRuntime.cache.l2;
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const indexFiles = Number(ioIndex['files'] ?? 0);
    return {
        cache: `L1 ${ioL1['enabled'] ? 'ativo' : 'inativo'} · entradas ${ioL1['size'] ?? 0} · bytes ${ioL1['bytesStored'] ?? 0} · L2 ${ioL2['enabled'] ? 'ativo' : 'inativo'} · entradas ${ioL2['size'] ?? 0} · acerto ${hitPercent}`,
        scope: `escopos ${ioRuntime.scopes.active} · parser ${ioRuntime.parser.size}/${ioRuntime.parser.maxSize} · índice ${
            ioIndex['available'] ? countLabel(indexFiles, 'arquivo', 'arquivos') : 'vazio'
        }`,
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalPermissionModeLabel(value) {
    const mode = String(value ?? '');
    if (mode === 'approve_all') return 'automáticas';
    if (mode === 'default') return 'padrão';
    if (mode === 'read_only') return 'somente leitura';
    if (mode === 'ask') return 'pedir confirmação';
    if (mode === 'deny_all') return 'bloqueadas';
    return mode.replace(/[_-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalSdkSessionPresence(value) {
    return typeof value === 'string' && value.trim().length > 0 ? 'sessão ativa' : 'sem sessão SDK';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDbSessionStatusLabel(value) {
    const status = String(value ?? '');
    if (status === 'active') return 'ativa';
    if (status === 'closed' || status === 'completed') return 'concluída';
    if (status === 'archived') return 'arquivada';
    if (status === 'failed' || status === 'error') return 'falhou';
    return status.replace(/[_-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTerminalHistoryContent(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} content
 * @returns {string}
 */
function renderTerminalHistoryPreview(content) {
    return content.slice(0, 160) + (content.length > 160 ? '…' : '');
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
    return compactTerminalOperatorToolText(text.replace(/\s+/gu, ' ').trim(), 120);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSessionActivityText(value) {
    return humanizeTerminalToolSurfaceText(compactHumanTerminalText(value));
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
    if (phase === 'model') return 'modelo';
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
    if (operation === 'search') return 'busca';
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
 * @returns {'success' | 'assistant' | 'warn' | 'error'}
 */
function renderLiveFlowStateRole(value) {
    const state = String(value ?? '');
    if (state === 'ready') return 'success';
    if (state === 'active-turn') return 'assistant';
    if (state === 'waiting-human' || state === 'paused') return 'warn';
    return 'error';
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
 * @param {unknown} value
 * @returns {string}
 */
function renderLiveRuntimeTarget(value) {
    return renderRuntimeTargetLabel(value);
}

/**
 * @param {{ cache: { l1: Record<string, unknown>; l2: Record<string, unknown>; aggregate: Record<string, unknown> }; index?: unknown; scopes: { active: number }; parser: { size: number; maxSize: number } }} ioRuntime
 * @returns {string}
 */
function renderLiveContextLine(ioRuntime) {
    const cacheHitRatio = Number(ioRuntime.cache.aggregate['hitRatio'] || 0);
    const hitPercent = Number.isFinite(cacheHitRatio) ? `${Math.round(cacheHitRatio * 100)}%` : '-';
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const l1Enabled = Boolean(ioRuntime.cache.l1['enabled']);
    const l2Enabled = Boolean(ioRuntime.cache.l2['enabled']);
    const l1Size = ioRuntime.cache.l1['size'] ?? 0;
    const l2Size = ioRuntime.cache.l2['size'] ?? 0;
    const indexFiles = Number(ioIndex['files'] ?? 0);
    const indexLabel = ioIndex['available'] ? countLabel(indexFiles, 'arquivo', 'arquivos') : 'vazio';
    return [
        `L1 ${renderLiveToggle(l1Enabled)} (${l1Size})`,
        `L2 ${renderLiveToggle(l2Enabled)} (${l2Size})`,
        `acerto ${hitPercent}`,
        `índice ${indexLabel}`,
        `escopos ${ioRuntime.scopes.active}`,
        `parser ${ioRuntime.parser.size}/${ioRuntime.parser.maxSize}`,
    ].join(' · ');
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
            ? ` · ${compactTerminalOperatorToolText(targetCandidate, 96)}`
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
        const waitLine = waitCount > 0 ? `${countLabel(waitCount, 'pendência', 'pendências')} · /sdk waits` : 'nenhuma pendência';
        const queue = Number(snap['queueSize'] ?? 0);
        const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
        const byokLabel = byok.enabled
            ? `${byok.ready ? 'pronto' : 'incompleto'} · ${byok.providerType ?? '-'} · ${byok.model ?? '-'}`
            : 'SDK Copilot';
        const modelBilling = projection.modelBilling;
        const gatewayProjection = configProjection.modelGatewayProjection ?? {
            providerCount: 0,
            modelCount: 0,
            enabledModelCount: 0,
        };
        const rawAction = projection.recommendedAction === 'none' ? null : projection.recommendedAction;
        const action = rawAction ?? (waitCount > 0 ? '/sdk waits' : '/menu');
        const modelLabel = renderTerminalModelSelectionLine(modelBilling, 'ver /status full');

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
        println(
            terminalThemeRow('Modelo', `${modelLabel} · raciocínio ${configProjection.currentReasoningEffort}`, {
                role: modelBilling.mismatch ? 'warn' : 'assistant',
            }),
        );
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
        ? `${projection.sdkPlanOperation}${projection.sdkPlanChangedAt ? ` @ ${formatTerminalTimeLabel(projection.sdkPlanChangedAt, { mode: 'dual' })}` : ''}`
        : 'sem alterações';
    const ws = projection.workspace;
    const branchStr = ws.currentBranch ? ws.currentBranch : 'sem branch';
    const shadowState = projection.pendingQuestionShadowState;
    const askUserStatus = projection.pendingQuestion
        ? `viva${
              projection.pendingQuestionKind
                  ? ` (${renderTerminalPendingQuestionKindLabel(projection.pendingQuestionKind)})`
                  : ''
          }`
        : projection.pendingQuestionShadowExpired
          ? 'pergunta restaurada expirada'
          : projection.pendingQuestionShadow
            ? `${shadowState === 'expired' ? 'pergunta restaurada expirada' : shadowState === 'expiring_soon' ? 'pergunta restaurada expirando' : shadowState === 'fresh' ? 'pergunta recém-restaurada' : 'pergunta restaurada'}${
                  projection.pendingQuestionShadowKind
                      ? ` (${renderTerminalPendingQuestionKindLabel(projection.pendingQuestionShadowKind)})`
                      : ''
              }`
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
            ? formatTerminalTimeLabel(projection.pendingQuestionShadowExpiresAt, { mode: 'dual' })
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
        : 'sem amostra';
    const shutdownLine = lifecycle.shuttingDown
        ? `em andamento · ${lifecycle.registeredShutdownHandlers} rotinas`
        : lifecycle.shutdown
          ? `${lifecycle.shutdown.status} · ${lifecycle.shutdown.handlers} rotinas · ${lifecycle.shutdown.durationMs}ms${lifecycle.shutdown.failedHandler ? ` · falha ${lifecycle.shutdown.failedHandler}` : ''}`
          : `parado · ${lifecycle.registeredShutdownHandlers} rotinas registradas`;
    const modelMeta = configProjection.modelMeta ?? configProjection.observedModelMeta;
    const autoPolicy = configProjection.autoModelPolicy;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
    const autoPolicyLine =
        configProjection.currentModel === 'auto'
            ? `preferido ${autoPolicy.preferredModel}/${autoPolicy.preferredReasoningEffort} · autoridade GitHub Copilot · último ${autoPolicy.observedModel ?? 'sem leitura'}`
            : '';
    const byokLine = byok.enabled
        ? `${byok.ready ? 'pronto' : 'incompleto'} · preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · autenticação ${renderTerminalAuthLabel(byok.auth)} · /byok`
        : '';
    const modelBilling = projection.modelBilling;
    const display = readTerminalDisplayProjection();
    const activityProgress = typeof activity.progress === 'number' ? ` (${activity.progress}%)` : '';
    const sdkInterruptions = [
        projection.pendingElicitations > 0
            ? `${countLabel(projection.pendingElicitations, 'formulário', 'formulários')}${projection.latestElicitationMode ? ` (${projection.latestElicitationMode})` : ''}`
            : null,
        projection.pendingPermissions > 0
            ? `${countLabel(projection.pendingPermissions, 'permissão', 'permissões')}${projection.latestPermissionType ? ` (${projection.latestPermissionType})` : ''}`
            : null,
        projection.pendingUserInputs > 0
            ? `${countLabel(projection.pendingUserInputs, 'pergunta', 'perguntas')}${projection.latestUserInputKind ? ` (${projection.latestUserInputKind})` : ''}`
            : null,
        projection.pendingStructuredUserInputs > 0
            ? countLabel(projection.pendingStructuredUserInputs, 'input estruturado', 'inputs estruturados')
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
                : 'sem leitura';
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
    const ioLines = renderTerminalIoStatusLines(ioRuntime);
    const agentSelection = getEffectiveSdkAgentSelection();
    const customAgentsLine = agentSelection.enabled.length
        ? `${agentSelection.enabled.join(', ')}${agentSelection.disabled.length ? ` · desativados ${agentSelection.disabled.join(', ')}` : ''}`
        : 'nenhum';
    const permissionModeSkipsSdkPrompts = terminalPermissionModeSkipsSdkPrompts(projection.permissionMode);
    const permissionModeDetail = `${renderTerminalPermissionModeLabel(projection.permissionMode)} · prompts SDK ${permissionModeSkipsSdkPrompts ? 'ignorados' : 'seletivos'}`;
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
    println(terminalThemeRow('UI SDK', `formulários ${uiElicitationFlag == null ? 'sem leitura' : uiElicitationFlag ? 'disponíveis' : 'indisponíveis'}`));
    println(terminalThemeRow('Modelo', `${snap['model']} · raciocínio ${effort}`));
    if (byokLine) println(terminalThemeRow('Rota BYOK', byokLine, { role: byok.ready ? 'success' : 'warn' }));
    println(terminalThemeRow('SDK', renderLiveSdkMode(sdkMode)));
    println(terminalThemeRow('Permissões', permissionModeDetail));
    println(terminalThemeRow('Plano arquivo', sdkPlanOpLabel));
    println(terminalThemeRow('Segundo plano', String(health?.['backgroundPendingCount'] ?? 0)));
    println(terminalThemeRow('Alertas', String(Array.isArray(health?.['issues']) ? health['issues'].length : 0)));
    println(terminalThemeRow('Próximo passo', renderTerminalActionLabel(projection.recommendedAction), { role: 'command' }));
    println(terminalThemeRow('Sessão local', projection.runtimeSessionId ?? 'sem sessão'));
    println(terminalThemeRow('Ambiente alvo', renderRuntimeTargetLabel(projection.runtimeId)));
    println(terminalThemeRow('Perfil local', projection.agentProfileId ?? 'sem perfil'));
    println(terminalThemeRow('Mapa local', renderTerminalRuntimeTopologyLabel(projection.runtimeTopologyLabel)));
    println(
        terminalThemeRow(
            'Timeline',
            `${renderTerminalTimelineSourceLabel(projection.timelineSource)} · ${renderTerminalTimelineAuthorityLabel(projection.timelineAuthority)} · ${renderTerminalTimelineReconciliationLabel(projection.timelineReconciliationStatus)} · ${projection.timelineTurnCount} turnos${timelineSyncLabel}`,
        ),
    );
    println(terminalThemeRow('Prompt', promptBindingDigest ? 'vinculado' : 'sem vínculo'));
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
    println(terminalThemeRow('Rota SDK/FS', renderTerminalSdkFsRoutingLine(sdkFsRouting)));
    println(terminalThemeRow('Agentes extras', `perfil ${COPILOT_OPERATIONAL_PROFILE} · ${customAgentsLine}`));
    println(terminalThemeRow('I/O cache', ioLines.cache));
    println(terminalThemeRow('I/O scope', ioLines.scope));
    println(terminalThemeRow('Sessão SDK', renderTerminalSdkSessionPresence(projection.sdkSessionId)));
    println(terminalThemeRow('Sessão hub', projection.hubSessionId ?? 'sem hub'));
    println(
        terminalThemeRow(
            'Turnos canônicos',
            `${projection.turnCount} · persistidos ${projection.persistedTimelineTurnCount} · vivos ${projection.bridgeTurnCount} · cauda viva ${projection.liveBridgeTailCount}`,
        ),
    );
    println(terminalThemeRow('Porta entrada', String(projection.injectPort)));
    println(terminalThemeRow('Atividade', `${renderSessionActivityText(activity.label)}${activityProgress}`));
    println(terminalThemeRow('Fluxo', `${renderLivePhaseLabel(activity.phase)} · ${renderLiveSourceLabel(activity.source)}`));
    println(terminalThemeRow('Inicialização', bootLine));
    println(terminalThemeRow('Encerramento', shutdownLine));
    println(
        terminalThemeRow(
            'Tela',
            `raciocínio ${display.thinking ? 'ativo' : 'inativo'} · streaming ${display.streaming ? 'ativo' : 'inativo'} · uso ${display.usage ? 'ativo' : 'inativo'} · ferramentas ${display.tools ? 'ativo' : 'inativo'} · intenção ${display.intent ? 'ativo' : 'inativo'}`,
        ),
    );
    println(terminalThemeRow('Último PR', modelBilling.at ?? 'sem consumo ainda'));
    println(
        terminalThemeRow(
            'Cobrança/modelo',
            modelBilling.mismatch
                ? `divergente · configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'}`
                : `ok · ${modelBilling.displayModel}`,
            { role: modelBilling.mismatch ? 'error' : 'success' },
        ),
    );
    println(terminalThemeRow('Custo último PR', modelBilling.cost == null ? 'sem leitura' : modelBilling.cost.toFixed(4)));
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
    println(terminalThemeRow('Raiz Git', ws.gitRoot ?? 'não é repositório Git'));
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
        println(terminalThemeRow('Detalhe atividade', compactLiveDetail(activity.detail)));
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
                        return `${renderLivePhaseLabel(entry.phase)} · ${compactLiveLabel(entry.label)}${progress}`;
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
        const requestedRuntimeLabel =
            projection.requestedRuntimeId == null ? 'desconhecido' : renderRuntimeTargetLabel(projection.requestedRuntimeId);
        println(
            terminalThemeRow(
                'Nota',
                `ambiente solicitado ${requestedRuntimeLabel} não encontrado; usando ambiente principal (${renderRuntimeTargetLabel(projection.runtimeId)}).`,
                { role: 'warn' },
            ),
        );
    }
    if (projection.timelineReconciliationStatus === 'diverged') {
        println(
            terminalThemeRow(
                'Nota',
                'conversa viva e persistência divergiram; a UX está priorizando o hub como autoridade canônica.',
                { role: 'warn' },
            ),
        );
    }
    if (projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight') {
        println(
            terminalThemeRow(
                'Sincronização',
                `${renderTerminalSyncStatusLabel(projection.timelineSyncStatus)} · ${projection.timelineSyncPendingCount} turnos pendentes para materializar no Hub`,
            ),
        );
    }
    if (projection.timelineSyncStatus === 'failed') {
        const retryLabel =
            typeof projection.timelineSyncNextRetryAt === 'number'
                ? ` próxima tentativa ${formatTerminalTimeLabel(projection.timelineSyncNextRetryAt, { mode: 'dual' })}`
                : '';
        println(
            terminalThemeRow('Sincronização', `falhou: ${projection.timelineSyncLastError ?? 'erro desconhecido'}${retryLabel}`, {
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
            ? `pergunta pendente (${renderTerminalPendingQuestionKindLabel(projection.pendingQuestionKind)})`
            : projection.pendingQuestionShadowState
              ? `pergunta salva (${projection.pendingQuestionShadowState})`
              : 'sem pergunta pendente';
        const waitLine =
            waitCount > 0 ? `${countLabel(waitCount, 'pendência humana', 'pendências humanas')} · /sdk waits` : 'sem pendências humanas';
        const modelLine = renderTerminalModelSelectionLine(modelBilling, 'revisar /status full');
        println('');
        println(terminalThemeHeadline('assistant', 'Agora'));
        println(terminalThemeDivider(37));
        println(
            terminalThemeRow(
                'Conversa',
                `${renderHumanTerminalStatus(state)} · ${projection.dialogLoopActive ? 'ativa' : 'inativa'} · fila ${queue} · ${askLine}`,
            ),
        );
        println(terminalThemeRow('Entrada', `${renderHumanInputChannelText(channel.label)} · ${waitLine}`));
        println(terminalThemeRow('Modelo', modelLine, { role: modelBilling.mismatch ? 'warn' : 'assistant' }));
        if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
            println(
                terminalThemeRow(
                    'Catálogo',
                    `${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ativo ${renderCompactGatewayActive(gatewayActive)}`,
                ),
            );
        }
        if (projection.activity?.label) {
            const detail = projection.activity.detail ? ` · ${renderSessionActivityText(projection.activity.detail)}` : '';
            println(terminalThemeRow('Atividade', `${renderSessionActivityText(projection.activity.label)}${detail}`));
        }
        if (projection.recommendedAction && projection.recommendedAction !== 'none') {
            println(terminalThemeRow('Próximo', renderTerminalActionLabel(projection.recommendedAction), { role: 'command' }));
        }
        println(terminalThemeDivider(37));
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
        ? `pergunta pendente (${renderTerminalPendingQuestionKindLabel(projection.pendingQuestionKind)})`
        : projection.pendingQuestionShadowState
          ? `pergunta salva (${projection.pendingQuestionShadowState})`
          : 'sem pergunta pendente';
    const modelLine = modelBilling.mismatch
        ? `configurado ${modelBilling.configuredModel ?? '-'} · observado ${modelBilling.observedModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'} · divergente`
        : `rota ${modelBilling.displayModel}${modelBilling.observedModel && modelBilling.observedModel !== modelBilling.displayModel ? ` · observado ${modelBilling.observedModel}` : ''}`;
    println('');
    println(terminalThemeHeadline('assistant', 'Agora - Detalhe'));
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow(
            'Ambiente',
            `${renderRuntimeTargetLabel(projection.runtimeId)} · sessão ${projection.runtimeSessionId ?? 'sem sessão'}`,
        ),
    );
    println(
        terminalThemeRow(
            'Conversa',
            `${renderHumanTerminalStatus(state)} · ${projection.dialogLoopActive ? 'ativa' : 'inativa'} · fila ${queue} · ${askLine}`,
        ),
    );
    println(
        terminalThemeRow(
            'Entrada',
            `${renderHumanInputChannelText(channel.label)} · modo SDK ${renderLiveSdkMode(projection.sdkSessionMode)} · permissões ${renderTerminalPermissionModeLabel(projection.permissionMode)} · ${waitSummary || 'sem pendências humanas'}`,
        ),
    );
    println(
        terminalThemeRow(
            'Timeline',
            `${renderTerminalTimelineSourceLabel(projection.timelineSource)} · ${renderTerminalTimelineReconciliationLabel(projection.timelineReconciliationStatus)} · sincronização ${renderTerminalSyncStatusLabel(projection.timelineSyncStatus)}`,
        ),
    );
    println(
        terminalThemeRow(
            'SSE',
            `${pluralPt(live.sse.clients, 'cliente', 'clientes')} · ${pluralPt(live.sse.criticalClients, 'cliente crítico', 'clientes críticos')} · estado ${live.state}`,
        ),
    );
    println(terminalThemeRow('Modelo', modelLine, { role: modelBilling.mismatch ? 'warn' : 'assistant' }));
    if (gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0) {
        println(
            terminalThemeRow(
                'Catálogo',
                `${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados · ativo ${renderCompactGatewayActive(gatewayActive)}`,
            ),
        );
    }
    if (projection.activity?.label) {
        const detail = projection.activity.detail ? ` · ${renderSessionActivityText(projection.activity.detail)}` : '';
        println(terminalThemeRow('Atividade', `${projection.activity.phase} · ${renderSessionActivityText(projection.activity.label)}${detail}`));
    }
    if (projection.recommendedAction) {
        println(terminalThemeRow('Próximo', projection.recommendedAction, { role: 'command' }));
    }
    println(terminalThemeDivider(37));
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
    const now = Date.now();
    const status = projection.status;
    const current = projection.activity.current;
    const activeTrace = projection.turnTrace.current ?? projection.turnTrace.recent[0] ?? null;
    const streamFlags = [
        `resposta ${renderLiveToggle(projection.stream.streaming)}`,
        `raciocínio ${renderLiveToggle(projection.stream.thinking)}`,
        `ferramentas ${renderLiveToggle(projection.stream.toolActivity)}`,
        `intenção ${renderLiveToggle(projection.stream.intent)}`,
        `uso ${renderLiveToggle(projection.stream.usage)}`,
    ].join(' · ');
    const ioRuntime = status.ioRuntime;

    if (!detailMode) {
        const streamBits = [
            projection.stream.streaming ? 'resposta ao vivo' : null,
            projection.stream.thinking ? 'raciocínio visível' : null,
            projection.stream.toolActivity ? 'ferramentas visíveis' : null,
            projection.stream.usage ? 'uso visível' : null,
        ].filter(Boolean);
        const traceSummary = [
            projection.counters.toolCount > 0 ? countLabel(projection.counters.toolCount, 'ferramenta', 'ferramentas') : null,
            projection.counters.fileCount > 0 ? countLabel(projection.counters.fileCount, 'arquivo', 'arquivos') : null,
            projection.counters.recentIoCount > 0 ? `${projection.counters.recentIoCount} I/O recente` : null,
        ].filter(Boolean);
        const stateLabel = renderLiveFlowStateLabel(projection.state);
        const activityLine = renderLiveActivitySummary(current);
        println('');
        println(terminalThemeHeadline('assistant', 'Fluxo da conversa'));
        println(terminalThemeDivider(37));
        println(
            terminalThemeRow('Estado', `${stateLabel} · ${projection.summary}`, {
                role: renderLiveFlowStateRole(projection.state),
            }),
        );
        println(
            terminalThemeRow(
                'Conversa',
                `${status.dialogLoopActive ? 'ativa' : 'inativa'} · ${renderHumanTerminalStatus(status.snap['status'])}${status.snap['dialogPaused'] ? ' · pausada' : ''}`,
            ),
        );
        println(terminalThemeRow('Sinais', streamBits.join(' · ') || 'sinais reduzidos'));
        println(terminalThemeRow('Atividade', activityLine));
        println(terminalThemeRow('Turno', traceSummary.join(' · ') || 'sem ações recentes'));
        println(
            terminalThemeRow(
                'Conexões',
                `${renderCompactSseLine(projection.sse)} · timeline ${countLabel(projection.counters.timelineTurns, 'turno', 'turnos')}`,
            ),
        );
        println(terminalThemeRow('Detalhe', renderCommandList(['/live full', `/activity ${requestedLimit} detail`, `/events ${requestedLimit}`])));
        println(terminalThemeDivider(37));
        return;
    }

    println('');
    println(terminalThemeHeadline('assistant', 'Fluxo detalhado da conversa'));
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Estado', `${renderLiveFlowStateLabel(projection.state)} · ${projection.summary}`, {
            role: renderLiveFlowStateRole(projection.state),
        }),
    );
    println(
        terminalThemeRow(
            'Ambiente',
            `${renderLiveRuntimeTarget(status.runtimeId)} · ${renderHumanTerminalStatus(status.snap['status'])} · conversa ${status.dialogLoopActive ? 'ativa' : 'inativa'} · ${status.snap['dialogPaused'] ? 'pausada' : 'contínua'}`,
        ),
    );
    println(
        terminalThemeRow(
            'Sessão SDK',
            `${renderLiveSdkMode(status.sdkSessionMode)} · ${renderTerminalSdkSessionPresence(status.sdkSessionId)} · permissões ${renderTerminalPermissionModeLabel(status.permissionMode)}`,
        ),
    );
    println(terminalThemeRow('Sinais', streamFlags));
    println(
        terminalThemeRow(
            'Conexões',
            `${countLabel(projection.sse.clients, 'cliente SSE', 'clientes SSE')} · ${countLabel(
                projection.sse.criticalClients,
                'crítico',
                'críticos',
            )} · replay ${projection.sse.replayLastId}`,
        ),
    );
    println(
        terminalThemeRow(
            'Timeline',
            `${renderTerminalTimelineSourceLabel(projection.timeline.timelineSource)} · ${renderTerminalTimelineReconciliationLabel(projection.timeline.reconciliationStatus)} · sincronização ${renderTerminalSyncStatusLabel(projection.timeline.sync.status)} · ${countLabel(projection.counters.timelineTurns, 'turno', 'turnos')}`,
        ),
    );
    println(
        terminalThemeRow(
            'Contexto',
            renderLiveContextLine(ioRuntime),
        ),
    );
    println(terminalThemeRow('Atividade', renderLiveActivitySummary(current, { includePhase: true })));
    println(
        terminalThemeRow(
            'Trace',
            `${countLabel(projection.counters.toolCount, 'ferramenta', 'ferramentas')} · ${countLabel(projection.counters.fileCount, 'arquivo', 'arquivos')} · ${projection.counters.recentIoCount} I/O recente`,
        ),
    );
    println(terminalThemeDivider(37));

    if (activeTrace && (activeTrace.tools.length > 0 || activeTrace.files.length > 0)) {
        println(terminalThemeHeadline('assistant', 'Turno observado'));
        for (const tool of activeTrace.tools.slice(0, 5)) {
            println(terminalThemeRow('Ferramenta', renderLiveToolSummary(tool, { detail: true })));
        }
        for (const file of activeTrace.files.slice(0, 5)) {
            println(
                terminalThemeRow(
                    'Arquivo',
                    `${renderLiveOperationLabel(file.operation)} · ${formatTerminalToolPathForOperator(file.path)} · ${renderLiveSourceLabel(file.source)}${file.count > 1 ? ` ×${file.count}` : ''}`,
                ),
            );
        }
    }

    if (projection.recentIo.length > 0) {
        println(terminalThemeHeadline('assistant', 'I/O real recente'));
        for (const entry of projection.recentIo.slice(0, 6)) {
            const time = formatTerminalTimeLabel(entry.timestamp, { now, mode: 'dual' });
            const statusLabel = entry.success ? 'concluída' : 'falhou';
            const bytes =
                typeof entry.bytesRead === 'number'
                    ? ` · ${renderLiveBytes(entry.bytesRead)} lidos`
                    : typeof entry.bytesWritten === 'number'
                      ? ` · ${renderLiveBytes(entry.bytesWritten)} escritos`
                      : '';
            const duration = typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : '';
            println(
                terminalThemeRow(
                    'Operação',
                    `${time} · ${statusLabel} · ${renderLiveOperationLabel(entry.operation)} · ${compactHumanTerminalText(entry.target)}${bytes}${duration}`,
                    { role: entry.success ? 'muted' : 'warn' },
                ),
            );
        }
    }

    if (projection.activity.history.length > 0) {
        println(terminalThemeHeadline('assistant', 'Eventos recentes'));
        for (const entry of projection.activity.history.slice(0, 6)) {
            const time = formatTerminalTimeLabel(entry.ts, { now, mode: 'dual' });
            const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
            println(
                terminalThemeRow(
                    'Evento',
                    `${time} · ${renderLiveActivitySummary(entry, { includePhase: true })}${progress}`,
                ),
            );
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
    const hist = timeline.turns.filter((turn) => normalizeTerminalHistoryContent(turn.content).length > 0);
    if (hist.length === 0) {
        const label = timeline.turns.length > 0 ? 'sem mensagens visíveis nesta janela' : 'vazio';
        println(terminalThemeRow('Histórico', label));
        return;
    }
    println('');
    println(
        terminalThemeHeadline('assistant', 'Histórico', [
            renderTerminalTimelineSourceLabel(timeline.timelineSource),
            renderTerminalTimelineAuthorityLabel(timeline.timelineAuthority),
            renderTerminalTimelineReconciliationLabel(timeline.reconciliationStatus),
        ]),
    );
    println(terminalThemeDivider(64));
    const now = Date.now();
    for (const turn of hist) {
        const time = formatTerminalTimeLabel(turn.timestamp, { now, mode: 'dual' });
        const actor = renderTerminalActorLabel(turn.role, turn.rawRole);
        const sourceLabel = turn.persisted ? '' : ' · ao vivo';
        const preview = renderTerminalHistoryPreview(normalizeTerminalHistoryContent(turn.content));
        println(terminalThemeRow(actor.label, `${time}${sourceLabel} · ${preview}`, { role: actor.role }));
    }
    if (timeline.reconciliationStatus === 'diverged') {
        println(
            terminalThemeRow(
                'Nota',
                `histórico em memória divergiu da persistência; ${countLabel(timeline.liveBridgeTailCount, 'turno ao vivo preservado', 'turnos ao vivo preservados')}${timeline.syncBlockedReason ? ` · motivo ${renderTerminalTimelineReasonLabel(timeline.syncBlockedReason)}` : ''}`,
                { role: 'warn' },
            ),
        );
    }
    if (timeline.sync.status === 'scheduled' || timeline.sync.status === 'inflight') {
        println(
            terminalThemeRow(
                'Sincronização',
                `${renderTerminalSyncStatusLabel(timeline.sync.status)} · ${countLabel(timeline.sync.pendingCount, 'turno aguardando persistência', 'turnos aguardando persistência')}`,
            ),
        );
    } else if (timeline.sync.status === 'failed') {
        println(terminalThemeRow('Sincronização', `falhou: ${timeline.sync.lastError ?? 'erro desconhecido'}.`, { role: 'warn' }));
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
        const turns = projection.turns.filter((turn) => normalizeTerminalHistoryContent(turn['content']).length > 0);
        if (turns.length === 0) {
            const label =
                projection.turns.length > 0
                    ? 'A janela persistida não tem mensagens visíveis.'
                    : 'Nenhum turno persistido ainda.';
            println(terminalThemeRow('/db-history', label));
            return;
        }
        const offsetLabel = offset > 0 ? ` (offset recente ${offset})` : '';
        println('');
        println(terminalThemeHeadline('assistant', `Últimos ${turns.length} turnos da sessão atual${offsetLabel}`));
        println(terminalThemeDivider(52));
        const now = Date.now();
        for (const t of turns) {
            const time = formatTerminalTimeLabel(String(t['created_at'] ?? ''), { now, mode: 'dual' });
            const role = String(t['role'] ?? 'user');
            const content = normalizeTerminalHistoryContent(t['content']);
            const actor = renderTerminalActorLabel(role, role);
            const preview = renderTerminalHistoryPreview(content);
            println(terminalThemeRow(actor.label, `${time} · ${preview}`, { role: actor.role }));
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
        println(terminalThemeHeadline('assistant', `Últimas ${sessions.length} sessões persistidas`));
        println(terminalThemeDivider(62));
        const now = Date.now();
        for (const s of sessions) {
            const createdAt = formatTerminalTimeLabel(String(s['created_at'] ?? ''), { now, mode: 'dual' });
            const sessionId = String(s['id'] ?? '');
            const sessionStatus = String(s['status'] ?? 'unknown');
            const title = String(s['title'] ?? '(sem título)');
            const isCurrent = sessionId === currentHubSessionId;
            const statusRole = sessionStatus === 'active' ? 'success' : 'muted';
            const marker = isCurrent ? ' · atual' : '';
            println(
                terminalThemeRow(
                    'Sessão',
                    `${createdAt} · ${renderDbSessionStatusLabel(sessionStatus)} · ${title}${marker}`,
                    { role: statusRole },
                ),
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
    println(terminalThemeRow('Você', 'digita diretamente no terminal', { role: 'user' }));
    println(terminalThemeRow('LLM-A', `envia mensagens pela porta ${injectPort}`, { role: 'system' }));
    println(terminalThemeRow('LLM-B', `conversa permanente · ${currentModel} · raciocínio ${currentReasoningEffort}`, { role: 'assistant' }));
    println(terminalThemeRow('Eventos', `stream local na porta ${injectPort}`));
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
        println(terminalThemeRow('Sessão', 'nenhuma sessão persistida ativa', { role: 'warn' }));
        return;
    }
    println('');
    println(terminalThemeHeadline('assistant', 'Estatísticas da sessão'));
    println(terminalThemeDivider(37));
    println(terminalThemeRow('Você', countLabel(projection.userTurns, 'turno', 'turnos')));
    println(terminalThemeRow('LLM-B', countLabel(projection.llmBTurns, 'turno', 'turnos')));
    println(terminalThemeRow('Total', countLabel(projection.turns, 'turno', 'turnos')));
    println(terminalThemeRow('Memórias', countLabel(projection.memories, 'salva', 'salvas')));
    println(
        terminalThemeRow(
            'Sessões',
            `hub ${projection.hubSessionId ? 'ativa' : 'ausente'} · SDK ${projection.sdkSessionId ? 'ativa' : 'ausente'}`,
        ),
    );
    println(terminalThemeDivider(37));
    println('');
}

/**
 * Limpa histórico em memória.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClear({ println }) {
    clearTerminalHistory();
    println(terminalThemeRow('Histórico', 'memória local limpa', { role: 'success' }));
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
        const runtimeSuffix =
            result.runtimeId && result.runtimeId !== 'default'
                ? ` · ambiente ${renderRuntimeTargetLabel(result.runtimeId)}`
                : '';
        println(
            terminalThemeRow('Resposta', `enviada para pergunta pendente${runtimeSuffix}: "${result.answer}"`, {
                role: 'success',
            }),
        );
        return;
    }
    if (result.reason === 'empty') {
        println(terminalThemeRow('/answer', 'Uso: /answer <texto>', { role: 'command' }));
        return;
    }
    if (result.reason === 'protocol_controlled') {
        println(terminalThemeRow('/answer', 'A conversa aguarda uma mensagem. Digite o texto normalmente, sem /answer.', { role: 'warn' }));
        return;
    }
    if (shouldConsumeTerminalPendingAnswerInput(result)) {
        const choices =
            result.pendingQuestionChoices.length > 0 ? ` Opções: ${result.pendingQuestionChoices.join(' | ')}.` : '';
        println(terminalThemeRow('/answer', `Resposta inválida para a pergunta pendente.${choices}`, { role: 'warn' }));
        return;
    }
    const projection = readTerminalStatusProjection(withRuntimeTarget({}, runtimeId));
    if (result.shadowExpired || projection.pendingQuestionShadowExpired) {
        println(terminalThemeRow('/answer', 'Nenhuma pergunta viva. Há uma pergunta restaurada expirada pendente de limpeza.', { role: 'warn' }));
        return;
    }
    println(terminalThemeRow('/answer', 'Nenhuma pergunta pendente.'));
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
    /\bBYOK_(?:AGENT_)?PROBE(?:_\w+)?\b|\bterminal_byok_probe_marker\b|\bBYOK_AGENT_PROBE_ASK\b/iu;

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
    if ((normalized === 'current' || normalized === 'atual') && inventory.currentSessionId) {
        return { sessionId: inventory.currentSessionId, source: 'atual' };
    }
    if ((normalized === 'last' || normalized === 'ultima' || normalized === 'última') && inventory.lastSessionId) {
        return { sessionId: inventory.lastSessionId, source: 'última usada' };
    }
    if (
        (normalized === 'foreground' || normalized === 'primeiro-plano' || normalized === 'primeiro_plano') &&
        inventory.foregroundSessionId
    ) {
        return { sessionId: inventory.foregroundSessionId, source: 'primeiro plano' };
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
    const outcomeLabel = outcome === 'created' ? 'criada' : 'retomada';
    const requestedLabel = requestedMode === 'new' ? 'nova' : requestedMode === 'resume' ? 'retomar' : 'automática';
    const candidate =
        typeof decision['resumeCandidateSessionId'] === 'string' && decision['resumeCandidateSessionId']
            ? ' · candidato informado'
            : '';
    return `${outcomeLabel} · pedido ${requestedLabel}${candidate} · motivo ${renderSdkSessionReasonLabel(reason)}`;
}

/**
 * @param {unknown} summary
 * @returns {string}
 */
function renderSdkSessionSummaryPreview(summary) {
    if (typeof summary !== 'string') return '';
    const compact = summary.replace(/\s+/gu, ' ').trim();
    if (!compact) return '';
    return compact.length > 84 ? `${compact.slice(0, 81)}...` : compact;
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
        providerKind ? renderSdkSessionMetadataProvider(providerKind, providerModel, model) : null,
        reason ? `limite ${renderSdkSessionReasonLabel(reason)}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * @param {string} providerKind
 * @param {string | null} providerModel
 * @param {string | null} model
 * @returns {string}
 */
function renderSdkSessionMetadataProvider(providerKind, providerModel, model) {
    const renderedProvider = renderSdkSessionProviderKindLabel(providerKind);
    const modelSuffix = providerModel && providerModel !== model ? `:${providerModel}` : '';
    return providerKind === 'byok' ? `rota BYOK${modelSuffix}` : `provedor ${renderedProvider}${modelSuffix}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkSessionProviderKindLabel(value) {
    const kind = String(value ?? '').trim();
    if (kind === 'github-copilot') return 'GitHub Copilot';
    if (kind === 'byok') return 'BYOK';
    if (kind === 'openai') return 'OpenAI';
    return kind.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkSessionReasonLabel(value) {
    const reason = String(value ?? '').trim();
    if (!reason) return 'n/d';
    if (reason.includes('operator-next-boot-new-session')) return 'operador pediu nova sessão no próximo boot';
    if (reason.includes('sdk-resume-fallback-created-new-session')) {
        return 'retomada automática criou sessão nova quando a anterior não pôde ser retomada';
    }
    if (reason.includes('auto-resume-persisted-session')) return 'retomada automática da sessão persistida';
    if (reason.includes('provider-boundary')) return 'mudança de rota/modelo BYOK';
    if (reason.includes('byok')) return reason.replace(/[._-]+/gu, ' ');
    return compactSdkSessionEventValue(reason.replace(/\bsdk[-_]/giu, '').replace(/[._-]+/gu, ' '), 96);
}

/**
 * @param {unknown} value
 * @param {number} [now]
 * @returns {string}
 */
function renderSdkSessionRelativeTime(value, now = Date.now()) {
    if (value == null || value === '') return 'sem horário';
    const rendered = formatTerminalTimeLabel(/** @type {Date | number | string} */ (value), { now, mode: 'dual' });
    return rendered === 'agora' ? 'há 0s' : rendered;
}

/**
 * @param {string | null | undefined} sessionId
 * @param {import('../../presentation/contracts/index.js').RuntimeSessionMetadata[]} sessions
 * @param {number} [offset]
 * @returns {string | null}
 */
function findSdkSessionHandle(sessionId, sessions, offset = 0) {
    if (!sessionId) return null;
    const index = sessions.findIndex((entry) => entry.sessionId === sessionId);
    return index >= 0 ? `#${offset + index + 1}` : null;
}

/**
 * @param {string | null | undefined} sessionId
 * @param {import('../../presentation/contracts/index.js').RuntimeSessionMetadata[]} sessions
 * @param {number} [offset]
 * @returns {string}
 */
function renderSdkSessionTopReference(sessionId, sessions, offset = 0) {
    if (!sessionId) return 'ausente';
    const handle = findSdkSessionHandle(sessionId, sessions, offset);
    return handle ? `sessão ${handle}` : 'sessão não listada nesta página';
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeSessionMetadata} entry
 * @param {{
 *     currentSessionId: string | null;
 *     lastSessionId: string | null;
 *     foregroundSessionId: string | null;
 * }} inventory
 * @returns {string}
 */
function renderSdkSessionInventoryBadges(entry, inventory) {
    const badges = [
        entry.sessionId === inventory.currentSessionId ? 'atual' : null,
        entry.sessionId === inventory.lastSessionId ? 'última usada' : null,
        entry.sessionId === inventory.foregroundSessionId ? 'em primeiro plano' : null,
        isTerminalProbeSdkSession(entry) ? 'diagnóstico antigo' : null,
        entry.isRemote ? 'remota' : 'local',
    ].filter(Boolean);
    return badges.length > 0 ? badges.join(' · ') : 'sem marcações';
}

/**
 * @param {{ mode?: unknown; sessionId?: unknown } | null | undefined} bootSelection
 * @param {import('../../presentation/contracts/index.js').RuntimeSessionMetadata[]} sessions
 * @returns {string}
 */
function renderSdkSessionNextBootLabel(bootSelection, sessions) {
    if (bootSelection?.mode === 'resume') {
        const handle = typeof bootSelection.sessionId === 'string' ? findSdkSessionHandle(bootSelection.sessionId, sessions) : null;
        return handle ? `retomar sessão ${handle}` : 'retomar sessão informada';
    }
    if (bootSelection?.mode === 'new') return 'criar nova sessão';
    return 'automático';
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
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkArchiveTypeLabel(value) {
    const type = String(value ?? '').trim();
    if (!type) return 'registrado';
    if (type === 'session.created') return 'sessão criada';
    if (type === 'session.deleted') return 'sessão removida';
    if (type === 'session.updated') return 'sessão atualizada';
    if (type === 'session.foreground') return 'sessão em primeiro plano';
    if (type === 'session.background') return 'sessão em segundo plano';
    if (type === 'session.shutdown') return 'sessão encerrada';
    if (type === 'completed') return 'concluído';
    if (type === 'requested') return 'solicitado';
    if (type === 'pending') return 'pendente';
    if (type === 'form') return 'formulário';
    return type.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSdkPermissionTypeLabel(value) {
    const type = String(value ?? '').trim();
    if (type === 'fs.write') return 'escrita de arquivo';
    if (type === 'fs.read') return 'leitura de arquivo';
    if (type === 'fs.delete') return 'exclusão de arquivo';
    if (type === 'fs.move') return 'movimento de arquivo';
    if (type === 'terminal.exec') return 'execução no terminal';
    return renderSdkArchiveTypeLabel(type);
}

/**
 * @param {string | null} value
 * @returns {string | null}
 */
function renderSdkSessionReference(value) {
    if (!value) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
        return 'ativa';
    }
    return compactSdkSessionEventValue(value, 28);
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
    const session = renderSdkSessionReference(sessionId);
    const detailParts = [
        renderSdkArchiveTypeLabel(type),
        session ? `sessão ${session}` : null,
        commandName ? `comando ${compactSdkSessionEventValue(commandName, 42)}` : null,
        localCommand ? `local ${compactSdkSessionEventValue(localCommand, 42)}` : null,
    ].filter(Boolean);
    return {
        key: [event, type, sessionId ?? '', commandName ?? '', localCommand ?? '', source].join('\u001f'),
        line: `${renderSdkArchiveEventLabel(event)} · ${detailParts.join(' · ')}`,
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
        renderSdkPermissionTypeLabel(type),
        choiceCount != null ? `${choiceCount} opção(ões)` : null,
        message ? `mensagem ${compactSdkSessionEventValue(message, 70)}` : null,
        answer ? `resposta ${compactSdkSessionEventValue(answer, 52)}` : null,
        contentKeys ? `campos ${compactSdkSessionEventValue(contentKeys, 40)}` : null,
    ].filter(Boolean);
    return {
        key: [entry.event, type, requestId ?? '', sessionId ?? '', message ?? '', answer ?? '', source].join('\u001f'),
        line: `${renderSdkArchiveEventLabel(entry.event)} · ${detailParts.join(' · ')}`,
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
            'Registro',
            `arquivo ${compactHumanTerminalText(state.path ?? 'sem arquivo')} · janela ${limit} · ciclo de vida ${lifecycle.entries.length} · comandos ${commands.entries.length}`,
        ),
    );
    if (lifecycle.state.error || commands.state.error) {
        println(terminalThemeRow('Erro', lifecycle.state.error ?? commands.state.error ?? 'erro desconhecido', { role: 'error' }));
    }
    if (merged.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhum ciclo de vida SDK ou comando SDK arquivado ainda', { role: 'warn' }));
        println(terminalThemeRow('Detalhe', '/events sources · bruto em /events --raw'));
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
    const now = Date.now();
    for (const entry of collapsed) {
        const time = entry.firstTimestamp ? formatTerminalTimeLabel(entry.firstTimestamp, { now, mode: 'dual' }) : 'sem horário';
        const repeats = entry.count > 1 ? ` ×${entry.count}` : '';
        println(terminalThemeRow('Evento', `${time} · ${entry.line}${repeats}`));
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
            'Registro',
            `arquivo ${compactHumanTerminalText(state?.path ?? 'sem arquivo')} · janela ${limit} · perguntas ${(counts.get('user_input.requested') ?? 0) + (counts.get('user_input.completed') ?? 0)} · formulários ${(counts.get('elicitation.pending') ?? 0) + (counts.get('elicitation.completed') ?? 0)} · permissões ${(counts.get('permission.requested') ?? 0) + (counts.get('permission.completed') ?? 0) + (counts.get('permission.mode_changed') ?? 0)}`,
        ),
    );
    const error = projections.find((projection) => projection.state.error)?.state.error;
    if (error) println(terminalThemeRow('Erro', error, { role: 'error' }));
    if (merged.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhuma espera SDK arquivada ainda', { role: 'warn' }));
        println(terminalThemeRow('Detalhe', '/sdk waits para pendências vivas · bruto em /events --raw'));
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
    const now = Date.now();
    for (const entry of collapsed) {
        const time = entry.firstTimestamp ? formatTerminalTimeLabel(entry.firstTimestamp, { now, mode: 'dual' }) : 'sem horário';
        const repeats = entry.count > 1 ? ` ×${entry.count}` : '';
        println(terminalThemeRow('Espera', `${time} · ${entry.line}${repeats}`));
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
    println(terminalThemeRow('Fonte', `agent/session/commands · ${countLabel(specs.length, 'comando', 'comandos')} · safelist observável; execução local continua no REPL`));
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
                println(terminalThemeRow('Uso', '/session sdk next resume <id|#n|atual|última|primeiro-plano>', { role: 'warn' }));
                return;
            }
            let resolved;
            if (/^(?:#\d+|current|last|foreground|atual|ultima|última|primeiro[-_]plano)$/iu.test(target)) {
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
                    `tentar retomar sessão SDK${resolved.source === 'id' ? ' informada' : ` ${resolved.source}`}`,
                    { role: 'success' },
                ),
            );
        } else if (mode === 'auto' || mode === 'clear') {
            const result = await scheduleTerminalSdkSessionBootSelection(null);
            if (!result.ok) throw result.error;
            println(terminalThemeRow('Próximo boot', 'seleção automática restaurada; a sessão persistida anterior volta a ser o padrão', { role: 'success' }));
        } else {
            println(terminalThemeRow('Uso', '/session sdk next <new|resume <id|#n|atual|última|primeiro-plano>|auto>', { role: 'warn' }));
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
            println(terminalThemeRow('Proteção', 'sessão SDK viva não apagada', { role: 'error' }));
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
                `apagada${resolved.source === 'id' ? ' por ID informado' : ` via ${resolved.source}`}`,
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

    const nextLabel = renderSdkSessionNextBootLabel(bootSelection, inventory.sessions);
    println('');
    println(terminalThemeHeadline('assistant', 'Sessão SDK'));
    println(terminalThemeRow('Atual', renderSdkSessionTopReference(inventory.currentSessionId, inventory.sessions)));
    println(terminalThemeRow('Última usada', renderSdkSessionTopReference(inventory.lastSessionId, inventory.sessions)));
    println(terminalThemeRow('Primeiro plano', renderSdkSessionTopReference(inventory.foregroundSessionId, inventory.sessions)));
    println(terminalThemeRow('Próximo boot', nextLabel));
    println(terminalThemeRow('Arquivos', renderSdkSessionFsState(inventory.sessionFs)));
    const byokBinding = classifyTerminalByokSdkBinding(
        readTerminalByokProjection().summary,
        inventory.persistedByokBinding,
        inventory.currentSessionId,
        callWithRuntimeTarget(readTerminalConfigProjection, runtimeId).currentModel,
    );
    println(terminalThemeRow('Vínculo SDK', renderTerminalSdkProviderBinding(inventory.persistedByokBinding)));
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
        terminalThemeRows('Comandos', [
            '/session sdk controla sessões SDK',
            '/restart reinicia só a conversa',
            '/resume injeta histórico do hub',
            '/session save|list|restore usa snapshots locais',
        ], { role: 'command' }),
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
    const now = Date.now();
    for (const [index, entry] of visibleSessions.entries()) {
        const absoluteIndex = inventoryArgs.offset + index;
        const badges = renderSdkSessionInventoryBadges(entry, inventory);
        const start = renderSdkSessionRelativeTime(entry.startTime ?? entry.createdAt ?? null, now);
        const modified = renderSdkSessionRelativeTime(
            entry.modifiedTime ?? entry.updatedAt ?? entry.lastActivityAt ?? null,
            now,
        );
        const summary = renderSdkSessionSummaryPreview(entry.summary);
        const localMetadata = renderSdkSessionLocalMetadata(
            entry.localMetadata && typeof entry.localMetadata === 'object'
                ? /** @type {Record<string, unknown>} */ (entry.localMetadata)
                : null,
        );
        println(terminalThemeRow(`#${absoluteIndex + 1}`, badges));
        println(terminalThemeRow('Tempo', `início ${start} · alterada ${modified}`));
        if (summary) {
            println(terminalThemeRow('Resumo', summary));
        }
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
                `${countLabel(inventory.sessions.length - inventoryArgs.offset - visibleSessions.length, 'sessão omitida', 'sessões omitidas')} · use /session sdk ${inventoryArgs.limit} offset=${inventoryArgs.offset + visibleSessions.length}`,
            ),
        );
    }
    println('');
    println(
        terminalThemeRows('Próximo boot', [
            '/session sdk next new',
            '/session sdk next resume <id|#n|atual|última|primeiro-plano>',
            '/session sdk next auto',
        ], { role: 'command' }),
    );
    println(
        terminalThemeRows('Filtros', [
            '/session sdk <n> offset=<n>',
            'cwd=<path> (diretório) · gitRoot=<path> (raiz Git)',
            'repo=<owner/repo> · branch=<nome>',
        ], { role: 'command' }),
    );
    println(terminalThemeRow('Limpeza', '/session sdk delete <id|#n>; sessão viva é protegida', { role: 'command' }));
    println(terminalThemeRows('Diagnósticos', [
        'sessões marcadas como diagnóstico antigo vieram de canários persistidos',
        'probes novos usam sessão efêmera',
    ]));
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
    println(terminalThemeRow('Snapshot', `salvo · ${String(data['snapshotId'] ?? '(sem id)')}`, { role: 'success' }));
    println(terminalThemeRow('Arquivo', path, { role: 'fileWrite' }));
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
                ? formatTerminalTimeLabel(createdAt, { mode: 'dual' })
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
            ? formatTerminalTimeLabel(createdAt, { mode: 'dual' })
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
            println(`    Restaurada em: ${formatTerminalTimeLabel(shadow.restoredAt, { mode: 'dual' })}`);
        }
        if (typeof shadow.expiresAt === 'number') {
            println(`    Expira em: ${formatTerminalTimeLabel(shadow.expiresAt, { mode: 'dual' })}`);
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
