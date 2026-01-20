/* ==========================================================================
   src/driver/nerv_adapter/driver_nerv_adapter.js
   Subsistema: DRIVER — NERV Adapter
   Audit Level: 800 — Critical Decoupling Layer (Singularity Edition)

   Responsabilidade:
   - Adaptar NERV (pub/sub) para o domínio do DRIVER
   - Gerenciar instâncias de DriverLifecycleManager
   - Escutar COMMANDS vindos do KERNEL via NERV
   - Emitir EVENTS de telemetria do driver via NERV
   - Garantir ZERO acoplamento direto com outros subsistemas

   Princípios:
   - NÃO importa KERNEL, SERVER ou INFRA diretamente
   - NÃO acessa filesystem diretamente (usa KERNEL para decisões)
   - NÃO decide estratégias (apenas executa ordens)
   - Comunicação 100% via NERV
========================================================================== */

const DriverLifecycleManager = require('../DriverLifecycleManager');
const { log } = require('../../core/logger');
const { ActionCode, MessageType, ActorRole } = require('../../shared/nerv/constants');

class DriverNERVAdapter {
    /**
     * @param {Object} nerv - Instância do NERV (IPC transport)
     * @param {Object} browserPool - Gerenciador do pool de conexões Chrome
     * @param {Object} config - Configuração do sistema
     */
    constructor(nerv, browserPool, config) {
        if (!nerv) {
            throw new Error('[DriverNERVAdapter] NERV instance required');
        }
        if (!browserPool) {
            throw new Error('[DriverNERVAdapter] BrowserPool required');
        }

        this.nerv = nerv;
        this.browserPool = browserPool;
        this.config = config;

        // Mapa de drivers ativos: taskId -> DriverLifecycleManager
        this.activeDrivers = new Map();

        // Estatísticas observacionais
        this.stats = {
            tasksExecuted: 0,
            tasksAborted: 0,
            driversCrashed: 0,
            vitalsEmitted: 0
        };

        // Setup de listeners NERV
        this._setupListeners();

        log('INFO', '[DriverNERVAdapter] Inicializado e conectado ao NERV');
    }

    /**
     * Configura listeners para comandos NERV destinados ao DRIVER.
     * Todos os comandos chegam via pub/sub do NERV.
     */
    _setupListeners() {
        // Escuta comandos do tipo DRIVER_* vindos do KERNEL
        this.nerv.onReceive(envelope => {
            // Filtra apenas mensagens para o domínio DRIVER
            if (envelope.messageType !== MessageType.COMMAND) {
                return;
            }
            if (!envelope.actionCode.startsWith('DRIVER_')) {
                return;
            }

            this._handleDriverCommand(envelope).catch(err => {
                log('ERROR', `[DriverNERVAdapter] Erro ao processar comando: ${err.message}`, envelope.correlationId);

                // Emite evento de falha
                this._emitEvent(
                    ActionCode.DRIVER_ERROR,
                    {
                        error: err.message,
                        taskId: envelope.payload?.taskId,
                        originalCommand: envelope.actionCode
                    },
                    envelope.correlationId
                );
            });
        });

        log('DEBUG', '[DriverNERVAdapter] Listeners configurados para DRIVER_* commands');
    }

    /**
     * Processa comandos DRIVER vindos do NERV.
     */
    async _handleDriverCommand(envelope) {
        const { actionCode, payload, correlationId } = envelope;

        log('DEBUG', `[DriverNERVAdapter] Recebido comando: ${actionCode}`, correlationId);

        switch (actionCode) {
            case ActionCode.DRIVER_EXECUTE_TASK:
                await this._executeTask(payload, correlationId);
                break;

            case ActionCode.DRIVER_ABORT:
                await this._abortTask(payload, correlationId);
                break;

            case ActionCode.DRIVER_HEALTH_CHECK:
                await this._performHealthCheck(payload, correlationId);
                break;

            default:
                log('WARN', `[DriverNERVAdapter] Comando desconhecido: ${actionCode}`, correlationId);
        }
    }

