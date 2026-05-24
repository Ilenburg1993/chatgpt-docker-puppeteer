// @ts-check
/**
 * src/copilot/boot/runtime-bootstrap.js — orquestrador canônico do boot Copilot.
 *
 * O host terminal é injetado pela borda (`terminal/bootstrap.js`); nenhum módulo fora de `terminal/` importa a
 * superfície do terminal diretamente.
 *
 * @module copilot/boot/runtime-bootstrap
 */

import { AUDIT_BUS } from '#copilot/audit';
import {
    assertCopilotBootSurfaces,
    createCopilotBootPlan,
    readCopilotBootConfig,
    runCopilotBootPlan,
} from '#copilot/boot';
import { EVENT_BUS, SHUTDOWN_LOGGER } from '#copilot/core';
import { buildModelGatewayOnListModelsHandler } from '#copilot/model-gateway';
import { ERROR_TRACKER } from '#copilot/observability';
import {
    HOOKS_LOGGER,
    SDK_LOGGER,
    TOOLS_BUILDER,
} from '#copilot/sdk/di';
import { createCopilotClient, defaultBus as defaultHookBus } from '#copilot/sdk/session';
import { getAuthStatus as checkAuthStatus, runCopilotSdkBootPreflight } from '#copilot/sdk/telemetry';
import { TOOLS_LOGGER, TOOLS_METRICS } from '#copilot/tools';
import { COPILOT_MODEL, PING_TIMEOUT_MS } from '../config/agent.js';
import { container } from '../core/di-container.js';
import {
    bootstrapConvergencePersistence,
    bootstrapLateDeps,
    bootstrapObservability,
} from '../observability/bootstrap.js';
import { log } from '../observability/logger.js';
import { startCopilotServer } from '../server/index.js';

/** @type {boolean} */
let _booted = false;

/**
 * @returns {Partial<import('#copilot/sdk/types').CopilotClientOptions>}
 */
function buildModelGatewayClientOptions() {
    const onListModels = buildModelGatewayOnListModelsHandler(process.env);
    return onListModels ? { onListModels } : {};
}

/**
 * @typedef {{
 *     startCopilotServer: typeof import('../server/index.js').startCopilotServer;
 *     wireRuntime: () => void;
 *     startTodoCleanupJob: typeof import('../tools/todo/store.js').startTodoCleanupJob;
 *     bootConfig: ReturnType<typeof readCopilotBootConfig>;
 *     bootPreflight?: import('#copilot/sdk/types').CopilotSdkBootPreflightReport | null;
 * }} CopilotTerminalBootContextInput
 *
 *
 * @typedef {{
 *     createTerminalBootContext: (input: CopilotTerminalBootContextInput) => any;
 *     runTerminalInitPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalAliasesPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalRuntimeConfigPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalPinnedContextPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalConversationHubPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalHttpServerPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalRuntimeListenersPhase: (ctx: any) => void | Promise<void>;
 *     runTerminalReplPhase: (ctx: any) => void | Promise<void>;
 *     rollbackTerminalPinnedContextPhase: (ctx: any) => void | Promise<void>;
 *     rollbackTerminalHttpServerPhase: (ctx: any) => void | Promise<void>;
 *     rollbackTerminalRuntimeListenersPhase: (ctx: any) => void | Promise<void>;
 * }} CopilotTerminalHostSurface
 *
 *
 * @typedef {{
 *     terminal: CopilotTerminalHostSurface;
 *     broadcastSse: (event: string, payload?: unknown) => void;
 * }} CopilotRuntimeBootstrapOptions
 */

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
 * Inicializa o runtime Copilot usando um host terminal injetado pela borda.
 *
 * @param {CopilotRuntimeBootstrapOptions} options
 * @returns {Promise<void>}
 */
