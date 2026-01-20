/**
 * Global Test Setup
 * Executa antes de todos os testes
 * @audit-level 50 - Test infrastructure
 */

const fs = require('fs');
const path = require('path');

/**
 * Diretórios temporários necessários para testes
 */
const TMP_DIRS = [
    path.join(__dirname, 'tmp'),
    path.join(__dirname, 'tmp', 'fila'),
    path.join(__dirname, 'tmp', 'respostas'),
    path.join(__dirname, 'tmp', 'logs'),
    path.join(__dirname, 'tmp', 'profile')
];

/**
 * Variáveis de ambiente para testes
 */
const TEST_ENV = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'ERROR', // Silenciar logs durante testes
    DISABLE_BROWSER: 'true', // Desabilitar browser real por padrão
    TEST_MODE: 'true'
};

/**
 * Configuração global para testes
 */
const GLOBAL_TEST_CONFIG = {
    timeout: 30000, // 30 segundos timeout padrão
    retries: 0, // Sem retries automáticos
    bail: false // Continuar após falhas
};

/**
 * Setup principal
 */
async function setup() {
    console.log('[TEST SETUP] Iniciando setup global...');

    // 1. Criar diretórios temporários
    for (const dir of TMP_DIRS) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[TEST SETUP] Criado: ${dir}`);
        }
    }

    // 2. Configurar variáveis de ambiente
    Object.entries(TEST_ENV).forEach(([key, value]) => {
        process.env[key] = value;
    });
    console.log('[TEST SETUP] Variáveis de ambiente configuradas');

    // 3. Configurar configuração global de testes
    global.testConfig = GLOBAL_TEST_CONFIG;
    console.log('[TEST SETUP] Configuração global definida');

    // 4. Suprimir avisos não críticos
    const originalWarning = process.emitWarning;
    process.emitWarning = (warning, ...args) => {
        // Filtrar avisos conhecidos não críticos
        if (
            typeof warning === 'string' &&
            (warning.includes('ExperimentalWarning') || warning.includes('DeprecationWarning'))
        ) {
            return;
        }
        originalWarning.call(process, warning, ...args);
    };

    // 5. Configurar handlers globais de erro
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[TEST SETUP] Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', error => {
        console.error('[TEST SETUP] Uncaught Exception:', error);
    });

    console.log('[TEST SETUP] ✅ Setup global concluído\n');
}

// Executar setup
setup().catch(error => {
    console.error('[TEST SETUP] ❌ Erro no setup:', error);
    process.exit(1);
});

module.exports = { setup, TMP_DIRS, TEST_ENV, GLOBAL_TEST_CONFIG };
