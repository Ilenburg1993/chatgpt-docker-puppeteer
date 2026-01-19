/* ==========================================================================
   tests/integration/discovery.test.js
   Audit Level: 400 — Dynamic Discovery Audit (Phase 2.2)
   Responsabilidade: Validar se o ipc_client localiza o servidor via estado.json.
========================================================================== */

const fs = require('fs');
const path = require('path');
const ipc = require('../../src/infra/ipc_client');
const io = require('../../src/infra/io');

const STATE_FILE = path.join(io.ROOT, 'estado.json');

async function runDiscoveryTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Descoberta Dinâmica\n`);

    const results = { pass: 0, fail: 0 };

    function check(description, condition) {
        if (condition) {
            console.log(`✅ [PASS] ${description}`);
            results.pass++;
        } else {
            console.error(`❌ [FAIL] ${description}`);
            results.fail++;
        }
    }

    try {
        // --- CENÁRIO 1: DESCOBERTA DE PORTA CUSTOMIZADA ---
        const customPort = 4545;
        const mockState = {
            server_port: customPort,
            server_pid: 9999,
            server_version: 'V51'
        };

        fs.writeFileSync(STATE_FILE, JSON.stringify(mockState, null, 2));
        console.log(`> [SETUP] estado.json criado com a porta ${customPort}.`);

        // Chamamos o método privado de descoberta (acesso via colchetes para teste)
        const discoveredPort = ipc['_discoverPort'](3000);
        
        check(`Deve detectar a porta ${customPort} a partir do arquivo`, discoveredPort === customPort);

        // --- CENÁRIO 2: FALLBACK PARA PORTA PADRÃO (ARQUIVO AUSENTE) ---
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
        console.log(`> [SETUP] estado.json removido.`);

        const fallbackPort = ipc['_discoverPort'](3000);
        check(`Deve usar a porta padrão (3000) quando o arquivo estiver ausente`, fallbackPort === 3000);

        // --- CENÁRIO 3: RESILIÊNCIA A ARQUIVO CORROMPIDO ---
        fs.writeFileSync(STATE_FILE, "CONTEUDO_INVALIDO_JSON", 'utf-8');
        console.log(`> [SETUP] estado.json corrompido propositalmente.`);

        const resiliencePort = ipc['_discoverPort'](3000);
        check(`Deve ignorar JSON inválido e usar o fallback com segurança`, resiliencePort === 3000);

        // Limpeza final
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);

        console.log(`\n--------------------------------------------------`);
        console.log(`RELATÓRIO: ${results.pass} Passaram | ${results.fail} Falharam`);
        console.log(`ESTADO: ${results.fail === 0 ? 'DESCOBERTA DETERMINÍSTICA' : 'FALHA DE RASTREIO'}`);
        console.log(`--------------------------------------------------\n`);

        if (results.fail > 0) process.exit(1);

    } catch (err) {
        console.error(`\n❌ [CRITICAL] Erro inesperado no teste: ${err.message}`);
        process.exit(1);
    }
}

runDiscoveryTest();