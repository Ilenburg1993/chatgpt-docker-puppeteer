// @ts-check
/**
 * src/copilot/bootstrap.js — Entry point canônico do módulo copilot.
 *
 * Inicializa o DI container, registra módulos por camada e delega para o modo selecionado:
 * - `terminal` → `terminal/index.js` (Terminal Permanente LLM-B)
 * - `server`   → retorna bridge para Express (rotas /api/copilot/*)
 * - `agent`    → `agent/lifecycle/entry.js` (PM2 copilot-sdk-agent loop)
 *
 * Boot sequence:
 *   Phase 0 — Kernel: container + L0 tokens (already at module load)
 *   Phase 1 — Observability: loggers, error tracker, EventBus
 *   Phase 2 — Late deps: tools builder, audit bus
 *   Phase 3 — Mode-specific delegation
 *
 * @module copilot/bootstrap
 */

import { container } from './core/di-container.js';
import { AUDIT_BUS } from './core/di-tokens.js';
import { bootstrapLateDeps, bootstrapObservability } from './observability/bootstrap.js';
import { log } from './observability/logger.js';

/** @type {boolean} */
let _booted = false;

/**
 * @typedef {'terminal' | 'server' | 'agent'} CopilotBootMode
 */

/**
 * @typedef {object} ServerContext
 * @property {any} [io] Socket.IO server instance (modo server)
 * @property {any} [nerv] NERV event bus instance (modo server)
 */

/**
 * @typedef {object} BootOptions
 * @property {CopilotBootMode} mode Modo de operação.
 * @property {ServerContext} [context] Objetos do server — relevante apenas para mode='server'.
 */

/**
 * Inicializa o módulo copilot com boot sequencial por camadas.
 *
 * Idempotente — chamadas subsequentes são ignoradas com log de aviso.
 *
 * @param {BootOptions} options
 * @returns {Promise<void>}
 */
export async function bootCopilot({ mode, context }) {
    if (_booted) {
        log('WARN', '[bootstrap] bootCopilot já executado — ignorando chamada duplicada.');
        return;
    }
    _booted = true;

    log('INFO', `[bootstrap] Iniciando copilot em modo "${mode}"…`);

    // ── Phase 1: Observability ──────────────────────────────────────────
    // DI tokens L0 (loggers, event bus, error tracking, shutdown handlers)
    bootstrapObservability();

    // ── Phase 2: Late deps ──────────────────────────────────────────────
    // Tools builder + audit bus — requer módulos L2+
    const { buildTool } = await import('./tools/index.js');
    bootstrapLateDeps({ buildTool });

    const { defaultBus } = await import('./hooks/bus.js');
    container.register(AUDIT_BUS, () => defaultBus, 'singleton');

    const { setAuditBus } = await import('./audit/pipeline-permission.js');
    setAuditBus(defaultBus);

    // ── Phase 3: Mode-specific ──────────────────────────────────────────
    if (mode === 'terminal') {
        const { startTerminalServer } = await import('./terminal/index.js');
        await startTerminalServer();
    } else if (mode === 'agent') {
        const { startAgentLoop } = await import('./agent/lifecycle/entry.js');
        await startAgentLoop();
    } else if (mode === 'server') {
        if (context?.io || context?.nerv) {
            const { wireServerCopilot } = await import('./server/wiring.js');
            await wireServerCopilot(context);
        }
        log('INFO', '[bootstrap] Modo server — copilot integrado.');
    } else {
        throw new Error(`[bootstrap] Modo desconhecido: "${mode}". Use 'terminal', 'server' ou 'agent'.`);
    }
}
