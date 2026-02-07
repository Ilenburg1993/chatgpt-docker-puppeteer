// @ts-check - Type checking rigoroso habilitado (arquivo core)
import 'dotenv/config';
import { log } from '#core/logger';
import { PROTOCOL_VERSION, MessageType, ActionCode, ActorRole } from '#shared/nerv/constants';
import { CONNECTION_MODES } from '#core/constants/browser';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import * as Authority from '#core/authority';
import * as Discovery from '#nerv/discovery';
import * as serverEngine from './engine/server.js';
import * as socketHub from './engine/socket.js';
import * as lifecycle from './engine/lifecycle.js';
import app from './engine/app.js';
import * as router from './api/router.js';
import * as pm2Bridge from './realtime/bus/pm2_bridge.js';
import * as logTail from './realtime/streams/log_tail.js';
import * as hardwareTelemetry from './realtime/telemetry/hardware.js';
import * as fsWatcher from './watchers/fs_watcher.js';
import * as logWatcher from './watchers/log_watcher.js';
import reconciler from './supervisor/reconcilier.js';
import ServerNERVAdapter from './nerv_adapter/server_nerv_adapter.js';
import * as NERV from '#nerv/nerv';


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
 * @param {number} port Porta efetivamente bound pelo HTTP engine
 * @param {'standalone'|'delegated'} [authority]
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
 * @returns {Promise<object>} Contexto operacional mínimo do server
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

        // Atualiza readiness do app HTTP para consumo do endpoint /ready
        try {
            try {
                const app = await import('./engine/app.js').then(m => m.default ?? m);
                app.locals = app.locals || {};
                app.locals.runtimeReadiness = {
                    nerv: Boolean(nerv),
                    serverAdapter: Boolean(serverAdapter),
                    httpServer: Boolean(httpServer)
                };
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

if (import.meta.filename === process.argv[1]) {
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
