// @ts-check - Type checking rigoroso habilitado (arquivo core)
import CONFIG from '#core/config';
import { log } from '#core/logger';
import os from 'node:os';
import puppeteerCore from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createMockBrowser } from './mock_chrome.js';

// Aplica stealth plugin para anti-detection
puppeteerExtra.use(StealthPlugin());

/* ========================================================================
   ESTADOS GLOBAIS
======================================================================== */
/** Constante/valor exportado: STATES. */
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
    READY: 'READY',
});

const ISSUE_KIND = Object.freeze({ EVENT: 'EVENT', ERROR: 'ERROR' });
const ISSUE_TYPES = Object.freeze({
    BROWSER_NOT_STARTED: 'BROWSER_NOT_STARTED',
    BROWSER_DISCONNECTED: 'BROWSER_DISCONNECTED',
    PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
    PAGE_CLOSED_BY_USER: 'PAGE_CLOSED_BY_USER',
    PAGE_INVALID: 'PAGE_INVALID',
});

/* ========================================================================
   DEFAULTS: Connection Configuration (DevContainer → Proxy → Chrome)
======================================================================== */
const DEFAULTS = {
    // Connection mode: 'wsEndpoint' | 'connect' | 'auto'
    mode: process.env.BROWSER_MODE || 'wsEndpoint',

    // Optional explicit endpoint override (fast-path).
    // Keep keys present so @ts-check can type-narrow correctly.
    browserEndpoint: {
        url: '',
        wsEndpoint: '',
    },

    // Connection targets (DevContainer: localhost:9224 = Chrome Proxy)
    // ARCHITECTURE: Puppeteer → localhost:9224 (Proxy) → host.docker.internal:9225 (Chrome)
    // IMPORTANT: Port 9225 (Chrome on Windows) is NOT accessible from container!
    ports: [Number(process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT)], // 9224
    hosts: ['localhost'], // Proxy runs IN container (localhost), not on Windows host
    connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT'],

    // Retry & Timing
    retryDelayMs: 3000,
    maxRetryDelayMs: 15000,
    maxConnectionAttempts: parseInt(process.env.MAX_CONNECTION_ATTEMPTS || '5', 10),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000', 10),

    // Page Selection
    pageScanIntervalMs: 4000,
    allowedDomains: ['chatgpt.com', 'gemini.google.com', 'claude.ai', 'openai.com'],
    pageSelectionPolicy: 'FIRST',

    // State & Fallback
    stateHistorySize: 50,
    autoFallback: true,
};

// Porta canonical do proxy (container-facing). Pode ser sobrescrita por env/config
const PROXY_PORT = Number(process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT);

