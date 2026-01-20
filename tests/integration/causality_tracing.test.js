/* ==========================================================================
   tests/integration/causality_tracing.test.js
   Audit Level: 400 — Distributed Tracing Audit (Phase 4.2)
========================================================================== */

const http = require('http');
const socketHub = require('../../src/server/engine/socket');
const ipc = require('../../src/infra/ipc_client');
const identityManager = require('../../src/core/identity_manager');
const { IPCCommand, IPCEvent } = require('../../src/shared/ipc/constants');
const { v4: uuidv4 } = require('uuid');

async function runCausalityTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Causalidade (Correlation ID)\n`);

    const PORT = 3007;
    const httpServer = http.createServer();
    const ioServer = socketHub.init(httpServer);
    
    // [FIX] O ID deve ser um UUID PURO para passar na validação do Zod
    const correlationIdOriginal = uuidv4(); 
    let ackReceived = false;
    let progressReceived = false;

    ioServer.on('connection', (socket) => {
        socket.on('message', (envelope) => {
            if (envelope.ids?.correlation_id !== correlationIdOriginal) return;
            if (envelope.ack_for) ackReceived = true;
            if (envelope.kind === IPCEvent.TASK_PROGRESS) progressReceived = true;
        });
    });

    await new Promise(r => httpServer.listen(PORT, r));
    await identityManager.initialize();
    const myRobotId = identityManager.robotId;

    ipc.on(IPCCommand.ENGINE_PAUSE, (payload, correlationId) => {
        console.log(`   [MAESTRO] Comando recebido. ID: ${correlationId}`);
        ipc.emitEvent(IPCEvent.TASK_PROGRESS, { step: 'TRACING_INTERNAL' }, correlationId);
    });

    ipc.connect(PORT);

    console.log(`> [ACTION] Aguardando autorização do Maestro...`);
    for (let i = 0; i < 20; i++) {
        if (ipc.isConnected()) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!ipc.isConnected()) {
        console.error("❌ [FAIL] Maestro não autorizou a tempo.");
        process.exit(1);
    }

    console.log(`> [ACTION] Dashboard disparando comando com ID: ${correlationIdOriginal}`);
    socketHub.sendCommand(IPCCommand.ENGINE_PAUSE, { 
        reason: 'audit', 
        correlation_id: correlationIdOriginal 
    }, myRobotId);

    // Verificação final
    for (let i = 0; i < 20; i++) {
        if (ackReceived && progressReceived) {
            console.log(`\n✅ [PASS] Causalidade preservada: ${correlationIdOriginal}`);
            httpServer.close();
            process.exit(0);
        }
        await new Promise(r => setTimeout(r, 500));
    }

    console.error(`❌ [FAIL] Timeout. ACK: ${ackReceived} | Progress: ${progressReceived}`);
    process.exit(1);
}

runCausalityTest();