FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\core\TargetDriver.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/core/TargetDriver.js
   Audit Level: 700 — Sovereign Contract Master (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Classe abstrata mestre. Define o contrato de execução,
                     gerencia a máquina de estados e o canal de sinais vitais.
   Sincronizado com: BaseDriver V700, DriverLifecycleManager V70, 
                     TelemetryBridge V500.
========================================================================== */

const EventEmitter = require('events');
const { log } = require('../../core/logger');

/**
 * EVENTOS PADRONIZADOS (The IPC 2.0 Pulse)
 */
const EVENTS = Object.freeze({
  STATE_CHANGE: 'state_change',        // Transições da máquina de estados
  CAPABILITIES_CHANGED: 'caps_change', // Mudança em habilidades técnicas
  DESTROYED: 'destroyed',              // Sinal para Factory limpar cache
  VITAL: 'driver:vital',               // Canal sensorial para TelemetryBridge
  WARNING: 'warning',                  // Alertas não fatais
  DEBUG: 'debug'                       // Dados de depuração técnica
});

/**
 * ESTADOS VITAIS (Engine States)
 */
const STATES = Object.freeze({
  IDLE: 'IDLE',           // Ocioso, aguardando tarefa
  PREPARING: 'PREPARING', // Configurando contexto/modelo
  TYPING: 'TYPING',       // Executando interação biomecânica
  WAITING: 'WAITING',     // Aguardando resposta da IA
  STALLED: 'STALLED'      // Detectado provável travamento
});

class TargetDriver extends EventEmitter {
  /**
   * @param {object} page - Instância da página do Puppeteer.
   * @param {object} config - Configuração da tarefa (clonada).
   * @param {AbortSignal} signal - Sinal soberano vindo do LifecycleManager.
   */
  constructor(page, config, signal) {
    super();
    
    // Proteção de Classe Abstrata
    if (this.constructor === TargetDriver) {
      throw new Error("[TARGET_DRIVER] Erro Fatal: Classe abstrata não pode ser instanciada diretamente.");
    }

    this.page = page;
    this.config = config;
    this.signal = signal; // [R3] O Driver segue o sinal de aborto externo (Soberania)
    this.name = "Generic";
    this.destroyed = false;
    this.correlationId = null;
    
    // Propriedades da Máquina de Estados
    this._state = STATES.IDLE;
    this.stateUpdated = Date.now();
    
    // Capacidades Técnicas Iniciais (Manifesto de Habilidades)
    this._capabilities = {
      text_generation: true,
      image_generation: false,
      file_upload: false,
      context_reset: true,
      streaming_events: false
    };
  }

  /* ==========================================================================
      GESTÃO DE ESTADO E CAPACIDADES
  ========================================================================== */
  
  get state() { return this._state; }
  
  /**
   * Altera o estado interno e emite telemetria de transição.
   * @param {string} newState - Membro da constante STATES.
   */
  setState(newState) {
    if (this.destroyed) return;

    if (!STATES[newState]) {
      throw new Error(`[TARGET_DRIVER] Tentativa de transição para estado inválido: "${newState}"`);
    }

    if (this._state !== newState) {
      const now = Date.now();
      const oldState = this._state;
      const duration = now - this.stateUpdated;

      this._state = newState;
      this.stateUpdated = now;

      this.emit(EVENTS.STATE_CHANGE, { 
          from: oldState, 
          to: newState, 
          ts: now,
          duration_ms: duration 
      });
    }
  }

  /**
   * Atualiza o mapa de capacidades técnicas do robô e notifica o sistema.
   * @param {object} newCaps - Objeto com as novas capacidades.
   */
  updateCapabilities(newCaps) {
      if (this.destroyed) return;
      const oldCaps = { ...this._capabilities };
      this._capabilities = { ...this._capabilities, ...newCaps };
      this.emit(EVENTS.CAPABILITIES_CHANGED, { old: oldCaps, new: this._capabilities });
  }

  getCapabilities() { return { ...this._capabilities }; }

  /* ==========================================================================
      DIAGNÓSTICO E SAÚDE (SAFE-ACCESS)
  ========================================================================== */

  /**
   * Retorna um snapshot da saúde operacional do driver.
   * Usado pelo Supervisor para detecção de Drifts.
   */
  async getHealth() { 
      const isPageAlive = !!(this.page && !this.page.isClosed());
      return { 
          status: this.destroyed ? 'DEAD' : (isPageAlive ? 'OK' : 'DEGRADED'), 
          state: this._state,
          stateAge: Date.now() - this.stateUpdated,
          isPageAttached: isPageAlive,
          name: this.name,
          correlationId: this.correlationId
      }; 
  }

  /* ==========================================================================
      API PÚBLICA (CONTRATO OBRIGATÓRIO)
  ========================================================================== */

  async optimizePage() { return Promise.resolve(); }

  // Métodos Abstratos: Devem ser implementados obrigatoriamente pelas classes filhas
  async validatePage() { throw new Error('Método validatePage não implementado.'); }
  async prepareContext(taskSpec) { throw new Error('Método prepareContext não implementado.'); }
  async sendPrompt(text, taskId, signal) { throw new Error('Método sendPrompt não implementado.'); }
  async waitForCompletion(startSnapshot, signal) { throw new Error('Método waitForCompletion não implementado.'); }
  async captureState() { throw new Error('Método captureState não implementado.'); }
  async stopGeneration() { throw new Error('Método stopGeneration não implementado.'); }
  async commitLearning() { return Promise.resolve(); }
  
  /**
   * Sobrescrita de segurança para emissão de eventos.
   * Bloqueia emissões após a destruição da instância.
   */
  emit(event, ...args) {
    if (this.destroyed && event !== EVENTS.DESTROYED) return false;
    return super.emit(event, ...args);
  }

  /**
   * Destruição profunda da instância e sinalização para a Factory.
   * Garante que o robô seja removido do cache e a memória seja liberada.
   */
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    // [R2] Notifica a Factory para remoção imediata do cache de instâncias
    this.emit(EVENTS.DESTROYED);

    this.removeAllListeners();

    // Assistência ao Garbage Collector (GC)
    this.page = null;
    this.config = null;
    
    try {
        log('DEBUG', `[${this.name}] Driver destruído. Referências de memória limpas.`);
    } catch(e) {}
  }
}

// Exportação de Constantes para uso externo
TargetDriver.EVENTS = EVENTS;
TargetDriver.STATES = STATES;

module.exports = TargetDriver;