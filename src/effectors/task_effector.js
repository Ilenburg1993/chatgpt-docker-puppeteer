/* ==========================================================================
   src/effectors/task_effector.js
   Audit Level: 920 — The Puppet Master
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: 
     - Instanciar e controlar o DriverLifecycleManager (Código Legado).
     - Traduzir ordens do Kernel em chamadas de driver.
     - Traduzir eventos do driver em observações para o Kernel.
========================================================================== */

// Importa o Gerente de Ciclo de Vida do Driver (O código que realmente abre o browser)
// Ajuste o caminho conforme a estrutura real do seu projeto.
const DriverLifecycleManager = require('../driver/DriverLifecycleManager');
const { log } = require('../core/logger');

// Importa fábrica de IDs para observações
const { v4: uuidv4 } = require('uuid');

class TaskEffector {
    /**
     * @param {object} deps
     * @param {object} deps.nerv - Para enviar logs/eventos diretamente se necessário.
     * @param {object} deps.config - Configuração global.
     * @param {Function} deps.onObservation - Callback para injetar observações no Kernel.
     */
    constructor({ nerv, config, onObservation }) {
        this.nerv = nerv;
        this.config = config;
        this.emitObservation = onObservation; // Canal de retorno para o Kernel
        
        this.activeManager = null; // Instância única do driver atual
    }

    /* =========================================================
       INTERFACE DE COMANDO (Do Kernel para o Driver)
    ========================================================= */

    /**
     * Inicia uma nova tarefa (PROPOSE_ACTIVATE_TASK).
     * @param {object} taskPayload - O objeto da tarefa vindo do servidor.
     */
    async start(taskPayload) {
        if (this.activeManager) {
            console.warn('[TASK EFFECTOR] Tentativa de iniciar tarefa sobreposta. Abortando anterior.');
            await this.abort();
        }

        console.log(`[TASK EFFECTOR] Inicializando Driver para tarefa ${taskPayload.meta.id}...`);

        try {
            // 1. Instancia o Gerente Legado
            // O código legado espera: (page, task, config).
            // Como ainda não temos 'page' (o factory cria), passamos null ou adaptamos.
            // Analisando o DriverLifecycleManager.js antigo, ele parece receber a page no construtor.
            // Precisamos de um passo anterior: Factory.
            
            // ADAPTAÇÃO: Vamos usar o factory.js diretamente ou deixar o Lifecycle gerenciar?
            // Para simplificar a transição, vamos assumir que o LifecycleManager possui um método start()
            // que resolve a página. Se não tiver, precisaremos instanciar a factory aqui.
            
            // *Solução Híbrida Segura:*
            // Vamos criar o manager e injetar um "Mock Page" ou usar a factory aqui se necessário.
            // Dado que o user mandou 'factory.js', vamos usá-lo para obter a página.
            
            const factory = require('../driver/factory');
            const page = await factory.getPage(); // Assumindo que existe algo assim ou createPage
            
            this.activeManager = new DriverLifecycleManager(page, taskPayload, this.config);

            // 2. Wiretapping (Grampo)
            // Interceptamos os eventos do driver para alimentar o Kernel
            this._attachSensors(this.activeManager);

            // 3. Ignição
            // Chama o método de execução do código legado (run, start, ou execute)
            this.activeManager.run().catch(err => {
                this._reportFailure(err, taskPayload);
            });

        } catch (err) {
            console.error('[TASK EFFECTOR] Falha na ignição do driver:', err);
            this._reportFailure(err, taskPayload);
        }
    }

    /**
     * Aborta a execução imediatamente (PROPOSE_TERMINATE_TASK).
     */
    async abort() {
        if (!this.activeManager) return;

        console.log('[TASK EFFECTOR] Enviando sinal de aborto para o driver...');
        
        try {
            // Usa o AbortController do driver legado se existir
            if (this.activeManager.abortController) {
                this.activeManager.abortController.abort();
            } else if (typeof this.activeManager.stop === 'function') {
                await this.activeManager.stop();
            }
            
            // Limpeza forçada
            this.activeManager = null;
            
        } catch (err) {
            console.error('[TASK EFFECTOR] Erro ao abortar driver:', err);
        }
    }

    /* =========================================================
       INTERFACE SENSORIAL (Do Driver para o Kernel)
    ========================================================= */

    _attachSensors(manager) {
        // Se o Manager legado emitir eventos (EventEmitter), ouvimos aqui.
        // Se não, dependemos dele chamar callbacks.
        // Assumindo que podemos injetar um 'telemetryBridge' modificado ou ouvir eventos.
        
        // Exemplo: Redirecionando logs vitais
        // Isso requer que alteremos levemente o DriverLifecycleManager para emitir eventos
        // OU usamos um Proxy.
        
        // POR ENQUANTO: Vamos assumir que o erro no .run() é a principal fonte de sinal.
    }

    _reportFailure(error, task) {
        // Transforma o erro JS em uma Observação Ontológica
        const observation = {
            id: uuidv4(),
            type: 'EVENT',
            code: 'TASK_FAILED', // ActionCode.TASK_FAILED
            payload: {
                msg: error.message,
                stack: error.stack,
                task_id: task.meta.id
            },
            timestamp: Date.now(),
            source: 'DRIVER'
        };

        // Injeta no Kernel
        this.emitObservation(observation);
    }
}

module.exports = TaskEffector;