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
        contextWindow,
        toolCallCount,
        toolErrorCount,
        errorStats,
        binding,
        runtimeSessionId,
        activity,
        modelBilling,
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
  contexto    ${ctxStr}
  último PR   ${lastModel} · ${costStr} · ${billingStatus}

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
  ═════════════════════════════════════
`);
}
