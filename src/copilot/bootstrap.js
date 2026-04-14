// @ts-check
/**
 * src/copilot/bootstrap.js — Entry point canônico do módulo copilot.
 *
 * Modo único: **terminal** (ferramenta de desenvolvimento).
 *
 * O copilot é a LLM-B — uma ferramenta de desenvolvimento equivalente ao DevTools.
 * Não é um addon de produção. Sempre boot via terminal com inject server (:3009).
 *
 * Boot sequence:
 *   Phase 0 — Kernel: container + L0 tokens (already at module load)
 *   Phase 1 — Observability: loggers, error tracker, EventBus
 *   Phase 2 — Late deps: tools builder, audit bus
 *   Phase 3 — Terminal: startTerminalServer()
 *
 * @module copilot/bootstrap
 */

import { container } from './core/di-container.js';
import { AUDIT_BUS } from './audit/di-tokens.js';
import { bootstrapLateDeps, bootstrapObservability } from './observability/bootstrap.js';
import { log } from './observability/logger.js';

/** @type {boolean} */
let _booted = false;

/**
 * Inicializa o módulo copilot (modo terminal — único modo canônico).
 *
 * Idempotente — chamadas subsequentes são ignoradas com log de aviso.
 *
 * @returns {Promise<void>}
 */
export async function bootCopilot() {
    if (_booted) {
        log('WARN', '[bootstrap] bootCopilot já executado — ignorando chamada duplicada.');
        return;
    }
    _booted = true;

    log('INFO', '[bootstrap] Iniciando copilot (modo terminal)…');

    // ── Phase 1: Observability ──────────────────────────────────────────
    bootstrapObservability();

    // ── Phase 2: Late deps ──────────────────────────────────────────────
    const { buildTool } = await import('./tools/index.js');
    bootstrapLateDeps({ buildTool });

    const { defaultBus } = await import('./hooks/bus.js');
    container.register(AUDIT_BUS, () => defaultBus, 'singleton');

    const { setAuditBus } = await import('./audit/pipeline-permission.js');
    setAuditBus(defaultBus);

    // ── Phase 3: Terminal (único modo) ──────────────────────────────────
    const { startTerminalServer } = await import('./terminal/index.js');
    await startTerminalServer();
}
