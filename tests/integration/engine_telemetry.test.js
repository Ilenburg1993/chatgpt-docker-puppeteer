/* ==========================================================================
   tests/integration/engine_telemetry.test.js
   Audit Level: 450 — Engine Pipeline Telemetry Audit (Phase 5.1)
========================================================================== */

const http = require('http');
const socketHub = require('../../src/server/engine/socket');
const ipc = require('../../src/infra/ipc_client');
const identityManager = require('../../src/core/identity_manager');
const ExecutionEngine = require('../../src/core/execution_engine');
const { IPCEvent } = require('../../src/shared/ipc/constants');
const { v4: uuidv4 } = require('uuid');

async function runEngineTelemetryTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Telemetria de Pipeline\n`);

    const PORT = 3008;
    const httpServer = http.createServer();
    const ioServer = socketHub.init(httpServer);

    const testCorrelationId = uuidv4();
    const eventsReceived = [];

    // 1. MOCKS DE INFRAESTRUTURA
    const mockOrchestrator = {
        acquireContext: async () => ({ page: { url: () => 'https://chatgpt.com' }, browser: {} }),
        cleanup: async () => {}
    };
    const mockEnvResolver = { resolve: () => ({ target: 'chatgpt', confidence: 1 }) };
    const mockInfraPolicy = { escalate: async () => {} };

    const engine = new ExecutionEngine({
        orchestrator: mockOrchestrator,
        environmentResolver: mockEnvResolver,
        infraFailurePolicy: mockInfraPolicy
    });

    // 2. MOCK DO IO PARA INJETAR TAREFA
    const io = require('../../src/infra/io');
    const originalLoad = io.loadNextTask;
    io.loadNextTask = async () => ({
        meta: { id: 'task-test-51', correlation_id: testCorrelationId, priority: 5, created_at: new Date().toISOString() },
        spec: { target: 'chatgpt', payload: { user_message: 'Hello' } },
        state: { status: 'PENDING', attempts: 0, history: [] }
    });

    // 3. ESPIÃO DO SERVIDOR
    ioServer.on('connection', (socket) => {
        socket.on('message', (envelope) => {
            if (envelope.ids?.correlation_id === testCorrelationId) {
                eventsReceived.push(envelope.kind);
                console.log(`   [EVENT] Servidor recebeu: ${envelope.kind}`);
            }
        });
    });

    await new Promise(r => { httpServer.listen(PORT, r); });
    await identityManager.initialize();

    console.log(`> [ACTION] Conectando Maestro e iniciando Engine...`);
    await ipc.connect(PORT);

    // Aguarda conexão real
    while(!ipc.isConnected()) { await new Promise(r => { setTimeout(r, 200); }); }

    engine.start();

    // 4. VALIDAÇÃO DO FLUXO
    const start = Date.now();
    while (Date.now() - start < 15000) {
        if (eventsReceived.includes(IPCEvent.TASK_COMPLETED)) {
            console.log(`\n✅ [PASS] Pipeline de telemetria validado.`);
            console.log(`   Eventos capturados: ${eventsReceived.join(' -> ')}`);

            await engine.stop();
            await ipc.disconnect();
            await socketHub.stop();
            httpServer.close();
            io.loadNextTask = originalLoad;
            process.exit(0);
        }
        await new Promise(r => { setTimeout(r, 500); });
    }

    console.error(`❌ [FAIL] Pipeline incompleto. Eventos recebidos: ${  eventsReceived.join(', ')}`);
    process.exit(1);
}

runEngineTelemetryTest();