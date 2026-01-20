/* ==========================================================================
   src/server/engine/lifecycle.js
   Audit Level: 600 — Sovereign Lifecycle & Shutdown (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar o encerramento atômico e ordenado de todos
                     os componentes do subsistema Server e limpeza de estado.
   Sincronizado com: main.js V51, server.js V100, socket.js V600.
========================================================================== */

const fs = require('fs');
const path = require('path');
const server = require('./server');
const socketHub = require('./socket');
const pm2Bridge = require('../realtime/bus/pm2_bridge');
const logTail = require('../realtime/streams/log_tail');
const hardwareTelemetry = require('../realtime/telemetry/hardware');
const fsWatcher = require('../watchers/fs_watcher');
const logWatcher = require('../watchers/log_watcher');
const { log } = require('../../core/logger');
const { ROOT } = require('../../infra/fs/fs_utils');

/**
 * Localização do arquivo de descoberta para limpeza no shutdown.
 */
const STATE_FILE = path.join(ROOT, 'estado.json');

/**
 * Flag de estado para evitar reentrância em desligamentos simultâneos.
 */
let isShuttingDown = false;

/**
 * Realiza o encerramento gracioso de todos os módulos do Mission Control.
 * Estratégia: Desativação em cascata reversa (Periferia -> Núcleo).
 *
 * @param {string} signal - O sinal de interrupção (ex: SIGINT, SIGTERM).
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {return;}
    isShuttingDown = true;

    log('WARN', `[LIFECYCLE] Sinal ${signal} detectado. Iniciando Protocolo de Encerramento...`);

    // 0. WATCHDOG DE SEGURANÇA: Impede que o processo fique "pendurado" no SO.
    const forceExitTimeout = setTimeout(() => {
        log('FATAL', '[LIFECYCLE] Shutdown excedeu o tempo limite de 5s. Forçando saída.');
        process.exit(1);
    }, 5000);

    try {
        // 1. DESATIVAÇÃO DOS OBSERVADORES (WATCHERS)
        // Corta a entrada de novos eventos do sistema de arquivos.
        log('DEBUG', '[LIFECYCLE] Finalizando observadores de disco...');
        if (fsWatcher && typeof fsWatcher.stop === 'function') {fsWatcher.stop();}
        if (logWatcher && typeof logWatcher.stop === 'function') {logWatcher.stop();}

        // 2. DESATIVAÇÃO DOS MOTORES DE TELEMETRIA E STREAMING
        // Interrompe o fluxo de dados de hardware e barramentos externos.
        log('DEBUG', '[LIFECYCLE] Encerrando barramentos de dados vivos...');
        if (hardwareTelemetry && typeof hardwareTelemetry.stop === 'function') {hardwareTelemetry.stop();}
        if (logTail && typeof logTail.stop === 'function') {logTail.stop();}
        if (pm2Bridge && typeof pm2Bridge.stop === 'function') {pm2Bridge.stop();}

        // 3. DESATIVAÇÃO DO HUB DE EVENTOS (SOCKET.IO)
        // [V600] Desconecta agentes e limpa o Registry de forma assíncrona.
        log('DEBUG', '[LIFECYCLE] Desconectando agentes e limpando barramento IPC...');
        if (socketHub && typeof socketHub.stop === 'function') {
            await socketHub.stop();
        }

        // 4. LIMPEZA DO ARQUIVO DE ESTADO (IPC Discovery)
        // Remove o sinalizador de porta para evitar tentativas de conexão órfãs.
        log('DEBUG', '[LIFECYCLE] Removendo arquivo de descoberta estado.json...');
        try {
            if (fs.existsSync(STATE_FILE)) {
                fs.unlinkSync(STATE_FILE);
            }
        } catch (cleanupErr) {
            log('WARN', `[LIFECYCLE] Falha ao remover estado.json: ${cleanupErr.message}`);
        }

        // 5. DESATIVAÇÃO DA FUNDAÇÃO HTTP
        // Libera o bind da porta no Sistema Operacional.
        log('DEBUG', '[LIFECYCLE] Encerrando servidor HTTP...');
        await server.stop();

        log('INFO', '[LIFECYCLE] Subsistema Mission Control encerrado com sucesso.');

        clearTimeout(forceExitTimeout);

        // Encerramento do processo com código de sucesso.
        process.exit(0);

    } catch (e) {
        log('ERROR', `[LIFECYCLE] Colapso durante a sequência de encerramento: ${e.message}`);
        process.exit(1);
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
    process.on('uncaughtException', (err) => {
        log('FATAL', `[LIFECYCLE] Exceção não tratada: ${err.message}\n${err.stack}`);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason) => {
        log('FATAL', `[LIFECYCLE] Rejeição de Promise não tratada: ${reason}`);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

module.exports = {
    gracefulShutdown,
    listenToSignals
};