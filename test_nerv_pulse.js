/* ==========================================================================
   test_nerv_pulse.js
   Audit Level: 000 — DIAGNOSTIC TOOL
   Status: DISPOSABLE
   Responsabilidade: Verificar se o NERV conecta, faz Handshake e fica READY.
========================================================================== */

const { v4: uuidv4 } = require('uuid');
const createNerv = require('./src/nerv/core');
const createSocketAdapter = require('./src/infra/transport/socket_io_adapter');
const { ActorRole, MessageType, ActionCode } = require('./src/shared/ipc/constants');
const { createEnvelope } = require('./src/shared/ipc/envelope');

// CONFIGURAÇÃO DO TESTE
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3008';
const ROBOT_ID = uuidv4(); // Identidade efêmera para o teste

console.log(`\n[DIAGNOSTIC] Iniciando Teste de Pulso do NERV...`);
console.log(`[DIAGNOSTIC] Alvo: ${SERVER_URL}`);
console.log(`[DIAGNOSTIC] Identidade Simulada: ${ROBOT_ID}\n`);

// 1. Criar o Adaptador Físico
const adapter = createSocketAdapter({
    url: SERVER_URL,
    options: {
        query: { robot_id: ROBOT_ID } // Alguns servidores exigem ID na query string
    }
});

// 2. Criar o NERV (O Cérebro)
const nerv = createNerv({
    connection: adapter,
    identity: {
        robot_id: ROBOT_ID,
        capabilities: ['TEST_PULSE', 'DIAGNOSTIC_MODE']
    }
});

// 3. Monitorar Telemetria (Os Sinais Vitais)
nerv.telemetry.on('nerv:state:change', data => {
    console.log(`[NERV STATE] ${data.from} -> ${data.to}`);

    if (data.to === 'READY') {
        console.log('\n✅ SUCESSO! O NERV completou o Handshake e está pronto para combate.');
        console.log('Enviando ping de teste em 3 segundos...');

        setTimeout(sendTestPing, 3000);
    }
});

nerv.telemetry.on('nerv:log', data => {
    console.log(`[NERV LOG] [${data.level}] ${data.msg}`);
});

nerv.telemetry.on('nerv:error', err => {
    console.error(`[NERV ERROR]`, err);
});

nerv.telemetry.on('nerv:dropped', data => {
    console.warn(`[NERV DROP] Motivo: ${data.reason}`);
});

nerv.telemetry.on('nerv:inbound', envelope => {
    console.log(`[NERV INBOUND] Recebido envelope tipo: ${envelope.type.kind}/${envelope.type.action}`);
    // Se recebermos um Pong ou ACK, o teste passou completo
});

// 4. Iniciar Conexão
console.log('[DIAGNOSTIC] Conectando cabo de rede virtual...');
nerv.connect();

// Função auxiliar para enviar dados após conectar
function sendTestPing() {
    console.log('[DIAGNOSTIC] Disparando Envelope de Teste...');

    const pingEnvelope = createEnvelope({
        actor: ActorRole.MAESTRO,
        target: ActorRole.SERVER,
        messageType: MessageType.EVENT, // Apenas um evento informativo
        actionCode: 'HEARTBEAT', // Simulando um batimento
        payload: {
            uptime: process.uptime(),
            cpu: 0.1,
            ram: process.memoryUsage().heapUsed
        }
    });

    nerv.send(pingEnvelope);
    console.log('[DIAGNOSTIC] Envelope enviado para a Outbox.');

    // Encerrar teste após 5 segundos
    setTimeout(() => {
        console.log('\n[DIAGNOSTIC] Encerrando teste e desconectando...');
        nerv.disconnect();
        process.exit(0);
    }, 5000);
}

// Tratamento de Erro Global
process.on('unhandledRejection', err => {
    console.error('CRASH:', err);
    process.exit(1);
});
