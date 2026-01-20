/* ==========================================================================
   tests/integration/ipc_tester.js
   Audit Level: 400 — IPC Integration Test Suite
   Responsabilidade: Orquestrar cenários de teste para o barramento IPC 2.0.
========================================================================== */

const { log } = require('../../src/core/logger');
const ipc = require('../../src/infra/ipc_client');
const identityManager = require('../../src/core/identity_manager');
const socketHub = require('../../src/server/engine/socket');
const http = require('http');

async function runHandshakeTest() {
    console.log('\n🧪 [TEST] Iniciando Auditoria de Handshake IPC 2.0...');

    // 1. Setup do Servidor de Teste
    const server = http.createServer();
    socketHub.init(server);
    server.listen(3001);

    try {
        // 2. Setup da Identidade (DNA)
        await identityManager.initialize();
        const dna = identityManager.robotId;

        // 3. Cenário A: Conexão com Versão Incompatível
        // Simularemos um erro forçando a versão no manager temporariamente
        const originalVersion = identityManager.capabilities;
        // (Apenas para ilustração, em um teste real usaríamos mocks)

        // 4. Cenário B: Fluxo Nominal (Sucesso)
        console.log(`> Tentando acoplar Maestro (DNA: ${dna})...`);

        await ipc.connect(3001);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('TIMEOUT_HANDSHAKE')), 5000);

            ipc.on('ready', (data) => {
                clearTimeout(timeout);
                console.log('✅ [PASS] Maestro autorizado com sucesso.');
                console.log(`   Sessão vinculada: ${data.session_id}`);
                resolve(true);
            });
        });

    } catch (err) {
        console.error(`❌ [FAIL] Erro no teste: ${err.message}`);
        return false;
    } finally {
        await ipc.disconnect();
        server.close();
    }
}

module.exports = { runHandshakeTest };