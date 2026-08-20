/* ==========================================================================
   test_nerv_pulse.js
   Audit Level: 000 — DIAGNOSTIC TOOL
   Status: DISPOSABLE
   Responsabilidade: Verificar se o NERV conecta, faz Handshake e fica READY.
========================================================================== */

const { v4: uuidv4 } = require('uuid');
const { default: createNerv } = require('./src/nerv/core');
const { ActorRole, MessageType, ActionCode } = require('./src/shared/ipc/constants');
const { createEnvelope } = require('./src/shared/ipc/envelope');

// CONFIGURAÇÃO DO TESTE
const SERVER_URL = process.env['SERVER_URL'] || 'http://localhost:3008';
const ROBOT_ID = uuidv4(); // Identidade efêmera para o teste

console.log(`\n[DIAGNOSTIC] Iniciando Teste de Pulso do NERV...`);
console.log(`[DIAGNOSTIC] Alvo: ${SERVER_URL}`);
console.log(`[DIAGNOSTIC] Identidade Simulada: ${ROBOT_ID}\n`);

// 1. Criar o NERV em modo híbrido (o bootstrap atual cria o adaptador físico)
const nerv = await createNerv({
    mode: 'HYBRID',
    socketUrl: SERVER_URL,
    socketOptions: {
        query: { robot_id: ROBOT_ID }, // Alguns servidores exigem ID na query string
    },
});

// 2. Monitorar a API atual de telemetria e recepção
nerv.telemetry.on((/** @type {{ type: string, meta?: unknown }} */ event) => {
    console.log(`[NERV TELEMETRY] ${event.type}`, event.meta ?? '');
});
nerv.onReceive((/** @type {{ type: { message_type: string, action_code: string } }} */ envelope) => {
    console.log(
        `[NERV INBOUND] Recebido envelope tipo: ${envelope.type.message_type}/${envelope.type.action_code}`,
    );
});

console.log('[DIAGNOSTIC] Transporte híbrido inicializado. Enviando ping em 3 segundos...');
setTimeout(sendTestPing, 3000);

// Função auxiliar para enviar dados após conectar
function sendTestPing() {
    console.log('[DIAGNOSTIC] Disparando Envelope de Teste...');

    const pingEnvelope = createEnvelope({
        actor: ActorRole.MAESTRO,
        target: ActorRole.SERVER,
        messageType: MessageType.EVENT, // Apenas um evento informativo
        actionCode: ActionCode.DRIVER_TASK_HEARTBEAT, // Simulando um batimento
        payload: {
            uptime: process.uptime(),
            cpu: 0.1,
            ram: process.memoryUsage().heapUsed,
        },
    });

    nerv.send(pingEnvelope);
    console.log('[DIAGNOSTIC] Envelope enviado para a Outbox.');

    // Encerrar teste após 5 segundos
    setTimeout(async () => {
        console.log('\n[DIAGNOSTIC] Encerrando teste e desconectando...');
        await nerv.shutdown();
        process.exit(0);
    }, 5000);
}

// Tratamento de Erro Global
process.on('unhandledRejection', (err) => {
    console.error('CRASH:', err);
    process.exit(1);
});
