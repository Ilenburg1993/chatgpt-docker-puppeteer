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
import {
    assertCopilotBootSurfaces,
    createCopilotBootPlan,
    readCopilotBootConfig,
    runCopilotBootPlan,
} from '#copilot/boot';
import { EVENT_BUS, SHUTDOWN_LOGGER } from '#copilot/core';
import { HOOKS_LOGGER } from '#copilot/hooks';
import { ERROR_TRACKER } from '#copilot/observability';
import { SDK_LOGGER, TOOLS_BUILDER, checkAuthStatus, createCopilotClient } from '#copilot/sdk';
import { TOOLS_LOGGER, TOOLS_METRICS } from '#copilot/tools';
import { runCopilotSdkBootPreflight } from './agent/lifecycle/process-host/runtime-host.js';
import { COPILOT_MODEL, PING_TIMEOUT_MS } from './config/agent.js';
import { container } from './core/di-container.js';
import { bootstrapLateDeps, bootstrapObservability } from './observability/bootstrap.js';
import { log } from './observability/logger.js';
import { startCopilotServer } from './server/index.js';

/** @type {boolean} */
let _booted = false;

/**
 * Reseta a trava de boot para permitir nova tentativa em testes.
 *
 * **Uso exclusivo em testes** — não chamar em código de produção.
 *
 * @returns {void}
 */
export function resetBootFlagForTests() {
    _booted = false;
}

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
        /**
         * @type {{
         *     bootPreflight:
         *         | import('./agent/lifecycle/process-host/runtime-host.js').CopilotSdkBootPreflightReport
         *         | null;
         *     startTodoCleanupJob: null | typeof import('./tools/todo/store.js').startTodoCleanupJob;
         *     wireRuntime: null | (() => void);
         *     terminal: null | typeof import('./terminal/index.js');
         *     terminalContext: null | import('./terminal/index.js').TerminalBootContext;
         * }}
         */
        const bootState = {
            bootPreflight: null,
            startTodoCleanupJob: null,
            wireRuntime: null,
            terminal: null,
            terminalContext: null,
        };

        log(
            'INFO',
            `[bootstrap] Iniciando copilot (modo ${bootConfig.mode}) em ${bootConfig.workspace.root} -> ${bootConfig.server.url}.`,
        );

        /**
         * @type {Record<
         *     string,
         *     | import('./boot/lifecycle-runner.js').BootPhaseHandler
         *     | ((context: import('./boot/lifecycle-runner.js').BootPhaseRunContext) => void | Promise<void>)
         * >}
         */
        const phaseHandlers = {
            observability: async () => {
                bootstrapObservability();
                container.resolve(ERROR_TRACKER).registerGlobalHandlers();
            },
            'late-deps': async () => {
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
            },
            'sdk-preflight': async () => {
                bootState.bootPreflight = await runCopilotSdkBootPreflight({
                    createClient: () => createCopilotClient(),
                    checkAuthStatus,
                    configuredModel: COPILOT_MODEL,
                    pingTimeoutMs: PING_TIMEOUT_MS,
                    log,
                });
            },
            'runtime-wiring': async () => {
                const [{ wireCopilotRuntimeDI }, terminal, { startTodoCleanupJob }] = await Promise.all([
                    import('./runtime-wiring.js'),
                    import('./terminal/index.js'),
                    import('./tools/todo/store.js'),
                ]);

                // GAP-BOOT-01: registrar/validar tokens do terminal ANTES do boot do servidor.
                // wireCopilotRuntimeDI() é idempotente; startTerminalServer() recebe só a função de composição.
                const wireRuntime = () => wireCopilotRuntimeDI({ broadcastSse: startTerminalServerBroadcast });
                bootState.wireRuntime = wireRuntime;
                bootState.terminal = terminal;
                bootState.startTodoCleanupJob = startTodoCleanupJob;
                bootState.terminalContext = terminal.createTerminalBootContext({
                    startCopilotServer,
                    wireRuntime,
                    startTodoCleanupJob,
                    bootConfig,
                    ...(bootState.bootPreflight ? { bootPreflight: bootState.bootPreflight } : {}),
                });
            },
            'boot-surface-validation': async () => {
                if (!bootState.terminal) {
                    throw new Error('[bootstrap] runtime-wiring não carregou a superfície terminal.');
                }
                const [coreSurface, sdkSurface, agentSurface] = await Promise.all([
                    import('#copilot/core'),
                    import('#copilot/sdk'),
                    import('#copilot/agent'),
                ]);
                const report = assertCopilotBootSurfaces({
                    core: coreSurface,
                    sdk: sdkSurface,
                    agent: agentSurface,
                    terminal: bootState.terminal,
                    plan: bootPlan,
                    phaseHandlers,
                });
                log(
                    'DEBUG',
                    `[bootstrap] Superfícies de boot validadas: ${report.groups
                        .map((group) => `${group.name}:${group.available.length}/${group.expected.length}`)
                        .join(' ')}`,
                );
            },
            'terminal-init': async () => {
                if (!bootState.terminal || !bootState.terminalContext) {
                    throw new Error('[bootstrap] runtime-wiring não produziu dependências do terminal.');
                }
                log('DEBUG', `[bootstrap] Plano de boot: ${bootPlan.phases.map((phase) => phase.id).join(' -> ')}`);
                await bootState.terminal.runTerminalInitPhase(bootState.terminalContext);
            },
            'terminal-aliases': async () => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalAliasesPhase(ctx);
            },
            'terminal-runtime-config': async () => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalRuntimeConfigPhase(ctx);
            },
            'terminal-pinned-context': async (
                /** @type {import('./boot/lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
            ) => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalPinnedContextPhase(ctx);
                bootPhase?.registerRollback('pinned-context', () => terminal.rollbackTerminalPinnedContextPhase(ctx));
            },
            'terminal-conversation-hub': async () => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalConversationHubPhase(ctx);
            },
            'copilot-http-server': async (
                /** @type {import('./boot/lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
            ) => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalHttpServerPhase(ctx);
                bootPhase?.registerRollback('http-server', () => terminal.rollbackTerminalHttpServerPhase(ctx));
            },
            'terminal-runtime-listeners': async (
                /** @type {import('./boot/lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
            ) => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalRuntimeListenersPhase(ctx);
                bootPhase?.registerRollback('runtime-listeners', () =>
                    terminal.rollbackTerminalRuntimeListenersPhase(ctx),
                );
            },
            repl: async () => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalReplPhase(ctx);
            },
        };

        await runCopilotBootPlan(bootPlan, {
            emit: emitBootLifecycleEvent,
            log,
            phaseHandlers,
        });
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

/**
 * @param {{ type: string; timestamp: number; [key: string]: unknown }} event
 * @returns {void}
 */
function emitBootLifecycleEvent(event) {
    if (!container.has(EVENT_BUS)) return;
    const bus = container.resolve(EVENT_BUS);
    bus?.emit(event);
}

/**
 * @param {{
 *     terminal: null | typeof import('./terminal/index.js');
 *     terminalContext: null | import('./terminal/index.js').TerminalBootContext;
 * }} bootState
 * @returns {{
 *     terminal: typeof import('./terminal/index.js');
 *     ctx: import('./terminal/index.js').TerminalBootContext;
 * }}
 */
function requireTerminalBootState(bootState) {
    if (!bootState.terminal || !bootState.terminalContext) {
        throw new Error('[bootstrap] terminal boot context indisponível.');
    }
    return { terminal: bootState.terminal, ctx: bootState.terminalContext };
}
