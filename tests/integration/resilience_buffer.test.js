/* ==========================================================================
   tests/integration/resilience_buffer.test.js
   Audit Level: 450 — Offline Resilience Audit (Phase 4.1)
========================================================================== */

const http = require('http');
const socketHub = require('../../src/server/engine/socket');
const ipc = require('../../src/infra/ipc_client');
const identityManager = require('../../src/core/identity_manager');
const { IPCEvent } = require('../../src/shared/ipc/constants');
const { v4: uuidv4 } = require('uuid');

async function runResilienceTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Resiliência (Offline-First)\n`);

    const PORT = 3006;
    let httpServer;
    let receivedSteps = [];
    const testSessionId = uuidv4();

    const startServer = async () => {
        await socketHub.stop();
        httpServer = http.createServer();
        const io = socketHub.init(httpServer);
        
        io.on('connection', (socket) => {
            socket.on('message', (envelope) => {
                if (envelope.payload?.test_session === testSessionId) {
                    const step = envelope.payload.step;
                    if (!receivedSteps.includes(step)) {
                        receivedSteps.push(step);
                        console.log(`   [REPLAY] Servidor recebeu: ${step}`);
                    }
                }
            });
        });
        return new Promise(r => httpServer.listen(PORT, r));
    };

    try {
        // --- LIMPEZA INICIAL ---
        await ipc.destroy(); 
        await identityManager.initialize();

        // --- ROUND 1: CONEXÃO ---
        await startServer();
        console.log(`> [SETUP] Servidor Online.`);
        
        await ipc.connect(PORT);
        
        // Espera autorização ativa
        let ready = false;
        for(let i=0; i<20; i++) {
            if(ipc.isConnected()) { ready = true; break; }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!ready) throw new Error("Falha autorização Round 1.");
        console.log(`> [SETUP] Maestro autorizado.`);

        // --- ROUND 2: BLACKOUT ---
        console.log(`\n⚠️ [ACTION] Iniciando Blackout...`);
        await socketHub.stop();
        await new Promise(r => httpServer.close(r));
        await new Promise(r => setTimeout(r, 2000));

        // --- ROUND 3: TELEMETRIA OFFLINE ---
        console.log(`> [ACTION] Gerando eventos no buffer...`);
        const correlationId = uuidv4();
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'PASSO_OFFLINE_1', test_session: testSessionId }, correlationId);
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'PASSO_OFFLINE_2', test_session: testSessionId }, correlationId);
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'PASSO_OFFLINE_3', test_session: testSessionId }, correlationId);
        console.log(`> [CHECK] Mensagens no Buffer: ${ipc.outbox.size}`);

        // --- ROUND 4: RECUPERAÇÃO ---
        console.log(`\n🔄 [ACTION] Reiniciando servidor...`);
        await startServer();

        // --- ROUND 5: VALIDAÇÃO ---
        const startTime = Date.now();
        while (Date.now() - startTime < 15000) {
            if (receivedSteps.length === 3) {
                console.log(`\n✅ [PASS] Replay concluído com sucesso.`);
                await socketHub.stop();
                httpServer.close();
                process.exit(0);
            }
            await new Promise(r => setTimeout(r, 500));
        }

        throw new Error("Timeout no replay do buffer.");

    } catch (err) {
        console.error(`\n❌ [FAIL] ${err.message}`);
        process.exit(1);
    }
}

runResilienceTest();