/* ========================================================================
   WINDOWS CHROME CONFIGURATION (Reference Only - NOT Managed by Container)

   ONTOLOGICAL PRINCIPLE:
   Chrome é propriedade do Windows Host. DevContainer APENAS conecta.

   IMPORTANT: Chrome Dual Purpose in System Architecture
   -----------------------------------------------------------------------

   The system uses Chrome for TWO DIFFERENT, INDEPENDENT purposes:

   1. DASHBOARD (Server Process - Port 2998):
      - Web interface for managing missions, viewing status
      - Accessed by HUMAN using ANY browser (Chrome, Firefox, Edge, Safari)
      - URL: http://localhost:2998
      - Does NOT require Chrome on Windows with remote debugging
      - Does NOT use Puppeteer or ConnectionOrchestrator
      - Process: src/server/main.js (Express + Socket.io)
      - Purpose: Human management interface

   2. LLM AUTOMATION (Main Process - Puppeteer):
      - Controls ChatGPT/Gemini/Claude pages via browser automation
      - Requires Chrome on Windows with --remote-debugging-port=9225
      - Uses Puppeteer + ConnectionOrchestrator (THIS FILE)
      - Process: src/main.js (Kernel + Drivers)
      - Purpose: Automated LLM interaction

   These are COMPLETELY INDEPENDENT. Dashboard works without Puppeteer Chrome.

   -----------------------------------------------------------------------

   Esta seção documenta a configuração recomendada do Chrome no Windows
   APENAS para LLM AUTOMATION (purpose #2 above).
   ConnectionOrchestrator NÃO gerencia essas configs - são de
   responsabilidade exclusiva do START-CHROME-SIMPLE.bat.
   -----------------------------------------------------------------------

   CHROME PATH (Windows):
   - C:\Program Files\Google\Chrome\Application\chrome.exe
   - Ou: C:\Program Files (x86)\Google\Chrome\Application\chrome.exe

   REQUIRED ARGS:
   --remote-debugging-port=9225        # Porta para DevTools Protocol
   --user-data-dir=%USERPROFILE%\chrome-automation  # Profile persistente

   RECOMMENDED ARGS (Security/Stability):
   --no-first-run                      # Skip first run wizard
   --no-default-browser-check          # Skip default browser prompt
   --disable-features=TranslateUI      # Disable auto-translate
   --disable-background-networking     # Reduce background noise
   --metrics-recording-only            # Disable full metrics
   --mute-audio                        # Silence audio
   --disable-sync                      # Disable Chrome sync
   --disable-default-apps              # Disable default apps
   --disable-extensions                # Disable extensions (optional)

   FULL COMMAND (START-CHROME-SIMPLE.bat):
   "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
     --remote-debugging-port=9225 ^
     --user-data-dir=%USERPROFILE%\chrome-automation ^
     --no-first-run ^
     --no-default-browser-check ^
     --disable-features=TranslateUI ^
     --disable-background-networking ^
     --metrics-recording-only ^
     --mute-audio ^
     --disable-sync ^
     --disable-default-apps

   VALIDATION:
   http://localhost:9225/json/version  # Test from Windows

   LIFECYCLE:
   - START: START-CHROME-SIMPLE.bat (Windows Host)
   - PROXY: PM2 chromeProxyService @ localhost:9224 (DevContainer)
   - CONNECT: ConnectionOrchestrator → localhost:9224 → proxy → host.docker.internal:9225

   IMPORTANT:
   - Container NEVER connects directly to port 9225 (not accessible)
   - Proxy handles localhost:9224 → host.docker.internal:9225 routing
   - All Chrome args must be set in START-CHROME-SIMPLE.bat, NOT here
======================================================================== */

