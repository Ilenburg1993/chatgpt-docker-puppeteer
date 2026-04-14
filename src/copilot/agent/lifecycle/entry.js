// @ts-check
/**
 * src/copilot/agent/lifecycle/entry.js
 *
 * Agent lifecycle para o processo PM2 "copilot-sdk-agent".
 *
 * Inicializa o AlwaysAliveAgent e mantém o processo ativo, aguardando mensagens via sinais ou via HTTP bridge (montado
 * no dashboard-web :3008).
 *
 * **Boot sequence**: A inicialização de DI (bootstrapObservability, bootstrapLateDeps, AUDIT_BUS) é feita pelo
 * `copilot/bootstrap.js`. Este módulo faz apenas o lifecycle do agent: plugin discovery, event wiring, retry loop,
 * shutdown handlers, IPC.
 *
 * @module copilot/agent/lifecycle/entry
 * @see EventBus
 */

import { toError, EVENT_BUS,
    TimeoutError,
    bridgeEmitter,
    container,
    registerShutdownHandler,
    runShutdown,
    withRetry,
} from '#copilot/core';
import { defaultBus } from '#copilot/hooks';
import { ERROR_TRACKER, log } from '#copilot/observability';
import { PluginRegistry, discoverPlugins } from '#copilot/plugins';
import { CopilotClient } from '#copilot/sdk';
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
import { alwaysAliveAgent } from '../always-alive.js';
import {
    BOOT_MAX_RETRIES,
    COPILOT_MODEL,
    DRAIN_WRITES_TIMEOUT_MS,
    PING_TIMEOUT_MS,
    RESTART_DELAY_MS,
} from '../config.js';
import { drainStateWrites } from './state-io.js';

/**
 * Inicializa o agent lifecycle: plugin discovery, event wiring, retries, shutdown, IPC.
 *
 * Chamado por `copilot/bootstrap.js` com `mode='agent'` — NÃO executa boot de DI (já feito).
 *
 * @returns {Promise<void>}
 */
