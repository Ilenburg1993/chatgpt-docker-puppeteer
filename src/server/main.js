// @ts-check - Type checking rigoroso habilitado (arquivo core)

import '#core/env_bootstrap';
import * as Authority from '#core/authority';
import { shouldAutobootEntrypoint } from '#core/entrypoint_guard';
import { getJwtSecret } from '#core/jwt_config';
import { log } from '#core/logger';
import { readPositiveInt, retryWithBackoff } from '#core/retry_policy';
import {
    clearRuntimeResources,
    getRuntimeReadinessSummary,
    setRuntimeResourceState,
    upsertRuntimeResource,
} from '#core/runtime_resource_registry';

/* ==========================================================================
   IPC DISCOVERY STATE — PERSISTÊNCIA CANÔNICA
========================================================================== */

/**
 * Persiste estado mínimo do processo SERVER para descoberta por outros
 * processos (ex: Maestro).
 *
 * Propriedades:
 *   ✔ Publicação via NERV (assíncrona, observável)
 *   ✔ Commit atômico via arquivo temporário (fallback)
 *   ✔ Nunca retorna estado parcialmente gravado
 *
 * @param {{discovery: typeof import('#nerv/discovery'), protocolVersion: string, singularityMode: string}} deps
 * @param {object} nerv - Instância NERV para publicação de eventos
 * @param {number} port - Porta efetivamente bound pelo HTTP engine
 * @param {'standalone'|'delegated'} [authority='standalone'] - Modo de autoridade do servidor
 * @sideEffects - Publica estado via Discovery (NERV-first, file fallback)
 * @returns {Promise<void>}
 */
async function persistServerState(deps, nerv, port, authority = Authority.SERVER_AUTHORITIES.STANDALONE) {
    const { discovery, protocolVersion, singularityMode } = deps;

    // Legacy compatibility hook: discovery is now canonical via NERV (SERVER_READY).
    // We delegate to the discovery helper which prefers NERV and only falls back
    // to file-based persistence if explicitly enabled via `ENABLE_STATE_FILE=true`.
    const payload = {
        port,
        server_port: port,
        pid: process.pid,
        server_started_at: new Date().toISOString(),
        protocol: protocolVersion,
        mode: singularityMode,
        role: 'server',
        authority,
    };

    try {
        await discovery.publishServerReady(nerv, payload);
        log('DEBUG', '[BOOT] persistServerState delegated to Discovery (NERV-first, file fallback opt-in)');
    } catch (err) {
        log('WARN', `[BOOT] persistServerState delegation failed: ${err.message}`);
    }
}

function envFlag(name, defaultValue) {
    const raw = process.env[name];
    if (raw === undefined) {
        return defaultValue;
    }
    const value = String(raw).trim().toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
    return defaultValue;
}

function validateDashboardAuthConfig(config) {
    const authRequired = config?.DASHBOARD_AUTH_REQUIRED ?? envFlag('DASHBOARD_AUTH_REQUIRED', true);
    const socketAuthRequired =
        config?.DASHBOARD_SOCKET_AUTH_REQUIRED ?? envFlag('DASHBOARD_SOCKET_AUTH_REQUIRED', true);
    if (!authRequired) {
        if (!socketAuthRequired) {
            return;
        }
    }

    const username = String(config?.DASHBOARD_AUTH_USERNAME || process.env.DASHBOARD_AUTH_USERNAME || '').trim();
    const password = String(config?.DASHBOARD_AUTH_PASSWORD || process.env.DASHBOARD_AUTH_PASSWORD || '');

    if (authRequired && !username) {
        throw new Error('[BOOT] DASHBOARD_AUTH_REQUIRED=true, mas DASHBOARD_AUTH_USERNAME está ausente');
    }

    if (authRequired && password.length < 12) {
        throw new Error(
            '[BOOT] DASHBOARD_AUTH_REQUIRED=true, mas DASHBOARD_AUTH_PASSWORD deve ter ao menos 12 caracteres'
        );
    }

    // Garante contrato de segurança do JWT antes do runtime aceitar conexões dashboard.
    getJwtSecret();
}

let __readySignalSent = false;
function sendReadySignalOnce() {
    if (__readySignalSent) return;
    if (typeof process.send !== 'function') return;
    process.send('ready');
    __readySignalSent = true;
}

