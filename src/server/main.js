/* ==========================================================================
   src/server/main.js
   Audit Level: 750 — Mission Control Prime Bootstrapper (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar o boot sequencial de todos os subsistemas do
                     servidor e persistir o estado para descoberta IPC.
   Sincronizado com: lifecycle.js V600, server.js V100, socket.js V600,
                     router.js V700, supervisor/reconciler.js V700.
========================================================================== */

const fs = require('fs');

const {
    CONNECTION_MODES: CONNECTION_MODES
} = require('../core/constants/browser.js');

const _path = require('path');

// 1. Motores Centrais (Engine)
const server = require('./engine/server');
const socketHub = require('./engine/socket');
const lifecycle = require('./engine/lifecycle');
const app = require('./engine/app');

// 2. Camada de Comunicação (API Gateway)
const router = require('./api/router');

// 3. Sentidos e Telemetria (Realtime)
const pm2Bridge = require('./realtime/bus/pm2_bridge');
const logTail = require('./realtime/streams/log_tail');
const hardwareTelemetry = require('./realtime/telemetry/hardware');

// 4. Inteligência de Controle (Supervisor / Reconciler)
const reconciler = require('./supervisor/reconciler');

// 5. Observadores de Infraestrutura (Watchers)
const fsWatcher = require('./watchers/fs_watcher');
const logWatcher = require('./watchers/log_watcher');

// 6. Utilidades de Core e Infra
const { log } = require('../core/logger');
const PATHS = require('../infra/fs/paths');
const { PROTOCOL_VERSION } = require('../shared/nerv/constants');

/**
 * === BOOTSTRAP ANCHOR ===
 * Persiste o estado do servidor para descoberta dinâmica pelo Maestro.
 * Executado após a definição da porta física e antes da lógica interativa.
 *
 * @param {number} port - Porta final alocada pelo algoritmo de Port Hunting.
 */
function persistServerState(port) {
    const serverState = {
        server_port: port,
        server_pid: process.pid,
        server_started_at: new Date().toISOString(),
        server_version: 'V750',
        protocol: PROTOCOL_VERSION || '2.0.0',
        mode: CONNECTION_MODES.SINGULARITY
    };

    try {
        const tmpFile = `${PATHS.STATE}.tmp`;

        // Escrita síncrona deliberada: barreira determinística de boot
        fs.writeFileSync(tmpFile, JSON.stringify(serverState, null, 2), 'utf-8');

        // Commit atômico para garantir integridade na leitura pelo Maestro
        if (fs.existsSync(PATHS.STATE)) {
            fs.unlinkSync(PATHS.STATE);
        }
        fs.renameSync(tmpFile, PATHS.STATE);

        log('DEBUG', `[BOOT] Descoberta persistida em estado.json (Porta: ${port})`);
    } catch (err) {
        log('ERROR', `[BOOT] Falha crítica ao registrar estado de descoberta: ${err.message}`);
        throw err;
    }
}

/**
 * Função de Inicialização (Main Sequence).
 * Segue o rigor do Protocolo 11 para garantir estabilidade operacional.
 */
async function bootstrap() {
    try {
        log('INFO', '🚀 >>> Iniciando Mission Control Prime V750 <<<');

        // PASSO 1: Ativar escuta de sinais vitais do SO (SIGINT / SIGTERM)
        lifecycle.listenToSignals();
        log('DEBUG', '[BOOT] Gestor de ciclo de vida e sinais ativo.');

        // PASSO 2: Iniciar Servidor HTTP (Fundação física com Port Hunting)
        const instance = await server.start(process.env.PORT || 3000);

        // PASSO 3: Persistir Estado para IPC Discovery
        persistServerState(instance.port);

        // PASSO 4: Inicializar Barramento de Eventos Soberano (Socket.io)
        socketHub.init(instance.server);
        log('DEBUG', '[BOOT] Hub IPC 2.0 acoplado à fundação HTTP.');

        // PASSO 5: Injetar Malha de Rotas e Gateway de API
        router.applyRoutes(app);
        log('DEBUG', '[BOOT] Gateway de API e Error Boundary consolidados.');

        // PASSO 6: Ligar Motores de Telemetria e Streaming
        pm2Bridge.init();
        logTail.init();
        hardwareTelemetry.init();
        log('INFO', '[BOOT] Motores de telemetria e streaming operacionais.');

        // PASSO 7: Ativar Observadores de Infraestrutura (Watchers)
        fsWatcher.init();
        logWatcher.init();
        log('DEBUG', '[BOOT] Vigilância de sistema de arquivos ativa.');

        // PASSO 8: Ativar o Reconciliador (Autocura)
        // O Reconciler é o último a subir para garantir que os barramentos estejam prontos
        if (reconciler && typeof reconciler.start === 'function') {
            reconciler.start();
            log('INFO', '[BOOT] Reconciliador de Estado em prontidão.');
        }

        log('INFO', `[BOOT] Mission Control Prime V750 totalmente operacional na porta ${instance.port}`);

        return instance;
    } catch (e) {
        log('FATAL', `[BOOT] Falha catastrófica na ignição do servidor: ${e.message}`);
        // Em caso de falha no boot, encerramos o processo para evitar estado inconsistente
        process.exit(1);
    }
}

/**
 * Execução Automática (Independência de Módulo)
 */
if (require.main === module) {
    bootstrap();
}

module.exports = bootstrap;
