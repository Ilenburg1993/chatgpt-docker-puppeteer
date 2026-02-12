// @ts-check - Type checking rigoroso habilitado (arquivo core)

// Load environment variables: .env.local (sensitive) overrides .env (defaults)
// Order matters: .env.local must be loaded first to take precedence
import dotenv from 'dotenv';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load .env.local if exists (Ollama Cloud API keys, etc.)
if (fs.existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
}
// Load .env (defaults, always exists)
dotenv.config();

import * as Authority from '#core/authority';
import { CONNECTION_MODES } from '#core/constants/browser';
import { log } from '#core/logger';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import * as Discovery from '#nerv/discovery';
import * as NERV from '#nerv/nerv';
import taskSyncBridge from '#server/dashboard-api/task_sync_bridge';
import telemetryAggregator from '#server/dashboard-api/telemetry_aggregator';
import { ActionCode, ActorRole, PROTOCOL_VERSION } from '#shared/nerv/constants';
import * as router from './api/router.js';
import app from './engine/app.js';
import * as lifecycle from './engine/lifecycle.js';
import * as serverEngine from './engine/server.js';
import * as socketHub from './engine/socket.js';
import ServerNERVAdapter from './nerv_adapter/server_nerv_adapter.js';
import * as pm2Bridge from './realtime/bus/pm2_bridge.js';
import * as ssotEventFeed from './realtime/ssot_event_feed.js';
import * as logTail from './realtime/streams/log_tail.js';
import * as hardwareTelemetry from './realtime/telemetry/hardware.js';
import reconciler from './supervisor/reconcilier.js';
import * as fsWatcher from './watchers/fs_watcher.js';
import * as logWatcher from './watchers/log_watcher.js';


/* ==========================================================================
   IPC DISCOVERY STATE — PERSISTÊNCIA CANÔNICA
========================================================================== */

/**
 * Persiste estado mínimo do processo SERVER para descoberta por outros
 * processos (ex: Maestro).
 *
 * Propriedades:
 *   ✔ Escrita síncrona deliberada (barreira de boot)
 *   ✔ Commit atômico via arquivo temporário
 *   ✔ Nunca retorna estado parcialmente gravado
 *
 * @param {number} port - Porta efetivamente bound pelo HTTP engine
 * @param {'standalone'|'delegated'} [authority='standalone'] - Modo de autoridade do servidor
 * @sideEffects - Publica estado via Discovery (NERV-first, file fallback)
 */
function persistServerState(port, authority = Authority.SERVER_AUTHORITIES.STANDALONE) {
    // Legacy compatibility hook: discovery is now canonical via NERV (SERVER_READY).
    // We delegate to the discovery helper which prefers NERV and only falls back
    // to file-based persistence if explicitly enabled via `ENABLE_STATE_FILE=true`.
    const payload = {
        port,
        server_port: port,
        pid: process.pid,
        server_started_at: new Date().toISOString(),
        protocol: PROTOCOL_VERSION || '2.0.0',
        mode: CONNECTION_MODES.SINGULARITY,
        role: 'server',
        authority
    };

    try {
        Discovery.publishServerReady(null, payload);
        log('DEBUG', '[BOOT] persistServerState delegated to Discovery (NERV-first, file fallback opt-in)');
    } catch (err) {
        log('WARN', `[BOOT] persistServerState delegation failed: ${err.message}`);
    }
}


/* ==========================================================================
   BOOTSTRAP — SEQUÊNCIA SOBERANA DE INICIALIZAÇÃO
========================================================================== */

/**
 * @typedef {object} BootstrapOptions
 * @property {'standalone'|'delegated'} [authority] - Modo de autoridade do servidor
 * @property {object} [nerv] - Instância NERV para injeção
 * @property {object} [missionManager] - MissionManager para injeção
 */

/**
 * Executa boot completo do processo SERVER.
 *
 * Ordem é contratual e não deve ser alterada sem auditoria:
 *
 *   1. lifecycle (signals)
 *   2. HTTP engine bind
 *   3. persistência IPC
 *   4. socket hub
 *   5. router / API
 *   6. telemetria
 *   7. watchers
 *   8. NERV local
 *   9. ServerNERVAdapter
 *  10. reconciler
 *
 * @param {BootstrapOptions} [options={}] - Opções de configuração do bootstrap
 * @returns {Promise<object>} Contexto operacional mínimo do server
 * @throws {Error} - Se alguma fase do bootstrap falhar
 * @sideEffects - Inicializa servidor HTTP, conecta NERV, registra watchers
 */
