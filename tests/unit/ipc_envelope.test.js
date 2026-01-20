/* ==========================================================================
   tests/unit/ipc_envelope.test.js
   Audit Level: 400 — Contract Integrity Audit (Phase 1.1)
   Responsabilidade: Validar se o IPCEnvelopeSchema bloqueia payloads inválidos.
========================================================================== */

const { IPCEnvelopeSchema } = require('../../src/shared/ipc/schemas');
const { IPCCommand, IPCEvent, PROTOCOL_VERSION, IPCActor } = require('../../src/shared/ipc/constants');
const { v4: uuidv4 } = require('uuid');

const results = { pass: 0, fail: 0 };

function assert(description, fn) {
    try {
        fn();
        console.log(`✅ [PASS] ${description}`);
        results.pass++;
    } catch (err) {
        console.error(`❌ [FAIL] ${description}`);
        console.error(`   Motivo: ${err.message}`);
        results.fail++;
    }
}

console.log(`\n🧪 [TEST] Iniciando Auditoria de Envelope (Protocolo ${PROTOCOL_VERSION})\n`);

// --- CENÁRIO 1: ENVELOPE VÁLIDO (COMANDO) ---
assert('Deve aceitar um comando perfeitamente formatado', () => {
    const validEnvelope = {
        header: {
            version: PROTOCOL_VERSION,
            timestamp: Date.now(),
            source: IPCActor.MISSION_CONTROL
        },
        ids: {
            msg_id: uuidv4(),
            correlation_id: uuidv4()
        },
        kind: IPCCommand.ENGINE_PAUSE,
        payload: { reason: 'manual_check' }
    };
    IPCEnvelopeSchema.parse(validEnvelope);
});

// --- CENÁRIO 2: UUID MALFORMADO ---
assert('Deve rejeitar se o msg_id não for um UUID válido', () => {
    const malformedIds = {
        header: { source: IPCActor.MAESTRO, version: PROTOCOL_VERSION, timestamp: Date.now() },
        ids: {
            msg_id: 'id-invalido-123', // Erro aqui
            correlation_id: uuidv4()
        },
        kind: IPCEvent.TASK_STARTED,
        payload: {}
    };

    const result = IPCEnvelopeSchema.safeParse(malformedIds);
    if (result.success) {throw new Error('O Schema aceitou um UUID inválido.');}
});

// --- CENÁRIO 3: KIND INEXISTENTE (ONTOLOGIA) ---
assert("Deve rejeitar se o 'kind' não pertencer à Ontologia (Constants)", () => {
    const invalidKind = {
        header: { source: IPCActor.MAESTRO, version: PROTOCOL_VERSION, timestamp: Date.now() },
        ids: { msg_id: uuidv4(), correlation_id: uuidv4() },
        kind: 'cmd:hack:system', // Kind inexistente
        payload: {}
    };

    const result = IPCEnvelopeSchema.safeParse(invalidKind);
    if (result.success) {throw new Error('O Schema aceitou um comando fora da lei.');}
});

// --- CENÁRIO 4: ATOR INVÁLIDO ---
assert("Deve rejeitar se o 'source' for um ator não homologado", () => {
    const invalidActor = {
        header: {
            source: 'actor:hacker_externo', // Ator inválido
            version: PROTOCOL_VERSION,
            timestamp: Date.now()
        },
        ids: { msg_id: uuidv4(), correlation_id: uuidv4() },
        kind: IPCEvent.AGENT_HEARTBEAT,
        payload: {}
    };

    const result = IPCEnvelopeSchema.safeParse(invalidActor);
    if (result.success) {throw new Error('O Schema aceitou um ator desconhecido.');}
});

console.log(`\n--------------------------------------------------`);
console.log(`RELATÓRIO: ${results.pass} Passaram | ${results.fail} Falharam`);
console.log(`ESTADO: ${results.fail === 0 ? 'CONSTITUCIONAL' : 'EM CRISE'}`);
console.log(`--------------------------------------------------\n`);

if (results.fail > 0) {process.exit(1);}