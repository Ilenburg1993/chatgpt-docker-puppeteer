/* ==========================================================================
   tests/integration/genetic_evolution.test.js
   Audit Level: 700 — Genetic Evolution & IPC Propagation Audit
   Responsabilidade: Validar o fluxo completo de aprendizado do SADI:
                     Discovery -> Persistence -> IPC Signal -> Cache Refresh.
========================================================================== */

const http = require('http');
const socketHub = require('../../src/server/engine/socket');
const ipc = require('../../src/infra/ipc_client');
const io = require('../../src/infra/io');
const identityManager = require('../../src/core/identity_manager');
const fsWatcher = require('../../src/server/watchers/fs_watcher');
const { v4: uuidv4 } = require('uuid');

async function runEvolutionTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Evolução Genética (SADI -> IPC)\n`);

    const PORT = 3010;
    const httpServer = http.createServer();
    socketHub.init(httpServer);
    
    // Ativa o vigia de disco para o teste
    fsWatcher.init();

    try {
        // 1. SETUP: Identidade e Conexão
        await identityManager.initialize();
        await new Promise(r => httpServer.listen(PORT, r));
        await ipc.connect(PORT);

        // Aguarda autorização do Handshake
        while (!ipc.isConnected()) { await new Promise(r => setTimeout(r, 200)); }
        console.log(`> [SETUP] Maestro conectado e vigia de disco ativo.`);

        // 2. ESTADO INICIAL
        const initialRules = await io.getTargetRules('chatgpt.com');
        const testSelector = `input-${uuidv4()}`; // Seletor único para o teste
        console.log(`> [BEFORE] Seletor atual: ${initialRules.selectors.input_box[0]}`);

        // 3. SIMULAÇÃO DE APRENDIZADO (Discovery)
        console.log(`\n🧬 [ACTION] SADI descobriu novo seletor: ${testSelector}`);
        
        // Criamos um novo DNA baseado no atual
        const currentDna = await io.getDna();
        const updatedDna = { ...currentDna };
        
        // Injetamos a nova regra no namespace do ChatGPT
        updatedDna.targets['chatgpt.com'] = {
            selectors: {
                input_box: [testSelector, ...initialRules.selectors.input_box]
            }
        };

        // 4. PERSISTÊNCIA E PROPAGAÇÃO
        // O saveDna deve disparar o fs_watcher, que dispara o IPC
        console.log(`> [ACTION] Gravando evolução no disco...`);
        await io.saveDna(updatedDna, 'TEST_SADI_EVOLUTION');

        // 5. VALIDAÇÃO DA REATIVIDADE
        console.log(`> [WAIT] Aguardando sinal IPC e invalidação de cache...`);
        
        let success = false;
        const start = Date.now();

        while (Date.now() - start < 10000) {
            // Consultamos o IO. Se o cache foi invalidado pelo sinal IPC, 
            // ele lerá o novo valor do disco.
            const freshRules = await io.getTargetRules('chatgpt.com');
            
            if (freshRules.selectors.input_box.includes(testSelector)) {
                console.log(`   [REACTIVE] Maestro detectou a mudança!`);
                console.log(`   [REACTIVE] Novo seletor em RAM: ${freshRules.selectors.input_box[0]}`);
                success = true;
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }

        if (success) {
            console.log(`\n✅ [PASS] Ciclo de Evolução Genética validado com sucesso.`);
            console.log(`   Fluxo: Discovery -> Disk -> Watcher -> IPC -> RAM Refresh.`);
        } else {
            throw new Error("O Maestro não atualizou o DNA em RAM após a escrita no disco.");
        }

    } catch (err) {
        console.error(`\n❌ [FAIL] Falha na evolução: ${err.message}`);
        process.exit(1);
    } finally {
        // Cleanup
        fsWatcher.stop();
        await socketHub.stop();
        httpServer.close();
        await ipc.disconnect();
        console.log("Audit Phase 6.1: COMPLETE\n");
        process.exit(0);
    }
}

runEvolutionTest();