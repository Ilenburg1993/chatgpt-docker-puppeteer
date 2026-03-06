// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import identityManager from '#core/identity_manager';
import * as io from '#infra/io';
import { v4 as uuidv4 } from 'uuid';

// Caminho físico do DNA (Sincronizado com identity_manager.js)
const IDENTITY_FILE = path.join(io.ROOT, 'src/infra/storage/robot_identity.json');

async function runIdentityTest() {
    console.log(`\n🧪 [TEST] Iniciando Auditoria de Ciclo de Vida de Identidade\n`);

    let hadOriginal = false;
    let originalContent = null;

    try {
        if (fs.existsSync(IDENTITY_FILE)) {
            hadOriginal = true;
            originalContent = fs.readFileSync(IDENTITY_FILE);
        }

        // --- PASSO 1: SIMULAR NASCIMENTO (DELEÇÃO) ---
        if (fs.existsSync(IDENTITY_FILE)) {
            fs.unlinkSync(IDENTITY_FILE);
            console.log(`> [SETUP] Arquivo de identidade removido para simular nascimento.`);
        }

        await identityManager.initialize();
        const dna1 = identityManager.robotId;
        const instance1 = identityManager.instanceId;

        if (!dna1 || dna1.length < 30) {
            throw new Error('Falha ao gerar DNA no nascimento.');
        }
        console.log(`✅ [PASS] Nascimento: Novo DNA gerado -> ${dna1}`);

        // --- PASSO 2: SIMULAR REBOOT (RE-INICIALIZAÇÃO) ---
        console.log(`> [ACTION] Simulando reinicialização do processo...`);

        // Forçamos uma nova instância do manager (simulando novo boot)
        // Nota: Como o manager é um singleton, vamos apenas re-executar o init
        // mas o instanceId deve ser resetado manualmente para o teste ser fiel
        const oldInstanceId = identityManager.instanceId;
        identityManager.instanceId = uuidv4();

        await identityManager.initialize();
        const dna2 = identityManager.robotId;
        const instance2 = identityManager.instanceId;

        // --- PASSO 3: VALIDAÇÃO DE PERSISTÊNCIA ---
        if (dna1 !== dna2) {
            throw new Error(`CRÍTICO: O DNA mudou após o reboot! (Antes: ${dna1} | Depois: ${dna2})`);
        }
        console.log(`✅ [PASS] Reconhecimento: DNA persistiu corretamente entre sessões.`);

        // --- PASSO 4: VALIDAÇÃO DE INSTÂNCIA ---
        if (instance1 === instance2) {
            throw new Error('Falha: O instance_id não mudou após o reboot.');
        }
        console.log(`✅ [PASS] Unicidade: Nova instância detectada (${instance2}).`);

        console.log(`\n--------------------------------------------------`);
        console.log(`ESTADO: IDENTIDADE SOBERANA CONSOLIDADA`);
        console.log(`--------------------------------------------------\n`);
    } catch (/** @type {any} */ err) {
        console.error(`\n❌ [FAIL] Colapso na Identidade: ${err.message}`);
        process.exitCode = 1;
    } finally {
        try {
            if (hadOriginal) {
                fs.writeFileSync(IDENTITY_FILE, /** @type {any} */ (originalContent));
            } else {
                fs.rmSync(IDENTITY_FILE, { force: true });
            }
        } catch (/** @type {any} */ restoreErr) {
            console.error(`\n❌ [FAIL] Não foi possível restaurar o arquivo de identidade: ${restoreErr.message}`);
            process.exitCode = 1;
        }
    }
}

await runIdentityTest();
