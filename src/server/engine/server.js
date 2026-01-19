/* ==========================================================================
   src/server/engine/server.js
   Audit Level: 100 — Mission Critical HTTP Engine (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Prover a fundação HTTP, gerenciar alocação dinâmica de 
                     portas e orquestrar o ciclo de vida físico da rede.
   Sincronizado com: app.js V100, lifecycle.js V600, socket.js V600.
========================================================================== */

const http = require('http');
const app = require('./app'); // Fábrica Express desidratada e configurada
const { log } = require('../../core/logger');

/**
 * Referência privada para a instância do servidor.
 * Mantida fora do escopo de exportação para garantir a soberania do Singleton.
 */
let httpServer = null;

/**
 * Inicia o motor HTTP com algoritmo de busca de porta (Port Hunting).
 * Em caso de porta ocupada, o sistema escala automaticamente para a próxima.
 * 
 * @param {number} port - Porta inicial para tentativa de bind.
 * @returns {Promise<object>} Objeto contendo a instância e a porta final alocada.
 */
function start(port) {
    return new Promise((resolve) => {
        // Criação do servidor acoplando a lógica de processamento do Express
        httpServer = http.createServer(app);

        httpServer.listen(port, () => {
            log('INFO', `[ENGINE] Servidor HTTP estabelecido em: http://localhost:${port}`);
            
            // Feedback visual de prontidão para o operador humano no console
            console.log(`\n🚀 MISSION CONTROL PRIME ONLINE`);
            console.log(`🔗 http://localhost:${port}\n`);
            
            resolve({ server: httpServer, port });
        });

        /**
         * TRATAMENTO DE ERRO DE BIND (EADDRINUSE)
         * Se a porta estiver em uso, o motor aplica uma estratégia recursiva 
         * de escalonamento até encontrar um slot livre no SO.
         */
        httpServer.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                log('WARN', `[ENGINE] Porta ${port} ocupada. Escalando para ${port + 1}...`);
                
                // Limpeza preventiva da instância falha para liberar recursos
                httpServer.close();
                httpServer = null;
                
                // Tentativa recursiva de alocação
                resolve(start(port + 1)); 
            } else {
                log('FATAL', `[ENGINE] Falha crítica no bind de rede: ${e.message}`);
                // Erros de permissão ou rede fatal interrompem o boot por segurança
                process.exit(1);
            }
        });
    });
}

/**
 * Encerramento atômico do servidor HTTP.
 * Garante a liberação imediata do descritor de arquivo e da porta no SO.
 */
async function stop() {
    return new Promise((resolve) => {
        if (httpServer && httpServer.listening) {
            httpServer.close(() => {
                log('INFO', '[ENGINE] Fundação HTTP encerrada e porta liberada.');
                httpServer = null;
                resolve();
            });
        } else {
            httpServer = null;
            resolve();
        }
    });
}

/**
 * API Pública do Motor de Rede.
 */
module.exports = {
    start,
    stop,
    /**
     * getRawServer: Gancho fundamental para o acoplamento do Hub Socket.io.
     */
    getRawServer: () => httpServer
};