export async function startAgentLoop() {
    // FAIXA-5A: descobrir e instalar plugins ao iniciar o processo
    {
        const _pluginRegistry = new PluginRegistry();
        const _pluginsDir = new URL('../../plugins', import.meta.url).pathname;
        discoverPlugins(_pluginsDir, _pluginRegistry).catch((e) => {
            log('WARN', `[copilot/agent] Plugin discovery falhou (não crítico): ${e?.message ?? e}`);
        });
    }

    // FAIXA-2A: bridge HookBus → EventBus central para observabilidade cross-module
    const _bus = container.resolve(EVENT_BUS);
    if (_bus) {
        bridgeEmitter(defaultBus, _bus, {
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
                    await alwaysAliveAgent.start();
                },
                {
                    maxAttempts: BOOT_MAX_RETRIES,
                    baseDelayMs: RESTART_DELAY_MS,
                    maxDelayMs: RESTART_DELAY_MS * 4,
                    jitter: true,
                    onRetry: (/** @type {unknown} */ err, /** @type {number} */ attempt) => {
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

    // ─── Tratamento de sinais ─────────────────────────────────────────────────────

    /** @param {string} signal */
    async function shutdown(signal = 'SIGTERM') {
        log('INFO', `[copilot/agent] Sinal ${signal} recebido — encerrando graciosamente...`);
        await runShutdown(signal);
        process.exit(0);
    }

    // Registrar handlers centralizados por prioridade
    registerShutdownHandler(
        'agent.stop',
        async () => {
            try {
                await alwaysAliveAgent.stop();
                log('INFO', '[copilot/agent] Agente parado.');
            } catch (e) {
                log('WARN', `[copilot/agent] Erro no shutdown: ${toError(e).message}`);
            }
        },
        0,
    );

    registerShutdownHandler(
        'state.drain',
        async () => {
            await drainStateWrites(DRAIN_WRITES_TIMEOUT_MS);
        },
        5,
    );

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // ─── Handlers de erros não tratados ──────────────────────────────────────────
    // Delegado ao error-tracker singleton que já implementa trackError + log.
    // Evita duplicação de handlers (FAIXA-0 Quick Win #2).
    container.resolve(ERROR_TRACKER).registerGlobalHandlers();

    // ─── IPC básico (G1-API-03) ───────────────────────────────────────────────────
    // Permite que o processo pai (PM2 / scripts de controle) envie comandos via IPC.
    // Comandos suportados: { cmd: 'ping' }, { cmd: 'status' }, { cmd: 'stop' }.
    if (process.send) {
        process.on('message', (/** @type {Record<string, unknown>} */ msg) => {
            const cmd = msg?.['cmd'];
            if (cmd === 'ping') {
                process.send?.({ ok: true, pong: true });
            } else if (cmd === 'status') {
                process.send?.({ ok: true, status: alwaysAliveAgent.status });
            } else if (cmd === 'stop') {
                log('INFO', '[copilot/agent] IPC stop recebido — encerrando...');
                shutdown('IPC:stop').catch((e) => logSwallowed(e, 'agent.entry.ipcShutdown'));
            } else {
                process.send?.({ ok: false, error: `Comando desconhecido: ${cmd}` });
            }
        });
    }

    // Logar status periódico (evita PM2 matar o processo por inatividade)
    alwaysAliveAgent.on(EMITTER_STATUS, (status) => {
        log('INFO', `[copilot/agent] Status: ${status}`);
    });

    alwaysAliveAgent.on(EMITTER_ERROR, (err) => {
        log('ERROR', `[copilot/agent] Erro do agente: ${err.message}`);
    });

    // `session.fatal` indica que a sessão está irrecuperável. Encerrar o processo permite ao PM2 reiniciar imediatamente.
    alwaysAliveAgent.on(EMITTER_SESSION_FATAL, (/** @type {Record<string, unknown>} */ evt) => {
        const reason = evt?.['reason'] ?? evt?.['message'] ?? 'desconhecido';
        log('ERROR', `[copilot/agent] session.fatal recebido — encerrando processo: ${reason}`);
        void runShutdown('session.fatal').finally(() => {
            process.exitCode = 1;
            process.exit(1);
        });
    });

    // ─── Bootstrap ───────────────────────────────────────────────────────────────

    // Verifica conectividade do CLI antes do primeiro start para falhar rápido em caso de indisponibilidade.
    try {
        const pingClient = new CopilotClient();
        await Promise.race([
            pingClient.ping(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new TimeoutError('Ping timeout (5s)')), PING_TIMEOUT_MS),
            ),
        ]);
        log('INFO', '[copilot/agent] CLI conectado — ping OK.');

        // F113 (Faixa 24): Verificar autenticação no boot para falhar rápido antes de criar sessão.
        try {
            const { checkAuthStatus } = await import('#copilot/sdk');
            const authStatus = await checkAuthStatus(pingClient);
            if (!authStatus.authenticated) {
                log(
                    'WARN',
                    '[copilot/agent] Usuário não autenticado no Copilot — sessão pode falhar. Verifique suas credenciais.',
                );
            } else {
                log('INFO', '[copilot/agent] Autenticação Copilot OK.');
            }
        } catch (authErr) {
            log('DEBUG', `[copilot/agent] Verificação de auth ignorada: ${toError(authErr).message ?? authErr}`);
        }

        // Para o cliente de ping após uso para evitar conexão TCP persistente desnecessaria.
        pingClient.stop().catch((e) => logSwallowed(e, 'agent.entry.pingStop'));
    } catch (e) {
        log('WARN', `[copilot/agent] CLI não respondeu ao ping no boot: ${toError(e).message}`);
        // Continuar de qualquer forma — startWithRetry() tratará a falha
    }

    // Valida COPILOT_MODEL proativamente — falha rápida em modelo inválido antes do start.
    if (COPILOT_MODEL && COPILOT_MODEL !== 'gpt-4.1') {
        try {
            const { listModels } = await import('../../sdk/models/helpers.js');
            const models = await listModels();
            const valid = models.some((/** @type {{ id: string }} */ m) => m.id === COPILOT_MODEL);
            if (!valid) {
                log(
                    'WARN',
                    `[copilot/agent] Modelo '${COPILOT_MODEL}' não encontrado na lista de modelos disponíveis. Verifique COPILOT_MODEL.`,
                );
            } else {
                log('INFO', `[copilot/agent] Modelo '${COPILOT_MODEL}' validado na lista de modelos.`);
            }
        } catch (e) {
            log('DEBUG', `[copilot/agent] Validação de modelo ignorada: ${toError(e).message ?? e}`);
        }
    }

    // Captura Promise para garantir que rejeições assíncronas não fiquem silenciosas.
    const _startPromise = startWithRetry();
    _startPromise.catch((e) => {
        log('ERROR', `[copilot/agent] startWithRetry() rejeitou: ${toError(e).message}`);
        process.exitCode = 1;
    });
}
