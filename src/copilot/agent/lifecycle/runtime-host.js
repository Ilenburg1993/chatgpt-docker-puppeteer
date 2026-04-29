// @ts-check
/**
 * src/copilot/agent/lifecycle/runtime-host.js
 *
 * Helpers do host de processo do runtime do agente.
 *
 * Aqui "host" significa a borda do processo Node que hospeda o runtime compatível do agent: sinais, IPC, shutdown e
 * preflight. Não é o mesmo "host" dos contratos internos do dialog loop, onde "host" significa um adapter estreito de
 * capacidades.
 *
 * Este módulo não é boot canônico. Ele encapsula preocupações de processo usadas pelo entrypoint compatível
 * (`agent/lifecycle/entry.js`) e por diagnósticos do boot canônico.
 *
 * @module copilot/agent/lifecycle/runtime-host
 */

import { TimeoutError, registerShutdownHandler, runShutdown, toError } from '#copilot/core';
import { listSdkCatalogModels } from '../facades/agent-model-config.js';
import { ensureAgentSdkClientStarted, pingAgentSdkClient, stopAgentSdkClient } from '../facades/agent-sdk-access.js';

/** @type {boolean} */
let _processSignalHandlersRegistered = false;

/** @type {boolean} */
let _ipcHandlersRegistered = false;

/** @type {WeakSet<object>} */
const _agentEventHosts = new WeakSet();

/**
 * @typedef {{
 *     ok: boolean;
 *     pingOk: boolean;
 *     authenticated: boolean | null;
 *     modelConfigured: string | null;
 *     modelValidated: boolean | null;
 *     warnings: string[];
 *     errors: string[];
 * }} CopilotSdkBootPreflightReport
 */

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
    registerShutdownHandler(
        'agent.stop',
        async () => {
            try {
                await agent.stop();
                log('INFO', '[copilot/runtime-host] Agente parado.');
            } catch (e) {
                log('WARN', `[copilot/runtime-host] Erro no shutdown do agente: ${toError(e).message}`);
            }
        },
        0,
    );

    registerShutdownHandler(
        'state.drain',
        async () => {
            await drainStateWrites(drainTimeoutMs);
        },
        5,
    );

    return async function shutdown(signal = 'SIGTERM') {
        log('INFO', `[copilot/runtime-host] Sinal ${signal} recebido — encerrando graciosamente...`);
        await runShutdown(signal);
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
 *     agent: { status: string };
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
            process.send?.({ ok: true, status: agent.status });
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
        void runShutdown('session.fatal').finally(() => {
            process.exitCode = 1;
            process.exit(1);
        });
    });

    _agentEventHosts.add(agent);
}

/**
 * Executa preflight do SDK/CLI para o boot.
 *
 * @param {{
 *     createClient: () => import('#copilot/sdk/types').CopilotClient;
 *     checkAuthStatus: (client: import('#copilot/sdk/types').CopilotClient) => Promise<{ authenticated: boolean }>;
 *     pingTimeoutMs: number;
 *     configuredModel?: string | null;
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {Promise<CopilotSdkBootPreflightReport>}
 */
export async function runCopilotSdkBootPreflight({
    createClient,
    checkAuthStatus,
    pingTimeoutMs,
    configuredModel = null,
    log,
}) {
    /** @type {CopilotSdkBootPreflightReport} */
    const report = {
        ok: false,
        pingOk: false,
        authenticated: null,
        modelConfigured: configuredModel ?? null,
        modelValidated: null,
        warnings: [],
        errors: [],
    };

    /** @type {import('#copilot/sdk/types').CopilotClient | null} */
    let client = null;
    try {
        client = createClient();
        await ensureAgentSdkClientStarted(client);
        /** @type {ReturnType<typeof setTimeout> | null} */
        let pingTimeoutHandle = null;
        try {
            await Promise.race([
                pingAgentSdkClient(client),
                new Promise((_, reject) => {
                    pingTimeoutHandle = setTimeout(
                        () => reject(new TimeoutError(`Ping timeout (${pingTimeoutMs}ms)`)),
                        pingTimeoutMs,
                    );
                }),
            ]);
        } finally {
            if (pingTimeoutHandle !== null) {
                clearTimeout(pingTimeoutHandle);
            }
        }
        report.pingOk = true;
        log('INFO', '[copilot/runtime-host] CLI conectado — ping OK.');

        try {
            const authStatus = await checkAuthStatus(client);
            report.authenticated = authStatus.authenticated;
            if (!authStatus.authenticated) {
                const warning = 'Usuário não autenticado no Copilot — sessão pode falhar.';
                report.warnings.push(warning);
                log('WARN', `[copilot/runtime-host] ${warning}`);
            } else {
                log('INFO', '[copilot/runtime-host] Autenticação Copilot OK.');
            }
        } catch (e) {
            const warning = `Verificação de auth ignorada: ${toError(e).message}`;
            report.warnings.push(warning);
            log('DEBUG', `[copilot/runtime-host] ${warning}`);
        }

        if (configuredModel && configuredModel !== 'gpt-5-mini') {
            // Special case: 'auto' is resolved at session creation time via ModelSelector (F40.2)
            if (configuredModel === 'auto') {
                log(
                    'INFO',
                    '[copilot/runtime-host] Modelo configurado como "auto" — será resolvido em runtime via ModelSelector.',
                );
                report.modelValidated = true; // Auto-resolution happens at createSession()
            } else {
                try {
                    const models = await listSdkCatalogModels();
                    report.modelValidated = models.some(
                        (/** @type {{ id: string }} */ model) => model.id === configuredModel,
                    );
                    if (!report.modelValidated) {
                        const warning = `Modelo '${configuredModel}' não encontrado na lista de modelos disponíveis.`;
                        report.warnings.push(warning);
                        log('WARN', `[copilot/runtime-host] ${warning}`);
                    } else {
                        log('INFO', `[copilot/runtime-host] Modelo '${configuredModel}' validado na lista de modelos.`);
                    }
                } catch (e) {
                    const warning = `Validação de modelo ignorada: ${toError(e).message}`;
                    report.warnings.push(warning);
                    log('DEBUG', `[copilot/runtime-host] ${warning}`);
                }
            }
        }

        report.ok = report.pingOk && report.errors.length === 0;
        return report;
    } catch (e) {
        const warning = `CLI não respondeu ao ping no boot: ${toError(e).message}`;
        report.warnings.push(warning);
        log('WARN', `[copilot/runtime-host] ${warning}`);
        return report;
    } finally {
        await (client ? stopAgentSdkClient(client) : Promise.resolve([])).catch((e) => {
            log('DEBUG', `[copilot/runtime-host] Falha ao encerrar cliente de preflight: ${toError(e).message}`);
        });
    }
}
