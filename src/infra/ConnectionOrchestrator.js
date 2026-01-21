/* ==========================================================================
   src/infra/connection_orchestrator.js
   Audit Level: 21 — Hardened Infrastructure State Machine (Leak Proof)
   Status: ENHANCED — Universal Connection Manager (All Methods Supported)

   Suporta:
   - launcher: Puppeteer inicia Chrome (padrão, mais confiável)
   - connect: Conecta a Chrome externo via browserURL
   - wsEndpoint: Conecta via WebSocket endpoint
   - executablePath: Usa Chrome customizado (Docker, Chromium, etc)
   - auto: Tenta todos os métodos em ordem de prioridade
========================================================================== */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = puppeteerExtra; // Alias para compatibilidade
const puppeteerCore = require('puppeteer-core');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { log } = require('../core/logger');

// Importa configuração centralizada do .puppeteerrc.cjs (FONTE ÚNICA)
const puppeteerConfig = require('../../.puppeteerrc.cjs');

// Aplica stealth plugin para anti-detection
puppeteerExtra.use(StealthPlugin());

/* ========================================================================
   ESTADOS GLOBAIS
======================================================================== */
const STATES = Object.freeze({
    INIT: 'INIT',
    DETECTING_ENV: 'DETECTING_ENV',
    WAITING_FOR_BROWSER: 'WAITING_FOR_BROWSER',
    CONNECTING_BROWSER: 'CONNECTING_BROWSER',
    RETRY_BROWSER: 'RETRY_BROWSER',
    BROWSER_READY: 'BROWSER_READY',
    BROWSER_LOST: 'BROWSER_LOST',
    WAITING_FOR_PAGE: 'WAITING_FOR_PAGE',
    PAGE_SELECTED: 'PAGE_SELECTED',
    VALIDATING_PAGE: 'VALIDATING_PAGE',
    PAGE_VALIDATED: 'PAGE_VALIDATED',
    PAGE_INVALID: 'PAGE_INVALID',
    READY: 'READY'
});

const ISSUE_KIND = Object.freeze({ EVENT: 'EVENT', ERROR: 'ERROR' });
const ISSUE_TYPES = Object.freeze({
    BROWSER_NOT_STARTED: 'BROWSER_NOT_STARTED',
    BROWSER_DISCONNECTED: 'BROWSER_DISCONNECTED',
    PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
    PAGE_CLOSED_BY_USER: 'PAGE_CLOSED_BY_USER',
    PAGE_INVALID: 'PAGE_INVALID'
});

/* ========================================================================
   USER-AGENTS (ROTATION POOL)
======================================================================== */
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

/* ========================================================================
   DEFAULTS: Config específica do ConnectionOrchestrator
   USA helpers de .puppeteerrc.cjs (isDocker, findChrome, getCacheDirectory)
======================================================================== */
const DEFAULTS = {
    // Modo de operação: 'launcher' | 'connect' | 'wsEndpoint' | 'executablePath' | 'auto'
    mode: process.env.BROWSER_MODE || 'launcher',

    // Configurações de conexão (para modo connect/wsEndpoint)
    ports: [9222, 9223, 9224],
    hosts: ['127.0.0.1', 'localhost', 'host.docker.internal', '172.17.0.1'],
    connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT'],

    // Configurações de launcher
    headless: process.env.HEADLESS === 'false' ? false : 'new',
    executablePath: puppeteerConfig.findChromeExecutable(), // ✅ USA helper compartilhado
    userDataDir: process.env.PROFILE_DIR || null,

    // Cache persistente (evita downloads repetidos)
    cacheDirectory: puppeteerConfig.getCacheDirectory(), // ✅ USA helper compartilhado
    cacheDir: puppeteerConfig.getCacheDirectory(), // Backward compatibility

    // Argumentos do Chrome (launcher/executablePath)
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update'
    ],

    // Retry e timing
    retryDelayMs: 3000,
    maxRetryDelayMs: 15000,
    maxConnectionAttempts: parseInt(process.env.MAX_CONNECTION_ATTEMPTS || '5'),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),

    // Página
    pageScanIntervalMs: 4000,
    allowedDomains: ['chatgpt.com', 'gemini.google.com', 'claude.ai', 'openai.com'],
    pageSelectionPolicy: 'FIRST',

    // Estado
    stateHistorySize: 50,

    // Fallback automático
    autoFallback: true // Se modo falhar, tenta outros automaticamente
};

