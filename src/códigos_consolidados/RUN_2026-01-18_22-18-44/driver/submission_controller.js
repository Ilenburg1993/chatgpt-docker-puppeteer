FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\modules\submission_controller.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/modules/submission_controller.js
   Audit Level: 500 — Instrumented Atomic Submission (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Garantir a submissão atômica da mensagem, prevenir disparos 
                     duplos e reportar a telemetria do fechamento da transação.
   Sincronizado com: BaseDriver V320, adaptive.js V100, TelemetryBridge V500.
========================================================================== */

const adaptive = require('../../logic/adaptive');
const { log } = require('../../core/logger');

class SubmissionController {
  /**
   * @param {object} driver - Instância do BaseDriver (acesso ao _emitVital).
   */
  constructor(driver) {
    this.driver = driver;
    this.submissionLock = null;
    this.LOCK_DURATION = 3000; // Janela de proteção contra double-tap (3s)
  }

  /**
   * Executa a submissão da mensagem com monitoramento sensorial.
   * 
   * @param {object} ctx - Contexto de execução (Page ou Frame).
   * @param {string} selector - Seletor do campo de entrada.
   * @param {string} taskId - ID da tarefa ativa.
   */
  async submit(ctx, selector, taskId) {
    const correlationId = this.driver.correlationId;

    // 1. GATE DE DUPLICIDADE (Anti-Race Condition)
    if (this.submissionLock && Date.now() - this.submissionLock < this.LOCK_DURATION) {
      log('WARN', '[SUBMISSION] Bloqueio de duplicidade ativo. Ignorando comando.', correlationId);
      return;
    }
    
    this.submissionLock = Date.now();

    try {
      // Sinaliza início do procedimento de envio
      this.driver._emitVital('PROGRESS_UPDATE', { step: 'SUBMISSION_START', taskId });

      // Pequena pausa biomecânica pré-press
      await new Promise(r => setTimeout(r, 300));
      
      // 2. ACIONAMENTO FÍSICO (Enter Key)
      this.driver._emitVital('PROGRESS_UPDATE', { step: 'SENDING_ENTER_KEY' });
      await this.driver.page.keyboard.press('Enter');
      
      // 3. CÁLCULO DE ESPERA ADAPTATIVA
      let debounceDelay = 400;
      try {
        const timeoutData = await adaptive.getAdjustedTimeout(
          this.driver.currentDomain, 
          0, 
          'ECHO'
        );
        // Usamos 10% do timeout de eco como janela de limpeza
        debounceDelay = Math.min(Math.floor(timeoutData.timeout / 10), 600);
      } catch (e) { /* Fallback para 400ms */ }
      
      await new Promise(r => setTimeout(r, debounceDelay));
      
      // 4. VERIFICAÇÃO DE ESVAZIAMENTO (Confirmação de Recebimento pela IA)
      const wasCleared = await ctx.evaluate((s) => {
        const el = document.querySelector(s);
        const content = el?.value || el?.innerText || "";
        return content.trim().length === 0;
      }, selector);
      
      if (wasCleared) {
          this.driver._emitVital('PROGRESS_UPDATE', { step: 'SUBMISSION_CONFIRMED' });
          log('DEBUG', '[SUBMISSION] Envio confirmado (campo limpo).', correlationId);
      } else {
          // 5. FALLBACK SINTÉTICO (Ação Corretiva de Emergência)
          log('WARN', '[SUBMISSION] Tecla física falhou. Acionando fallback sintético...', correlationId);
          
          this.driver._emitVital('TRIAGE_ALERT', { 
              type: 'SYNTHETIC_SUBMISSION_TRIGGERED', 
              severity: 'MEDIUM',
              evidence: { selector, delay: debounceDelay }
          });

          await ctx.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const evParams = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 };
            
            // Dispara a sequência completa de eventos de teclado via DOM
            ['keydown', 'keypress', 'keyup'].forEach(t => 
              el.dispatchEvent(new KeyboardEvent(t, evParams))
            );
          }, selector);

          this.driver._emitVital('PROGRESS_UPDATE', { step: 'SUBMISSION_SYNTHETIC_SENT' });
      }
      
      // Estabilização pós-envio
      await new Promise(r => setTimeout(r, 500));
      
    } catch (err) {
        log('ERROR', `[SUBMISSION] Falha no processo de envio: ${err.message}`, correlationId);
        throw err;
    } finally {
      this.submissionLock = null;
    }
  }

  /**
   * Força a liberação do lock de submissão.
   */
  clearLock() {
    this.submissionLock = null;
  }

  /**
   * Verifica se o controlador está em período de cooldown.
   */
  isLocked() {
    return !!(this.submissionLock && Date.now() - this.submissionLock < this.LOCK_DURATION);
  }
}

module.exports = SubmissionController;