async function bootstrap(options = {}) {
    const authority = Authority.resolveAuthority(options.authority);

    try {
        log('INFO', `🚀 Server Process — Canonical Bootstrap (authority=${authority})`);

        /* --------------------------------------------------------------
         FASE 1 — Lifecycle / Signal Handling
         Deve subir antes de qualquer recurso externo.
      -------------------------------------------------------------- */
        if (Authority.isStandalone(authority)) {
            lifecycle.listenToSignals();
            log('DEBUG', '[BOOT] Lifecycle signals ativos (standalone)');
        } else {
            // Em delegated, suprimimos exits e não registramos handlers de sinal
            if (typeof lifecycle.setAllowProcessExit === 'function') {
                lifecycle.setAllowProcessExit(false);
            }
            log('DEBUG', '[BOOT] Lifecycle signals skip (delegated); process exit suprimido');
        }

        /* --------------------------------------------------------------
           FASE 2 — Fundação HTTP
           Único ponto de bind de rede.
        -------------------------------------------------------------- */
        const basePort = Number(process.env.SERVER_PORT || process.env.PORT || 3008);
        const { server: httpServer, port } = await serverEngine.start(basePort);

        /* --------------------------------------------------------------
         FASE 3 — Estado IPC
         Só após porta real conhecida.
         Em modo delegated, evitamos escrita do arquivo de discovery
         pois o Maestro é responsável pela descoberta/coordenação.
      -------------------------------------------------------------- */
        if (Authority.isStandalone(authority)) {
            persistServerState(port, authority);
        } else {
            log('DEBUG', '[BOOT] persistServerState skip (delegated)');
        }

        /* --------------------------------------------------------------
           FASE 4 — Socket Hub
           Acoplado sobre servidor já bound.
        -------------------------------------------------------------- */
        socketHub.init(httpServer);
        log('DEBUG', '[BOOT] Socket hub acoplado');

        // Dashboard vNext: SSOT DB Event Feed (realtime via SQLite events table)
        try {
            const intervalMs = Number(process.env.SSOT_EVENT_FEED_INTERVAL_MS || 250) || 250;
            const batchLimit = Number(process.env.SSOT_EVENT_FEED_BATCH_LIMIT || 500) || 500;
            ssotEventFeed.start({ socketHub, intervalMs, batchLimit });
        } catch (err) {
            log('WARN', `[BOOT] Falha ao iniciar SSOTEventFeed: ${err.message}`);
        }

        // Dashboard V2: TelemetryAggregator (realtime metrics)
        try {
            const intervalMs = Number(process.env.DASHBOARD_TELEMETRY_INTERVAL_MS || 1000) || 1000;
            telemetryAggregator.start({ socketHub, intervalMs });
            log('INFO', `[BOOT] Dashboard telemetry aggregator ativo (interval=${intervalMs}ms)`);
        } catch (err) {
            log('WARN', `[BOOT] Falha ao iniciar TelemetryAggregator: ${err.message}`);
        }

        /* --------------------------------------------------------------
         FASE 5 — API Gateway
         Router injeta rotas — não cria servidor.
      -------------------------------------------------------------- */
        // Expõe autoridade no app para que controllers possam atuar de forma
        // conservadora (ex.: negar operações de lifecycle quando delegated)
        try {
            app.locals = app.locals || {};
            app.locals.authority = authority;
        } catch (e) {
            /* noop */
        }

        await router.applyRoutes(app);
        log('DEBUG', '[BOOT] Rotas HTTP consolidadas');

        /* --------------------------------------------------------------
           FASE 6 — Telemetria
        -------------------------------------------------------------- */
        pm2Bridge.init();
        logTail.init();
        hardwareTelemetry.init();
        // TODO: Inicia snapshot de telemetria em background para respostas rápidas
        // try {
        //     const intervalMs = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '60000', 10);
        //     snapshot.start(intervalMs);
        // } catch (e) {
        //     log('WARN', `[BOOT] Falha ao iniciar snapshot de telemetria: ${e.message}`);
        // }

        log('DEBUG', '[BOOT] Telemetria online (sem snapshot - módulo pendente)');

        /* --------------------------------------------------------------
           FASE 7 — Watchers
        -------------------------------------------------------------- */
        fsWatcher.init();
        logWatcher.init();
        log('DEBUG', '[BOOT] Watchers ativos');

        /* --------------------------------------------------------------
         FASE 8 — NERV local do processo SERVER (criação ou injeção)
      -------------------------------------------------------------- */
        let nerv = options.nerv ?? null;

        if (!nerv) {
            if (Authority.isDelegated(authority)) {
                log('FATAL', '[BOOT] NERV não injetado em modo delegated');
                // Em modo delegated não finalizamos o processo localmente; propaga erro para o chamador
                throw new Error('NERV must be injected in delegated mode');
            }

            const { createNERV } = NERV;
            nerv = await createNERV({
                mode: 'hybrid',
                correlation: true,
                bufferSize: 1000,
                telemetry: true
            });

            log('DEBUG', '[BOOT] NERV local criado (standalone)');
        } else {
            log('DEBUG', '[BOOT] NERV injetado (delegated)');
        }

        // Dashboard V2: TaskSyncBridge (realtime task updates via NERV)
        if (process.env.ENABLE_TASK_SYNC_BRIDGE === 'true') {
            try {
                taskSyncBridge.initialize({ socketHub, nervClient: nerv });
                log('INFO', '[BOOT] TaskSyncBridge inicializado (NERV → Dashboard)');
            } catch (err) {
                log('WARN', `[BOOT] Falha ao inicializar TaskSyncBridge: ${err.message}`);
            }
        } else {
            log('INFO', '[BOOT] TaskSyncBridge desativado (ENABLE_TASK_SYNC_BRIDGE!=true)');
        }

        // PUBLICAÇÃO CANÔNICA: SERVER_READY via NERV (canal preferencial para descoberta — somente standalone)
        if (Authority.isStandalone(authority)) {
            try {
                const payload = {
                    port,
                    server_port: port,
                    pid: process.pid,
                    server_started_at: new Date().toISOString(),
                    protocol: PROTOCOL_VERSION || 'unknown',
                    mode: CONNECTION_MODES.SINGULARITY,
                    role: 'server',
                    httpAuthority: Boolean(port)
                };

                try {
                    HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
                    log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
                } catch (err) {
                    log('WARN', `[BOOT] Falha ao publicar SERVER_READY via HighLevelNERV: ${err.message}`);
                }
            } catch (err) {
                log('WARN', `[BOOT] Não foi possível publicar SERVER_READY via NERV: ${err.message}`);
            }
        } else {
            log('DEBUG', '[BOOT] SERVER_READY skip (delegated) — Maestro é responsável pela publicação');
        }

        /* --------------------------------------------------------------
         FASE 9 — Adapter NERV ⇄ Socket
      -------------------------------------------------------------- */
        const serverAdapter = new ServerNERVAdapter(nerv, socketHub);
        log('INFO', '[BOOT] ServerNERVAdapter ativo');

        // Injeção opcional de MissionManager passada via options (delegated ou embed)
        try {
            if (options.missionManager) {
                const missionsController = await import('./api/controllers/missions.js').then(m => m.default ?? m);
                if (typeof missionsController.setMissionManager === 'function') {
                    missionsController.setMissionManager(options.missionManager);
                    log('DEBUG', '[BOOT] MissionManager injetado via options.missionManager');
                }
            }
        } catch (e) {
            log('WARN', `[BOOT] Falha ao injetar MissionManager via options: ${e.message}`);
        }

        /* --------------------------------------------------------------
           FASE 10 — Reconciler (último)
        -------------------------------------------------------------- */
        if (typeof reconciler?.start === 'function') {
            reconciler.start();
            log('INFO', '[BOOT] Reconciler ativo');
        }

        log('INFO', `[BOOT] Server pronto na porta ${port}`);

        // PM2 readiness gate: prevents "online but not listening" situations.
        try {
            if (typeof process.send === 'function') {
                process.send('ready');
                log('DEBUG', '[BOOT] PM2 ready signal sent');
            }
        } catch (e) {
            // noop
        }

        // Atualiza readiness do app HTTP para consumo do endpoint /ready
        try {
            try {
                const app = await import('./engine/app.js').then(m => m.default ?? m);
                app.locals = app.locals || {};
                app.locals.runtimeReadiness = Object.assign({}, app.locals.runtimeReadiness || null, {
                    nerv: Boolean(nerv),
                    serverAdapter: Boolean(serverAdapter),
                    httpServer: Boolean(httpServer)
                });
                app.locals.requiredReadiness = app.locals.requiredReadiness || ['nerv'];
                log('DEBUG', '[BOOT] runtimeReadiness definido no app (server process)');
            } catch (err) {
                log(
                    'WARN',
                    `[BOOT] Não foi possível definir runtimeReadiness no app: ${err && err.message ? err.message : String(err)}`
                );
            }
        } catch (err) {
            /* noop */
        }

        return {
            port,
            httpServer,
            nerv,
            serverAdapter,
            authority
        };
    } catch (err) {
        log('FATAL', `[BOOT] Falha crítica de bootstrap: ${err.message}`);
        if (typeof authority !== 'undefined' && Authority.isStandalone(authority)) {
            process.exit(1);
        }
        throw err;
    }
}


/* ==========================================================================
   ENTRYPOINT CONTROL
========================================================================== */

const __entryFile = fileURLToPath(import.meta.url);
let __isDirectRun = false;
try {
    const argvFile = process.argv[1];
    if (argvFile) {
        __isDirectRun = fs.realpathSync(argvFile) === fs.realpathSync(__entryFile);
    }
} catch (err) {
    __isDirectRun = false;
}

const __isPm2Managed =
    typeof process.env.NODE_APP_INSTANCE !== 'undefined' ||
    (process.env.PM2_JSON_PROCESSING === 'true' && Boolean(process.env.PM2_HOME));

const __shouldBootstrap = __isDirectRun || __isPm2Managed || process.env.DAEMON_MODE === 'true';

if (__shouldBootstrap && !globalThis.__MISSION_CONTROL_BOOTSTRAPPED__) {
    globalThis.__MISSION_CONTROL_BOOTSTRAPPED__ = true;
    (async () => {
        try {
            await bootstrap();
        } catch (err) {
            log('FATAL', `[BOOT] Entrypoint bootstrap falhou: ${err.message}`);
            process.exit(1);
        }
    })();
}

export default bootstrap;