    /**
     * Executa uma tarefa usando DriverLifecycleManager.
     * Aloca página do BrowserPool, cria driver, executa e monitora.
     */
    async _executeTask(payload, correlationId) {
        const { task } = payload;

        if (!task || !task.meta || !task.meta.id) {
            throw new Error('Task inválida recebida via NERV');
        }

        const taskId = task.meta.id;

        log('INFO', `[DriverNERVAdapter] Iniciando execução: ${taskId}`, correlationId);

        // 1. Verifica se já existe driver para essa task
        if (this.activeDrivers.has(taskId)) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} já possui driver ativo`, correlationId);
            return;
        }

        let page = null;
        let lifecycleManager = null;

        try {
            // 2. Aloca página do pool
            page = await this.browserPool.allocate(task.spec.target);

            // 3. Cria DriverLifecycleManager
            lifecycleManager = new DriverLifecycleManager(page, task, this.config);
            this.activeDrivers.set(taskId, lifecycleManager);

            // 4. Adquire driver da Factory
            const driver = await lifecycleManager.acquire();

            // 5. Conecta listeners de telemetria do driver
            this._attachDriverTelemetry(driver, taskId, correlationId);

            // 6. Emite evento de início
            this._emitEvent(
                ActionCode.DRIVER_TASK_STARTED,
                {
                    taskId,
                    target: task.spec.target,
                    driverType: driver.constructor.name
                },
                correlationId
            );

            // 7. Executa a tarefa (método execute do driver)
            const result = await driver.execute(task.spec.prompt);

            // 8. Emite evento de conclusão
            this._emitEvent(
                ActionCode.DRIVER_TASK_COMPLETED,
                {
                    taskId,
                    result: {
                        status: 'SUCCESS',
                        outputLength: result?.length || 0,
                        duration: Date.now() - task.meta.created_at
                    }
                },
                correlationId
            );

            this.stats.tasksExecuted++;
        } catch (error) {
            log('ERROR', `[DriverNERVAdapter] Falha na execução: ${error.message}`, correlationId);

            this._emitEvent(
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    error: error.message,
                    errorType: error.constructor.name
                },
                correlationId
            );

            this.stats.driversCrashed++;
        } finally {
            // 9. Libera recursos
            if (lifecycleManager) {
                await lifecycleManager.release();
                this.activeDrivers.delete(taskId);
            }

            if (page) {
                await this.browserPool.release(page);
            }
        }
    }

    /**
     * Aborta uma tarefa em execução.
     */
    async _abortTask(payload, correlationId) {
        const { taskId } = payload;

        const lifecycleManager = this.activeDrivers.get(taskId);

        if (!lifecycleManager) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} não encontrada para abortar`, correlationId);
            return;
        }

        log('INFO', `[DriverNERVAdapter] Abortando task: ${taskId}`, correlationId);

        await lifecycleManager.release();
        this.activeDrivers.delete(taskId);

        this._emitEvent(
            ActionCode.DRIVER_TASK_ABORTED,
            {
                taskId,
                reason: 'USER_REQUESTED'
            },
            correlationId
        );

        this.stats.tasksAborted++;
    }

    /**
     * Realiza health check do adapter e drivers ativos.
     */
    async _performHealthCheck(payload, correlationId) {
        const health = {
            adapter: 'HEALTHY',
            activeDrivers: this.activeDrivers.size,
            stats: { ...this.stats },
            browserPoolHealth: await this.browserPool.getHealth()
        };

        this._emitEvent(ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

        log('DEBUG', `[DriverNERVAdapter] Health check: ${this.activeDrivers.size} drivers ativos`, correlationId);
    }

    /**
     * Conecta listeners aos eventos do driver (state_change, progress, vitals).
     * Emite via NERV para observação do KERNEL e SERVER.
     */
    _attachDriverTelemetry(driver, taskId, correlationId) {
        // Listener para mudanças de estado
        driver.on('state_change', data => {
            this._emitEvent(
                ActionCode.DRIVER_STATE_OBSERVED,
                {
                    taskId,
                    stateTransition: data,
                    timestamp: new Date().toISOString()
                },
                correlationId
            );
        });

        // Listener para progresso
        driver.on('progress', data => {
            this._emitEvent(
                ActionCode.DRIVER_VITAL,
                {
                    taskId,
                    vitalType: 'PROGRESS',
                    data,
                    timestamp: new Date().toISOString()
                },
                correlationId
            );

            this.stats.vitalsEmitted++;
        });

        // Listener para anomalias (se disponível)
        if (typeof driver.on === 'function') {
            driver.on('anomaly', data => {
                this._emitEvent(
                    ActionCode.DRIVER_ANOMALY,
                    {
                        taskId,
                        anomalyType: data.type,
                        severity: data.severity,
                        details: data.message
                    },
                    correlationId
                );
            });
        }
    }

    /**
     * Emite um evento via NERV.
     * Wrapper para padronizar emissões do adapter.
     */
    _emitEvent(actionCode, payload, correlationId) {
        this.nerv.emitEvent({
            actor: ActorRole.DRIVER,
            actionCode,
            payload,
            correlationId
        });

        log('DEBUG', `[DriverNERVAdapter] Evento emitido: ${actionCode}`, correlationId);
    }

    /**
     * Shutdown gracioso do adapter.
     * Aborta todas as tasks ativas e libera recursos.
     */
    async shutdown() {
        log('INFO', `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos)`);

        const shutdownPromises = [];

        for (const [taskId, lifecycleManager] of this.activeDrivers.entries()) {
            shutdownPromises.push(
                lifecycleManager.release().catch(err => {
                    log('ERROR', `[DriverNERVAdapter] Erro ao liberar driver ${taskId}: ${err.message}`);
                })
            );
        }

        await Promise.all(shutdownPromises);
        this.activeDrivers.clear();

        log('INFO', '[DriverNERVAdapter] Shutdown concluído');
    }

    /**
     * Retorna estatísticas observacionais do adapter.
     */
    getStats() {
        return {
            ...this.stats,
            activeDrivers: this.activeDrivers.size
        };
    }
}

module.exports = DriverNERVAdapter;
