/* ==========================================================================
   src/driver/modules/input_resolver.js
   Audit Level: 750 — Governed Input Resolver (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Localizar interfaces de interação priorizando o DNA (rules)
                     sobre a heurística, gerenciar cache e reportar telemetria.
   Sincronizado com: io.js V730, analyzer.js V500, config.js V740.
========================================================================== */

const analyzer = require('./analyzer');
const io = require('../../infra/io');
const CONFIG = require('../../core/config');
const { log } = require('../../core/logger');

class InputResolver {
  /**
   * @param {object} driver - Instância do BaseDriver.
   */
  constructor(driver) {
    this.driver = driver;
    this.cachedProtocol = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Resolve o protocolo de entrada (seletor + contexto) com hierarquia de autoridade.
   * Fluxo: Cache -> DNA (Rules) -> Heurística (SADI Scan).
   */
  async resolve() {
    this.driver._assertPageAlive();
    const domain = this.driver.currentDomain;
    const correlationId = this.driver.correlationId;
    
    // Ritmo de validade ditado pela governança central
    const ttl = CONFIG.all.INPUT_CACHE_TTL || 60000;

    try {
      // 1. VALIDAÇÃO DE CACHE (Performance O(1))
      if (this.cachedProtocol && (Date.now() - this.cacheTimestamp < ttl)) {
        const ok = await analyzer.validateCandidateInteractivity(
          this.driver.page, 
          this.cachedProtocol
        );

        if (ok) {
          this.driver._emitVital('SADI_PERCEPTION', { 
              selector: this.cachedProtocol.selector, 
              status: 'CACHE_HIT',
              domain 
          });
          return this.cachedProtocol;
        }
        this.cachedProtocol = null;
      }

      // 2. CONSULTA À CONSTITUIÇÃO (DNA First)
      // Busca as regras específicas para o domínio atual via Fachada de IO
      this.driver._emitVital('SADI_PERCEPTION', { status: 'CONSULTING_DNA', domain });
      const dnaRules = await io.getTargetRules(domain);
      
      if (dnaRules.selectors?.input_box) {
          const dnaCandidate = await this._tryKnownSelectors(dnaRules.selectors.input_box);
          if (dnaCandidate) {
              return this._finalizeDiscovery(dnaCandidate, 'DNA_MATCH', dnaRules);
          }
      }

      // 3. FALLBACK PARA HEURÍSTICA (SADI Heuristics Second)
      // Acionado apenas se o DNA estiver desatualizado ou for um domínio novo
      this.driver._emitVital('SADI_PERCEPTION', { status: 'HEURISTIC_SCAN_START', domain });
      const heuristicResult = await analyzer.findChatInputSelector(this.driver.page);
      
      if (heuristicResult?.protocol?.selector) {
          return this._finalizeDiscovery(
              heuristicResult.protocol, 
              'HEURISTIC_MATCH', 
              dnaRules, 
              heuristicResult.confidence
          );
      }

      // 4. FALHA CRÍTICA DE PERCEPÇÃO
      // Reporta o "ponto cego" para o Supervisor e para o Dashboard
      this.driver._emitVital('TRIAGE_ALERT', { 
          type: 'INPUT_NOT_FOUND', 
          severity: 'HIGH',
          evidence: { domain, url: this.driver.page.url() }
      });
      throw new Error(`INPUT_NOT_FOUND: Falha ao localizar interface em ${domain}`);

    } finally {
      // Higiene de handles: evita vazamento de referências do Puppeteer
      await this.driver.handles.clearAll();
    }
  }

  /**
   * Testa uma lista de seletores ou protocolos conhecidos para ganho de performance.
   * Suporta polimorfismo: aceita Array de strings ou objetos de protocolo SADI.
   */
  async _tryKnownSelectors(inputRules) {
      const candidates = Array.isArray(inputRules) ? inputRules : [inputRules];
      
      for (const item of candidates) {
          // Normaliza para o formato de protocolo estruturado
          const protocol = typeof item === 'string' 
            ? { selector: item, context: 'root' } 
            : item;

          const ok = await analyzer.validateCandidateInteractivity(this.driver.page, protocol);
          if (ok) return protocol;
      }
      return null;
  }

  /**
   * Consolida a descoberta, resolve o botão de envio e atualiza o cache em RAM.
   */
  async _finalizeDiscovery(protocol, source, dnaRules, confidence = 1.0) {
      const domain = this.driver.currentDomain;

      // Localiza o botão de envio baseado no input recém-encontrado
      const sendButton = await analyzer.findSendButtonSelector(this.driver.page, protocol);
      
      this.cachedProtocol = { 
        ...protocol, 
        hasSendButton: !!sendButton,
        source,
        confidence
      };
      this.cacheTimestamp = Date.now();

      // Notifica o Mission Control sobre o sucesso da percepção
      this.driver._emitVital('SADI_PERCEPTION', { 
          selector: protocol.selector, 
          status: 'DISCOVERY_COMPLETE',
          source,
          confidence,
          domain
      });

      log('INFO', `[INPUT_RESOLVER] Interface resolvida via ${source} para ${domain}`, this.driver.correlationId);
      return this.cachedProtocol;
  }

  /**
   * Invalida o conhecimento atual. Chamado pelo Driver em manobras de recuperação.
   */
  clearCache() {
    this.cachedProtocol = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Verifica se o cache ainda é confiável conforme a política de ritmo.
   */
  isCached() {
    const ttl = CONFIG.all.INPUT_CACHE_TTL || 60000;
    return !!(this.cachedProtocol && (Date.now() - this.cacheTimestamp < ttl));
  }
}

module.exports = InputResolver;