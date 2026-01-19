/* ==========================================================================
   src/infra/connection_orchestrator.js
   Audit Level: 21 — Hardened Infrastructure State Machine (Leak Proof)
========================================================================== */

const puppeteer = require('puppeteer-core'); // Use core se for local
const os = require('os');
const { log } = require('../core/logger');

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

const DEFAULTS = {
  ports: [9222],
  retryDelayMs: 3000,
  maxRetryDelayMs: 15000,
  pageScanIntervalMs: 4000,
  stateHistorySize: 50,
  allowedDomains: ['chatgpt.com', 'gemini.google.com'],
  pageSelectionPolicy: 'FIRST',
  connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT']
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
    
    // Handlers referenciados para remoção limpa
    this._onDisconnect = this._handleDisconnect.bind(this);
    this._onTargetDestroyed = this._handleTargetDestroyed.bind(this);
  }

  setState(next, meta = {}) {
    if (this.state === next) return; // Evita spam de estado igual
    this.state = next;
    this._pushStateHistory(next, meta);
    log('INFO', `[ORCH] State: ${next}`, meta);
  }

  _pushStateHistory(state, meta) {
    this.stateHistory.push({ state, meta, ts: new Date().toISOString() });
    if (this.stateHistory.length > this.config.stateHistorySize) this.stateHistory.shift();
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

  // --- CONEXÃO ---

  async tryConnectBrowserURL() {
    for (const port of this.config.ports) {
      try {
        return await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
      } catch (_) {}
    }
    throw new Error('browserURL unreachable');
  }

  async tryConnectWSEndpoint() {
    for (const port of this.config.ports) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // Timeout curto para check
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const json = await res.json();
        if (json.webSocketDebuggerUrl) {
          return await puppeteer.connect({ browserWSEndpoint: json.webSocketDebuggerUrl, defaultViewport: null });
        }
      } catch (_) {}
    }
    throw new Error('WS endpoint unreachable');
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

    while (true) {
      try {
        this.setState(STATES.CONNECTING_BROWSER);

        for (const strat of this.config.connectionStrategies) {
          if (strat === 'BROWSER_URL') this.browser = await this.tryConnectBrowserURL().catch(() => null);
          else if (strat === 'WS_ENDPOINT') this.browser = await this.tryConnectWSEndpoint().catch(() => null);
          
          if (this.browser) break;
        }

        if (!this.browser) throw new Error('Chrome não encontrado (Porta fechada)');

        // Registra listeners limpos
        this.browser.on('disconnected', this._onDisconnect);
        this.browser.on('targetdestroyed', this._onTargetDestroyed);

        this.retryCount = 0;
        this.setState(STATES.BROWSER_READY);
        return this.browser;

      } catch (e) {
        this.retryCount++;
        this.classifyIssue(ISSUE_KIND.EVENT, ISSUE_TYPES.BROWSER_NOT_STARTED, e.message);
        this.setState(STATES.RETRY_BROWSER, { retry: this.retryCount });
        
        const delay = Math.min(this.config.retryDelayMs * (1 + this.retryCount * 0.1), this.config.maxRetryDelayMs);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async scanForTargetPage() {
    const pages = await this.browser.pages();
    const candidates = pages.filter(p => {
      const url = p.url();
      return url && url !== 'about:blank' && this.config.allowedDomains.some(d => url.includes(d));
    });
    if (!candidates.length) return null;
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
          return page;
        }

        this.classifyIssue(ISSUE_KIND.EVENT, ISSUE_TYPES.PAGE_NOT_FOUND, 'Aguardando aba alvo...');
        await new Promise(r => setTimeout(r, this.config.pageScanIntervalMs));

      } catch (e) {
        if (e.message.includes('Browser lost')) {
            // Joga erro para cima para reiniciar o ciclo do browser
            throw e; 
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async validatePage(page) {
    this.setState(STATES.VALIDATING_PAGE);
    try {
      if (!page || page.isClosed()) throw new Error('Page closed');
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
            await new Promise(r => setTimeout(r, 1000));
        }
    }
  }

  getStatus() {
    return {
      state: this.state,
      browserConnected: !!this.browser?.isConnected(),
      pageUrl: this.page?.url() || null,
      lastIssue: this.lastIssue
    };
  }
}

module.exports = { ConnectionOrchestrator, STATES };