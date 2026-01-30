/* ==========================================================================
   src/core/boot_resilience_manager.js
   Audit Level: 850 — Boot Sequence Resilience & Graceful Degradation
   Status: V1.0 (2026-01-29)

   Responsabilidade:
   - Detectar e tratar falhas durante boot sequence
   - Oferecer opções ao usuário quando subsistemas críticos falharem
   - Habilitar modo degradado (boot parcial) quando possível
   - Guiar usuário para corrigir problemas (ex: Chrome não rodando)
   - Evitar crashes catastróficos com mensagens úteis

   Princípios:
   - Graceful degradation > Hard failure
   - User guidance > Cryptic errors
   - Retry com inteligência > Give up imediato
   - Boot parcial > No boot
========================================================================== */

const { log } = require('./logger');
const { execSync } = require('child_process');
const http = require('http');

/**
 * Resultado canônico de decisões de boot relacionadas ao Browser Pool.
 *
 * @typedef {Object} BrowserPoolDecision
 * @property {boolean} success - Indica se o boot pode continuar
 * @property {'full'|'degraded'|'abort'} mode - Modo operacional resultante
 * @property {Object|null} [browserPool] - Instância ativa ou null em modo degradado
 */

/**
 * Resolve o endpoint de Chrome Remote Debugging de forma canônica.
 * Fonte única de verdade para todo o processo de boot.
 *
 * Ordem de precedência:
 * 1. process.env.CHROME_WS_ENDPOINT
 * 2. CONFIG.BROWSER_URL
 * 3. Fallback local (localhost:9224)
 *
 * ⚠️ Não inicia Chrome.
 * ⚠️ Não valida conectividade.
 *
 * @returns {string}
 */
function resolveChromeEndpoint() {
    const CONFIG = require('./config');

    return process.env.CHROME_WS_ENDPOINT || CONFIG.BROWSER_URL || 'http://localhost:9224';
}

/**
 * Health check para Chrome remote debugging.
 * “Verifica se Chrome está acessível no endpoint de Remote Debugging configurado.”
 *
 * @param {string|null} [endpoint] - ##
 * @param {number} [timeout=2000] - Timeout em ms
 * @returns {Promise<boolean>} - true se Chrome está acessível
 */
async function checkChromeHealth(endpoint = null, timeout = 2000) {
    const chromeEndpoint = endpoint || resolveChromeEndpoint();
    const url = `${chromeEndpoint.replace(/\/$/, '')}/json/version`;

    return new Promise(resolve => {
        const timeoutId = setTimeout(() => {
            resolve(false);
        }, timeout);

        http.get(url, res => {
            clearTimeout(timeoutId);
            resolve(res.statusCode === 200);
        }).on('error', () => {
            clearTimeout(timeoutId);
            resolve(false);
        });
    });
}

/**
 * Cria e inicializa um BrowserPoolManager de forma canônica.
 * Centraliza a lógica de construção para evitar divergência
 * entre boot normal, retry automático e retry manual.
 *
 * @param {Object} config
 * @returns {Promise<Object>} BrowserPoolManager inicializado
 */
async function createBrowserPool(config) {
    const BrowserPoolManager = require('../infra/browser_pool/pool_manager');
    const pool = new BrowserPoolManager(config);
    await pool.initialize();
    return pool;
}

/**
 * Define se o sistema tem permissão explícita
 * para tentar iniciar Chrome automaticamente.
 *
 * ⚠️ DESABILITADO por padrão.
 * ⚠️ Violação arquitetural se ativado sem consciência.
 */
const AUTO_START_CHROME = process.env.AUTO_START_CHROME === 'true';

/**
 * Tenta iniciar Chrome automaticamente usando o script start-chrome.sh
 *
 * @returns {Promise<boolean>} - true se Chrome foi iniciado com sucesso
 */
async function tryStartChrome() {
    try {
        log('INFO', '[RESILIENCE] Tentando iniciar Chrome automaticamente...');

        // Verifica se script existe
        const fs = require('fs');
        const scriptPath = './scripts/start-chrome.sh';

        if (!fs.existsSync(scriptPath)) {
            log('WARN', '[RESILIENCE] Script start-chrome.sh não encontrado');
            return false;
        }

        // Executa script (timeout 15s)
        execSync('bash scripts/start-chrome.sh', {
            timeout: 15000,
            stdio: 'inherit' // Mostra output do script no console
        });

        // Valida que Chrome iniciou
        const chromeHealthy = await checkChromeHealth();
        if (chromeHealthy) {
            log('INFO', '[RESILIENCE] ✅ Chrome iniciado automaticamente com sucesso');
            return true;
        } else {
            log('WARN', '[RESILIENCE] Script executou mas Chrome não está acessível');
            return false;
        }
    } catch (error) {
        log('WARN', `[RESILIENCE] Falha ao executar start-chrome.sh: ${error.message}`);
        return false;
    }
}

