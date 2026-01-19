FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\kernel\adapters\task_executor.js
PASTA_BASE: kernel
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/kernel/adapters/task_executor.js
   Nível de Auditoria: 920 — Adaptador de Execução de Tarefas (Efetor Muscular)
   Status: CONSOLIDADO (Sincronizado com Protocolo 11)
   Responsabilidade: 
     - Atuar como a ponte física entre o TaskRuntime do Kernel e o Driver.
     - Orquestrar a aquisição de recursos (Páginas) via factory.js.
     - Instanciar e monitorar o DriverLifecycleManager para tarefas ativas.
     - Garantir que ordens de aborto do Kernel interrompam o Puppeteer.
========================================================================== */

const DriverLifecycleManager = require('../../driver/DriverLifecycleManager');
const driverFactory = require('../../driver/factory');
const { log } = require('../../core/logger');

/**
 * Classe TaskExecutor
 * * Este componente é o "braço" do Kernel. Ele não decide quando agir, mas
 * sabe exatamente como traduzir uma decisão lógica em uma execução real
 * no navegador, gerenciando o ciclo de vida do driver associado.
 */
class TaskExecutor {
    /**
     * @param {Object} deps - Dependências injetadas.
     * @param {Object} deps.telemetry - Barramento de telemetria para eventos do Kernel.
     * @param {Object} deps.config - Configurações globais do sistema.
     */
    constructor({ telemetry, config }) {
        this.telemetry = telemetry;
        this.config = config;
        
        /**
         * Referência ao gerenciador de ciclo de vida da tarefa atual.
         * @type {DriverLifecycleManager|null}
         */
        this.activeManager = null;
    }

    /**
     * Inicia a execução física de uma tarefa no navegador.
     * * @param {Object} taskSnapshot - Dados da tarefa (Schema V4 Gold) gerenciados pelo Kernel.
     * @returns {Promise<boolean>} - Confirmação de que a ignição foi bem-sucedida.
     */
    async execute(taskSnapshot) {
        try {
            log('INFO', `[EXECUTOR] Acionando ignição física: Tarefa ${taskSnapshot.taskId}`);

            // 1. Aquisição de Recurso (Página do Puppeteer)
            // Solicita ao factory uma aba pronta para uso.
            const page = await driverFactory.getPage();

            // 2. Acoplamento do Ciclo de Vida
            // Criamos o gerente que cuidará desta tarefa específica naquela página.
            this.activeManager = new DriverLifecycleManager(page, taskSnapshot, this.config);

            // 3. Disparo da Execução (Fluxo Assíncrono)
            // O KernelLoop não fica travado; ele continua girando enquanto o driver trabalha.
            this.activeManager.run()
                .then(() => {
                    log('INFO', `[EXECUTOR] Sucesso: Fluxo de driver finalizado para ${taskSnapshot.taskId}`);
                    this.telemetry.info('execution_finished', { taskId: taskSnapshot.taskId });
                })
                .catch(err => {
                    log('ERROR', `[EXECUTOR] Falha crítica no driver: ${err.message}`);
                    this.telemetry.error('execution_crash', { 
                        taskId: taskSnapshot.taskId, 
                        error: err.message 
                    });
                });

            return true;

        } catch (err) {
            log('FATAL', `[EXECUTOR] Erro na preparação dos recursos físicos: ${err.message}`);
            this.telemetry.error('preparation_failed', { error: err.message });
            throw err;
        }
    }

    /**
     * Implementa o "Kill Switch" soberano.
     * Interrompe o DriverLifecycleManager e limpa o cache da página no factory.
     */
    async abort() {
        if (!this.activeManager) {
            log('DEBUG', '[EXECUTOR] Aborto ignorado: Nenhuma tarefa ativa em execução.');
            return;
        }

        try {
            log('WARN', '[EXECUTOR] Ordem de aborto recebida. Interrompendo driver...');

            // 1. Sinaliza o AbortController nativo do DriverLifecycleManager
            if (this.activeManager.abortController) {
                this.activeManager.abortController.abort();
            }

            // 2. Solicita ao factory a invalidação e limpeza da página
            if (this.activeManager.page) {
                await driverFactory.invalidatePageCache(this.activeManager.page);
            }

            this.activeManager = null;
            log('INFO', '[EXECUTOR] Sistema físico limpo e parado com sucesso.');

        } catch (err) {
            log('ERROR', `[EXECUTOR] Falha ao executar sequência de limpeza: ${err.message}`);
        }
    }
}

module.exports = { TaskExecutor };