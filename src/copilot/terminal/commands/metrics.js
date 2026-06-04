// @ts-check
/**
 * src/copilot/terminal/commands/metrics.js
 *
 * Comando `/metrics` — exibe métricas consolidadas de performance e uso da sessão.
 *
 * @module copilot/terminal/commands/metrics
 * @see EventBus
 */

import { readTerminalConfigProjection, readTerminalMetricsProjection } from '../frontend/index.js';
import { terminalThemeDivider, terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {object} MetricsContext
 * @property {(text: string) => void} println
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function yesNoPt(value) {
    if (typeof value !== 'boolean') return 'n/d';
    return value ? 'sim' : 'não';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanMetricStatus(value) {
    const status = String(value ?? '').trim().toLowerCase();
    if (status === 'completed' || status === 'success' || status === 'ok') return 'concluído';
    if (status === 'idle') return 'ocioso';
    if (status === 'processing') return 'trabalhando';
    if (status === 'waiting_for_input') return 'aguardando você';
    if (status === 'starting') return 'iniciando';
    if (status === 'stopped') return 'parado';
    if (status === 'error' || status === 'failed') return 'falhou';
    if (status === 'pending') return 'pendente';
    return status || 'sem leitura';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanMetricSdkMode(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'interactive') return 'interativo';
    if (mode === 'plan') return 'plano';
    if (mode === 'autopilot') return 'autopiloto';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecido';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanMetricPromptState(value) {
    const state = String(value ?? '').trim();
    if (state === 'stale') return 'desatualizado';
    if (state === 'live-reload') return 'recarregando';
    if (state === 'ok') return 'ok';
    return state.replace(/[._-]+/gu, ' ') || 'sem leitura';
}

/**
 * @param {string | null | undefined} value
 * @param {boolean} detail
 * @param {string} visibleLabel
 * @returns {string}
 */
function renderMetricBinding(value, detail, visibleLabel) {
    if (!value) return `sem ${visibleLabel}`;
    return detail ? value : visibleLabel;
}

/**
 * @param {string | null | undefined} value
 * @param {boolean} detail
 * @returns {string}
 */
function renderMetricRuntimeTarget(value, detail) {
    const runtimeId = String(value ?? '').trim();
    if (!runtimeId || runtimeId === 'default') return 'principal';
    return detail ? runtimeId : runtimeId;
}

/**
 * Exibe métricas consolidadas da sessão.
 *
 * @param {MetricsContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdMetrics({ println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const detail = /\b(?:detail|debug|--detail|--debug)\b/iu.test(cleanArg);
    const projection = callWithRuntimeTarget(readTerminalMetricsProjection, runtimeId);
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    const {
        snap,
        turnCount,
        bridgeTurnCount,
        timelineSource,
        timelineAuthority,
        timelineReconciliationStatus,
        timelineSyncStatus,
        timelineSyncPendingCount,
        timelineSyncTelemetry,
        contextWindow,
        systemPromptBinding,
        systemPromptFreshness,
        toolCallCount,
        toolErrorCount,
        errorStats,
        binding,
        runtimeSessionId,
        activity,
        modelBilling,
        latestInject,
        streamDiagnostics,
        sseEventArchive,
    } = projection;

    // ── Session info ─────────────────────────────────────────────────
    const model = snap['model'] ?? '?';
    const status = snap['status'] ?? '?';
    const sessionId = renderMetricBinding(runtimeSessionId, detail, 'ativa');
    const byok = configProjection.byok;
    const byokActive = byok?.enabled === true;

    // ── Token context ────────────────────────────────────────────────
    let ctxStr = terminalThemeText('muted', '(sem dados)');
    if (contextWindow) {
        const tokens = contextWindow.tokens;
        const limit = contextWindow.tokenLimit;
        const pct = limit > 0 ? ((tokens / limit) * 100).toFixed(1) : '?';
        const pctNum = Number(pct);
        const role = pctNum > 80 ? 'error' : pctNum > 60 ? 'warn' : 'success';
        ctxStr = `${terminalThemeText(role, `${pct}%`)} (${tokens.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')})`;
    }

    // ── Billing ──────────────────────────────────────────────────────
    const lastModel = modelBilling.mismatch
        ? `configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'}`
        : modelBilling.displayModel;
    const costStr = modelBilling.cost === null ? '-' : `$${modelBilling.cost.toFixed(4)}`;
    const billingStatus = terminalThemeText(modelBilling.mismatch ? 'error' : 'success', modelBilling.mismatch ? 'divergente' : 'ok');
    const billingLine = byokActive
        ? `GitHub PR lateral ${lastModel} · ${costStr} · ${billingStatus} ${terminalThemeText('muted', `(histórica; BYOK ativo provedor ${byok.preset ?? byok.providerType ?? '-'} · modelo ${byok.model ?? '-'}; não é cobrança BYOK)`)}`
        : `telemetria PR ${lastModel} · ${costStr} · ${billingStatus} ${terminalThemeText('muted', '(histórica)')}`;
    const promptDigest = typeof systemPromptBinding?.['digest'] === 'string' ? systemPromptBinding['digest'] : null;
    const promptIsStale =
        typeof systemPromptFreshness?.['isStale'] === 'boolean' ? systemPromptFreshness['isStale'] : null;
    const promptReason =
        typeof systemPromptFreshness?.['reason'] === 'string' ? systemPromptFreshness['reason'] : '(sem motivo)';
    const promptAction =
        systemPromptFreshness?.['recommendedAction'] === 'none' ||
        systemPromptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
        systemPromptFreshness?.['recommendedAction'] === 'resume-session'
            ? systemPromptFreshness['recommendedAction']
            : 'none';
    const promptActionLabel =
        promptAction === 'observe-live-reload'
            ? 'observar recarregamento vivo'
            : promptAction === 'resume-session'
              ? 'retomar sessão'
              : 'nenhuma ação imediata';
    const promptLabel =
        promptIsStale === true
            ? terminalThemeText('error', 'desatualizado')
            : promptAction === 'observe-live-reload'
              ? terminalThemeText('warn', 'recarregando')
              : promptIsStale === false
                ? terminalThemeText('success', 'ok')
                : terminalThemeText('muted', '(sem leitura)');
    const latestInjectOutcome = latestInject?.outcome ?? (latestInject?.ok ? 'completed' : 'error');
    const latestInjectTimeout =
        typeof latestInject?.timeoutMs === 'number'
            ? ` / timeout ${latestInject.timeoutMs}ms${latestInject.timeoutStrategy ? ` (${latestInject.timeoutStrategy})` : ''}`
            : '';
    const latestInjectPrompt = latestInject?.promptDigest ?? promptDigest ?? '-';
    const latestInjectFreshness =
        latestInject?.promptIsStale === true
            ? 'desatualizado'
            : latestInject?.promptRecommendedAction === 'observe-live-reload'
              ? 'recarregando'
              : latestInject?.promptIsStale === false
                ? 'ok'
                : 'sem leitura';
    const latestInjectReason = latestInject?.promptFreshnessReason ?? promptReason;
    const latestInjectDiagnostics =
        latestInject?.diagnostics && typeof latestInject.diagnostics === 'object' ? latestInject.diagnostics : null;
    const latestInjectRuntimeDialog =
        latestInjectDiagnostics?.['runtimeDialog'] && typeof latestInjectDiagnostics['runtimeDialog'] === 'object'
            ? /** @type {Record<string, unknown>} */ (latestInjectDiagnostics['runtimeDialog'])
            : null;
    const latestInjectPreflightMs =
        typeof latestInjectDiagnostics?.['preflightDurationMs'] === 'number'
            ? latestInjectDiagnostics['preflightDurationMs']
            : null;
    const latestInjectContextMs =
        typeof latestInjectDiagnostics?.['contextEmbeddingDurationMs'] === 'number'
            ? latestInjectDiagnostics['contextEmbeddingDurationMs']
            : null;
    const latestInjectAttachmentsMs =
        typeof latestInjectDiagnostics?.['attachmentEmbeddingDurationMs'] === 'number'
            ? latestInjectDiagnostics['attachmentEmbeddingDurationMs']
            : null;
    const latestInjectDialogMs =
        typeof latestInjectDiagnostics?.['dialogDurationMs'] === 'number'
            ? latestInjectDiagnostics['dialogDurationMs']
            : null;
    const latestInjectAutoStart =
        typeof latestInjectRuntimeDialog?.['autoStarted'] === 'boolean'
            ? latestInjectRuntimeDialog['autoStarted']
            : null;
    const latestInjectRecovery =
        typeof latestInjectRuntimeDialog?.['recoveredInputChannel'] === 'boolean'
            ? latestInjectRuntimeDialog['recoveredInputChannel']
            : null;
    const latestInjectTransport =
        typeof latestInject?.transportTimeoutMs === 'number'
            ? `${latestInject.transportTimeoutMs}ms${latestInject.transportTimeoutStrategy ? ` (${latestInject.transportTimeoutStrategy})` : ''}`
            : latestInject?.transportTimeoutStrategy === 'disabled'
              ? 'desabilitado'
              : 'sem leitura';

    println('');
    println(terminalThemeHeadline('command', 'Métricas da sessão'));
    println(terminalThemeDivider(52));
    println(terminalThemeRow('Sessão', sessionId, { role: 'muted' }));
    println(terminalThemeRow('Runtime alvo', renderMetricRuntimeTarget(projection.runtimeId, detail), { role: 'muted' }));
    println(terminalThemeRow('Sessão SDK', renderMetricBinding(binding.sdkSessionId, detail, 'ativa'), { role: 'muted' }));
    println(terminalThemeRow('Sessão hub', renderMetricBinding(binding.hubSessionId, detail, 'ativa'), { role: 'muted' }));
    println(terminalThemeRow('Status', humanMetricStatus(status), { role: 'info' }));
    println(terminalThemeRow('Modelo', String(model), { role: 'assistant' }));
    println(terminalThemeRow('Modo SDK', humanMetricSdkMode(configProjection.sdkSessionMode), { role: 'muted' }));
    println(terminalThemeRow('Plano', configProjection.sdkPlanOperation ?? '(sem alterações)', { role: 'muted' }));

    println(terminalThemeHeadline('command', 'Uso'));
    println(terminalThemeRow('Turnos', `${turnCount} ${terminalThemeText('muted', '(timeline canônica)')}`, { role: 'info' }));
    println(terminalThemeRow('Timeline', `${bridgeTurnCount} ${terminalThemeText('muted', `(${timelineSource} · ${timelineAuthority} · ${timelineReconciliationStatus})`)}`, { role: 'info' }));
    println(terminalThemeRow('Sincronização', `${timelineSyncStatus} ${terminalThemeText('muted', `(pendentes ${timelineSyncPendingCount} · agendados ${timelineSyncTelemetry.scheduledTotal} · gravados ${timelineSyncTelemetry.turnsSyncedTotal} · falhas ${timelineSyncTelemetry.failedTotal} · retentativas ${timelineSyncTelemetry.retryTotal} · cache ${timelineSyncTelemetry.completedCacheSize}/${timelineSyncTelemetry.failureCacheSize})`)}`, { role: 'info' }));
    println(terminalThemeRow('Contexto', ctxStr, { role: 'info' }));
    println(terminalThemeRow('Cobrança', billingLine, { role: 'info' }));
    println(
        terminalThemeRow(
            'Prompt',
            detail
                ? `${promptLabel} ${terminalThemeText('muted', `(digest ${promptDigest ?? '-'} · ação ${promptActionLabel})`)}`
                : `${promptLabel} ${terminalThemeText('muted', `(ação ${promptActionLabel})`)}`,
            { role: 'info' },
        ),
    );

    println(terminalThemeHeadline('tool', 'Ferramentas'));
    println(terminalThemeRow('Chamadas', String(toolCallCount), { role: 'info' }));
    println(terminalThemeRow('Erros', toolErrorCount > 0 ? String(toolErrorCount) : '0', { role: toolErrorCount > 0 ? 'error' : 'success' }));

    println(terminalThemeHeadline('error', 'Erros'));
    println(terminalThemeRow('Total', errorStats.total > 0 ? String(errorStats.total) : '0', { role: errorStats.total > 0 ? 'error' : 'success' }));
    println(terminalThemeRow('Buffer', String(errorStats.buffered), { role: 'info' }));

    println(terminalThemeHeadline('thinking', 'Atividade'));
    println(terminalThemeRow('Fase', humanMetricStatus(activity.phase), { role: 'thinking' }));
    println(terminalThemeRow('Label', `${activity.label}${typeof activity.progress === 'number' ? ` (${activity.progress}%)` : ''}`, { role: 'thinking' }));
    println(terminalThemeRow('Detalhe', activity.detail ?? '(nenhum)', { role: activity.detail ? 'muted' : 'muted' }));

    println(terminalThemeHeadline('info', 'Streaming público'));
    println(terminalThemeRow('Deltas', `aceitos ${streamDiagnostics.counters.deltaAccepted} · normalizados ${streamDiagnostics.counters.deltaNormalized} · suprimidos ${streamDiagnostics.counters.deltaSuppressed}`, { role: 'info' }));
    println(terminalThemeRow('Causal', `aceitos ${streamDiagnostics.counters.deltaCausalAccepted} · duplicados ${streamDiagnostics.counters.deltaCausalDuplicateSuppressed} · fallback temporal ${streamDiagnostics.counters.deltaTemporalFallbackSuppressed}`, { role: 'muted' }));
    println(terminalThemeRow('Cumulativo', `normalizados ${streamDiagnostics.counters.deltaCumulativeNormalized} · suprimidos ${streamDiagnostics.counters.deltaCumulativeSuppressed} · overlap ${streamDiagnostics.counters.deltaOverlapNormalized} · sufixo dup ${streamDiagnostics.counters.deltaDuplicateSuppressed}`, { role: 'muted' }));
    println(terminalThemeRow('Final', `ok ${streamDiagnostics.counters.finalAlreadyStreamed} · sufixo ${streamDiagnostics.counters.finalSuffix} · divergências ${streamDiagnostics.counters.finalMismatch} · sem delta ${streamDiagnostics.counters.finalNoVisibleStream} · vazio ${streamDiagnostics.counters.finalEmpty}`, { role: 'info' }));

    println(terminalThemeHeadline('info', 'Registro SSE'));
    println(terminalThemeRow('Eventos', `${sseEventArchive.events} (último id ${sseEventArchive.lastEventId ?? '-'})`, { role: 'info' }));
    println(terminalThemeRow('Fila', `${sseEventArchive.queueDepth} (flush ${sseEventArchive.flushInFlight ? 'em andamento' : sseEventArchive.flushScheduled ? 'agendado' : 'ocioso'} · falhas ${sseEventArchive.failedEvents} · descartados ${sseEventArchive.droppedEvents})`, { role: 'muted' }));
    println(terminalThemeRow('Arquivo', sseEventArchive.enabled ? sseEventArchive.path ?? '(aguardando primeiro evento)' : 'desabilitado', { role: 'muted' }));
    if (sseEventArchive.error) println(terminalThemeRow('Erro SSE', sseEventArchive.error, { role: 'error' }));

    println(terminalThemeHeadline('command', 'Injeção'));
    println(terminalThemeRow('Último', latestInject ? `${humanMetricStatus(latestInjectOutcome)} · ${latestInject.durationMs}ms${latestInjectTimeout}` : '(nenhum)', { role: latestInject ? 'info' : 'muted' }));
    println(terminalThemeRow('Transporte', latestInjectTransport, { role: 'muted' }));
    println(terminalThemeRow('Prompt', detail ? `${latestInjectPrompt} · ${latestInjectFreshness}` : humanMetricPromptState(latestInjectFreshness), { role: 'muted' }));
    println(terminalThemeRow('Motivo', latestInjectReason, { role: 'muted' }));
    println(terminalThemeRow('Fases', `checagem ${latestInjectPreflightMs ?? '-'}ms · contexto ${latestInjectContextMs ?? '-'}ms · anexos ${latestInjectAttachmentsMs ?? '-'}ms · diálogo ${latestInjectDialogMs ?? '-'}ms`, { role: 'muted' }));
    println(terminalThemeRow('Runtime', `auto-início ${yesNoPt(latestInjectAutoStart)} · recuperação ${yesNoPt(latestInjectRecovery)}`, { role: 'muted' }));
    println(terminalThemeDivider(52));
}