/**
 * Mostra instruções ao usuário sobre como corrigir problemas de Chrome.
 * @param {string} errorMessage - Mensagem de erro original
 */
/**
 * Gera instruções humanas para correção do Chrome.
 * Função pura: NÃO escreve diretamente no console.
 *
 * @param {string} errorMessage
 * @returns {string[]}
 */
function getChromeInstructions(errorMessage) {
    return [
        '',
        '═══════════════════════════════════════════════════════════',
        '  ⚠️  CHROME REMOTE DEBUGGING NÃO ESTÁ ACESSÍVEL',
        '═══════════════════════════════════════════════════════════',
        '',
        'O sistema necessita do Chrome com remote debugging ativo.',
        '',
        `Erro detectado: ${errorMessage}`,
        '',
        'SOLUÇÃO RÁPIDA (Execute em outro terminal):',
        '',
        '  Windows:',
        '    scripts\\start-chrome.bat',
        '',
        '  Linux/WSL/Mac:',
        '    bash scripts/start-chrome.sh',
        '',
        'OU manualmente:',
        '  chrome --remote-debugging-port=9224 \\',
        '    --user-data-dir=<perfil-dedicado>',
        '',
        '⚠️ IMPORTANTE:',
        'Este sistema NÃO inicia browsers.',
        'O Chrome deve estar em execução ANTES do boot.',
        ''
    ];
}

/**
 * Trata falha no Browser Pool durante boot.
 * Oferece opções ao usuário e tenta recuperação automática.
 *
 * @param {Error} error - Erro original do Browser Pool
 * @param {Object} options - Opções de configuração
 * @param {boolean} [options.allowDegradedMode=true] - Permite boot sem browser
 * @param {boolean} [options.autoRetry=true] - Tenta iniciar Chrome automaticamente
 * @param {number} [options.maxAutoRetries=2] - Máximo de tentativas automáticas
 *
 * @returns {Promise<BrowserPoolDecision>}
 * ⚠️ Esta função NUNCA é void.
 * ⚠️ O chamador DEVE respeitar o campo `.mode`.
 */
