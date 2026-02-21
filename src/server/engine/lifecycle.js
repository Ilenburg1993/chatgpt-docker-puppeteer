// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as server from './server.js';
import * as socketHub from './socket.js';
import * as pm2Bridge from '../realtime/bus/pm2_bridge.js';
import * as logTail from '../realtime/streams/log_tail.js';
import * as hardwareTelemetry from '../realtime/telemetry/hardware.js';
import * as fsWatcher from '../watchers/fs_watcher.js';
import * as logWatcher from '../watchers/log_watcher.js';
import { log } from '#core/logger';
import CONFIG from '#core/config';
import * as Discovery from '#nerv/discovery';
import * as ssotEventFeed from '../realtime/ssot_event_feed.js';

/**
 * Legacy: file-based discovery handled by `@nerv/discovery`.
 * We avoid direct filesystem operations here and delegate cleanup to Discovery.
 */

/**
 * Flag de estado para evitar reentrância em desligamentos simultâneos.
 */
let isShuttingDown = false;
/**
 * Controle se o lifecycle deve chamar `process.exit()` ao final.
 * Em modo 'delegated' o processo chamador (Maestro) deve controlar o exit.
 */
let allowProcessExit = true;
let signalsListening = false;
const signalHandlers = {
    sigint: null,
    sigterm: null,
    sigusr2: null,
    sigquit: null,
    sigbreak: null,
    sigpipe: null,
    sigchld: null,
    uncaughtException: null,
    unhandledRejection: null,
};

async function loadDashboardShutdownModules() {
    const [taskSyncBridgeModule, telemetryAggregatorModule] = await Promise.all([
        import('#server/dashboard-api/task_sync_bridge'),
        import('#server/dashboard-api/telemetry_aggregator'),
    ]);

    return {
        taskSyncBridge: taskSyncBridgeModule?.default ?? null,
        telemetryAggregator: telemetryAggregatorModule?.default ?? null,
    };
}

function setAllowProcessExit(flag) {
    allowProcessExit = !!flag;
}

function registerSignalSafely(signal, key, handler) {
    try {
        process.on(signal, handler);
        signalHandlers[key] = handler;
        return true;
    } catch (err) {
        signalHandlers[key] = null;
        log('DEBUG', `[LIFECYCLE] ${signal} não suportado nesta plataforma: ${err.message}`);
        return false;
    }
}

function removeSignalListenerSafely(signal, key) {
    if (!signalHandlers[key]) {
        return;
    }

    process.removeListener(signal, signalHandlers[key]);
    signalHandlers[key] = null;
}

