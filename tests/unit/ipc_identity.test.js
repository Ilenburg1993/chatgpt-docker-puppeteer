/* ==========================================================================
   tests/unit/ipc_identity.test.js
   Audit Level: 400 — Identity Integrity Audit (Phase 1.2)
   Responsabilidade: Validar se o RobotIdentitySchema protege o DNA do agente.
========================================================================== */

const { RobotIdentitySchema } = require('../../src/shared/ipc/schemas');
const { IPCActor, PROTOCOL_VERSION } = require('../../src/shared/ipc/constants');
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

console.log(`\n🧪 [TEST] Iniciando Auditoria de Identidade Soberana\n`);

// --- CENÁRIO 1: IDENTIDADE PERFEITA ---
assert('Deve aceitar uma identidade completa e válida', () => {
    const validIdentity = {
        robot_id: uuidv4(),
        instance_id: uuidv4(),
        role: IPCActor.MAESTRO,
        version: PROTOCOL_VERSION,
        capabilities: ['BROWSER_CONTROL', 'SADI_V19'],
        metadata: { os: 'linux', arch: 'x64' }
    };
    RobotIdentitySchema.parse(validIdentity);
});

// --- CENÁRIO 2: DNA (ROBOT_ID) INVÁLIDO ---
assert('Deve rejeitar se o robot_id não for um UUID', () => {
    const invalidDna = {
        robot_id: 'ROBO-DO-GUI-001', // Não é UUID
        instance_id: uuidv4(),
        role: IPCActor.MAESTRO,
        capabilities: []
    };
    const result = RobotIdentitySchema.safeParse(invalidDna);
    if (result.success) {throw new Error('O Schema aceitou um DNA que não segue o padrão UUID.');}
});

// --- CENÁRIO 3: PAPEL (ROLE) INVÁLIDO ---
assert('Deve rejeitar se o papel (role) for desconhecido', () => {
    const invalidRole = {
        robot_id: uuidv4(),
        instance_id: uuidv4(),
        role: 'actor:hacker', // Papel inexistente
        capabilities: []
    };
    const result = RobotIdentitySchema.safeParse(invalidRole);
    if (result.success) {throw new Error('O Schema aceitou um papel não homologado.');}
});

// --- CENÁRIO 4: CAPACIDADES MALFORMADAS ---
assert("Deve rejeitar se 'capabilities' não for um array de strings", () => {
    const invalidCaps = {
        robot_id: uuidv4(),
        instance_id: uuidv4(),
        role: IPCActor.MAESTRO,
        capabilities: 'SUPER_PODERES' // Deveria ser array
    };
    const result = RobotIdentitySchema.safeParse(invalidCaps);
    if (result.success) {throw new Error('O Schema aceitou capacidades fora de um array.');}
});

console.log(`\n--------------------------------------------------`);
console.log(`RELATÓRIO: ${results.pass} Passaram | ${results.fail} Falharam`);
console.log(`ESTADO: ${results.fail === 0 ? 'INTEGRIDADE TOTAL' : 'IDENTIDADE COMPROMETIDA'}`);
console.log(`--------------------------------------------------\n`);

if (results.fail > 0) {process.exit(1);}