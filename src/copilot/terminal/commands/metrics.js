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
    if (status === 'error' || status === 'failed') return 'falhou';
    if (status === 'pending') return 'pendente';
    return status || 'n/d';
}

/**
 * Exibe métricas consolidadas da sessão.
 *
 * @param {MetricsContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdMetrics({ println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
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
    const sessionId = runtimeSessionId ?? '?';
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
            ? terminalThemeText('error', 'stale')
            : promptAction === 'observe-live-reload'
              ? terminalThemeText('warn', 'live-reload')
              : promptIsStale === false
                ? terminalThemeText('success', 'ok')
                : terminalThemeText('muted', '(n/d)');
    const latestInjectOutcome = latestInject?.outcome ?? (latestInject?.ok ? 'completed' : 'error');
    const latestInjectTimeout =
        typeof latestInject?.timeoutMs === 'number'
            ? ` / timeout ${latestInject.timeoutMs}ms${latestInject.timeoutStrategy ? ` (${latestInject.timeoutStrategy})` : ''}`
            : '';
    const latestInjectPrompt = latestInject?.promptDigest ?? promptDigest ?? '-';
    const latestInjectFreshness =
        latestInject?.promptIsStale === true
            ? 'stale'
            : latestInject?.promptRecommendedAction === 'observe-live-reload'
              ? 'live-reload'
              : latestInject?.promptIsStale === false
                ? 'ok'
                : 'n/d';
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
              ? `disabled (${latestInject.transportTimeoutStrategy})`
              : 'n/d';

    println('');
    println(terminalThemeHeadline('command', 'Métricas da sessão'));
    println(terminalThemeDivider(52));
    println(terminalThemeRow('Sessão', sessionId, { role: 'muted' }));
    println(terminalThemeRow('runtime alvo', projection.runtimeId, { role: 'muted' }));
    println(terminalThemeRow('sessão SDK', binding.sdkSessionId ?? '(sem sdk)', { role: 'muted' }));
    println(terminalThemeRow('sessão hub', binding.hubSessionId ?? '(sem hub)', { role: 'muted' }));
    println(terminalThemeRow('Status', String(status), { role: 'info' }));
    println(terminalThemeRow('Modelo', String(model), { role: 'assistant' }));
    println(terminalThemeRow('modo sdk', configProjection.sdkSessionMode ?? 'interactive', { role: 'muted' }));
    println(terminalThemeRow('Plano', configProjection.sdkPlanOperation ?? '(sem alterações)', { role: 'muted' }));

    println(terminalThemeHeadline('command', 'Uso'));
    println(terminalThemeRow('Turns', `${turnCount} ${terminalThemeText('muted', '(timeline canônica)')}`, { role: 'info' }));
    println(terminalThemeRow('bridge/live', `${bridgeTurnCount} ${terminalThemeText('muted', `(${timelineSource} · ${timelineAuthority} · ${timelineReconciliationStatus})`)}`, { role: 'info', width: 11 }));
    println(terminalThemeRow('Sync Hub', `${timelineSyncStatus} ${terminalThemeText('muted', `(pendentes ${timelineSyncPendingCount} · agendados ${timelineSyncTelemetry.scheduledTotal} · gravados ${timelineSyncTelemetry.turnsSyncedTotal} · falhas ${timelineSyncTelemetry.failedTotal} · retentativas ${timelineSyncTelemetry.retryTotal} · cache ${timelineSyncTelemetry.completedCacheSize}/${timelineSyncTelemetry.failureCacheSize})`)}`, { role: 'info' }));
    println(terminalThemeRow('Contexto', ctxStr, { role: 'info' }));
    println(terminalThemeRow('Billing', billingLine, { role: 'info' }));
    println(terminalThemeRow('Prompt', `${promptLabel} ${terminalThemeText('muted', `(digest ${promptDigest ?? '-'} · ação ${promptActionLabel})`)}`, { role: 'info' }));

    println(terminalThemeHeadline('tool', 'Ferramentas'));
    println(terminalThemeRow('Chamadas', String(toolCallCount), { role: 'info' }));
    println(terminalThemeRow('Erros', toolErrorCount > 0 ? String(toolErrorCount) : '0', { role: toolErrorCount > 0 ? 'error' : 'success' }));

    println(terminalThemeHeadline('error', 'Erros'));
    println(terminalThemeRow('Total', errorStats.total > 0 ? String(errorStats.total) : '0', { role: errorStats.total > 0 ? 'error' : 'success' }));
    println(terminalThemeRow('Buffer', String(errorStats.buffered), { role: 'info' }));

    println(terminalThemeHeadline('thinking', 'Atividade'));
    println(terminalThemeRow('Fase', String(activity.phase), { role: 'thinking' }));
    println(terminalThemeRow('Label', `${activity.label}${typeof activity.progress === 'number' ? ` (${activity.progress}%)` : ''}`, { role: 'thinking' }));
    println(terminalThemeRow('Detalhe', activity.detail ?? '(nenhum)', { role: activity.detail ? 'muted' : 'muted' }));

    println(terminalThemeHeadline('info', 'Streaming público'));
    println(terminalThemeRow('Deltas', `aceitos ${streamDiagnostics.counters.deltaAccepted} · normalizados ${streamDiagnostics.counters.deltaNormalized} · suprimidos ${streamDiagnostics.counters.deltaSuppressed}`, { role: 'info' }));
    println(terminalThemeRow('Causal', `aceitos ${streamDiagnostics.counters.deltaCausalAccepted} · duplicados ${streamDiagnostics.counters.deltaCausalDuplicateSuppressed} · fallback temporal ${streamDiagnostics.counters.deltaTemporalFallbackSuppressed}`, { role: 'muted' }));
    println(terminalThemeRow('Cumulativo', `normalizados ${streamDiagnostics.counters.deltaCumulativeNormalized} · suprimidos ${streamDiagnostics.counters.deltaCumulativeSuppressed} · overlap ${streamDiagnostics.counters.deltaOverlapNormalized} · sufixo dup ${streamDiagnostics.counters.deltaDuplicateSuppressed}`, { role: 'muted' }));
    println(terminalThemeRow('Final', `ok ${streamDiagnostics.counters.finalAlreadyStreamed} · sufixo ${streamDiagnostics.counters.finalSuffix} · divergências ${streamDiagnostics.counters.finalMismatch} · sem delta ${streamDiagnostics.counters.finalNoVisibleStream} · vazio ${streamDiagnostics.counters.finalEmpty}`, { role: 'info' }));

    println(terminalThemeHeadline('info', 'Archive SSE'));
    println(terminalThemeRow('Eventos', `${sseEventArchive.events} (último id ${sseEventArchive.lastEventId ?? '-'})`, { role: 'info' }));
    println(terminalThemeRow('Fila', `${sseEventArchive.queueDepth} (flush ${sseEventArchive.flushInFlight ? 'em andamento' : sseEventArchive.flushScheduled ? 'agendado' : 'ocioso'} · falhas ${sseEventArchive.failedEvents} · descartados ${sseEventArchive.droppedEvents})`, { role: 'muted' }));
    println(terminalThemeRow('Arquivo', sseEventArchive.enabled ? sseEventArchive.path ?? '(aguardando primeiro evento)' : 'desabilitado', { role: 'muted' }));
    if (sseEventArchive.error) println(terminalThemeRow('Erro SSE', sseEventArchive.error, { role: 'error' }));

    println(terminalThemeHeadline('command', 'Inject'));
    println(terminalThemeRow('Último', latestInject ? `${humanMetricStatus(latestInjectOutcome)} · ${latestInject.durationMs}ms${latestInjectTimeout}` : '(nenhum)', { role: latestInject ? 'info' : 'muted' }));
    println(terminalThemeRow('transporte', latestInjectTransport, { role: 'muted' }));
    println(terminalThemeRow('Prompt', `${latestInjectPrompt} · ${latestInjectFreshness}`, { role: 'muted' }));
    println(terminalThemeRow('Motivo', latestInjectReason, { role: 'muted' }));
    println(terminalThemeRow('Fases', `preflight ${latestInjectPreflightMs ?? '-'}ms · contexto ${latestInjectContextMs ?? '-'}ms · anexos ${latestInjectAttachmentsMs ?? '-'}ms · diálogo ${latestInjectDialogMs ?? '-'}ms`, { role: 'muted' }));
    println(terminalThemeRow('Runtime', `autostart ${yesNoPt(latestInjectAutoStart)} · recuperação ${yesNoPt(latestInjectRecovery)}`, { role: 'muted' }));
    println(terminalThemeDivider(52));
}
