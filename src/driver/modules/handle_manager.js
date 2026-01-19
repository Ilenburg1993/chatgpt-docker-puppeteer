/* ==========================================================================
   src/driver/modules/handle_manager.js
   Audit Level: 100 — Handle Lifecycle Management
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: Gestão de handles do Puppeteer com cleanup automático.
========================================================================== */

const { log } = require('../../core/logger');

class HandleManager {
  constructor(driver) {
    this.driver = driver;
    this.activeHandles = [];
  }

  register(handle) {
    if (handle) this.activeHandles.push(handle);
    return handle;
  }

  async clearAll() {
    const clearWithTimeout = Promise.race([
      (async () => {
        while (this.activeHandles.length > 0) {
          const h = this.activeHandles.pop();
          try { 
            await h.dispose(); 
          } catch (disposeErr) {}
        }
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CLEAR_TIMEOUT')), 3000))
    ]);

    try { 
      await clearWithTimeout; 
    } catch (timeoutErr) {
      log('WARN', `[HANDLES] Cleanup parcial: ${this.activeHandles.length} handles em background disposal`);
      
      const orphans = [...this.activeHandles];
      this.activeHandles = [];
      
      // Fire-and-forget
      Promise.all(orphans.map(h => h.dispose().catch(() => {}))).catch(() => {});
    }
  }

  getActiveCount() {
    return this.activeHandles.length;
  }
}

module.exports = HandleManager;