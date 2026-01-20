/* ==========================================================================
   src/driver/DriverLifecycleManager.js
   Audit Level: 700 — Sovereign Lifecycle Manager (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Gerenciar o ciclo de vida do driver para uma tarefa única.
                     Orquestrar a fiação sensorial e a soberania de interrupção.
   Sincronizado com: ExecutionEngine V1.6.0, BaseDriver V700,
                     TelemetryBridge V500, ipc_client V600.
========================================================================== */

const driverFactory = require('./factory');
const { log } = require('../core/logger');

class DriverLifecycleManager {
    /**
     * @param {object} page - Instância ativa do Puppeteer (Aba alvo).
     * @param {object} task - Objeto da Tarefa (Schema V4 Gold).
     * @param {object} config - Configuração consolidada do sistema.
     */
    constructor(page, task, config) {
        this.page = page;
        this.task = task;
        this.config = config;
        this.driver = null;

        // [V700] Sinal Soberano Único: O "Kill Switch" local da tarefa.
        this.abortController = new AbortController();

        // [IPC 2.0] Identidade e Causalidade
        this.taskId = task.meta.id;
        this.correlationId = task.meta.correlation_id || task.meta.id;

        // Bind de métodos para preservação de contexto em barramentos de eventos
        this._handleStateChange = this._handleStateChange.bind(this);
        this._handleProgress = this._handleProgress.bind(this);
    }

    /**
     * Adquire o driver da Factory e realiza a instrumentação sensorial completa.
     * @returns {Promise<object>} Instância do driver configurada e telemetrada.
     */
    async acquire() {
        try {
            log('DEBUG', `[LIFECYCLE] Iniciando aquisição de driver para tarefa: ${this.taskId}`, this.correlationId);

            // 1. Obtém instância da Factory injetando o sinal de aborto da tarefa
            this.driver = driverFactory.getDriver(
                this.task.spec.target,
                this.page,
                this.config,
                this.abortController.signal
            );

            // 2. [IPC 2.0] Injeção de Causalidade: Conecta o robô ao rastro da transação
            if (typeof this.driver.setCorrelationId === 'function') {
                this.driver.setCorrelationId(this.correlationId);
            }

            // 3. [ONDA 2] TODO: Telemetria via DriverNERVAdapter (desacoplado via NERV)
            // O adapter será responsável por escutar eventos do driver e emitir via NERV

            // 4. LIMPEZA E VÍNCULO DE TELEMETRIA DE ESTADO
            // Garante que o objeto Task reflita a máquina de estados do Driver.
            this.driver.removeAllListeners('state_change');
            this.driver.removeAllListeners('progress');

            this.driver.on('state_change', this._handleStateChange);
            this.driver.on('progress', this._handleProgress);

            return this.driver;

        } catch (e) {
            log('ERROR', `[LIFECYCLE] Falha catastrófica na ignição do driver: ${e.message}`, this.correlationId);
            throw e;
        }
    }

    /**
     * Libera recursos, aborta operações pendentes e destrói a instância do driver.
     * Garante a higiene total da memória e do barramento de eventos.
     */
    async release() {
        log('DEBUG', `[LIFECYCLE] Iniciando sequência de liberação: ${this.taskId}`, this.correlationId);

        // 1. Aciona o sinal de aborto (Propagação física para o motor de automação)
        if (!this.abortController.signal.aborted) {
            this.abortController.abort();
        }

        if (this.driver) {
            // 2. DESACOPLAMENTO DE EVENTOS (Zero Leak Policy)
            this.driver.removeListener('state_change', this._handleStateChange);
            this.driver.removeListener('progress', this._handleProgress);

            // 3. DESTRUIÇÃO FÍSICA
            // Gatilha a auto-evicção do cache na Factory e libera handles do Puppeteer.
            await this.driver.destroy().catch(err => {
                log('WARN', `[LIFECYCLE] Erro no descarte do driver: ${err.message}`, this.correlationId);
            });
        }

        this.driver = null;
        this.page = null;
    }

    /* ==========================================================================
       HANDLERS DE TELEMETRIA (PONTE ENTRE DRIVER E TASK STATE)
    ========================================================================== */

    /**
     * Sincroniza a mudança de estado do Driver com o histórico da Tarefa.
     */
    async _handleStateChange(data) {
        // Validação de Token de Segurança
        if (this.task.meta.id !== this.taskId) {return;}

        this.task.state.status = data.to;
        this.task.state.history.push({
            ts: new Date().toISOString(),
            event: 'DRIVER_STATE_CHANGE',
            msg: `Transição: ${data.from} -> ${data.to}`
        });

        log('DEBUG', `[LIFECYCLE] Driver State: ${data.to}`, this.correlationId);
    }

    /**
     * Atualiza a estimativa de progresso da tarefa no objeto persistente.
     */
    async _handleProgress(data) {
        if (this.task.meta.id !== this.taskId) {return;}

        // Estimativa baseada no volume de dados processados (Bytes/Chars)
        const estimated = Math.min(99, Math.round((data.length / 5000) * 100));
        this.task.state.progress_estimate = estimated;
    }

    /**
     * Getter para o sinal de aborto (Soberania de execução).
     */
    get signal() {
        return this.abortController.signal;
    }
}

module.exports = DriverLifecycleManager;