async function handleBrowserPoolFailure(error, options = {}) {
    const { allowDegradedMode = true, autoRetry = true, maxAutoRetries = 2 } = options;

    log('WARN', `[RESILIENCE] Browser Pool falhou: ${error.message}`);

    // 1. Verifica se é problema de Chrome não rodando
    const chromeHealthy = await checkChromeHealth();

    if (!chromeHealthy) {
        log('WARN', '[RESILIENCE] Chrome não está acessível no endpoint de Remote Debugging configurado');

        // 2. Tenta iniciar Chrome automaticamente (se permitido)
        if (autoRetry && AUTO_START_CHROME) {
            for (let attempt = 1; attempt <= maxAutoRetries; attempt++) {
                log('INFO', `[RESILIENCE] Tentativa automática ${attempt}/${maxAutoRetries}...`);

                const chromeStarted = await tryStartChrome();

                if (chromeStarted) {
                    // Chrome iniciado! Tenta reconectar Browser Pool usando createBrowserPool
                    try {
                        const CONFIG = require('./config');

                        const browserPool = await createBrowserPool({
                            poolSize: process.env.BROWSER_POOL_SIZE || CONFIG.BROWSER_POOL_SIZE || 3,
                            allocationStrategy:
                                process.env.ALLOCATION_STRATEGY || CONFIG.ALLOCATION_STRATEGY || 'round-robin',
                            healthCheckInterval:
                                process.env.HEALTH_CHECK_INTERVAL || CONFIG.HEALTH_CHECK_INTERVAL || 30000,
                            browserEndpoint: {
                                url: resolveChromeEndpoint(),
                                wsEndpoint: process.env.CHROME_WS_ENDPOINT || CONFIG.WS_ENDPOINT
                            }
                        });

                        log('INFO', '[RESILIENCE] ✅ Browser Pool reconectado com sucesso após iniciar Chrome!');

                        return {
                            success: true,
                            mode: 'full',
                            browserPool
                        };
                    } catch (retryError) {
                        log('WARN', `[RESILIENCE] Falha ao reconectar após iniciar Chrome: ${retryError.message}`);
                    }
                }

                // Aguarda antes de próxima tentativa
                if (attempt < maxAutoRetries) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }

        // 3. Auto-retry falhou, mostra instruções ao usuário
        getChromeInstructions(error.message).forEach(line => console.log(line));
    }

    // 4. Modo degradado (se permitido)
    if (allowDegradedMode) {
        console.log('OPÇÕES:');
        console.log('  1) Aguardar - Corrija o problema e pressione ENTER para retry');
        console.log('  2) Modo Degradado - Iniciar sistema sem Browser Pool (limitado)');
        console.log('  3) Abortar - Sair do sistema');
        console.log('');

        // Em ambiente não-interativo (PM2, Docker), usa default
        if (!process.stdin.isTTY) {
            log('WARN', '[RESILIENCE] Ambiente não-interativo, abortando...');
            return { success: false, mode: 'abort' };
        }

        // Lê escolha do usuário (com timeout de 60s)
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const choice = await new Promise(resolve => {
            const timeoutId = setTimeout(() => {
                log('WARN', '[RESILIENCE] Timeout de 60s atingido, abortando...');
                rl.close();
                resolve('3');
            }, 60000);

            rl.question('Escolha (1-3): ', answer => {
                clearTimeout(timeoutId);
                rl.close();
                resolve(answer.trim());
            });
        });

        switch (choice) {
            case '1': {
                // Retry após usuário corrigir problema
                log('INFO', '[RESILIENCE] Tentando reconectar...');

                try {
                    const CONFIG = require('./config');

                    const browserPool = await createBrowserPool({
                        poolSize: process.env.BROWSER_POOL_SIZE || CONFIG.BROWSER_POOL_SIZE || 3,
                        allocationStrategy:
                            process.env.ALLOCATION_STRATEGY || CONFIG.ALLOCATION_STRATEGY || 'round-robin',
                        healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || CONFIG.HEALTH_CHECK_INTERVAL || 30000,
                        browserEndpoint: {
                            url: resolveChromeEndpoint(),
                            wsEndpoint: process.env.CHROME_WS_ENDPOINT || CONFIG.WS_ENDPOINT
                        }
                    });

                    log('INFO', '[RESILIENCE] ✅ Browser Pool conectado com sucesso após correção manual!');

                    return {
                        success: true,
                        mode: 'full',
                        browserPool
                    };
                } catch (retryError) {
                    log('ERROR', `[RESILIENCE] Retry falhou: ${retryError.message}`);
                    return { success: false, mode: 'abort' };
                }
            }

            case '2':
                // Modo degradado
                log('WARN', '[RESILIENCE] ⚠️ Iniciando em MODO DEGRADADO (sem Browser Pool)');
                log('WARN', '[RESILIENCE] Funcionalidades limitadas: Sem execução de tasks via browser');
                log('WARN', '[RESILIENCE] Para habilitar browser pool: Corrija Chrome e restart');

                return {
                    success: true,
                    mode: 'degraded',
                    browserPool: null // Indica modo degradado
                };

            case '3':
            default:
                // Abortar
                log('INFO', '[RESILIENCE] Abortando boot por escolha do usuário');
                return { success: false, mode: 'abort' };
        }
    } else {
        // Modo degradado não permitido, falha imediata
        log('FATAL', '[RESILIENCE] Browser Pool é crítico e modo degradado não está habilitado');
        return { success: false, mode: 'abort' };
    }
}

/**
 * Wrapper resiliente para inicialização de Browser Pool.
 * Substitui a inicialização direta no boot sequence.
 *
 * @param {Object} config - Configuração do Browser Pool
 * @param {Object} [options] - Opções de resiliência
 * @returns {Promise<Object>} - Resultado da inicialização
 */
async function initializeBrowserPoolResilient(config, options = {}) {
    const BrowserPoolManager = require('../infra/browser_pool/pool_manager');

    try {
        const browserPool = new BrowserPoolManager(config);
        await browserPool.initialize();

        const poolHealth = await browserPool.getHealth();
        log(
            'INFO',
            `[RESILIENCE] ✅ Browser Pool online (${poolHealth.healthy}/${poolHealth.poolSize} instâncias saudáveis)`
        );

        return {
            success: true,
            mode: 'full',
            browserPool
        };
    } catch (error) {
        log('WARN', `[RESILIENCE] Browser Pool falhou na inicialização: ${error.message}`);

        // Delega para handler de falha
        return handleBrowserPoolFailure(error, options);
    }
}

module.exports = {
    checkChromeHealth,
    tryStartChrome,
    getChromeInstructions,
    handleBrowserPoolFailure,
    initializeBrowserPoolResilient
};
