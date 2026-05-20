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
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {object} MetricsContext
 * @property {(text: string) => void} println
 */

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

    // ── Token context ────────────────────────────────────────────────
    let ctxStr = '\x1b[90m(sem dados)\x1b[0m';
    if (contextWindow) {
        const tokens = contextWindow.tokens;
        const limit = contextWindow.tokenLimit;
        const pct = limit > 0 ? ((tokens / limit) * 100).toFixed(1) : '?';
        const pctNum = Number(pct);
        const color = pctNum > 80 ? '\x1b[31m' : pctNum > 60 ? '\x1b[33m' : '\x1b[32m';
        ctxStr = `${color}${pct}%\x1b[0m (${tokens.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')})`;
    }

    // ── Billing ──────────────────────────────────────────────────────
    const lastModel = modelBilling.mismatch
        ? `cfg=${modelBilling.configuredModel ?? '-'} · cobrado=${modelBilling.billedModel ?? '-'}`
        : modelBilling.displayModel;
    const costStr = modelBilling.cost === null ? '-' : `$${modelBilling.cost.toFixed(4)}`;
    const billingStatus = modelBilling.mismatch ? '\x1b[31mmismatch\x1b[0m' : '\x1b[32mok\x1b[0m';
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
    const promptLabel =
        promptIsStale === true
            ? '\x1b[31mstale\x1b[0m'
            : promptAction === 'observe-live-reload'
              ? '\x1b[33mlive-reload\x1b[0m'
              : promptIsStale === false
                ? '\x1b[32mok\x1b[0m'
                : '\x1b[90m(n/d)\x1b[0m';
    const latestInjectOutcome = latestInject?.outcome ?? (latestInject?.ok ? 'completed' : 'error');
    const latestInjectTimeout =
        typeof latestInject?.timeoutMs === 'number'
            ? ` / timeout=${latestInject.timeoutMs}ms${latestInject.timeoutStrategy ? ` (${latestInject.timeoutStrategy})` : ''}`
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

    println(`
  \x1b[36mMétricas da Sessão\x1b[0m
  ═════════════════════════════════════
  sessão      \x1b[90m${sessionId}\x1b[0m
    runtime id   \x1b[90m${projection.runtimeId}\x1b[0m
    sdk sessão  \x1b[90m${binding.sdkSessionId ?? '(sem sdk)'}\x1b[0m
    hub sessão  \x1b[90m${binding.hubSessionId ?? '(sem hub)'}\x1b[0m
  status      ${status}
  modelo      \x1b[36m${model}\x1b[0m
  modo sdk    ${configProjection.sdkSessionMode ?? 'interactive'}
  plan file   ${configProjection.sdkPlanOperation ?? '(sem alterações)'}

  \x1b[35m📊 Uso\x1b[0m
  ─────────────────────────────────────
  turns       ${turnCount} \x1b[90m(timeline canônica)\x1b[0m
  bridge/live ${bridgeTurnCount} \x1b[90m(${timelineSource} · ${timelineAuthority} · ${timelineReconciliationStatus})\x1b[0m
  sync Hub    ${timelineSyncStatus} \x1b[90m(pendentes=${timelineSyncPendingCount} · agendados=${timelineSyncTelemetry.scheduledTotal} · gravados=${timelineSyncTelemetry.turnsSyncedTotal} · falhas=${timelineSyncTelemetry.failedTotal} · retries=${timelineSyncTelemetry.retryTotal} · cache=${timelineSyncTelemetry.completedCacheSize}/${timelineSyncTelemetry.failureCacheSize})\x1b[0m
  contexto    ${ctxStr}
  último PR   ${lastModel} · ${costStr} · ${billingStatus}
  prompt      ${promptLabel} \x1b[90m(digest=${promptDigest ?? '-'} · ação=${promptAction})\x1b[0m

  \x1b[35m🔧 Ferramentas\x1b[0m
  ─────────────────────────────────────
  chamadas    ${toolCallCount}
  erros       ${toolErrorCount > 0 ? `\x1b[31m${toolErrorCount}\x1b[0m` : '\x1b[32m0\x1b[0m'}

  \x1b[35m⚠️  Erros\x1b[0m
  ─────────────────────────────────────
  total       ${errorStats.total > 0 ? `\x1b[31m${errorStats.total}\x1b[0m` : '\x1b[32m0\x1b[0m'}
  buffer      ${errorStats.buffered}

  \x1b[35m🎛️  Atividade\x1b[0m
  ─────────────────────────────────────
  fase        ${activity.phase}
  label       ${activity.label}${typeof activity.progress === 'number' ? ` (${activity.progress}%)` : ''}
  detalhe     ${activity.detail ?? '\x1b[90m(nenhum)\x1b[0m'}

  \x1b[35m🌊 Streaming público\x1b[0m
  ─────────────────────────────────────
  deltas      aceitos=${streamDiagnostics.counters.deltaAccepted} · normalizados=${streamDiagnostics.counters.deltaNormalized} · suprimidos=${streamDiagnostics.counters.deltaSuppressed}
    causal      \x1b[90maceitos=${streamDiagnostics.counters.deltaCausalAccepted} · duplicados=${streamDiagnostics.counters.deltaCausalDuplicateSuppressed} · fallback temporal=${streamDiagnostics.counters.deltaTemporalFallbackSuppressed}\x1b[0m
    cumulativo  \x1b[90mnormalizados=${streamDiagnostics.counters.deltaCumulativeNormalized} · suprimidos=${streamDiagnostics.counters.deltaCumulativeSuppressed} · overlap=${streamDiagnostics.counters.deltaOverlapNormalized} · sufixo dup=${streamDiagnostics.counters.deltaDuplicateSuppressed}\x1b[0m
  final       ok=${streamDiagnostics.counters.finalAlreadyStreamed} · sufixo=${streamDiagnostics.counters.finalSuffix} · mismatch=${streamDiagnostics.counters.finalMismatch} · sem-delta=${streamDiagnostics.counters.finalNoVisibleStream} · vazio=${streamDiagnostics.counters.finalEmpty}

  \x1b[35m🧾 Archive SSE\x1b[0m
  ─────────────────────────────────────
  eventos     ${sseEventArchive.events} \x1b[90m(lastId=${sseEventArchive.lastEventId ?? '-'})\x1b[0m
  fila        ${sseEventArchive.queueDepth} \x1b[90m(flush=${sseEventArchive.flushInFlight ? 'inflight' : sseEventArchive.flushScheduled ? 'scheduled' : 'idle'} · falhas=${sseEventArchive.failedEvents} · dropped=${sseEventArchive.droppedEvents})\x1b[0m
  arquivo     \x1b[90m${sseEventArchive.enabled ? sseEventArchive.path ?? '(aguardando primeiro evento)' : 'desabilitado'}\x1b[0m${sseEventArchive.error ? `\n  erro        \x1b[31m${sseEventArchive.error}\x1b[0m` : ''}

  \x1b[35m🚀 Inject\x1b[0m
  ─────────────────────────────────────
  último      ${latestInject ? `${latestInjectOutcome} · ${latestInject.durationMs}ms${latestInjectTimeout}` : '\x1b[90m(nenhum)\x1b[0m'}
    transporte  \x1b[90m${latestInjectTransport}\x1b[0m
  prompt      \x1b[90m${latestInjectPrompt} · ${latestInjectFreshness}\x1b[0m
  motivo      \x1b[90m${latestInjectReason}\x1b[0m
    fases       \x1b[90mpreflight=${latestInjectPreflightMs ?? '-'}ms · context=${latestInjectContextMs ?? '-'}ms · attachments=${latestInjectAttachmentsMs ?? '-'}ms · dialog=${latestInjectDialogMs ?? '-'}ms\x1b[0m
    runtime     \x1b[90mautostart=${latestInjectAutoStart === null ? 'n/d' : latestInjectAutoStart ? 'yes' : 'no'} · recovery=${latestInjectRecovery === null ? 'n/d' : latestInjectRecovery ? 'yes' : 'no'}\x1b[0m
  ═════════════════════════════════════
`);
}