class ConnectionOrchestrator {
    constructor(options = {}) {
        this.config = { ...DEFAULTS, ...options };
        this.state = STATES.INIT;
        this.env = null;
        this.browser = null;
        this.page = null;
        this.retryCount = 0;
        this.lastIssue = null;
        this.stateHistory = [];
        this.attemptedModes = []; // Rastreia modos já tentados

        // Handlers referenciados para remoção limpa
        this._onDisconnect = this._handleDisconnect.bind(this);
        this._onTargetDestroyed = this._handleTargetDestroyed.bind(this);

        // Garante que diretório de cache existe
        this._ensureCacheDir();
    }

    _ensureCacheDir() {
        try {
            const cacheDir = this.config.cacheDirectory || this.config.cacheDir;
            if (cacheDir && !fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
                log('INFO', `[ORCH] Cache directory created: ${cacheDir}`);
            }
        } catch (error) {
            log('WARN', `[ORCH] Não foi possível criar cache dir: ${error.message}`);
        }
    }

    setState(next, meta = {}) {
        if (this.state === next) {
            return;
        } // Evita spam de estado igual
        this.state = next;
        this._pushStateHistory(next, meta);
        log('INFO', `[ORCH] State: ${next}`, meta);
    }

    _pushStateHistory(state, meta) {
        this.stateHistory.push({ state, meta, ts: new Date().toISOString() });
        if (this.stateHistory.length > this.config.stateHistorySize) {
            this.stateHistory.shift();
        }
    }

    classifyIssue(kind, type, message) {
        this.lastIssue = { kind, type, message, ts: new Date().toISOString() };
        return this.lastIssue;
    }

    detectEnvironment() {
        this.setState(STATES.DETECTING_ENV);
        const platform = os.platform();
        this.env = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux';
        return this.env;
    }

    // --- HANDLERS DE EVENTOS (Prevenção de Memory Leak) ---

    _handleDisconnect() {
        this.classifyIssue(ISSUE_KIND.EVENT, ISSUE_TYPES.BROWSER_DISCONNECTED, 'Browser disconnected');
        this.cleanup();
        this.setState(STATES.BROWSER_LOST);
    }

    _handleTargetDestroyed(target) {
        if (this.page && target.type() === 'page' && target.url() === this.page.url()) {
            // Verificação extra: a página realmente fechou ou navegou?
            if (this.page.isClosed()) {
                this.classifyIssue(ISSUE_KIND.EVENT, ISSUE_TYPES.PAGE_CLOSED_BY_USER, 'Target page closed');
                this.page = null;
                this.setState(STATES.WAITING_FOR_PAGE);
            }
        }
    }

    cleanup() {
        if (this.browser) {
            this.browser.off('disconnected', this._onDisconnect);
            this.browser.off('targetdestroyed', this._onTargetDestroyed);
        }
        this.browser = null;
        this.page = null;
    }

    // --- MÉTODOS DE CONEXÃO (Todos os tipos suportados) ---

    /**
     * LAUNCHER: Puppeteer inicia Chrome automaticamente
     * Mais confiável, funciona em qualquer ambiente
     */
    async tryLauncher() {
        const launchOptions = {
            headless: this.config.headless,
            args: this.config.args,
            defaultViewport: null,
            ignoreHTTPSErrors: true,
            timeout: this.config.connectionTimeout
        };

        // Configura executablePath se fornecido
        if (this.config.executablePath) {
            launchOptions.executablePath = this.config.executablePath;
        }

        // Configura userDataDir se fornecido
        if (this.config.userDataDir) {
            launchOptions.userDataDir = this.config.userDataDir;
        }

        // Usa puppeteer (bundle) ou puppeteer-core (sem bundle)
        const lib = this.config.executablePath ? puppeteerCore : puppeteer;

        return lib.launch(launchOptions);
    }