/**
 * Orquestrador de conexões browser com suporte a múltiplos modos de conexão.
 *
 * Gerencia ciclo de vida completo: detecção de ambiente → conexão browser →
 * seleção de página → validação. Suporta fallbacks automáticos entre modos
 * (WebSocket endpoint, connect direto, auto-detecção).
 *
 * **Side-effects:** Inicia processos Chrome, gerencia conexões WebSocket.
 * **Semântica:** Estados finitos bem definidos com transições controladas.
 *
 * @example
 * const orchestrator = new ConnectionOrchestrator({ mode: 'auto' });
 * await orchestrator.connect();
 * const page = await orchestrator.getPage();
 */
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
    }

    setState(next, meta = {}) {
        if (this.state === next) {
            return;
        } // Evita spam de estado igual
        this.state = next;
        this._pushStateHistory(next, meta);
        const metaObj = typeof meta === 'object' && meta !== null ? /** @type {Record<string, unknown>} */ (meta) : {};
        const correlationIdRaw =
            metaObj['correlation_id'] || metaObj['correlationId'] || metaObj['taskId'] || metaObj['task_id'] || null;
        const correlationId = correlationIdRaw ? String(correlationIdRaw) : '-';
        log('INFO', { event: 'ORCH_STATE', state: next, meta }, correlationId);
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
        this.env = platform === 'win32' ? 'windows' : 'linux';
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

    // --- MÉTODOS DE CONEXÃO (Apenas modos suportados: connect, wsEndpoint) ---

    /**
     * BROWSER_URL: Conecta via http://host:port
     * Para Chrome externo com --remote-debugging-port
     *
     * Estratégia:
     * 1. FAST PATH: browserEndpoint.url definido → conecta direto (1 tentativa)
     * 2. FALLBACK: hosts/ports custom → loops (configs não-DevContainer)
     */
    async tryConnectBrowserURL() {
        const errors = [];

        // Mock mode: return a lightweight mock browser for tests/CI
        if (process.env.MOCK_CHROME === '1') {
            log('INFO', '[ORCH] MOCK_CHROME enabled — returning mock browser (browserURL)');
            return createMockBrowser();
        }

        // ✅ FAST PATH: browserEndpoint.url definido → conecta direto (99% dos casos)
        if (this.config.browserEndpoint && this.config.browserEndpoint.url) {
            try {
                log('INFO', `[ORCH] [FAST PATH] Conectando via browserURL: ${this.config.browserEndpoint.url}`);
                return await puppeteerCore.connect({
                    browserURL: this.config.browserEndpoint.url,
                    defaultViewport: null,
                    protocolTimeout: 5000,
                });
            } catch (e) {
                const error = `browserEndpoint.url (${this.config.browserEndpoint.url}): ${e.message}`;
                log('ERROR', `[ORCH] Fast path failed: ${error}`);
                errors.push(error);
                if (!this.config.autoFallback) {
                    throw new Error(error, { cause: e });
                }
                log('WARN', '[ORCH] Fast path falhou; tentando fallback de hosts/ports');
            }
        }

        // ✅ FALLBACK PATH: Loops para configs custom (raro - ambientes non-DevContainer)
        // DevContainer padrão: 1 host (localhost) × 1 porta (9224) = 1 iteração
        log('DEBUG', '[ORCH] [FALLBACK] browserEndpoint não definido, tentando hosts/ports configurados');
        for (const port of this.config.ports) {
            const isProxyPort = port === Number(process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT);
            const portType = isProxyPort ? '[PROXY]' : '[DIRECT]';

            for (const host of this.config.hosts) {
                try {
                    const browserURL = `http://${host}:${port}`;
                    log('DEBUG', `[ORCH] ${portType} Tentando browserURL: ${browserURL}`);

                    return await puppeteerCore.connect({
                        browserURL,
                        defaultViewport: null,
                        protocolTimeout: 5000,
                    });
                } catch (e) {
                    errors.push(`${host}:${port} - ${e.message}`);
                }
            }
        }

        throw new Error(`browserURL unreachable (fallback): ${errors.join('; ')}`);
    }

    /**
     * WS_ENDPOINT: Conecta via WebSocket Debugger URL
     * Para Chrome externo, mais estável que browserURL
     *
     * Estratégia:
     * 1. FAST PATH: browserEndpoint.url ou .wsEndpoint → conecta direto (1 tentativa)
     * 2. FALLBACK: hosts/ports custom → loops (configs não-DevContainer)
     */
    async tryConnectWSEndpoint() {
        const errors = [];

        // Mock mode: return a lightweight mock browser for tests/CI
        if (process.env.MOCK_CHROME === '1') {
            log('INFO', '[ORCH] MOCK_CHROME enabled — returning mock browser (wsEndpoint)');
            return createMockBrowser();
        }

        // ✅ FAST PATH 1: browserEndpoint.wsEndpoint definido → conecta direto (mais rápido)
        if (this.config.browserEndpoint && this.config.browserEndpoint.wsEndpoint) {
            try {
                log('INFO', `[ORCH] [FAST PATH] Conectando via wsEndpoint: ${this.config.browserEndpoint.wsEndpoint}`);
                return await puppeteerCore.connect({
                    browserWSEndpoint: this.config.browserEndpoint.wsEndpoint,
                    defaultViewport: null,
                    protocolTimeout: 10000,
                });
            } catch (e) {
                const error = `browserEndpoint.wsEndpoint (${this.config.browserEndpoint.wsEndpoint}): ${e.message}`;
                log('ERROR', `[ORCH] Fast path failed: ${error}`);
                errors.push(error);
                if (!this.config.autoFallback) {
                    throw new Error(error, { cause: e });
                }
                log('WARN', '[ORCH] Fast path wsEndpoint falhou; tentando resolução/fallback');
            }
        }

        // ✅ FAST PATH 2: browserEndpoint.url definido → resolve wsEndpoint via /json/version
        if (this.config.browserEndpoint && this.config.browserEndpoint.url) {
            try {
                const url = `${this.config.browserEndpoint.url}/json/version`;
                log('INFO', `[ORCH] [FAST PATH] Resolvendo wsEndpoint via: ${url}`);

                const controller = new AbortController();
                let timeoutId = null;
                try {
                    timeoutId = setTimeout(() => controller.abort(), 5000);
                    const res = await fetch(url, { signal: controller.signal });

                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}`);
                    }

                    /** @type {{ webSocketDebuggerUrl?: string }} */
                    const json = await res.json();
                    if (!json.webSocketDebuggerUrl) {
                        throw new Error('No webSocketDebuggerUrl in response');
                    }

                    log('INFO', `[ORCH] ✅ WebSocket URL resolvido: ${json.webSocketDebuggerUrl}`);
                    return await puppeteerCore.connect({
                        browserWSEndpoint: json.webSocketDebuggerUrl,
                        defaultViewport: null,
                        protocolTimeout: 10000,
                    });
                } finally {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                    }
                }
            } catch (e) {
                const error = `browserEndpoint.url (${this.config.browserEndpoint.url}): ${e.message}`;
                log('ERROR', `[ORCH] Fast path failed: ${error}`);
                errors.push(error);
                if (!this.config.autoFallback) {
                    throw new Error(error, { cause: e });
                }
                log('WARN', '[ORCH] Fast path browserEndpoint.url falhou; tentando fallback de hosts/ports');
            }
        }

        // ✅ FALLBACK PATH: Loops para configs custom (raro - ambientes non-DevContainer)
        // DevContainer padrão: 1 host (localhost) × 1 porta (9224) = 1 iteração
        log('DEBUG', '[ORCH] [FALLBACK] browserEndpoint não definido, tentando hosts/ports configurados');
        for (const port of this.config.ports) {
            // ✅ TELEMETRIA: Detecta se está tentando via Chrome Proxy (porta canônica configurável)
            const isProxyAttempt = port === PROXY_PORT;
            const attemptType = isProxyAttempt ? '[PROXY]' : '[DIRECT]';

            for (const host of this.config.hosts) {
                try {
                    const url = `http://${host}:${port}/json/version`;

                    log('DEBUG', `[ORCH] ${attemptType} Tentando WS endpoint: ${url}`);

                    const controller = new AbortController();
                    let timeoutId = null;
                    let res;
                    try {
                        timeoutId = setTimeout(() => controller.abort(), 5000);
                        res = await fetch(url, { signal: controller.signal });
                    } finally {
                        if (timeoutId !== null) {
                            clearTimeout(timeoutId);
                        }
                    }

                    if (!res.ok) {
                        errors.push(`${host}:${port} - HTTP ${res.status}`);
                        continue;
                    }

                    /** @type {{ webSocketDebuggerUrl?: string }} */
                    const json = await res.json();
                    if (json.webSocketDebuggerUrl) {
                        // ✅ LOG DE SUCESSO: Indica claramente se conectou via proxy
                        if (isProxyAttempt && port === PROXY_PORT) {
                            log('INFO', `[ORCH] ✅ Conectado via Chrome Proxy Service (${host}:${port})`);
                            log('INFO', `[ORCH]    WebSocket URL: ${json.webSocketDebuggerUrl}`);
                        } else {
                            log('INFO', `[ORCH] ✅ Conectado diretamente ao Chrome (${host}:${port})`);
                        }

                        return await puppeteerCore.connect({
                            browserWSEndpoint: json.webSocketDebuggerUrl,
                            defaultViewport: null,
                            protocolTimeout: 10000,
                        });
                    }
                    errors.push(`${host}:${port} - No WS URL in response`);
                } catch (e) {
                    errors.push(`${host}:${port} - ${e.message}`);
                }
            }
        }

        throw new Error(`WS endpoint unreachable (fallback): ${errors.join('; ')}`);
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

        // FIXED (P0-2.3): Substituído recursão por loop iterativo
        // Previne stack overflow em retry scenarios

        // =====================================================================
        // CHROME PROXY INTEGRATION - Estratégia Smart (Fast Path + Fallback)
        // =====================================================================
        // ARQUITETURA CORRETA (DevContainer + Windows Host):
        //
        // Puppeteer (container) → localhost:9224 (Proxy no container)
        //                           ↓
        //                         host.docker.internal:9225 (Chrome no Windows)
        //
        // ESTRATÉGIA DE CONEXÃO:
        //
        // 1. FAST PATH (99% dos casos - DevContainer padrão):
        //    - browserEndpoint.url ou .wsEndpoint definido
        //    - Conecta DIRETO sem loops (1 tentativa, <100ms)
        //    - Usado por: boot_resilience_manager.js, pool_manager.js
        //    - Exemplo: browserEndpoint: { url: 'http://localhost:9224' }
        //
        // 2. FALLBACK PATH (raro - configs custom non-DevContainer):
        //    - browserEndpoint NÃO definido
        //    - Itera hosts/ports configurados (flexibilidade)
        //    - DevContainer padrão: 1 host × 1 porta = 1 iteração
        //    - Custom config: new ConnectionOrchestrator({ hosts: [...], ports: [...] })
        //
        // IMPORTANTE: Puppeteer NUNCA se conecta diretamente ao Chrome no Windows!
        // - Porta 9225 está no Windows, inacessível do container (sem port forwarding)
        // - host.docker.internal é usado PELO PROXY, não pelo Puppeteer
        // - Puppeteer conecta APENAS a localhost:9224 (proxy no mesmo container)
        //
        // O Proxy (chromeProxyService.js) faz o redirecionamento:
        // - Recebe conexões em localhost:9224 (container-facing)
        // - Reescreve URLs (localhost → host.docker.internal)
        // - Encaminha para Chrome em host.docker.internal:9225
        //
        // Portas configuradas em config.js (CHROME_PROXY_PORT: 9224, CHROME_PORT: 9225)
        // Documentação: DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md
        // =====================================================================

        // Ordem de prioridade para modo 'auto' (apenas modos de conexão; launcher/executablePath NÃO são suportados)
        const fallbackOrder = ['wsEndpoint', 'connect'];
        const modesToTry = mode === 'auto' ? fallbackOrder : [mode];

        let lastError = null;

        // FIXED (P0-2.3): Loop iterativo ao invés de recursão
        // Outer loop para retries (previne stack overflow)
        while (this.retryCount < this.config.maxConnectionAttempts) {
            // Inner loop para tentar diferentes modos
            for (const currentMode of modesToTry) {
                // Evita tentar o mesmo modo múltiplas vezes na mesma rodada
                if (this.attemptedModes.includes(currentMode) && mode !== 'auto') {
                    continue;
                }

                try {
                    this.setState(STATES.CONNECTING_BROWSER, { mode: currentMode });
                    log('INFO', `[ORCH] Tentando conexão em modo: ${currentMode}`);

                    switch (currentMode) {
                        case 'connect':
                            this.browser = await this.tryConnectBrowserURL();
                            break;

                        case 'wsEndpoint':
                            this.browser = await this.tryConnectWSEndpoint();
                            break;

                        default:
                            throw new Error(`Modo desconhecido: ${currentMode} (suportados: wsEndpoint, connect)`);
                    }

                    if (this.browser) {
                        // Registra listeners limpos
                        this.browser.on('disconnected', this._onDisconnect);
                        this.browser.on('targetdestroyed', this._onTargetDestroyed);

                        this.retryCount = 0;
                        this.attemptedModes = []; // Reseta tentativas após sucesso
                        this.setState(STATES.BROWSER_READY);
                        log('INFO', `[ORCH] Browser conectado com sucesso em modo: ${currentMode}`);
                        return this.browser; // SUCCESS - sai imediatamente
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

            // Se chegou aqui, todos os modos falharam nesta rodada
            this.retryCount++;
            this.classifyIssue(
                ISSUE_KIND.EVENT,
                ISSUE_TYPES.BROWSER_NOT_STARTED,
                lastError?.message || 'Todos os modos falharam'
            );
            this.setState(STATES.RETRY_BROWSER, { retry: this.retryCount, attemptedModes: this.attemptedModes });

            // Se ainda há tentativas disponíveis, aguarda com backoff exponencial
            if (this.retryCount < this.config.maxConnectionAttempts) {
                const delay = Math.min(
                    this.config.retryDelayMs * Math.pow(1.5, this.retryCount - 1),
                    this.config.maxRetryDelayMs
                );

                log('WARN', `[ORCH] Retry ${this.retryCount}/${this.config.maxConnectionAttempts} em ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));

                // Reseta modos tentados para permitir nova rodada
                this.attemptedModes = [];
                // Continue outer while loop para tentar novamente
            }
        }

        // Esgotou todas as tentativas
        throw new Error(
            `Falha ao conectar após ${this.retryCount} tentativas: ${lastError?.message || 'Unknown error'}`
        );
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

    async ensurePage(maxRetries = 60, maxWaitMs = 120000) {
        this.setState(STATES.WAITING_FOR_PAGE);

        // Se já temos página válida, retorna
        if (this.page && !this.page.isClosed()) {
            this.setState(STATES.PAGE_SELECTED);
            return this.page;
        }

        const startTime = Date.now();
        let attempt = 0;

        while (attempt < maxRetries) {
            // Check global timeout
            if (Date.now() - startTime > maxWaitMs) {
                throw new Error(`ensurePage timed out after ${maxWaitMs}ms (${attempt} attempts)`);
            }

            try {
                // Verifica se browser ainda está vivo antes de buscar página
                if (!this.browser || !this.browser.isConnected()) {
                    throw new Error('Browser lost during page scan');
                }

                const page = await this.scanForTargetPage();
                if (page) {
                    this.page = page;
                    this.setState(STATES.PAGE_SELECTED, { url: page.url() });
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

                attempt++;
                if (attempt >= maxRetries) {
                    throw new Error(`Failed to ensure page after ${maxRetries} attempts: ${e.message}`, { cause: e });
                }

                await new Promise(r => {
                    setTimeout(r, 1000);
                });
            }
        }

        throw new Error(`Failed to ensure page after ${maxRetries} attempts`);
    }

    async validatePage(page) {
        this.setState(STATES.VALIDATING_PAGE);
        try {
            if (!page || page.isClosed()) {
                throw new Error('Page closed');
            }
            // ❌ REMOVIDO: page.bringToFront() trazia Chrome para frente constantemente
            // await page.bringToFront().catch(() => {});
            this.setState(STATES.PAGE_VALIDATED, { url: page.url() });
            return true;
        } catch (_) {
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

    async acquireContext({ timeout = 30000, maxRetries = 30 } = {}) {
        this.detectEnvironment();

        const startTime = Date.now();
        let attempt = 0;

        // Loop de recuperação com timeout e max retries
        while (attempt < maxRetries) {
            // Check global timeout
            if (Date.now() - startTime > timeout) {
                throw new Error(`acquireContext timed out after ${timeout}ms (${attempt} attempts)`);
            }

            try {
                await this.ensureBrowser();
                const page = await this.ensurePage();

                if (await this.validatePage(page)) {
                    this.setState(STATES.READY);
                    return { browser: this.browser, page: this.page };
                }
            } catch (e) {
                attempt++;
                log('WARN', `[ORCH] Ciclo de recuperação (attempt ${attempt}/${maxRetries}): ${e.message}`);

                if (attempt >= maxRetries) {
                    throw new Error(`Failed to acquire context after ${maxRetries} attempts: ${e.message}`); // eslint-disable-line preserve-caught-error
                }

                await new Promise(r => {
                    setTimeout(r, 1000);
                });
            }
        }

        throw new Error(`Failed to acquire context after ${maxRetries} attempts`);
    }

    getStatus() {
        return {
            state: this.state,
            mode: this.config.mode,
            browserConnected: !!this.browser?.isConnected(),
            pageUrl: this.page?.url() || null,
            lastIssue: this.lastIssue,
            attemptedModes: this.attemptedModes,
            retryCount: this.retryCount,
        };
    }

    /**
     * Sincroniza e valida endpoints de Chrome/Proxy.
     * Retorna um relatório com tentativas em hosts/ports configurados.
     * Útil para scripts de bootstrap/diagnóstico.
     */
    static async synchronize(options = {}) {
        const report = {
            checked: [],
            reachable: [],
            unreachable: [],
        };

        const hosts = options.hosts && options.hosts.length ? options.hosts : DEFAULTS.hosts;
        const ports = options.ports && options.ports.length ? options.ports : DEFAULTS.ports;

        // ✅ ESTRATÉGIA (DevContainer): Valida proxy no container (localhost:9224)
        // NOTA: Ordem consistente com tryConnect* (port outer, host inner)
        for (const port of ports) {
            for (const host of hosts) {
                const url = `http://${host}:${port}/json/version`;
                const entry = { host, port, url, ok: false, status: null, ws: null, error: null };
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);

                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    entry.status = res.status;
                    if (!res.ok) {
                        entry.error = `HTTP ${res.status}`;
                        report.unreachable.push(entry);
                        report.checked.push(entry);
                        continue;
                    }

                    /** @type {{ webSocketDebuggerUrl?: string }} */
                    const json = await res.json();
                    entry.ok = true;
                    entry.ws = json.webSocketDebuggerUrl || null;
                    report.reachable.push(entry);
                    report.checked.push(entry);
                } catch (err) {
                    entry.error = err && err.message ? err.message : String(err);
                    report.unreachable.push(entry);
                    report.checked.push(entry);
                }
            }
        }

        // Summary
        report.summary = {
            totalChecked: report.checked.length,
            reachable: report.reachable.length,
            unreachable: report.unreachable.length,
        };

        return report;
    }
}

export { ConnectionOrchestrator, STATES };