/**
 * Realiza o encerramento gracioso de todos os módulos do Mission Control.
 * Estratégia: Desativação em cascata reversa (Periferia -> Núcleo).
 *
 * @param {string} signal - O sinal de interrupção (ex: SIGINT, SIGTERM).
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        log('DEBUG', `[LIFECYCLE] ${signal} ignorado; shutdown já em andamento.`);
        return;
    }
    isShuttingDown = true;

    log('WARN', `[LIFECYCLE] Sinal ${signal} detectado. Iniciando Protocolo de Encerramento...`);

    // 0. WATCHDOG DE SEGURANÇA: Impede que o processo fique "pendurado" no SO.
    const shutdownTimeoutMs = Number(CONFIG.get('SERVER_SHUTDOWN_TIMEOUT_MS', 5000)) || 5000;
    const forceExitTimeout = setTimeout(() => {
        log('FATAL', `[LIFECYCLE] Shutdown excedeu o tempo limite de ${shutdownTimeoutMs}ms.`);
        if (allowProcessExit) {
            log('FATAL', '[LIFECYCLE] Forçando saída do processo.');
            process.exit(1);
        } else {
            log('ERROR', '[LIFECYCLE] Shutdown timeout — saída suprimida por allowProcessExit=false');
        }
    }, shutdownTimeoutMs);

    try {
        // 1. DESATIVAÇÃO DOS OBSERVADORES (WATCHERS)
        // Corta a entrada de novos eventos do sistema de arquivos.
        log('DEBUG', '[LIFECYCLE] Finalizando observadores de disco...');
        if (fsWatcher && typeof fsWatcher.stop === 'function') {
            fsWatcher.stop();
        }
        if (logWatcher && typeof logWatcher.stop === 'function') {
            logWatcher.stop();
        }

        // 2. DESATIVAÇÃO DOS MOTORES DE TELEMETRIA E STREAMING
        // Interrompe o fluxo de dados de hardware e barramentos externos.
        log('DEBUG', '[LIFECYCLE] Encerrando barramentos de dados vivos...');
        if (hardwareTelemetry && typeof hardwareTelemetry.stop === 'function') {
            hardwareTelemetry.stop();
        }
        // Snapshot telemetry disabled (module not found - telemetry directory missing)
        // try {
        //     if (snapshot && typeof snapshot.stop === 'function') {
        //         snapshot.stop();
        //     }
        // } catch (e) {
        //     log('WARN', `[LIFECYCLE] Falha ao parar snapshot: ${e.message}`);
        // }
        if (logTail && typeof logTail.stop === 'function') {
            logTail.stop();
        }
        if (pm2Bridge && typeof pm2Bridge.stop === 'function') {
            pm2Bridge.stop();
        }

        // 2.25. MCP UPSTREAMS (stdio child processes)
        // Ensure no orphan child processes remain when shutting down Mission Control.
        try {
            const { shutdownUpstreams } = await import('../../integration/mcp/upstream-manager.mjs');
            if (typeof shutdownUpstreams === 'function') {
                await shutdownUpstreams();
                log('DEBUG', '[LIFECYCLE] MCP upstreams encerrados');
            }
        } catch (e) {
            log('DEBUG', `[LIFECYCLE] shutdownUpstreams skipped: ${e && e.message ? e.message : String(e)}`);
        }

        // 2.3. LSP/tsserver daemon
        try {
            const { stopTsserverDaemon } = await import('../../integration/lsp/tsserver-daemon.mjs');
            if (typeof stopTsserverDaemon === 'function') {
                await stopTsserverDaemon();
                log('DEBUG', '[LIFECYCLE] LSP daemon encerrado');
            }
        } catch (e) {
            log('DEBUG', `[LIFECYCLE] stopTsserverDaemon skipped: ${e && e.message ? e.message : String(e)}`);
        }

        // 2.5. DASHBOARD AGGREGATORS (realtime)
        // Lazy-load apenas no shutdown para evitar side effects no import do entrypoint.
        // Para timers internos antes de desconectar o Hub.
        try {
            const { taskSyncBridge, telemetryAggregator } = await loadDashboardShutdownModules();

            try {
                if (telemetryAggregator && typeof telemetryAggregator.stop === 'function') {
                    telemetryAggregator.stop();
                }
            } catch (e) {
                log('DEBUG', `[LIFECYCLE] TelemetryAggregator.stop() skipped: ${e && e.message ? e.message : String(e)}`);
            }

            try {
                if (taskSyncBridge && typeof taskSyncBridge.clearAll === 'function') {
                    taskSyncBridge.clearAll();
                }
            } catch (e) {
                log('DEBUG', `[LIFECYCLE] TaskSyncBridge.clearAll() skipped: ${e && e.message ? e.message : String(e)}`);
            }
        } catch (e) {
            log('DEBUG', `[LIFECYCLE] Dashboard shutdown modules skipped: ${e && e.message ? e.message : String(e)}`);
        }

        try {
            if (ssotEventFeed && typeof ssotEventFeed.stop === 'function') {
                ssotEventFeed.stop();
            }
        } catch (e) {
            log('DEBUG', `[LIFECYCLE] SSOTEventFeed.stop() skipped: ${e && e.message ? e.message : String(e)}`);
        }

        // 3. DESATIVAÇÃO DO HUB DE EVENTOS (SOCKET.IO)
        // [V600] Desconecta agentes e limpa o Registry de forma assíncrona.
        log('DEBUG', '[LIFECYCLE] Desconectando agentes e limpando barramento IPC...');
        if (socketHub && typeof socketHub.stop === 'function') {
            await socketHub.stop();
        }

        // 4. LIMPEZA DO ARQUIVO DE ESTADO (LEGACY: IPC Discovery)
        // Delega a limpeza ao helper de discovery; ele decide se remove o arquivo
        // legacy (apenas quando ENABLE_STATE_FILE=true) ou não.
        try {
            const removed = Discovery.unpublishServerReady();
            if (removed) {
                log('DEBUG', '[LIFECYCLE] arquivo de estado legado removido via Discovery');
            } else {
                log(
                    'DEBUG',
                    '[LIFECYCLE] Pulando limpeza do arquivo de estado legado (não habilitado ou não presente)'
                );
            }
        } catch (cleanupErr) {
            log(
                'WARN',
                `[LIFECYCLE] Falha ao tentar unpublish arquivo de estado legado via Discovery: ${cleanupErr.message}`
            );
        }

        // 5. DESATIVAÇÃO DA FUNDAÇÃO HTTP
        // Libera o bind da porta no Sistema Operacional.
        log('DEBUG', '[LIFECYCLE] Encerrando servidor HTTP...');
        // Pass shorter timeout to prevent watchdog force-exit
        const serverTimeout = Math.max(1000, shutdownTimeoutMs - 1000); // Reserve 1s for cleanup
        await server.stop(serverTimeout);

        log('INFO', '[LIFECYCLE] Subsistema Mission Control encerrado com sucesso.');

        // Encerramento do processo com código de sucesso.
        if (allowProcessExit) {
            process.exit(0);
        } else {
            log('INFO', '[LIFECYCLE] Encerramento concluído (exit suprimido por allowProcessExit=false)');
        }
    } catch (e) {
        log('ERROR', `[LIFECYCLE] Colapso durante a sequência de encerramento: ${e.message}`);
        if (allowProcessExit) {
            process.exit(1);
        } else {
            log('ERROR', '[LIFECYCLE] Falha no shutdown (exit suprimido por allowProcessExit=false)');
        }
    } finally {
        clearTimeout(forceExitTimeout);
        if (!allowProcessExit) {
            isShuttingDown = false;
        }
    }
}

/**
 * Ativa a escuta de sinais vitais do SO e monitora exceções críticas.
 * Deve ser invocado no início do bootstrap em main.js.
 */