async function publishServerReadyWithRetry({ nerv, payload, highLevelNerv, actorRole, actionCode, config }) {
    let attempt = 0;
    const maxAttempts = Math.max(2, Math.min(3, readPositiveInt(config?.BOOT_RETRY_MAX_ATTEMPTS, 3)));
    const baseDelayMs = readPositiveInt(config?.BOOT_RETRY_BASE_MS, 1000);
    const maxDelayMs = readPositiveInt(config?.BOOT_RETRY_MAX_MS, 8000);

    await retryWithBackoff(
        async () => {
            attempt += 1;
            await highLevelNerv.sendEvent(nerv, actorRole, actionCode, payload);
        },
        {
            maxAttempts,
            baseDelayMs,
            maxDelayMs,
            onRetry: ({ attempt: currentAttempt, maxAttempts: totalAttempts, error, delayMs }) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log(
                    'WARN',
                    `[BOOT] NERV SERVER_READY tentativa ${currentAttempt}/${totalAttempts} falhou: ${errorMessage}. Retry em ${delayMs}ms`
                );
            },
        }
    );

    return { attempt, maxAttempts };
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
    const runtimeOwner = 'dashboard-web';

    try {
        clearRuntimeResources(runtimeOwner);
        const [
            { default: CONFIG },
            { CONNECTION_MODES },
            HighLevelNERV,
            Discovery,
            NERV,
            { ActionCode, ActorRole, PROTOCOL_VERSION },
            snapshot,
            lifecycle,
            serverEngine,
            socketHub,
            { default: ServerNERVAdapter },
            pm2Bridge,
            ssotEventFeed,
            logTail,
            hardwareTelemetry,
            { default: reconciler },
            fsWatcher,
            logWatcher,
            { default: appInstance },
            routerModule,
            { default: telemetryAggregator },
        ] = await Promise.all([
            import('#core/config'),
            import('#core/constants/browser'),
            import('#nerv/adapters/high_level_adapter'),
            import('#nerv/discovery'),
            import('#nerv/nerv'),
            import('#shared/nerv/constants'),
            import('#shared/telemetry/snapshot'),
            import('./engine/lifecycle.js'),
            import('./engine/server.js'),
            import('./engine/socket.js'),
            import('./nerv_adapter/server_nerv_adapter.js'),
            import('./realtime/bus/pm2_bridge.js'),
            import('./realtime/ssot_event_feed.js'),
            import('./realtime/streams/log_tail.js'),
            import('./realtime/telemetry/hardware.js'),
            import('./supervisor/reconcilier.js'),
            import('./watchers/fs_watcher.js'),
            import('./watchers/log_watcher.js'),
            import('./engine/app.js'),
            import('./api/router.js'),
            import('#server/dashboard-api/telemetry_aggregator'),
        ]);
        const applyRoutes = routerModule?.applyRoutes;
        validateDashboardAuthConfig(CONFIG);
        try {
            const { bootstrapRbacFromEnv } = await import('#infra/db/rbac_repo');
            bootstrapRbacFromEnv();
            log('DEBUG', '[BOOT] RBAC bootstrap aplicado');
        } catch (err) {
            log('WARN', `[BOOT] Falha no bootstrap RBAC: ${err?.message || String(err)}`);
        }

        log('INFO', `🚀 Server Process — Canonical Bootstrap (authority=${authority})`);
        const requestedSyncMode = CONFIG.DASHBOARD_TASK_SYNC_MODE || 'ssot_feed';
        const legacyBridgeContingency = Boolean(
            CONFIG.DASHBOARD_LEGACY_BRIDGE_CONTINGENCY || envFlag('DASHBOARD_LEGACY_BRIDGE_CONTINGENCY', false)
        );
        const dashboardTaskSyncMode =
            requestedSyncMode === 'legacy_bridge' && legacyBridgeContingency ? 'legacy_bridge' : 'ssot_feed';
        if (requestedSyncMode === 'legacy_bridge' && !legacyBridgeContingency) {
            log(
                'WARN',
                '[BOOT] DASHBOARD_TASK_SYNC_MODE=legacy_bridge ignorado; habilite DASHBOARD_LEGACY_BRIDGE_CONTINGENCY=true apenas em contingência'
            );
        }

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
        const basePort = /** @type {number} */ (CONFIG.SERVER_PORT);
        const { server: httpServer, port, protocol } = await serverEngine.start(basePort);
        setRuntimeResourceState('http_server', 'ready', {
            owner: runtimeOwner,
            criticality: 'required',
        });

        // Log protocol info
        if (protocol) {
            log('INFO', `[SERVER] Servidor iniciado com protocolo: ${protocol}`);
        }

        /* --------------------------------------------------------------
         FASE 3 — Estado IPC
         Só após porta real conhecida.
         Em modo delegated, evitamos escrita do arquivo de discovery
         pois o Maestro é responsável pela descoberta/coordenação.
      -------------------------------------------------------------- */
        // Movido para depois da criação do NERV (FASE 8)

        /* --------------------------------------------------------------
           FASE 4 — Socket Hub
           Acoplado sobre servidor já bound.
        -------------------------------------------------------------- */
        socketHub.init(httpServer);
        log('DEBUG', '[BOOT] Socket hub acoplado');
        upsertRuntimeResource({
            id: 'socket_hub',
            owner: runtimeOwner,
            criticality: 'required',
            state: 'ready',
            stop: async () => {
                if (socketHub && typeof socketHub.stop === 'function') {
                    await socketHub.stop();
                }
            },
        });

        // Dashboard vNext: SSOT DB Event Feed (realtime via SQLite events table)
        if (dashboardTaskSyncMode === 'ssot_feed') {
            try {
                const intervalMs = Number(process.env.SSOT_EVENT_FEED_INTERVAL_MS || 250) || 250;
                const batchLimit = Number(process.env.SSOT_EVENT_FEED_BATCH_LIMIT || 500) || 500;
                ssotEventFeed.start({ socketHub, intervalMs, batchLimit });
                upsertRuntimeResource({
                    id: 'ssot_feed',
                    owner: runtimeOwner,
                    criticality: 'optional',
                    state: 'ready',
                    stop: () => {
                        if (typeof ssotEventFeed.stop === 'function') {
                            ssotEventFeed.stop();
                        }
                    },
                });
            } catch (err) {
                log('WARN', `[BOOT] Falha ao iniciar SSOTEventFeed: ${err.message}`);
                setRuntimeResourceState('ssot_feed', 'degraded', {
                    owner: runtimeOwner,
                    criticality: 'optional',
                    reasonCode: 'SSOT_EVENT_FEED_START_FAILED',
                    message: err?.message || String(err),
                });
            }
        } else {
            log('INFO', `[BOOT] SSOTEventFeed desativado (DASHBOARD_TASK_SYNC_MODE=${dashboardTaskSyncMode})`);
            setRuntimeResourceState('ssot_feed', 'stopped', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'SSOT_FEED_DISABLED_BY_MODE',
            });
        }

        // Dashboard V2: TelemetryAggregator (realtime metrics)
        try {
            const intervalMs = Number(process.env.DASHBOARD_TELEMETRY_INTERVAL_MS || 1000) || 1000;
            telemetryAggregator.start({ socketHub, intervalMs });
            log('INFO', `[BOOT] Dashboard telemetry aggregator ativo (interval=${intervalMs}ms)`);
            upsertRuntimeResource({
                id: 'telemetry_aggregator',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof telemetryAggregator.stop === 'function') {
                        telemetryAggregator.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] Falha ao iniciar TelemetryAggregator: ${err.message}`);
            setRuntimeResourceState('telemetry_aggregator', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'TELEMETRY_AGGREGATOR_START_FAILED',
                message: err?.message || String(err),
            });
        }

        /* --------------------------------------------------------------
         FASE 5 — API Gateway
         Router injeta rotas — não cria servidor.
      -------------------------------------------------------------- */
        // Expõe autoridade no app para que controllers possam atuar de forma
        // conservadora (ex.: negar operações de lifecycle quando delegated)
        try {
            appInstance.locals = appInstance.locals || {};
            appInstance.locals.authority = authority;
        } catch (e) {
            /* noop */
        }

        if (typeof applyRoutes !== 'function') {
            throw new Error('router.applyRoutes indisponível');
        }
        await applyRoutes(appInstance);
        log('DEBUG', '[BOOT] Rotas HTTP consolidadas');

        try {
            const { startPeriodicCleanup, stopPeriodicCleanup } = await import('#infra/db/token_blocklist');
            startPeriodicCleanup();
            log('DEBUG', '[BOOT] Token blocklist cleanup periódico iniciado');
            upsertRuntimeResource({
                id: 'token_blocklist_cleanup',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof stopPeriodicCleanup === 'function') {
                        stopPeriodicCleanup();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] Falha ao iniciar token blocklist cleanup: ${err.message}`);
            setRuntimeResourceState('token_blocklist_cleanup', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'TOKEN_BLOCKLIST_CLEANUP_START_FAILED',
                message: err?.message || String(err),
            });
        }

        /* --------------------------------------------------------------
           FASE 6 — Telemetria
        -------------------------------------------------------------- */
        try {
            pm2Bridge.init();
            log('DEBUG', '[BOOT] PM2 Bridge inicializado');
            upsertRuntimeResource({
                id: 'pm2_bridge',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof pm2Bridge.stop === 'function') {
                        pm2Bridge.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] PM2 Bridge init falhou: ${err.message}`);
            setRuntimeResourceState('pm2_bridge', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'PM2_BRIDGE_INIT_FAILED',
                message: err?.message || String(err),
            });
        }

        try {
            logTail.init();
            log('DEBUG', '[BOOT] LogTail inicializado');
            upsertRuntimeResource({
                id: 'log_tail',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof logTail.stop === 'function') {
                        logTail.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] LogTail init falhou: ${err.message}`);
            setRuntimeResourceState('log_tail', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'LOG_TAIL_INIT_FAILED',
                message: err?.message || String(err),
            });
        }

        try {
            hardwareTelemetry.init();
            log('DEBUG', '[BOOT] Hardware Telemetry inicializado');
            upsertRuntimeResource({
                id: 'hardware_telemetry',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof hardwareTelemetry.stop === 'function') {
                        hardwareTelemetry.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] Hardware Telemetry init falhou: ${err.message}`);
            setRuntimeResourceState('hardware_telemetry', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'HARDWARE_TELEMETRY_INIT_FAILED',
                message: err?.message || String(err),
            });
        }

        // Inicia snapshot de telemetria em background para respostas rápidas
        try {
            const intervalMs = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '60000', 10);
            snapshot.start(intervalMs);
        } catch (e) {
            log('WARN', `[BOOT] Falha ao iniciar snapshot de telemetria: ${e.message}`);
        }

        log('DEBUG', '[BOOT] Telemetria online com snapshot');

        /* --------------------------------------------------------------
           FASE 7 — Watchers
        -------------------------------------------------------------- */
        try {
            fsWatcher.init();
            log('DEBUG', '[BOOT] FS Watcher inicializado');
            upsertRuntimeResource({
                id: 'fs_watcher',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof fsWatcher.stop === 'function') {
                        fsWatcher.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] FS Watcher init falhou: ${err.message}`);
            setRuntimeResourceState('fs_watcher', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'FS_WATCHER_INIT_FAILED',
                message: err?.message || String(err),
            });
        }

        try {
            logWatcher.init();
            log('DEBUG', '[BOOT] Log Watcher inicializado');
            upsertRuntimeResource({
                id: 'log_watcher',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'ready',
                stop: () => {
                    if (typeof logWatcher.stop === 'function') {
                        logWatcher.stop();
                    }
                },
            });
        } catch (err) {
            log('WARN', `[BOOT] Log Watcher init falhou: ${err.message}`);
            setRuntimeResourceState('log_watcher', 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'LOG_WATCHER_INIT_FAILED',
                message: err?.message || String(err),
            });
        }

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
                telemetry: true,
            });

            log('DEBUG', '[BOOT] NERV local criado (standalone)');
        } else {
            log('DEBUG', '[BOOT] NERV injetado (delegated)');
        }
        setRuntimeResourceState('nerv_runtime', 'ready', {
            owner: runtimeOwner,
            criticality: 'required',
        });

        // Dashboard legacy bridge: habilitado apenas em contingência explícita.
        if (dashboardTaskSyncMode === 'legacy_bridge') {
            try {
                const taskSyncBridge = await import('#server/dashboard-api/task_sync_bridge').then(
                    module => module.default ?? null
                );
                if (taskSyncBridge && typeof taskSyncBridge.initialize === 'function') {
                    taskSyncBridge.initialize({ socketHub, nervClient: nerv });
                    log('WARN', '[BOOT] TaskSyncBridge inicializado (contingência legacy_bridge)');
                    upsertRuntimeResource({
                        id: 'task_sync_bridge',
                        owner: runtimeOwner,
                        criticality: 'optional',
                        state: 'ready',
                        stop: () => {
                            if (typeof taskSyncBridge.clearAll === 'function') {
                                taskSyncBridge.clearAll();
                            }
                        },
                    });
                } else {
                    log('WARN', '[BOOT] TaskSyncBridge indisponível para modo legacy_bridge');
                    setRuntimeResourceState('task_sync_bridge', 'degraded', {
                        owner: runtimeOwner,
                        criticality: 'optional',
                        reasonCode: 'TASK_SYNC_BRIDGE_MISSING',
                    });
                }
            } catch (err) {
                log('WARN', `[BOOT] Falha ao inicializar TaskSyncBridge: ${err.message}`);
                setRuntimeResourceState('task_sync_bridge', 'degraded', {
                    owner: runtimeOwner,
                    criticality: 'optional',
                    reasonCode: 'TASK_SYNC_BRIDGE_START_FAILED',
                    message: err?.message || String(err),
                });
            }
        } else {
            log('INFO', `[BOOT] TaskSyncBridge desativado (modo efetivo=${dashboardTaskSyncMode})`);
            setRuntimeResourceState('task_sync_bridge', 'stopped', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: 'TASK_SYNC_BRIDGE_DISABLED_BY_MODE',
            });
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
                    httpAuthority: Boolean(port),
                };

                // Publicação SERVER_READY com política unificada de retry/backoff.
                let nervPublished = false;
                try {
                    const { attempt, maxAttempts } = await publishServerReadyWithRetry({
                        nerv,
                        payload,
                        highLevelNerv: HighLevelNERV,
                        actorRole: ActorRole.SERVER,
                        actionCode: ActionCode.SERVER_READY,
                        config: CONFIG,
                    });
                    const level = attempt > 1 ? 'INFO' : 'DEBUG';
                    log(level, `[BOOT] Evento NERV SERVER_READY publicado na tentativa ${attempt}/${maxAttempts}`);
                    nervPublished = true;
                } catch (retryErr) {
                    log('ERROR', `[BOOT] CRITICAL: SERVER_READY falhou após retries: ${retryErr.message}`);

                    // Se em modo standalone, discovery é crítica
                    if (Authority.isStandalone(authority)) {
                        throw new Error(`Discovery crítica falhou: ${retryErr.message}`, { cause: retryErr });
                    }
                }

                // Fallback: persistServerState (file-based discovery)
                try {
                    await persistServerState(
                        {
                            discovery: Discovery,
                            protocolVersion: PROTOCOL_VERSION || '2.0.0',
                            singularityMode: CONNECTION_MODES.SINGULARITY,
                        },
                        nerv,
                        port,
                        authority
                    );
                } catch (persistErr) {
                    log('ERROR', `[BOOT] persistServerState falhou: ${persistErr.message}`);
                    if (!nervPublished && Authority.isStandalone(authority)) {
                        throw new Error('Discovery falhou completamente (NERV + persistServerState)', {
                            cause: persistErr,
                        });
                    }
                }
            } catch (err) {
                log('ERROR', `[BOOT] Falha crítica na publicação SERVER_READY: ${err.message}`);
                throw err; // Re-throw para abortar boot se standalone
            }
        } else {
            log('DEBUG', '[BOOT] SERVER_READY skip (delegated) — Maestro é responsável pela publicação');
        }

        /* --------------------------------------------------------------
         FASE 9 — Adapter NERV ⇄ Socket
      -------------------------------------------------------------- */
        const serverAdapter = new ServerNERVAdapter(nerv, socketHub);
        log('INFO', '[BOOT] ServerNERVAdapter ativo');
        setRuntimeResourceState('server_adapter', 'ready', {
            owner: runtimeOwner,
            criticality: 'required',
        });

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
            sendReadySignalOnce();
            log('DEBUG', '[BOOT] PM2 ready signal sent');
        } catch (e) {
            // noop
        }

        // Atualiza readiness do app HTTP para consumo do endpoint /ready
        try {
            upsertRuntimeResource({
                id: 'mcp_upstreams',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'unknown',
                stop: async () => {
                    const { shutdownUpstreams } = await import('../integration/mcp/upstream-manager.mjs');
                    if (typeof shutdownUpstreams === 'function') {
                        await shutdownUpstreams();
                    }
                },
            });
            upsertRuntimeResource({
                id: 'lsp_daemon',
                owner: runtimeOwner,
                criticality: 'optional',
                state: 'unknown',
                stop: async () => {
                    const { stopTsserverDaemon } = await import('../integration/lsp/tsserver-daemon.mjs');
                    if (typeof stopTsserverDaemon === 'function') {
                        await stopTsserverDaemon();
                    }
                },
            });

            appInstance.locals = appInstance.locals || {};
            appInstance.locals.runtimeReadiness = Object.assign({}, appInstance.locals.runtimeReadiness || null, {
                nerv: Boolean(nerv),
                serverAdapter: Boolean(serverAdapter),
                httpServer: Boolean(httpServer),
            });
            appInstance.locals.requiredReadiness = appInstance.locals.requiredReadiness || ['nerv'];
            appInstance.locals.getRuntimeResourcesStatus = () =>
                getRuntimeReadinessSummary({
                    owner: runtimeOwner,
                    requiredComponents: ['http_server', 'nerv_runtime', 'server_adapter'],
                    allowDegradedReady: CONFIG.BOOT_DEGRADED_READY_ALLOWED !== false,
                });

            const upstreamStatusGetter = appInstance.locals.getMcpUpstreamsStatus;
            const upstreams = typeof upstreamStatusGetter === 'function' ? upstreamStatusGetter() : [];
            const hasRequiredUpstreamDown = Array.isArray(upstreams)
                ? upstreams.some(item => item?.required && item?.enabled !== false && item?.ready !== true)
                : false;

            if (hasRequiredUpstreamDown) {
                setRuntimeResourceState('mcp_upstreams', 'degraded', {
                    owner: runtimeOwner,
                    criticality: 'optional',
                    reasonCode: 'UPSTREAM_UNREADY',
                    message: 'Há upstream obrigatório ainda indisponível',
                });
            } else {
                setRuntimeResourceState('mcp_upstreams', 'ready', {
                    owner: runtimeOwner,
                    criticality: 'optional',
                });
            }

            const mcpTools = appInstance.locals?.mcp?.tools;
            const hasLspTools = Array.isArray(mcpTools) && mcpTools.some(tool => String(tool || '').startsWith('lsp_'));
            setRuntimeResourceState('lsp_daemon', hasLspTools ? 'ready' : 'degraded', {
                owner: runtimeOwner,
                criticality: 'optional',
                reasonCode: hasLspTools ? null : 'LSP_TOOLS_NOT_EXPOSED',
                message: hasLspTools ? null : 'MCP não expôs ferramentas LSP neste ciclo',
            });

            log('DEBUG', '[BOOT] runtimeReadiness definido no app (server process)');
        } catch (err) {
            log(
                'WARN',
                `[BOOT] Não foi possível definir runtimeReadiness no app: ${err && err.message ? err.message : String(err)}`
            );
        }

        return {
            port,
            httpServer,
            nerv,
            serverAdapter,
            authority,
        };
    } catch (err) {
        log('FATAL', `[BOOT] Falha crítica de bootstrap: ${err.message}`);
        if (Authority.isStandalone(authority)) {
            process.exit(1);
        }
        throw err;
    }
}

/* ==========================================================================
   ENTRYPOINT CONTROL — COMPATIBILITY LAYER
========================================================================== */

const __shouldBootstrap = shouldAutobootEntrypoint({
    importMetaUrl: import.meta.url,
    explicitAutostartEnv: 'MAESTRO_ENTRY_AUTOSTART',
    allowPm2ExecPathMatch: true,
});

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

// Compatibility exports for main.js integration
export { bootstrap as serverBootstrap };
