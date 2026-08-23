// @ts-check
/**
 * src/copilot/agent/lifecycle/process-host/runtime-host.js
 *
 * Helpers do host de processo do runtime do agente.
 *
 * Aqui "host" significa a borda do processo Node que hospeda o runtime compatível do agent: sinais, IPC e shutdown. Não
 * é o mesmo "host" dos contratos internos do dialog loop, onde "host" significa um adapter estreito de capacidades.
 *
 * Este módulo não é boot canônico. Ele encapsula preocupações de processo usadas pelo entrypoint compatível
 * (`agent/lifecycle/entrypoints/entry.js`).
 *
 * @module copilot/agent/lifecycle/process-host/runtime-host
 */

import {
    PROCESS_SHUTDOWN_PHASE,
    registerApplicationShutdownHandler,
    runApplicationShutdown,
} from '#copilot/boot/process-runtime';
import { toError } from '#copilot/infra/public/platform/error';
import { readRuntimeControlState } from '../../facades/agent-runtime-controls.js';

/** @type {boolean} */
let _processSignalHandlersRegistered = false;

/** @type {boolean} */
let _ipcHandlersRegistered = false;

/** @type {WeakSet<object>} */
const _agentEventHosts = new WeakSet();

/**
 * Descobre plugins do runtime em background.
 *
 * @param {{
 *     pluginsDir: string;
 *     registry: { discoverPlugins: (dir: string, registry: unknown) => Promise<unknown>; pluginRegistry: unknown };
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {void}
 */
export function discoverRuntimePlugins({ pluginsDir, registry, log }) {
    registry.discoverPlugins(pluginsDir, registry.pluginRegistry).catch((e) => {
        log('WARN', `[copilot/runtime-host] Plugin discovery falhou (não crítico): ${toError(e).message}`);
    });
}

/**
 * Registra handlers de shutdown específicos do host compatível do agent.
 *
 * @param {{
 *     agent: { stop: () => Promise<void> };
 *     drainStateWrites: (timeoutMs: number) => Promise<void>;
 *     drainTimeoutMs: number;
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {(signal?: string) => Promise<never>}
 */
export function registerRuntimeShutdownHost({ agent, drainStateWrites, drainTimeoutMs, log }) {
    registerApplicationShutdownHandler(
        'agent.stop',
        async () => {
            try {
                await agent.stop();
                log('INFO', '[copilot/runtime-host] Agente parado.');
            } catch (e) {
                log('WARN', `[copilot/runtime-host] Erro no shutdown do agente: ${toError(e).message}`);
            }
        },
        PROCESS_SHUTDOWN_PHASE.HOST_EARLY,
    );

    registerApplicationShutdownHandler(
        'state.drain',
        async () => {
            await drainStateWrites(drainTimeoutMs);
        },
        PROCESS_SHUTDOWN_PHASE.STATE_DRAIN,
    );

    return async function shutdown(signal = 'SIGTERM') {
        log('INFO', `[copilot/runtime-host] Sinal ${signal} recebido — encerrando graciosamente...`);
        await runApplicationShutdown(signal);
        process.exit(0);
    };
}

/**
 * Registra sinais de processo uma única vez.
 *
 * @param {{
 *     shutdown: (signal?: string) => Promise<unknown>;
 * }} options
 * @returns {void}
 */
export function registerRuntimeProcessSignals({ shutdown }) {
    if (_processSignalHandlersRegistered) return;
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    _processSignalHandlersRegistered = true;
}

/**
 * Registra IPC básico para o runtime compatível.
 *
 * @param {{
 *     agent: Parameters<typeof readRuntimeControlState>[0];
 *     shutdown: (signal?: string) => Promise<unknown>;
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {void}
 */
export function registerRuntimeIpcHost({ agent, shutdown, log }) {
    if (!process.send || _ipcHandlersRegistered) return;

    process.on('message', (/** @type {Record<string, unknown>} */ msg) => {
        const cmd = msg?.['cmd'];
        if (cmd === 'ping') {
            process.send?.({ ok: true, pong: true });
        } else if (cmd === 'status') {
            process.send?.({ ok: true, status: readRuntimeControlState(agent).status });
        } else if (cmd === 'stop') {
            log('INFO', '[copilot/runtime-host] IPC stop recebido — encerrando...');
            void shutdown('IPC:stop');
        } else {
            process.send?.({ ok: false, error: `Comando desconhecido: ${cmd}` });
        }
    });

    _ipcHandlersRegistered = true;
}

/**
 * Registra logging de eventos de processo do agent uma única vez por instância.
 *
 * @param {{
 *     agent: import('node:events').EventEmitter & { status: string };
 *     events: {
 *         status: string;
 *         error: string;
 *         sessionFatal: string;
 *     };
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {void}
 */
export function registerRuntimeAgentEventHost({ agent, events, log }) {
    if (_agentEventHosts.has(agent)) return;

    agent.on(events.status, (status) => {
        log('INFO', `[copilot/runtime-host] Status: ${status}`);
    });

    agent.on(events.error, (err) => {
        log('ERROR', `[copilot/runtime-host] Erro do agente: ${err?.message ?? err}`);
    });

    agent.on(events.sessionFatal, (/** @type {Record<string, unknown>} */ evt) => {
        const reason = evt?.['reason'] ?? evt?.['message'] ?? 'desconhecido';
        log('ERROR', `[copilot/runtime-host] session.fatal recebido — encerrando processo: ${reason}`);
        void runApplicationShutdown('session.fatal').finally(() => {
            process.exitCode = 1;
            process.exit(1);
        });
    });

    _agentEventHosts.add(agent);
}
