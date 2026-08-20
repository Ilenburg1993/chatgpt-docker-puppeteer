// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * Diretórios temporários necessários para testes
 */
const TMP_DIRS = [
    path.join(import.meta.dirname, 'tmp'),
    path.join(import.meta.dirname, 'tmp', 'fila'),
    path.join(import.meta.dirname, 'tmp', 'respostas'),
    path.join(import.meta.dirname, 'tmp', 'logs'),
    path.join(import.meta.dirname, 'tmp', 'profile'),
];

/**
 * Variáveis de ambiente para testes
 */
const TEST_ENV = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'FATAL',
    COPILOT_LOG_LEVEL: 'FATAL',
    COPILOT_LOG_DIR: path.join(import.meta.dirname, 'tmp', 'logs', 'copilot'),
    DISABLE_BROWSER: 'true',
    TEST_MODE: 'true',
    NO_COLOR: '1',
};

/**
 * @type {(level: string, msg: unknown, meta?: unknown) => void}
 */
const QUIET_TEST_LOGGER = () => {};

/**
 * Estado compartilhado do setup por worker/processo.
 *
 * @type {{
 *     setupInstalled: boolean;
 *     warningPatchInstalled: boolean;
 *     errorHandlersInstalled: boolean;
 * }}
 */
const setupState =
    /**
     * @type {typeof globalThis & {
     *     __copilotTestSetupState?: {
     *         setupInstalled: boolean;
     *         warningPatchInstalled: boolean;
     *         errorHandlersInstalled: boolean;
     *     };
     * }}
     */ (globalThis).__copilotTestSetupState ??
    (/**
     * @type {typeof globalThis & {
     *     __copilotTestSetupState?: {
     *         setupInstalled: boolean;
     *         warningPatchInstalled: boolean;
     *         errorHandlersInstalled: boolean;
     *     };
     * }}
     */ (globalThis).__copilotTestSetupState = {
        setupInstalled: false,
        warningPatchInstalled: false,
        errorHandlersInstalled: false,
    });

/**
 * Configuração global para testes
 */
const GLOBAL_TEST_CONFIG = {
    timeout: 30000, // 30 segundos timeout padrão
    retries: 0, // Sem retries automáticos
    bail: false, // Continuar após falhas
};

/**
 * Setup principal
 *
 * @returns {Promise<void>}
 */
async function setup() {
    if (setupState.setupInstalled) {
        return;
    }

    // 1. Criar diretórios temporários
    for (const dir of TMP_DIRS) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // 2. Configurar variáveis de ambiente
    Object.entries(TEST_ENV).forEach(([key, value]) => {
        process.env[key] = value;
    });

    // 3. Configurar configuração global de testes
    /** @type {any} */ (global).testConfig = GLOBAL_TEST_CONFIG;

    // 3.1. Instalar sink silencioso de logs para testes.
    const [{ setSdkLogger }, toolsLogger] = await Promise.all([
        import('../../src/copilot/sdk/logger.js'),
        import('../../src/copilot/tools/infra/logger.js'),
    ]);
    setSdkLogger(QUIET_TEST_LOGGER);
    toolsLogger.setToolsLogger(QUIET_TEST_LOGGER);

    // 4. Suprimir avisos não críticos
    if (!setupState.warningPatchInstalled) {
        const originalWarning = process.emitWarning;
        process.emitWarning = (warning, ...args) => {
            // Filtrar avisos conhecidos não críticos
            if (
                typeof warning === 'string' &&
                (warning.includes('ExperimentalWarning') || warning.includes('DeprecationWarning'))
            ) {
                return;
            }
            /** @type {Function} */ (originalWarning).call(process, warning, ...args);
        };
        setupState.warningPatchInstalled = true;
    }

    // 5. Configurar handlers globais de erro
    if (!setupState.errorHandlersInstalled) {
        process.on('unhandledRejection', (reason) => {
            throw reason instanceof Error ? reason : new Error(String(reason));
        });

        process.on('uncaughtException', (error) => {
            throw error;
        });

        setupState.errorHandlersInstalled = true;
    }

    setupState.setupInstalled = true;
}

// Executar setup
setup().catch((error) => {
    console.error('[TEST SETUP] setup failed:', error);
    process.exit(1);
});

export { GLOBAL_TEST_CONFIG, TEST_ENV, TMP_DIRS, setup };