export async function bootCopilot(options) {
    if (!options?.terminal || typeof options.broadcastSse !== 'function') {
        throw new TypeError('[boot/runtime-bootstrap] terminal host e broadcastSse são obrigatórios.');
    }
    if (_booted) {
        log('WARN', '[bootstrap] bootCopilot já executado — ignorando chamada duplicada.');
        return;
    }
    _booted = true;

    try {
        const terminalSurface = options.terminal;
        const bootConfig = readCopilotBootConfig();
        const bootPlan = createCopilotBootPlan(bootConfig);
        /**
         * @type {{
         *     bootPreflight: import('#copilot/sdk/types').CopilotSdkBootPreflightReport | null;
         *     startTodoCleanupJob: null | typeof import('../tools/todo/store.js').startTodoCleanupJob;
         *     wireRuntime: null | (() => void);
         *     terminal: CopilotTerminalHostSurface | null;
         *     terminalContext: unknown;
         * }}
         */
        const bootState = {
            bootPreflight: null,
            startTodoCleanupJob: null,
            wireRuntime: null,
            terminal: terminalSurface,
            terminalContext: null,
        };

        log(
            'INFO',
            `[bootstrap] Iniciando copilot (modo ${bootConfig.mode}) em ${bootConfig.workspace.root} -> ${bootConfig.server.url}.`,
        );

        /**
         * @type {Record<
         *     string,
         *     | import('./lifecycle-runner.js').BootPhaseHandler
         *     | ((context: import('./lifecycle-runner.js').BootPhaseRunContext) => void | Promise<void>)
         * >}
         */
        const phaseHandlers = {
            observability: async () => {
                bootstrapObservability();
                container.resolve(ERROR_TRACKER).registerGlobalHandlers();

                try {
                    const { getCopilotDb } = await import('../db/sqlite.js');
                    bootstrapConvergencePersistence(getCopilotDb());
                } catch {
                    // SQLite indisponível não deve bloquear o boot; ring-buffer in-memory continua.
                }
            },
            'late-deps': async () => {
                const { buildTool } = await import('../tools/index.js');
                bootstrapLateDeps({ buildTool });

                container.register(AUDIT_BUS, () => defaultHookBus, 'singleton');

                const { setAuditBus } = await import('../audit/pipeline-permission.js');
                setAuditBus(defaultHookBus);

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
                    createClient: () => createCopilotClient(buildModelGatewayClientOptions()),
                    checkAuthStatus,
                    configuredModel: COPILOT_MODEL,
                    pingTimeoutMs: PING_TIMEOUT_MS,
                    log,
                });
            },
            'runtime-wiring': async () => {
                const [{ wireCopilotRuntimeDI }, { startTodoCleanupJob }] = await Promise.all([
                    import('../runtime-wiring.js'),
                    import('../tools/todo/store.js'),
                ]);

                const wireRuntime = () =>
                    wireCopilotRuntimeDI({
                        broadcastSse: (event, payload) => {
                            const data = payload && typeof payload === 'object' ? payload : { value: payload ?? null };
                            options.broadcastSse(event, data);
                        },
                    });
                bootState.wireRuntime = wireRuntime;
                bootState.startTodoCleanupJob = startTodoCleanupJob;
                bootState.terminalContext = terminalSurface.createTerminalBootContext({
                    startCopilotServer,
                    wireRuntime,
                    startTodoCleanupJob,
                    bootConfig,
                    ...(bootState.bootPreflight ? { bootPreflight: bootState.bootPreflight } : {}),
                });
            },
            'boot-surface-validation': async () => {
                const [coreSurface, sdkSurface, agentSurface] = await Promise.all([
                    import('#copilot/core'),
                    import('#copilot/sdk'),
                    import('#copilot/agent'),
                ]);
                const report = assertCopilotBootSurfaces({
                    core: coreSurface,
                    sdk: sdkSurface,
                    agent: agentSurface,
                    terminal: terminalSurface,
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
                const { terminal, ctx } = requireTerminalBootState(bootState);
                log('DEBUG', `[bootstrap] Plano de boot: ${bootPlan.phases.map((phase) => phase.id).join(' -> ')}`);
                await terminal.runTerminalInitPhase(ctx);
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
                /** @type {import('./lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
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
                /** @type {import('./lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
            ) => {
                const { terminal, ctx } = requireTerminalBootState(bootState);
                await terminal.runTerminalHttpServerPhase(ctx);
                bootPhase?.registerRollback('http-server', () => terminal.rollbackTerminalHttpServerPhase(ctx));
            },
            'terminal-runtime-listeners': async (
                /** @type {import('./lifecycle-runner.js').BootPhaseRunContext | undefined} */ bootPhase,
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
 * @param {{ type: string; timestamp: number; [key: string]: unknown }} event
 * @returns {void}
 */
function emitBootLifecycleEvent(event) {
    if (!container.has(EVENT_BUS)) return;
    const bus = container.resolve(EVENT_BUS);
    bus?.emit(event);
}

/**
 * @param {{ terminal: CopilotTerminalHostSurface | null; terminalContext: unknown }} bootState
 * @returns {{ terminal: CopilotTerminalHostSurface; ctx: unknown }}
 */
function requireTerminalBootState(bootState) {
    if (!bootState.terminal || !bootState.terminalContext) {
        throw new Error('[bootstrap] terminal boot context indisponível.');
    }
    return { terminal: bootState.terminal, ctx: bootState.terminalContext };
}