function listenToSignals() {
    if (signalsListening) {
        log('DEBUG', '[LIFECYCLE] listenToSignals já ativo; registro duplicado ignorado');
        return;
    }

    // Sinais de interrupção padrão (Ctrl+C, PM2 Stop/Reload)
    signalHandlers.sigint = () => gracefulShutdown('SIGINT');
    signalHandlers.sigterm = () => gracefulShutdown('SIGTERM');
    signalHandlers.sigusr2 = () => gracefulShutdown('SIGUSR2');

    registerSignalSafely('SIGINT', 'sigint', signalHandlers.sigint);
    registerSignalSafely('SIGTERM', 'sigterm', signalHandlers.sigterm);
    registerSignalSafely('SIGUSR2', 'sigusr2', signalHandlers.sigusr2);

    signalHandlers.sigquit = () => gracefulShutdown('SIGQUIT');
    signalHandlers.sigbreak = () => gracefulShutdown('SIGBREAK');

    if (process.platform === 'win32') {
        registerSignalSafely('SIGBREAK', 'sigbreak', signalHandlers.sigbreak);
        signalHandlers.sigquit = null;
    } else {
        registerSignalSafely('SIGQUIT', 'sigquit', signalHandlers.sigquit);
        signalHandlers.sigbreak = null;
    }

    // Sinais auxiliares de subprocesso (não encerram o processo principal)
    signalHandlers.sigpipe = () => {
        if (isShuttingDown) {
            return;
        }
        log('DEBUG', '[LIFECYCLE] SIGPIPE recebido; mantendo runtime ativo.');
    };
    signalHandlers.sigchld = () => {
        if (isShuttingDown) {
            return;
        }
        log('DEBUG', '[LIFECYCLE] SIGCHLD recebido; subprocesso finalizado.');
    };

    if (process.platform === 'win32') {
        signalHandlers.sigpipe = null;
        signalHandlers.sigchld = null;
    } else {
        registerSignalSafely('SIGPIPE', 'sigpipe', signalHandlers.sigpipe);
        registerSignalSafely('SIGCHLD', 'sigchld', signalHandlers.sigchld);
    }

    // Captura de falhas catastróficas para evitar encerramento "sujo" da infraestrutura
    signalHandlers.uncaughtException = err => {
        log('FATAL', `[LIFECYCLE] Exceção não tratada: ${err.message}\n${err.stack}`);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    };
    process.on('uncaughtException', signalHandlers.uncaughtException);

    signalHandlers.unhandledRejection = reason => {
        log('FATAL', `[LIFECYCLE] Rejeição de Promise não tratada: ${reason}`);
        gracefulShutdown('UNHANDLED_REJECTION');
    };
    process.on('unhandledRejection', signalHandlers.unhandledRejection);

    signalsListening = true;
}

function cleanupSignalListeners() {
    if (!signalsListening) {
        return;
    }

    removeSignalListenerSafely('SIGINT', 'sigint');
    removeSignalListenerSafely('SIGTERM', 'sigterm');
    removeSignalListenerSafely('SIGUSR2', 'sigusr2');
    removeSignalListenerSafely('SIGQUIT', 'sigquit');
    removeSignalListenerSafely('SIGBREAK', 'sigbreak');
    removeSignalListenerSafely('SIGPIPE', 'sigpipe');
    removeSignalListenerSafely('SIGCHLD', 'sigchld');
    removeSignalListenerSafely('uncaughtException', 'uncaughtException');
    removeSignalListenerSafely('unhandledRejection', 'unhandledRejection');

    signalsListening = false;
}

function __resetLifecycleStateForTests() {
    cleanupSignalListeners();
    isShuttingDown = false;
    allowProcessExit = true;
}

const __lifecycleTestHooks = Object.freeze({
    getSignalHandlers: () => signalHandlers,
    isShuttingDown: () => isShuttingDown,
    isSignalsListening: () => signalsListening,
    resetState: __resetLifecycleStateForTests,
});

export { __lifecycleTestHooks, cleanupSignalListeners, gracefulShutdown, listenToSignals, setAllowProcessExit };
