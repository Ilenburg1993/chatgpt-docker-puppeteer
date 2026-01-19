FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\modules\biomechanics_engine.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/modules/biomechanics_engine.js
   Audit Level: 500 — Instrumented Biomechanics Engine (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Gerenciar a execução física de interações (clique, digitação, 
                     scroll) e reportar telemetria biomecânica em tempo real.
   Sincronizado com: BaseDriver V320, human.js V500, TelemetryBridge V500.
========================================================================== */

const human = require('./human');
const analyzer = require('./analyzer');
const stabilizer = require('./stabilizer');
const adaptive = require('../../logic/adaptive');
const { log } = require('../../core/logger');

class BiomechanicsEngine {
  /**
   * @param {object} driver - Instância do BaseDriver (para acesso ao _emitVital).
   */
  constructor(driver) {
    this.driver = driver;
    this.modifier = null;
    this.lastKeepAlive = Date.now();
  }

  /* ======================================================================
     GESTÃO DE MODIFICADORES E ESTADO
  ====================================================================== */

  async getModifier() {
    if (this.modifier) return this.modifier;
    this.driver._assertPageAlive();
    
    try {
      const platform = await this.driver.page.evaluate(() => {
        const ua = navigator.userAgent || "";
        if (navigator.userAgentData?.mobile || /Mobile(?!.*Chrome\/\d+)|Android|iPhone/i.test(ua)) {
          return 'mobile';
        }
        return (navigator.platform || '').toLowerCase();
      });
      
      if (platform.includes('mac')) this.modifier = 'Meta';
      else if (platform === 'mobile') this.modifier = null;
      else this.modifier = 'Control';
      
    } catch (modErr) { 
      this.modifier = 'Control'; 
    }
    
    return this.modifier;
  }

  async releaseModifiers() {
    try {
      if (this.driver.page && !this.driver.page.isClosed()) {
        const knownMods = ['Control', 'Meta', 'Shift', 'Alt'];
        for (const mod of knownMods) {
          await this.driver.page.keyboard.up(mod).catch(() => {});
        }
      }
    } catch (releaseErr) {}
  }

  /* ======================================================================
     INSTRUMENTAÇÃO DE ESPERA E ESTABILIDADE
  ====================================================================== */

  /**
   * Aguarda a IA ficar ociosa, narrando a espera para o Dashboard.
   */
  async waitIfBusy(taskId) {
    const { timeout } = await adaptive.getAdjustedTimeout(
      this.driver.currentDomain, 
      0, 
      'INITIAL'
    );
    
    const start = Date.now();
    let iterations = 0;

    // [V500] Inicia narração de espera
    this.driver._emitVital('PROGRESS_UPDATE', { step: 'WAITING_FOR_IA_IDLE', taskId });

    while (Date.now() - start < timeout && iterations < 50) { 
      iterations++;
      this.driver._assertPageAlive();
      
      if (Date.now() - this.lastKeepAlive > 25000) {
        await human.wakeUpMove(this.driver.page).catch(() => {});
        this.lastKeepAlive = Date.now();
      }

      const responseInfo = await analyzer.findResponseArea(this.driver.page).catch(() => null);
      if (!responseInfo || !responseInfo.isBusy) {
        const loadStatus = await stabilizer.getPageLoadStatus(this.driver.page);
        if (loadStatus === 'IDLE') {
            this.driver._emitVital('PROGRESS_UPDATE', { step: 'IA_IDLE_CONFIRMED', taskId });
            return;
        }
      }
      
      await new Promise(r => setTimeout(r, 800));
    }
    
    if (iterations >= 50) {
      log('WARN', `[BIOMECH] _waitIfBusy atingiu limite de segurança`, taskId);
    }
  }

  /* ======================================================================
     EXECUÇÃO FÍSICA INSTRUMENTADA
  ====================================================================== */

  async getStableRect(ctx, selector) {
    let lastRect = null;
    for (let i = 0; i < 10; i++) {
      try {
        const rect = await ctx.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }, selector);
        
        if (lastRect && rect && 
            Math.abs(rect.x - lastRect.x) < 0.5 && 
            Math.abs(rect.y - lastRect.y) < 0.5) {
          return rect;
        }
        lastRect = rect;
      } catch (rectErr) { return null; }
      await new Promise(r => setTimeout(r, 60));
    }
    return lastRect;
  }

  async omniScroll(ctx, frameStack, selector) {
    const mainHeight = await this.driver.page.evaluate(() => window.innerHeight);
    const baseOffset = mainHeight * 0.15;

    await ctx.evaluate((sel, off) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      const safeOff = Math.min(off, window.innerHeight * 0.3);
      window.scrollBy(0, -safeOff);
    }, selector, baseOffset);
    
    for (let i = frameStack.length - 1; i >= 0; i--) {
      try {
        const parent = (i === 0) ? this.driver.page : await frameStack[i-1].contentFrame();
        if (!parent) continue;
        await frameStack[i].scrollIntoView({ behavior: 'auto', block: 'center' });
        await parent.evaluate((off) => {
          const safeOff = Math.min(off, window.innerHeight * 0.3);
          window.scrollBy(0, -safeOff);
        }, baseOffset);
      } catch (scrollErr) {}
    }
    await new Promise(r => setTimeout(r, 500));
  }

  /**
   * Prepara o elemento para interação, reportando o pulso de movimento.
   */
  async prepareElement(execContext, selector) {
    const { ctx, frameStack, offsetX, offsetY } = execContext;
    
    this.driver._emitVital('PROGRESS_UPDATE', { step: 'SCROLLING_TO_ELEMENT', selector });
    await this.omniScroll(ctx, frameStack, selector);
    
    const rect = await this.getStableRect(ctx, selector);
    if (!rect) throw new Error('ELEMENT_LOST');
    
    // [V500] Realiza o clique humano reportando o pulso de mouse
    await human.humanClick(
        this.driver.page, 
        ctx, 
        selector, 
        offsetX, 
        offsetY, 
        this.driver.signal,
        (pulse) => this.driver._emitVital('HUMAN_PULSE', pulse)
    );

    await ctx.focus(selector);
  }

  async clearInput(ctx, selector) {
    this.driver._emitVital('PROGRESS_UPDATE', { step: 'CLEARING_INPUT', selector });
    const mod = await this.getModifier();
    
    if (mod && mod !== 'mobile') {
      await this.driver.page.keyboard.down(mod);
      await this.driver.page.keyboard.press('a');
      await this.driver.page.keyboard.up(mod);
      await this.driver.page.keyboard.press('Backspace');
    }
    
    await ctx.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) { 
        if (el.isContentEditable) el.innerHTML = ''; 
        else el.value = ''; 
      }
    }, selector);
  }

  /**
   * Digita o texto reportando o progresso e o pulso de cada tecla.
   */
  async typeText(ctx, selector, text, signal) {
    if (text.length > 2000) {
      // Zen Mode (Injeção Direta)
      this.driver._emitVital('PROGRESS_UPDATE', { step: 'ZEN_MODE_TYPING_START', length: text.length });
      
      const zenSuccess = await ctx.evaluate((sel, content) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.focus();
        const ok = document.execCommand('insertText', false, content);
        if (!ok) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText")?.set;
          if (setter) setter.call(el, content);
        }
        ['input', 'change'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
        const finalVal = el.value || el.innerText || "";
        if (finalVal.trim().length > 0) { el.blur(); el.focus(); return true; }
        return false;
      }, selector, text);

      if (!zenSuccess) throw new Error('ZEN_MODE_FAILED');
      this.driver._emitVital('PROGRESS_UPDATE', { step: 'ZEN_MODE_TYPING_COMPLETE' });
      
    } else {
      // Human Mode (Digitação Biomecânica)
      this.driver._emitVital('PROGRESS_UPDATE', { step: 'HUMAN_TYPING_START', length: text.length });
      
      const lag = await stabilizer.measureEventLoopLag(this.driver.page);
      
      // [V500] Passa o callback para reportar cada tecla pressionada
      await human.humanType(
          this.driver.page, 
          ctx, 
          selector, 
          text, 
          lag, 
          signal,
          (pulse) => this.driver._emitVital('HUMAN_PULSE', pulse)
      );
      
      // Verificação de Eco (Sanidade)
      const eco = await ctx.evaluate((s) => {
        const el = document.querySelector(s);
        const val = el?.value || el?.innerText || "";
        return Array.from(val.replace(/\s/g, '')).length;
      }, selector);
      
      const threshold = text.length > 50 ? 0.6 : 0.5;
      if (eco < Array.from(text.replace(/\s/g, '')).length * threshold) {
        throw new Error('INPUT_ECHO_FAILED');
      }

      this.driver._emitVital('PROGRESS_UPDATE', { step: 'HUMAN_TYPING_COMPLETE' });
    }
  }
}

module.exports = BiomechanicsEngine;