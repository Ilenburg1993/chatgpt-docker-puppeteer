// @ts-check
/**
 * src/copilot/bootstrap.js — Entry point canônico do módulo copilot.
 *
 * Modo único: **terminal-runtime** (ferramenta de desenvolvimento).
 *
 * O copilot é a LLM-B — uma ferramenta de desenvolvimento equivalente ao DevTools. Não é um addon de produção. Sempre
 * boot via terminal com inject server (:3009).
 *
 * Boot sequence: Phase 0 — Kernel: container + L0 tokens (already at module load) Phase 1 — Observability: loggers,
 * error tracker, EventBus Phase 2 — Late deps: tools builder, audit bus Phase 3 — Runtime wiring Phase 4 — Terminal
 * host
 *
 * - Copilot HTTP server Phase 5 — REPL
 *
 * @module copilot/bootstrap
 */

import { AUDIT_BUS } from '#copilot/audit';
import { createCopilotBootPlan, readCopilotBootConfig } from '#copilot/boot';
import { EVENT_BUS, SHUTDOWN_LOGGER } from '#copilot/core';
import { HOOKS_LOGGER } from '#copilot/hooks';
import { ERROR_TRACKER } from '#copilot/observability';
import { SDK_LOGGER, TOOLS_BUILDER, checkAuthStatus, createCopilotClient } from '#copilot/sdk';
import { TOOLS_LOGGER, TOOLS_METRICS } from '#copilot/tools';
import { runCopilotSdkBootPreflight } from './agent/lifecycle/runtime-host.js';
import { COPILOT_MODEL, PING_TIMEOUT_MS } from './config/agent.js';
import { container } from './core/di-container.js';
import { bootstrapLateDeps, bootstrapObservability } from './observability/bootstrap.js';
import { log } from './observability/logger.js';
import { startCopilotServer } from './server/index.js';

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

    try {
        const bootConfig = readCopilotBootConfig();
        const bootPlan = createCopilotBootPlan(bootConfig);

        log(
            'INFO',
            `[bootstrap] Iniciando copilot (modo ${bootConfig.mode}) em ${bootConfig.workspace.root} -> ${bootConfig.server.url}.`,
        );

        // ── Phase 1: Observability ──────────────────────────────────────────
        bootstrapObservability();
        container.resolve(ERROR_TRACKER).registerGlobalHandlers();

        // ── Phase 2: Late deps ──────────────────────────────────────────────
        const { buildTool } = await import('./tools/index.js');
        bootstrapLateDeps({ buildTool });

        const { defaultBus } = await import('./hooks/bus.js');
        container.register(AUDIT_BUS, () => defaultBus, 'singleton');

        const { setAuditBus } = await import('./audit/pipeline-permission.js');
        setAuditBus(defaultBus);

        // ── Validation: verify all critical DI tokens are registered ────────
        container.validateRequired([
            SHUTDOWN_LOGGER,
            EVENT_BUS,
            SDK_LOGGER,
            TOOLS_BUILDER,
            AUDIT_BUS,
            HOOKS_LOGGER,
            TOOLS_LOGGER,
            TOOLS_METRICS,
        ]);

        const bootPreflight = await runCopilotSdkBootPreflight({
            createClient: () => createCopilotClient(),
            checkAuthStatus,
            configuredModel: COPILOT_MODEL,
            pingTimeoutMs: PING_TIMEOUT_MS,
            log,
        });

        // ── Phase 3: Terminal (único modo) ──────────────────────────────────
        const [{ wireCopilotRuntimeDI }, { startTerminalServer }, { startTodoCleanupJob }] = await Promise.all([
            import('./runtime-wiring.js'),
            import('./terminal/index.js'),
            import('./tools/todo/store.js'),
        ]);

        // GAP-BOOT-01: registrar/validar tokens do terminal ANTES do boot do servidor.
        // wireCopilotRuntimeDI() é idempotente; startTerminalServer() recebe só a função de composição.
        const wireRuntime = () => wireCopilotRuntimeDI({ broadcastSse: startTerminalServerBroadcast });
        wireRuntime();

        log('DEBUG', `[bootstrap] Plano de boot: ${bootPlan.phases.map((phase) => phase.id).join(' -> ')}`);

        await startTerminalServer({ startCopilotServer, wireRuntime, startTodoCleanupJob, bootConfig, bootPreflight });
    } catch (error) {
        _booted = false;
        throw error;
    }
}

/**
 * Adapter tardio para evitar que `runtime-wiring` importe a borda terminal.
 *
 * @param {string} event
 * @param {unknown} [payload]
 * @returns {void}
 */
function startTerminalServerBroadcast(event, payload) {
    const data = payload && typeof payload === 'object' ? payload : { value: payload ?? null };
    void import('./terminal/dialog/index.js').then(({ broadcastSse }) => broadcastSse(event, data));
}