    /**
     * BROWSER_URL: Conecta via http://host:port
     * Para Chrome externo com --remote-debugging-port
     */
    async tryConnectBrowserURL() {
        const errors = [];

        for (const host of this.config.hosts) {
            for (const port of this.config.ports) {
                try {
                    const browserURL = `http://${host}:${port}`;
                    log('DEBUG', `[ORCH] Tentando browserURL: ${browserURL}`);

                    return await puppeteerCore.connect({
                        browserURL,
                        defaultViewport: null,
                        timeout: 5000
                    });
                } catch (e) {
                    errors.push(`${host}:${port} - ${e.message}`);
                }
            }
        }

        throw new Error(`browserURL unreachable: ${errors.join('; ')}`);
    }

    /**
     * WS_ENDPOINT: Conecta via WebSocket Debugger URL
     * Para Chrome externo, mais estável que browserURL
     */
    async tryConnectWSEndpoint() {
        const errors = [];

        for (const host of this.config.hosts) {
            for (const port of this.config.ports) {
                try {
                    const url = `http://${host}:${port}/json/version`;
                    log('DEBUG', `[ORCH] Tentando WS endpoint: ${url}`);

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);

                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    if (!res.ok) {
                        errors.push(`${host}:${port} - HTTP ${res.status}`);
                        continue;
                    }

                    const json = await res.json();
                    if (json.webSocketDebuggerUrl) {
                        return await puppeteerCore.connect({
                            browserWSEndpoint: json.webSocketDebuggerUrl,
                            defaultViewport: null,
                            timeout: 10000
                        });
                    }
                    errors.push(`${host}:${port} - No WS URL in response`);
                } catch (e) {
                    errors.push(`${host}:${port} - ${e.message}`);
                }
            }
        }

