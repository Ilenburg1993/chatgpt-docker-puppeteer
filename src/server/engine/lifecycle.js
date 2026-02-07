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

function setAllowProcessExit(flag) {
    allowProcessExit = !!flag;
}

/**
 * Realiza o encerramento gracioso de todos os módulos do Mission Control.
 * Estratégia: Desativação em cascata reversa (Periferia -> Núcleo).
 *
 * @param {string} signal - O sinal de interrupção (ex: SIGINT, SIGTERM).
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
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
        await server.stop();

        log('INFO', '[LIFECYCLE] Subsistema Mission Control encerrado com sucesso.');

        clearTimeout(forceExitTimeout);

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
    }
}

/**
 * Ativa a escuta de sinais vitais do SO e monitora exceções críticas.
 * Deve ser invocado no início do bootstrap em main.js.
 */
function listenToSignals() {
    // Sinais de interrupção padrão (Ctrl+C, PM2 Stop)
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Captura de falhas catastróficas para evitar encerramento "sujo" da infraestrutura
    process.on('uncaughtException', err => {
        log('FATAL', `[LIFECYCLE] Exceção não tratada: ${err.message}\n${err.stack}`);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', reason => {
        log('FATAL', `[LIFECYCLE] Rejeição de Promise não tratada: ${reason}`);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

export { gracefulShutdown, listenToSignals, setAllowProcessExit };
