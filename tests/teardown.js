/**
 * Global Test Teardown
 * Executa após todos os testes
 * @audit-level 50 - Test infrastructure
 */

const fs = require('fs');
const path = require('path');

/**
 * Diretórios temporários para limpar
 */
const TMP_DIRS = [path.join(__dirname, 'tmp')];

/**
 * Cleanup principal
 */
async function teardown() {
    console.log('\n[TEST TEARDOWN] Iniciando cleanup global...');

    try {
        // 1. Limpar diretórios temporários
        for (const dir of TMP_DIRS) {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
                console.log(`[TEST TEARDOWN] Removido: ${dir}`);
            }
        }

        // 2. Forçar garbage collection se disponível
        if (global.gc) {
            global.gc();
            console.log('[TEST TEARDOWN] Garbage collection executado');
        }

        // 3. Restaurar variáveis de ambiente
        delete process.env.NODE_ENV;
        delete process.env.LOG_LEVEL;
        delete process.env.DISABLE_BROWSER;
        delete process.env.TEST_MODE;
        console.log('[TEST TEARDOWN] Variáveis de ambiente restauradas');

        // 4. Fechar handlers pendentes
        process.removeAllListeners('unhandledRejection');
        process.removeAllListeners('uncaughtException');
        console.log('[TEST TEARDOWN] Event listeners removidos');

        console.log('[TEST TEARDOWN] ✅ Cleanup global concluído');
    } catch (error) {
        console.error('[TEST TEARDOWN] ❌ Erro no cleanup:', error);
        process.exit(1);
    }
}

// Executar teardown
teardown().catch(error => {
    console.error('[TEST TEARDOWN] ❌ Erro crítico no teardown:', error);
    process.exit(1);
});

module.exports = { teardown, TMP_DIRS };
