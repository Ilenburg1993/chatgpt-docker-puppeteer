// @ts-check
/**
 * src/copilot/agent/lifecycle/entry.js
 *
 * Agent lifecycle mantido para compat interna.
 *
 * Inicializa o AlwaysAliveAgent e mantém o processo ativo, aguardando mensagens via sinais ou via HTTP bridge (montado
 * no dashboard-web :3008).
 *
 * **Boot sequence**: `terminal/bootstrap.js` e `copilot/bootstrap.js` são o boot canônico. Este módulo não é entrypoint
 * operacional principal.
 *
 * O "host" citado pelos helpers deste arquivo é o host de processo compatível. Ele não se confunde com os
 * `DialogHost`/`DialogLoopHost` de `agent/types.js`.
 *
 * @module copilot/agent/lifecycle/entry
 * @see EventBus
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { EVENT_BUS, bridgeEmitter, container, toError, withRetry } from '#copilot/core';
import { PluginRegistry, discoverPlugins } from '#copilot/plugins';
import {
    BOOT_MAX_RETRIES,
    COPILOT_MODEL,
    DRAIN_WRITES_TIMEOUT_MS,
    PING_TIMEOUT_MS,
    RESTART_DELAY_MS,
} from '../../config/agent.js';
import { logSwallowed } from '../../core/error-handlers.js';
import {
    EMITTER_ERROR,
    EMITTER_SESSION_FATAL,
    EMITTER_STATUS,
    HOOK_ERROR_OCCURRED,
    HOOK_POST_TOOL_USE,
    HOOK_PRE_TOOL_USE,
    HOOK_PROMPT_SUBMITTED,
    HOOK_SESSION_END,
    HOOK_SESSION_START,
} from '../../events/index.js';
import { getAgent } from '../always-alive.js';
import { checkAgentSdkAuthStatus, createAgentSdkClient } from '../facades/agent-sdk-access.js';
import { getDefaultHookBus } from '../ports/hook-port.js';
import { ERROR_TRACKER, log } from '../ports/observability-port.js';
import {
    discoverRuntimePlugins,
    registerRuntimeAgentEventHost,
    registerRuntimeIpcHost,
    registerRuntimeProcessSignals,
    registerRuntimeShutdownHost,
    runCopilotSdkBootPreflight,
} from './runtime-host.js';
import { drainStateWrites } from './state-io.js';

/**
 * Inicializa o agent lifecycle: plugin discovery, event wiring, retries, shutdown, IPC.
 *
 * Compat interno do lifecycle. O boot canônico chama `bootCopilot()` e compõe o runtime via `runtime-wiring.js`.
 *
 * @returns {Promise<void>}
 */
export async function startAgentLoop() {
    const agent = getAgent();
    const bootConfig = readCopilotBootConfig();

    // FAIXA-5A: descobrir e instalar plugins ao iniciar o processo
    discoverRuntimePlugins({
        pluginsDir: bootConfig.paths.pluginsDir,
        registry: {
            discoverPlugins: /** @type {(dir: string, registry: unknown) => Promise<unknown>} */ (discoverPlugins),
            pluginRegistry: new PluginRegistry(),
        },
        log,
    });

    // FAIXA-2A: bridge HookBus → EventBus central para observabilidade cross-module
    const _bus = container.resolve(EVENT_BUS);
    if (_bus) {
        bridgeEmitter(getDefaultHookBus(), _bus, {
            pre_tool_use: HOOK_PRE_TOOL_USE,
            post_tool_use: HOOK_POST_TOOL_USE,
            prompt_submitted: HOOK_PROMPT_SUBMITTED,
            session_start: HOOK_SESSION_START,
            session_end: HOOK_SESSION_END,
            error_occurred: HOOK_ERROR_OCCURRED,
        });
    }

    /**
     * Inicializa o agente com retry centralizado (até {@link BOOT_MAX_RETRIES} tentativas).
     *
     * @returns {Promise<void>}
     */
    async function startWithRetry() {
        try {
            await withRetry(
                async () => {
                    await agent.start();
                },
                {
                    maxAttempts: BOOT_MAX_RETRIES,
                    baseDelayMs: RESTART_DELAY_MS,
                    maxDelayMs: RESTART_DELAY_MS * 4,
                    jitter: true,
                    onRetry: (err, attempt) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        log('ERROR', `[copilot/agent] Falha ao iniciar (tentativa ${attempt}): ${msg}`);
                        log('INFO', `[copilot/agent] Tentando novamente em ~${RESTART_DELAY_MS}ms...`);
                    },
                },
            );
            log('INFO', '[copilot/agent] Agente ativo e aguardando mensagens via HTTP bridge.');
        } catch (e) {
            log('ERROR', `[copilot/agent] Máximo de tentativas atingido (${BOOT_MAX_RETRIES}). Encerrando processo.`);
            process.exitCode = 1;
            process.exit(1);
        }
    }

    const shutdown = registerRuntimeShutdownHost({
        agent,
        drainStateWrites,
        drainTimeoutMs: DRAIN_WRITES_TIMEOUT_MS,
        log,
    });
    registerRuntimeProcessSignals({ shutdown });

    // ─── Handlers de erros não tratados ──────────────────────────────────────────
    // Delegado ao error-tracker singleton que já implementa trackError + log.
    // Evita duplicação de handlers (FAIXA-0 Quick Win #2).
    container.resolve(ERROR_TRACKER).registerGlobalHandlers();

    // ─── IPC básico (G1-API-03) ───────────────────────────────────────────────────
    registerRuntimeIpcHost({
        agent,
        shutdown: (signal) => shutdown(signal).catch((e) => logSwallowed(e, 'agent.entry.ipcShutdown')),
        log,
    });

    registerRuntimeAgentEventHost({
        agent,
        events: {
            status: EMITTER_STATUS,
            error: EMITTER_ERROR,
            sessionFatal: EMITTER_SESSION_FATAL,
        },
        log,
    });

    const preflightReport = await runCopilotSdkBootPreflight({
        createClient: () => createAgentSdkClient(),
        checkAuthStatus: checkAgentSdkAuthStatus,
        configuredModel: COPILOT_MODEL,
        pingTimeoutMs: PING_TIMEOUT_MS,
        log,
    });
    if (!preflightReport.ok) {
        log(
            'WARN',
            `[copilot/agent] Preflight degradado no host compatível: ${preflightReport.warnings.join(' | ') || 'sem detalhes'}`,
        );
    } else {
        log('INFO', '[copilot/agent] Preflight SDK concluído com sucesso no host compatível.');
    }

    // Captura Promise para garantir que rejeições assíncronas não fiquem silenciosas.
    const _startPromise = startWithRetry();
    _startPromise.catch((e) => {
        log('ERROR', `[copilot/agent] startWithRetry() rejeitou: ${toError(e).message}`);
        process.exitCode = 1;
    });
}
