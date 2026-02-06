import { log } from '#core/logger';

/**
 * Resultados de validação de pré-requisitos.
 */
const ValidationResult = {
    // Cria resultado de sucesso
    ok: () => ({ valid: true }),

    // Cria resultado de falha com mensagem
    fail: (reason, details = {}) => ({
        valid: false,
        reason,
        details
    })
};

// Valida se página está em URL utilizável para LLM.
// @param {Page} page - Puppeteer Page
// @returns {Object} ValidationResult
async function validateLLMPage(page) {
    if (!page) {
        return ValidationResult.fail('PAGE_NULL', {
            message: 'Página é null/undefined'
        });
    }

    if (page.isClosed()) {
        return ValidationResult.fail('PAGE_CLOSED', {
            message: 'Página foi fechada'
        });
    }

    let url;
    try {
        url = page.url();
    } catch (err) {
        return ValidationResult.fail('PAGE_ERROR', {
            message: 'Erro ao obter URL da página',
            error: err.message
        });
    }

    // URLs inválidas
    const invalidUrls = ['about:blank', 'chrome://', 'chrome-extension://', 'data:', 'file://'];

    if (invalidUrls.some(prefix => url.startsWith(prefix))) {
        return ValidationResult.fail('INVALID_URL', {
            message: 'Página não está em URL utilizável',
            url,
            expectedDomains: ['chatgpt.com', 'gemini.google.com', 'claude.ai']
        });
    }

    // URLs de LLMs suportadas
    const supportedDomains = ['chatgpt.com', 'openai.com', 'gemini.google.com', 'claude.ai', 'anthropic.com'];

    const isSupported = supportedDomains.some(domain => url.includes(domain));

    if (!isSupported) {
        return ValidationResult.fail('UNSUPPORTED_LLM', {
            message: 'Página não está em LLM suportada',
            url,
            supportedDomains
        });
    }

    return ValidationResult.ok();
}

/**
 * Valida se interface LLM está carregada e utilizável.
 * Usa SADI (Sensory Analysis Deep Intelligence) via analyzer.js.
 *
 * @param {Page} page - Puppeteer Page
 * @returns {Promise<Object>} ValidationResult
 */
async function validateLLMInterface(page) {
    const pageValidation = await validateLLMPage(page);
    if (!pageValidation.valid) {
        return pageValidation;
    }

    // Usa analyzer.js (SADI) em vez de seletores hardcoded
    const analyzer = await import('#shared/sadi/analyzer').then(m => m.default ?? m);
    const url = page.url();

    try {
        // 1. Detecta campo de entrada usando SADI
        const inputResult = await analyzer.findChatInputSelector(page);

        if (!inputResult || !inputResult.selector) {
            return ValidationResult.fail('TEXTAREA_NOT_FOUND', {
                message: 'Campo de entrada (textarea) não encontrado',
                url,
                possibleReasons: [
                    'Página ainda não carregou completamente',
                    'LLM mudou interface',
                    'Página está em estado de erro',
                    'Login necessário'
                ],
                sadiDetails: inputResult || {}
            });
        }

        // 2. Valida interatividade do campo (foco, oclusão)
        const isInteractive = await analyzer.validateCandidateInteractivity(page, inputResult);

        if (!isInteractive) {
            return ValidationResult.fail('TEXTAREA_NOT_INTERACTIVE', {
                message: 'Campo de entrada encontrado mas não está interativo',
                selector: inputResult.selector,
                possibleReasons: [
                    'Elemento oculto ou coberto por overlay',
                    'Campo desabilitado',
                    'Modal ou popup bloqueando interação',
                    'Página em estado de carregamento'
                ]
            });
        }

        // 3. Verifica área de resposta (não-crítico)
        try {
            const responseArea = await analyzer.findResponseArea(page);
            if (!responseArea) {
                log('WARN', `[PrerequisiteValidator] Área de resposta não detectada (não-crítico)`);
            }
        } catch (err) {
            log('WARN', `[PrerequisiteValidator] Erro ao detectar área de resposta: ${err.message}`);
        }

        return ValidationResult.ok();
    } catch (err) {
        return ValidationResult.fail('INTERFACE_CHECK_ERROR', {
            message: 'Erro ao verificar interface LLM usando SADI',
            error: err.message,
            stack: err.stack
        });
    }
}

/**
 * Valida se Browser Pool está disponível e funcional.
 *
 * @param {BrowserPoolManager} browserPool
 * @returns {Object} ValidationResult
 */
