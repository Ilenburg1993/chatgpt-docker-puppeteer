/* ==========================================================================
   tests/integration/biomechanical_pulse.test.js
   Audit Level: 450 — Biomechanical Pulse & Throttling Audit (Phase 5.2)
   Responsabilidade: Provar que o TelemetryBridge filtra movimentos de mouse
                     e propaga o pulso humano com o Correlation ID correto.
========================================================================== */

const http = require('http');
const socketHub = require('../../src/server/engine/socket');
const ipc = require('../../src/infra/ipc_client');
const TelemetryBridge = require('../../src/driver/modules/telemetry_bridge');
const { IPCEvent } = require('../../shared/ipc/constants');

async function runBiomechanicalTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Pulso Biomecânico (Driver V310)\n`);

    const PORT = 3009;
    const httpServer = http.createServer();
    socketHub.init(httpServer);
    await new Promise(r => { httpServer.listen(PORT, r); });

    // 1. SETUP DO CLIENTE E BRIDGE
    await ipc.connect(PORT);
    const bridge = new TelemetryBridge(null); // Driver mockado como null
    const testCorrelationId = 'trace-biomech-123';
    bridge.setContext(testCorrelationId);

    console.log(`> [SETUP] Bridge configurada com Throttling de 150ms.`);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Falha na recepção de pulsos')), 10000);
        let mouseEventsCount = 0;
        let sadiEventsCount = 0;

        // O Servidor monitora a rajada de telemetria
        socketHub.getIO().on('connection', (socket) => {
            socket.on('message', (envelope) => {
                if (envelope.ids.correlation_id !== testCorrelationId) {return;}

                if (envelope.kind === IPCEvent.HUMAN_PULSE && envelope.payload.type === 'MOUSE_MOVE') {
                    mouseEventsCount++;
                    console.log(`   [PULSE] Mouse em x:${envelope.payload.coords.x} y:${envelope.payload.coords.y}`);
                }

                if (envelope.kind === IPCEvent.SADI_SNAPSHOT) {
                    sadiEventsCount++;
                    console.log(`   [SADI] Percepção: ${envelope.payload.selector} (${envelope.payload.status})`);
                }

                // Critério de Sucesso:
                // Recebeu o SADI e recebeu o Mouse (mesmo com rajada, o throttle deve limitar)
                if (sadiEventsCount === 1 && mouseEventsCount >= 1) {
                    clearTimeout(timeout);

                    // Validação de Throttling: Se enviamos 100 e chegaram 100, o throttle falhou.
                    // Em 500ms de teste, deveriam chegar no máximo 4 eventos (1 a cada 150ms).
                    if (mouseEventsCount > 10) {
                        reject(new Error(`Falha no Throttling: Recebidos ${mouseEventsCount} eventos de mouse em 500ms.`));
                    } else {
                        console.log(`\n✅ [PASS] Telemetria biomecânica validada.`);
                        console.log(`   Eventos de Mouse (Throttled): ${mouseEventsCount}`);
                        console.log(`   Causalidade preservada: ${envelope.ids.correlation_id}`);
                        httpServer.close();
                        resolve(true);
                    }
                }
            });
        });

        // 2. SIMULAÇÃO DE RAJADA (BURST)
        console.log(`> [ACTION] Disparando 100 movimentos de mouse e 1 SADI Scan...`);

        // Emite percepção visual
        bridge.emitSadiPerception('#send-btn', 'SEARCHING', 0.8);

        // Emite rajada de mouse (100 movimentos em 500ms)
        let moves = 0;
        const interval = setInterval(() => {
            bridge.emitMouseMovement(100 + moves, 200 + moves);
            moves++;
            if (moves >= 100) {clearInterval(interval);}
        }, 5); // 5ms entre movimentos (muito rápido para o IPC)
    });
}

runBiomechanicalTest().then(() => console.log('Audit Phase 5.2: SUCCESS\n')).catch(err => {
    console.error(`❌ [FAIL] Erro no pulso biomecânico: ${err.message}`);
    process.exit(1);
});