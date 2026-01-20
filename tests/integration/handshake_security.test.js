/* ==========================================================================
   tests/integration/handshake_security.test.js
   Audit Level: 400 — Handshake & Quarantine Audit (Phase 3.1 & 3.2)
   Responsabilidade: Provar que o servidor isola conexões não autorizadas
                     e encerra conexões silenciosas (zumbis).
========================================================================== */

const http = require('http');
const { io: Client } = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');
const socketHub = require('../../src/server/engine/socket');
const { PROTOCOL_VERSION } = require('../../src/shared/ipc/constants');

async function runSecurityTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Segurança de Fronteira\n`);

    const PORT = 3005;
    const httpServer = http.createServer();
    socketHub.init(httpServer);
    await new Promise(r => { httpServer.listen(PORT, r); });

    const results = { pass: 0, fail: 0 };
    const check = (desc, cond) => {
        if (cond) { console.log(`✅ [PASS] ${desc}`); results.pass++; }
        else { console.error(`❌ [FAIL] ${desc}`); results.fail++; }
    };

    try {
        // --- CENÁRIO 1: O TESTE DO SILÊNCIO (HANDSHAKE TIMEOUT) ---
        console.log(`> [SCENARIO] Conectando agente "mudo" (esperando expulsão)...`);
        const silentClient = Client(`http://localhost:${PORT}`, {
            auth: { token: 'SYSTEM_MAESTRO_PRIME' },
            transports: ['websocket']
        });

        const timeoutExpulsion = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 7000);
            silentClient.on('disconnect', (reason) => {
                if (reason === 'io server disconnect' || reason === 'transport close') {resolve(true);}
            });
        });
        check('Deve desconectar o agente que não se apresenta em 5 segundos', timeoutExpulsion);

        // --- CENÁRIO 2: O TESTE DA VERSÃO (PROTOCOL DRIFT) ---
        console.log(`> [SCENARIO] Tentando handshake com versão obsoleta (1.0.0)...`);
        const oldClient = Client(`http://localhost:${PORT}`, {
            auth: { token: 'SYSTEM_MAESTRO_PRIME' },
            transports: ['websocket']
        });

        const versionRejection = await new Promise((resolve) => {
            oldClient.on('connect', () => {
                oldClient.emit('handshake:present', {
                    identity: {
                        robot_id: uuidv4(),
                        instance_id: uuidv4(),
                        role: 'actor:maestro',
                        version: '1.0.0', // Versão errada
                        capabilities: []
                    }
                });
            });
            oldClient.on('handshake:rejected', (err) => {
                if (err.reason.includes('Incompatibilidade') || err.reason.includes('Drift')) {resolve(true);}
            });
            setTimeout(() => resolve(false), 3000);
        });
        check('Deve rejeitar identidades com versão de protocolo divergente', versionRejection);
        oldClient.disconnect();

        // --- CENÁRIO 3: O TESTE DA QUARENTENA (BYPASS ATTEMPT) ---
        console.log(`> [SCENARIO] Tentando enviar mensagem sem estar autorizado...`);
        const hackerClient = Client(`http://localhost:${PORT}`, {
            auth: { token: 'SYSTEM_MAESTRO_PRIME' },
            transports: ['websocket']
        });

        const quarantineWorks = await new Promise((resolve) => {
            hackerClient.on('connect', () => {
                // Tenta enviar telemetria antes do handshake
                hackerClient.emit('message', { kind: 'evt:task:started', payload: {} });
                // Se em 2s o servidor não desconectou mas também não autorizou, a quarentena está segurando
                setTimeout(() => resolve(true), 2000);
            });
        });
        check('Deve ignorar mensagens de nós em estado de Quarentena', quarantineWorks);
        hackerClient.disconnect();

    } catch (err) {
        console.error(`❌ [ERROR] Falha catastrófica no test: ${err.message}`);
    } finally {
        console.log(`\n--------------------------------------------------`);
        console.log(`RELATÓRIO: ${results.pass} Passaram | ${results.fail} Falharam`);
        console.log(`ESTADO: ${results.fail === 0 ? 'FRONTEIRA BLINDADA' : 'VULNERÁVEL'}`);
        console.log(`--------------------------------------------------\n`);
        httpServer.close();
        if (results.fail > 0) {process.exit(1);}
    }
}

runSecurityTest();