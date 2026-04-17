// @ts-check
/**
 * src/copilot/terminal/commands/metrics.js
 *
 * Comando `/metrics` — exibe métricas consolidadas de performance e uso da sessão.
 *
 * @module copilot/terminal/commands/metrics
 * @see EventBus
 */

import { readTerminalMetricsProjection } from '../frontend/index.js';

/**
 * @typedef {object} MetricsContext
 * @property {(text: string) => void} println
 */

/**
 * Exibe métricas consolidadas da sessão.
 *
 * @param {MetricsContext} ctx
 * @returns {void}
 */
export function cmdMetrics({ println }) {
    const projection = readTerminalMetricsProjection();
    const { snap, pr, turnCount, contextWindow, toolCallCount, toolErrorCount, errorStats, binding, runtimeSessionId } =
        projection;

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
    const lastModel = pr?.['model'] ?? '-';
    const lastCost = pr?.['cost'];
    const costStr = typeof lastCost === 'number' ? `$${lastCost.toFixed(4)}` : '-';

    println(`
  \x1b[36mMétricas da Sessão\x1b[0m
  ═════════════════════════════════════
  sessão      \x1b[90m${sessionId}\x1b[0m
    sdk sessão  \x1b[90m${binding.sdkSessionId ?? '(sem sdk)'}\x1b[0m
    hub sessão  \x1b[90m${binding.hubSessionId ?? '(sem hub)'}\x1b[0m
  status      ${status}
  modelo      \x1b[36m${model}\x1b[0m

  \x1b[35m📊 Uso\x1b[0m
  ─────────────────────────────────────
  turns       ${turnCount}
  contexto    ${ctxStr}
  último PR   ${lastModel} · ${costStr}

  \x1b[35m🔧 Ferramentas\x1b[0m
  ─────────────────────────────────────
  chamadas    ${toolCallCount}
  erros       ${toolErrorCount > 0 ? `\x1b[31m${toolErrorCount}\x1b[0m` : '\x1b[32m0\x1b[0m'}

  \x1b[35m⚠️  Erros\x1b[0m
  ─────────────────────────────────────
  total       ${errorStats.total > 0 ? `\x1b[31m${errorStats.total}\x1b[0m` : '\x1b[32m0\x1b[0m'}
  buffer      ${errorStats.buffered}
  ═════════════════════════════════════
`);
}