        throw new Error(`WS endpoint unreachable: ${errors.join('; ')}`);
    }

    /**
     * EXECUTABLE_PATH: Inicia Chrome customizado
     * Para usar Chrome instalado (não Chromium do Puppeteer)
     */
    async tryExecutablePath() {
        if (!this.config.executablePath) {
            throw new Error('executablePath não configurado');
        }

        if (!fs.existsSync(this.config.executablePath)) {
            throw new Error(`Chrome não encontrado: ${this.config.executablePath}`);
        }

        return this.tryLauncher(); // Usa launcher com executablePath
    }

    async ensureBrowser() {
        this.setState(STATES.WAITING_FOR_BROWSER);

        // Se já existe e está conectado, reaproveita
        if (this.browser && this.browser.isConnected()) {
            this.setState(STATES.BROWSER_READY);
            return this.browser;
        }

        // Garante limpeza antes de tentar novo
        this.cleanup();

        const mode = this.config.mode;
        const autoFallback = this.config.autoFallback;

        // Ordem de prioridade para modo 'auto'
        const fallbackOrder = ['launcher', 'wsEndpoint', 'connect', 'executablePath'];
        const modesToTry = mode === 'auto' ? fallbackOrder : [mode];

        let lastError = null;

        for (const currentMode of modesToTry) {
            // Evita tentar o mesmo modo múltiplas vezes
            if (this.attemptedModes.includes(currentMode) && mode !== 'auto') {
                continue;
            }

            try {
                this.setState(STATES.CONNECTING_BROWSER, { mode: currentMode });
                log('INFO', `[ORCH] Tentando conexão em modo: ${currentMode}`);

                switch (currentMode) {
                    case 'launcher':
                        this.browser = await this.tryLauncher();
                        break;

                    case 'connect':
                        this.browser = await this.tryConnectBrowserURL();
                        break;

                    case 'wsEndpoint':
                        this.browser = await this.tryConnectWSEndpoint();
                        break;

                    case 'executablePath':
                        this.browser = await this.tryExecutablePath();
                        break;

                    default:
                        throw new Error(`Modo desconhecido: ${currentMode}`);
                }

                if (this.browser) {
                    // Registra listeners limpos
                    this.browser.on('disconnected', this._onDisconnect);
                    this.browser.on('targetdestroyed', this._onTargetDestroyed);

                    this.retryCount = 0;
                    this.attemptedModes = []; // Reseta tentativas após sucesso
                    this.setState(STATES.BROWSER_READY);
                    log('INFO', `[ORCH] Browser conectado com sucesso em modo: ${currentMode}`);
                    return this.browser;
                }
            } catch (error) {
                lastError = error;
                this.attemptedModes.push(currentMode);
                log('WARN', `[ORCH] Falha em modo ${currentMode}: ${error.message}`);

                // Se não é auto e não tem fallback, rejeita imediatamente
                if (!autoFallback && mode !== 'auto') {
                    throw error;
                }

                // Continua para próximo modo
                continue;
            }
        }

        // Se chegou aqui, todos os modos falharam
        this.retryCount++;
        this.classifyIssue(
            ISSUE_KIND.EVENT,
            ISSUE_TYPES.BROWSER_NOT_STARTED,
            lastError?.message || 'Todos os modos falharam'
        );
        this.setState(STATES.RETRY_BROWSER, { retry: this.retryCount, attemptedModes: this.attemptedModes });

        // Retry com backoff exponencial
        if (this.retryCount < this.config.maxConnectionAttempts) {
            const delay = Math.min(
                this.config.retryDelayMs * Math.pow(1.5, this.retryCount - 1),
                this.config.maxRetryDelayMs
            );

            log('WARN', `[ORCH] Retry ${this.retryCount}/${this.config.maxConnectionAttempts} em ${delay}ms`);
            await new Promise(r => {
                setTimeout(r, delay);
            });

            // Reseta modos tentados para permitir nova rodada
            this.attemptedModes = [];
            return this.ensureBrowser(); // Recursão com retry
        }

        throw new Error(`Falha ao conectar após ${this.retryCount} tentativas: ${lastError?.message}`);
    }

    async scanForTargetPage() {
        const pages = await this.browser.pages();
        const candidates = pages.filter(p => {
            const url = p.url();
            // [P8.2] SECURITY: Use URL parsing instead of .includes() to prevent bypass
            if (!url || url === 'about:blank') {
                return false;
            }
            try {
                const parsed = new URL(url);
                return this.config.allowedDomains.some(d => {
                    // Match exact hostname or subdomain
                    return parsed.hostname === d || parsed.hostname.endsWith(`.${d}`);
                });
            } catch {
                return false; // Invalid URL
            }
        });
        if (!candidates.length) {
            return null;
        }
        return this.config.pageSelectionPolicy === 'MOST_RECENT' ? candidates[candidates.length - 1] : candidates[0];
    }

    async ensurePage() {
        this.setState(STATES.WAITING_FOR_PAGE);

        // Se já temos página válida, retorna
        if (this.page && !this.page.isClosed()) {
            this.setState(STATES.PAGE_SELECTED);
            return this.page;
        }

        while (true) {
            try {
                // Verifica se browser ainda está vivo antes de buscar página
                if (!this.browser || !this.browser.isConnected()) {
                    throw new Error('Browser lost during page scan');
                }

                const page = await this.scanForTargetPage();
                if (page) {
                    this.page = page;
                    this.setState(STATES.PAGE_SELECTED, { url: page.url() });

                    // P3.2: User-Agent Rotation (anti-fingerprinting)
                    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
                    try {
                        await page.setUserAgent(randomUA);
                        log('DEBUG', `[ORCH] User-Agent rotacionado: ${randomUA.substring(0, 50)}...`);
                    } catch (error) {
                        log('WARN', `[ORCH] Falha ao definir User-Agent: ${error.message}`);
                    }

                    return page;
                }

                this.classifyIssue(ISSUE_KIND.EVENT, ISSUE_TYPES.PAGE_NOT_FOUND, 'Aguardando aba alvo...');
                await new Promise(r => {
                    setTimeout(r, this.config.pageScanIntervalMs);
                });
            } catch (e) {
                if (e.message.includes('Browser lost')) {
                    // Joga erro para cima para reiniciar o ciclo do browser
                    throw e;
                }
                await new Promise(r => {
                    setTimeout(r, 1000);
                });
            }
        }
    }

    async validatePage(page) {
        this.setState(STATES.VALIDATING_PAGE);
        try {
            if (!page || page.isClosed()) {
                throw new Error('Page closed');
            }
            await page.bringToFront().catch(() => {});
            this.setState(STATES.PAGE_VALIDATED, { url: page.url() });
            return true;
        } catch (e) {
            this.page = null;
            this.setState(STATES.PAGE_INVALID);
            return false;
        }
    }

    // --- API PÚBLICA ---

    /**
     * Conecta/inicia browser e retorna instância.
     * Usado pelo BrowserPoolManager para obter múltiplas instâncias.
     */
    async connect() {
        await this.ensureBrowser();
        return this.browser;
    }

    async acquireContext() {
        this.detectEnvironment();

        // Loop infinito de recuperação
        while (true) {
            try {
                await this.ensureBrowser();
                const page = await this.ensurePage();

                if (await this.validatePage(page)) {
                    this.setState(STATES.READY);
                    return { browser: this.browser, page: this.page };
                }
            } catch (e) {
                log('WARN', `[ORCH] Ciclo de recuperação: ${e.message}`);
                await new Promise(r => {
                    setTimeout(r, 1000);
                });
            }
        }
    }

    getStatus() {
        return {
            state: this.state,
            mode: this.config.mode,
            browserConnected: !!this.browser?.isConnected(),
            pageUrl: this.page?.url() || null,
            lastIssue: this.lastIssue,
            attemptedModes: this.attemptedModes,
            retryCount: this.retryCount
        };
    }

    /**
     * Limpa profiles temporários criados pelo Puppeteer em /tmp
     * Deve ser chamado periodicamente ou no shutdown
     */
    static async cleanupTempProfiles() {
        try {
            const tmpDir = '/tmp';
            const profiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('puppeteer_dev_chrome_profile-'));

            let cleaned = 0;
            for (const profile of profiles) {
                const profilePath = path.join(tmpDir, profile);
                try {
                    fs.rmSync(profilePath, { recursive: true, force: true });
                    cleaned++;
                } catch (e) {
                    log('WARN', `[ORCH] Não foi possível limpar ${profile}: ${e.message}`);
                }
            }

            if (cleaned > 0) {
                log('INFO', `[ORCH] Limpou ${cleaned} profiles temporários de /tmp`);
            }

            return cleaned;
        } catch (error) {
            log('WARN', `[ORCH] Erro ao limpar profiles temporários: ${error.message}`);
            return 0;
        }
    }

    /**
     * Obtém informações sobre o cache do Puppeteer
     */
    static getCacheInfo() {
        const cacheDir = puppeteerConfig.getCacheDirectory(); // ✅ USA helper compartilhado

        if (!fs.existsSync(cacheDir)) {
            return { exists: false, path: cacheDir };
        }

        try {
            const chrome = path.join(cacheDir, 'chrome');
            const chromeHeadless = path.join(cacheDir, 'chrome-headless-shell');

            return {
                exists: true,
                path: cacheDir,
                chrome: fs.existsSync(chrome),
                chromeHeadless: fs.existsSync(chromeHeadless)
            };
        } catch (error) {
            return { exists: true, path: cacheDir, error: error.message };
        }
    }

    /**
     * Exporta configuração completa do Chrome para consumo por launchers/scripts externos.
     * Gera chrome-config.json com todas as configurações necessárias para iniciar/conectar Chrome.
     *
     * @param {string} outputPath - Caminho onde salvar o JSON (padrão: ./chrome-config.json)
     * @returns {object} Configuração exportada
     *
     * Uso:
     * ```javascript
     * // CLI: node -e "require('./src/infra/ConnectionOrchestrator').ConnectionOrchestrator.exportConfig()"
     * // Programático: ConnectionOrchestrator.exportConfig('./custom-path.json')
     * ```
     */
    static exportConfig(outputPath = null) {
        // Usa helpers de .puppeteerrc.cjs + DEFAULTS local
        const platform = os.platform();
        const env = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux';
        const detectedChromePath = puppeteerConfig.findChromeExecutable();
        const isDockerEnv = puppeteerConfig.isDocker();

        // Monta configuração completa
        const config = {
            exportedAt: new Date().toISOString(),
            version: '3.0',
            source: 'ConnectionOrchestrator + .puppeteerrc.cjs helpers',
            environment: env,
            isDocker: isDockerEnv,

            connection: {
                mode: DEFAULTS.mode,
                autoFallback: DEFAULTS.autoFallback,
                ports: DEFAULTS.ports,
                hosts: DEFAULTS.hosts,
                connectionStrategies: DEFAULTS.connectionStrategies,
                connectionTimeout: DEFAULTS.connectionTimeout,
                maxConnectionAttempts: DEFAULTS.maxConnectionAttempts,
                retryDelayMs: DEFAULTS.retryDelayMs,
                maxRetryDelayMs: DEFAULTS.maxRetryDelayMs
            },

            launcher: {
                headless: DEFAULTS.headless,
                executablePath: DEFAULTS.executablePath,
                detectedChromePath,
                userDataDir: DEFAULTS.userDataDir,
                cacheDirectory: DEFAULTS.cacheDirectory,
                args: DEFAULTS.args
            },

            page: {
                allowedDomains: DEFAULTS.allowedDomains,
                pageSelectionPolicy: DEFAULTS.pageSelectionPolicy,
                pageScanIntervalMs: DEFAULTS.pageScanIntervalMs,
                userAgents: USER_AGENTS
            },

            health: {
                chromeDebugUrl: 'http://localhost:9222/json/version',
                chromeDevtoolsUrl: 'http://localhost:9222',
                expectedPorts: DEFAULTS.ports
            },

            commands:
                env === 'windows'
                    ? {
                          startChrome: detectedChromePath
                              ? `"${detectedChromePath}" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\chrome-automation" ${DEFAULTS.args.join(' ')}`
                              : null,
                          checkChrome: 'netstat -ano | findstr ":9222"',
                          killChrome: 'taskkill /F /IM chrome.exe'
                      }
                    : {
                          startChrome: detectedChromePath
                              ? `"${detectedChromePath}" --remote-debugging-port=9222 --user-data-dir=~/chrome-automation ${DEFAULTS.args.join(' ')}`
                              : null,
                          checkChrome: 'lsof -i :9222 || netstat -an | grep :9222',
                          killChrome: 'pkill -f "chrome.*remote-debugging-port=9222"'
                      },

            usage: {
                description: 'Configuração exportada do ConnectionOrchestrator',
                helpers: 'Helpers compartilhados (.puppeteerrc.cjs): isDocker, findChrome, getCacheDirectory',
                config: 'Config específica (ConnectionOrchestrator.js): DEFAULTS inline',
                launcher: 'Use connection.mode para decidir como iniciar Chrome (launcher/connect/auto)',
                healthCheck: 'Teste health.chromeDebugUrl para validar que Chrome está respondendo',
                fallback: 'Se connection.autoFallback=true, o sistema tentará todos os modos automaticamente'
            }
        };

        // Salva em arquivo se outputPath fornecido
        if (outputPath) {
            const resolvedPath = path.resolve(outputPath);
            fs.writeFileSync(resolvedPath, JSON.stringify(config, null, 2), 'utf-8');
            log('INFO', `[ORCH] Configuração exportada para: ${resolvedPath}`);
        }

        return config;
    }

    /**
     * Método de conveniência para exportar config no formato esperado pelo launcher.
     * Simplifica chamadas via CLI.
     */
    static exportConfigForLauncher() {
        const projectRoot = path.join(__dirname, '../..');
        const outputPath = path.join(projectRoot, 'chrome-config.json');
        return ConnectionOrchestrator.exportConfig(outputPath);
    }
}

module.exports = { ConnectionOrchestrator, STATES };
