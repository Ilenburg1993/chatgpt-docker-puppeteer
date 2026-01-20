/* ==========================================================================
   tests/integration/resilience.test.js
========================================================================== */

const ipc = require('../../src/infra/ipc_client');
const socketHub = require('../../src/server/engine/socket');
const http = require('http');

async function testBufferReplay() {
    console.log('\n🧪 [TEST] Iniciando Auditoria de Resiliência (Offline-First)...');

    let server = http.createServer();
    socketHub.init(server);
    server.listen(3002);

    await ipc.connect(3002);
    console.log('> Conectado. Derrubando servidor em 1s...');

    await new Promise(r => { setTimeout(r, 1000); });
    server.close(); // Blackout simulado
    console.log('⚠️ [BLACKOUT] Servidor Offline.');

    // O Maestro gera eventos no escuro
    ipc.emitEvent('evt:task:progress', { step: 'OFFLINE_STEP_1' });
    ipc.emitEvent('evt:task:progress', { step: 'OFFLINE_STEP_2' });
    console.log(`> Eventos bufferizados: ${ipc.outbox.size}`);

    console.log('> Reiniciando servidor...');
    server = http.createServer();
    socketHub.init(server);
    server.listen(3002);

    return new Promise((resolve) => {
        let receivedCount = 0;

        // O Hub do servidor deve receber os eventos retransmitidos
        socketHub.getIO().on('connection', (socket) => {
            socket.on('message', (envelope) => {
                if (envelope.payload.step && envelope.payload.step.startsWith('OFFLINE')) {
                    receivedCount++;
                    console.log(`   [REPLAY] Mensagem recebida: ${envelope.payload.step}`);
                    if (receivedCount === 2) {
                        console.log('✅ [PASS] Todos os eventos bufferizados foram entregues.');
                        server.close();
                        resolve(true);
                    }
                }
            });
        });
    });
}

testBufferReplay();