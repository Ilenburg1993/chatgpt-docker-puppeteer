FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\modules\stabilizer.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/modules/stabilizer.js
   Audit Level: 500 — Instrumented System Stabilizer (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Garantir que a interface está estática e responsiva antes 
                     de interações físicas, narrando o status de prontidão.
   Sincronizado com: BaseDriver V320, adaptive.js V100, TelemetryBridge V500.
========================================================================== */

const { log } = require('../../core/logger');
const adaptive = require('../../logic/adaptive');

/**
 * Mede o atraso (lag) do Event Loop no contexto do Browser.
 */
async function measureEventLoopLag(page) {
  try {
    return await page.evaluate(() => {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        const t0 = performance.now();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve(performance.now() - t0);
        };
        channel.port2.postMessage(null);
      });
    });
  } catch { return 500; }
}

/**
 * Verifica a presença de indicadores de carregamento (spinners) e tráfego de rede.
 */
async function getPageLoadStatus(page) {
  try {
    return await page.evaluate(() => {
      const checkSpinnersDeep = (root = document) => {
        const selector = '[role="progressbar"], .spinner, .loading, svg.animate-spin, [aria-busy="true"], [data-loading="true"]';
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;

        while (node) {
          if (node.nodeType === 1) {
            if (node.matches(selector)) {
                if (node.offsetParent !== null) {
                    const s = window.getComputedStyle(node);
                    if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.1) return true;
                }
            }
            if (node.shadowRoot && checkSpinnersDeep(node.shadowRoot)) return true;
            if (node.tagName === 'IFRAME') {
              try { 
                  if (node.contentDocument && checkSpinnersDeep(node.contentDocument)) return true; 
              } catch (e) {}
            }
          }
          node = walker.nextNode();
        }
        return false;
      };

      if (checkSpinnersDeep()) return 'BUSY_SPINNER';

      const entries = performance.getEntriesByType('resource');
      if (entries.length > 0) {
        const latest = entries.reduce((a, b) => (b.responseEnd > a.responseEnd ? b : a), entries[0]);
        if (performance.now() - latest.responseEnd < 500) return 'BUSY_NETWORK';
      }
      return 'IDLE';
    });
  } catch { return 'UNKNOWN'; }
}

/**
 * Orquestra a estabilização multi-fase da página.
 * @param {object} driver - Instância do BaseDriver.
 * @param {number} timeoutMs - Tempo máximo de espera.
 */
async function waitForStability(driver, timeoutMs = 30000) {
  const page = driver.page;
  const start = Date.now();
  const deadline = start + timeoutMs;
  const correlationId = driver.correlationId;

  let domain = 'unknown';
  try {
      const url = page.url();
      if (url && url.startsWith('http')) domain = new URL(url).hostname.replace('www.', '');
  } catch (e) {}

  // FASE 0: Limpeza de métricas
  await page.evaluate(() => performance.clearResourceTimings()).catch(() => {});

  try {
    // FASE 1: Network Idle
    driver._emitVital('PROGRESS_UPDATE', { step: 'STABILIZING_NETWORK' });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // FASE 2: Spinner Check
    driver._emitVital('PROGRESS_UPDATE', { step: 'CHECKING_UI_SPINNERS' });
    let iterations = 0;
    while (iterations < 60 && Date.now() < deadline) {
        const status = await getPageLoadStatus(page);
        if (status === 'IDLE') break;
        await new Promise(r => setTimeout(r, 500));
        iterations++;
    }

    // FASE 3: Estabilidade de Entropia (MutationObserver)
    driver._emitVital('PROGRESS_UPDATE', { step: 'ANALYZING_DOM_ENTROPY' });
    
    let silenceWindow = 500;
    try {
        const metrics = await adaptive.getSnapshot(); 
        const targetStats = metrics.targets[domain];
        if (targetStats && targetStats.stream.avg > 1000) silenceWindow = 1000;
    } catch (e) {}

    await page.evaluate(async (windowMs, taskDomain, maxWaitMs) => {
      const observers = [];
      try {
          return await new Promise((resolve) => {
            let lastActivity = Date.now();
            const startTime = Date.now();

            const onMutation = (mutations) => {
                const isRelevant = mutations.some(m => 
                    m.type === 'childList' || m.type === 'characterData' ||
                    (m.type === 'attributes' && (m.attributeName.startsWith('data-') || ['class', 'aria-busy'].includes(m.attributeName)))
                );
                if (isRelevant) lastActivity = Date.now();
            };

            const roots = [document];
            const queue = [document];
            while (queue.length > 0) {
                const curr = queue.shift();
                const walker = document.createTreeWalker(curr, NodeFilter.SHOW_ELEMENT);
                let node = walker.nextNode();
                while (node) {
                    if (node.nodeType === 1) {
                        if (node.shadowRoot) { roots.push(node.shadowRoot); queue.push(node.shadowRoot); }
                        if (node.tagName === 'IFRAME') {
                            try { if (node.contentDocument) { roots.push(node.contentDocument); queue.push(node.contentDocument); } } catch(e) {}
                        }
                    }
                    node = walker.nextNode();
                }
            }

            roots.forEach(r => {
                const obs = new MutationObserver(onMutation);
                const target = (r instanceof ShadowRoot) ? r : (r.documentElement || r);
                try {
                    obs.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
                    observers.push(obs);
                } catch(e) {}
            });

            const check = setInterval(() => {
              const now = Date.now();
              if (!window.__SADI_PULSE) window.__SADI_PULSE = {};
              const lastPulse = window.__SADI_PULSE[taskDomain] || 0;
              const isPulsing = (now - lastPulse < 1500);

              if ((!isPulsing && now - lastActivity > windowMs) || (now - startTime > maxWaitMs)) {
                clearInterval(check);
                resolve();
              }
            }, 100);
          });
      } finally {
          observers.forEach(o => o.disconnect());
      }
    }, silenceWindow, domain, Math.max(8000, timeoutMs * 0.3));

    // FASE 4: Hydration Guard
    driver._emitVital('PROGRESS_UPDATE', { step: 'HYDRATION_GUARD' });
    await page.evaluate(async () => {
        return new Promise((resolve) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => { controller.abort(); resolve(); }, 1000);
            document.addEventListener('mousemove', () => { clearTimeout(timeout); resolve(); }, { once: true, signal: controller.signal });
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        });
    }).catch(() => {});

    // FASE 5: Visual Frame Sync
    driver._emitVital('PROGRESS_UPDATE', { step: 'FRAME_SYNC' });
    await Promise.race([
        page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))),
        new Promise(r => setTimeout(r, 2000))
    ]).catch(() => {});

    // FASE 6: CPU Lag Check
    driver._emitVital('PROGRESS_UPDATE', { step: 'CPU_LAG_CHECK' });
    let lag = 999;
    const cpuDeadline = Math.min(Date.now() + 5000, deadline);
    while (lag > 150 && Date.now() < cpuDeadline) {
      lag = await measureEventLoopLag(page);
      if (lag > 150) {
          driver._emitVital('TRIAGE_ALERT', { type: 'HIGH_CPU_LAG', severity: 'LOW', evidence: { lag_ms: lag } });
          await new Promise(r => setTimeout(r, 300));
      }
    }

    driver._emitVital('PROGRESS_UPDATE', { step: 'STABILITY_CONFIRMED' });
    return true;

  } catch (e) {
    log('WARN', `Estabilização parcial (${Date.now() - start}ms): ${e.message}`, correlationId);
    return false;
  }
}

module.exports = { waitForStability, measureEventLoopLag, getPageLoadStatus };