function validateBrowserPool(browserPool) {
    if (!browserPool) {
        return ValidationResult.fail('BROWSER_POOL_NULL', {
            message: 'Browser Pool não inicializado',
            suggestion: 'Sistema em modo degradado - inicialize Chrome e reinicie'
        });
    }

    if (!browserPool.initialized) {
        return ValidationResult.fail('BROWSER_POOL_NOT_INITIALIZED', {
            message: 'Browser Pool não foi inicializado',
            suggestion: 'Aguarde boot completo do sistema'
        });
    }

    if (browserPool.shuttingDown) {
        return ValidationResult.fail('BROWSER_POOL_SHUTTING_DOWN', {
            message: 'Browser Pool está sendo desligado',
            suggestion: 'Operação não pode ser executada durante shutdown'
        });
    }

    // Verifica Circuit Breaker
    if (browserPool.circuitBreaker) {
        if (browserPool.circuitBreaker.shouldPauseSystem()) {
            const status = browserPool.circuitBreaker.getStatus();
            return ValidationResult.fail('CIRCUIT_BREAKER_OPEN', {
                message: 'Sistema pausado pelo Circuit Breaker',
                cause: status.lastCause,
                state: status.state,
                suggestion:
                    status.lastCause === 'USER_CLOSED'
                        ? 'Reabra o Chrome com START-CHROME-SIMPLE.bat'
                        : 'Aguarde auto-recovery ou investigue causa'
            });
        }
    }

    return ValidationResult.ok();
}

/**
 * Valida se browser instance está conectada e utilizável.
 *
 * @param {Browser} browser - Puppeteer Browser
 * @returns {Object} ValidationResult
 */
function validateBrowserConnection(browser) {
    if (!browser) {
        return ValidationResult.fail('BROWSER_NULL', {
            message: 'Browser instance é null/undefined'
        });
    }

    if (!browser.isConnected()) {
        return ValidationResult.fail('BROWSER_DISCONNECTED', {
            message: 'Browser não está conectado',
            suggestion: 'Verifique se Chrome está rodando e acessível'
        });
    }

    return ValidationResult.ok();
}

/**
 * Valida pré-requisitos para execução de Driver.
 * Verifica: Browser Pool, Circuit Breaker, Página, Interface LLM.
 *
 * @param {Object} options
 * @param {BrowserPoolManager} options.browserPool
 * @param {Page} options.page
 * @returns {Promise<Object>} ValidationResult
 */
async function validateDriverExecution({ browserPool, page }) {
    // 1. Valida Browser Pool
    const poolValidation = validateBrowserPool(browserPool);
    if (!poolValidation.valid) {
        return poolValidation;
    }

    // 2. Valida página LLM
    const pageValidation = await validateLLMPage(page);
    if (!pageValidation.valid) {
        return pageValidation;
    }

    // 3. Valida interface LLM carregada
    const interfaceValidation = await validateLLMInterface(page);
    if (!interfaceValidation.valid) {
        return interfaceValidation;
    }

    return ValidationResult.ok();
}

/**
 * Valida pré-requisitos para execução do Kernel Loop.
 *
 * @param {Object} options
 * @param {ExecutionEngine} options.executionEngine
 * @param {NERVBridge} options.nervBridge
 * @param {Telemetry} options.telemetry
 * @returns {Object} ValidationResult
 */
function validateKernelExecution({ executionEngine, nervBridge, telemetry }) {
    if (!executionEngine) {
        return ValidationResult.fail('EXECUTION_ENGINE_NULL', {
            message: 'ExecutionEngine não inicializado',
            suggestion: 'Erro de boot - verifique inicialização do Kernel'
        });
    }

    if (typeof executionEngine.evaluate !== 'function') {
        return ValidationResult.fail('EXECUTION_ENGINE_INVALID', {
            message: 'ExecutionEngine.evaluate() não é função',
            suggestion: 'Implementação incorreta do ExecutionEngine'
        });
    }

    if (!nervBridge) {
        return ValidationResult.fail('NERV_BRIDGE_NULL', {
            message: 'NERVBridge não inicializado',
            suggestion: 'Erro de boot - NERV não foi configurado'
        });
    }

    if (!telemetry || typeof telemetry.emit !== 'function') {
        return ValidationResult.fail('TELEMETRY_INVALID', {
            message: 'Telemetry não é válida',
            suggestion: 'Telemetry deve ter método emit()'
        });
    }

    return ValidationResult.ok();
}

export { ValidationResult, validateLLMPage, validateLLMInterface, validateBrowserPool, validateBrowserConnection, validateDriverExecution, validateKernelExecution };
