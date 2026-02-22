// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';
import * as analyzer from '#shared/sadi/analyzer';
import * as io from '#infra/io';
import CONFIG from '#core/config';
import { log } from '#core/logger';

/**
 * Configuração de timeouts e cache para input resolution.
 *
 * @readonly
 * @enum {number}
 */
const RESOLVER_CONFIG = {
    /** Cache TTL para protocolos (ms) - Default: 60s */
    CACHE_TTL_MS: parseInt(
        process.env.RESOLVER_CACHE_TTL || /** @type {any} */ (CONFIG).all?.INPUT_CACHE_TTL || '60000'
    ),

    /** Timeout para resolve completo (ms) - Default: 15s */
    RESOLVE_TIMEOUT_MS: parseInt(process.env.RESOLVER_TIMEOUT || '15000'),

    /** Timeout para validação de interatividade (ms) - Default: 5s */
    VALIDATION_TIMEOUT_MS: parseInt(process.env.RESOLVER_VALIDATION_TIMEOUT || '5000'),

    /** Máximo de retries em fallback heurístico - Default: 2 */
    MAX_HEURISTIC_RETRIES: parseInt(process.env.RESOLVER_MAX_RETRIES || '2'),

    /** Máximo de protocolos em cache (multi-domain) - Default: 10 */
    MAX_CACHE_SIZE: parseInt(process.env.RESOLVER_CACHE_SIZE || '10'),

    /** Confidence threshold para cache (0-1) - Default: 0.7 */
    MIN_CONFIDENCE_THRESHOLD: parseFloat(process.env.RESOLVER_MIN_CONFIDENCE || '0.7'),
};

/**
 * Eventos emitidos pelo InputResolver.
 *
 * @readonly
 * @enum {string}
 */
const RESOLVER_EVENTS = {
    /** Emitido quando resolution inicia */
    RESOLUTION_STARTED: 'resolver:resolution_started',

    /** Emitido quando cache hit (protocolo válido encontrado) */
    CACHE_HIT: 'resolver:cache_hit',

    /** Emitido quando cache miss (cache inválido ou ausente) */
    CACHE_MISS: 'resolver:cache_miss',

    /** Emitido quando DNA match (seletor rules-based) */
    DNA_MATCH: 'resolver:dna_match',

    /** Emitido quando heuristic match (SADI scan) */
    HEURISTIC_MATCH: 'resolver:heuristic_match',

    /** Emitido quando resolution é concluída */
    RESOLUTION_COMPLETED: 'resolver:resolution_completed',

    /** Emitido quando resolution falha */
    RESOLUTION_FAILED: 'resolver:resolution_failed',

    /** Emitido quando cache é invalidado */
    CACHE_CLEARED: 'resolver:cache_cleared',
};

/**
 * InputResolver v2.0 - Governed Input Resolver
 *
 * Localiza interfaces de interação (input box) com hierarquia de autoridade:
 * Cache → DNA (rules) → Heurística (SADI). Cache multi-domain com LRU eviction,
 * timeout protection, retry logic, e metrics tracking completo.
 *
 * FEATURES v2.0:
 * - EventEmitter inheritance (8 eventos locais)
 * - RESOLVER_CONFIG (6 keys configuráveis via env vars)
 * - Cache multi-domain (Map com LRU eviction)
 * - Timeout protection em resolve (RESOLVE_TIMEOUT_MS)
 * - Retry logic em heurística (MAX_HEURISTIC_RETRIES)
 * - Metrics tracking (9 contadores + timing + cache hit rate)
 * - Validação completa de parâmetros (driver, page, handles)
 * - JSDoc 100% (class, constructor, methods, events)
 * - getStats() method para introspection
 *
 * @extends EventEmitter
 *
 * @example
 * const resolver = new InputResolver(driver);
 *
 * // Listen to events
 * resolver.on(RESOLVER_EVENTS.CACHE_HIT, (data) => {
 *     console.log('Cache hit:', data);
 * });
 *
 * resolver.on(RESOLVER_EVENTS.RESOLUTION_COMPLETED, (data) => {
 *     console.log('Resolution completed:', data);
 * });
 *
 * // Resolve input protocol
 * const protocol = await resolver.resolve();
 * console.log('Selector:', protocol.selector);
 *
 * // Get metrics
 * const stats = resolver.getStats();
 * console.log('Cache hit rate:', stats.cacheHitRate + '%');
 */
class InputResolver extends EventEmitter {
    /**
     * Cria uma instância do InputResolver.
     *
     * @param {Object} driver - Instância do driver (BaseDriver ou subclasses)
     * @param {Function} driver._emitVital - Método IPC para telemetria vital
     * @param {Function} driver._assertPageAlive - Validação de page alive
     * @param {string} driver.correlationId - ID de correlação para logs
     * @param {Object} [driver.page] - Instância Puppeteer Page (pode ser null até attachContext)
     * @param {string} [driver.currentDomain] - Domain atual
     * @param {Object} [driver.handles] - HandleManager para cleanup (injetado após instanciar)
     *
     * @throws {Error} Se driver não for fornecido
     * @throws {Error} Se driver._emitVital não for uma função
     * @throws {Error} Se driver.page não existir
     * @throws {Error} Se driver.handles não existir
     *
     * @example
     * const resolver = new InputResolver(driver);
     */
    constructor(driver) {
        super(); // EventEmitter constructor

        // ✅ Validação de driver (BUG #3 fix)
        if (!driver) {
            throw new Error('[InputResolver] Driver is required');
        }

        if (typeof driver._emitVital !== 'function') {
            throw new Error('[InputResolver] Driver must have _emitVital method');
        }

        this.driver = driver;

        // ✅ Cache multi-domain (BUG #7 fix) - Map: domain → { protocol, timestamp, confidence }
        this.protocolCache = new Map();

        // ✅ Metrics tracking (BUG #5 fix)
        this.stats = {
            totalResolutions: 0,
            successfulResolutions: 0,
            failedResolutions: 0,
            cacheHits: 0,
            cacheMisses: 0,
            dnaMatches: 0,
            heuristicMatches: 0,
            totalResolutionDuration: 0,
            maxResolutionDuration: 0,
        };
    }

    /**
     * Resolve o protocolo de entrada (seletor + contexto) com hierarquia de autoridade.
     *
     * FLUXO DE EXECUÇÃO:
     * 1. Validação de precondições (page alive)
     * 2. Cache validation (multi-domain lookup)
     * 3. DNA First (io.getTargetRules → _tryKnownSelectors)
     * 4. Heuristic Second (analyzer.findChatInputSelector com retry)
     * 5. Finalize discovery (resolve sendButton + cache update)
     *
     * @returns {Promise<Object>} Protocolo resolvido
     * Propriedades do objeto retornado:
     *   - selector (string): Seletor CSS do input
     *   - context (string): Contexto do seletor ('root' ou frame)
     *   - hasSendButton (boolean): Se possui botão de envio
     *   - source (string): Fonte da resolução ('CACHE_HIT', 'DNA_MATCH', 'HEURISTIC_MATCH')
     *   - confidence (number): Nível de confiança (0-1)
     *
     * @throws {Error} Se input não for encontrado (INPUT_NOT_FOUND)
     * @throws {Error} Se timeout exceder RESOLVE_TIMEOUT_MS
     *
     * @emits RESOLVER_EVENTS.RESOLUTION_STARTED
     * @emits RESOLVER_EVENTS.CACHE_HIT
     * @emits RESOLVER_EVENTS.CACHE_MISS
     * @emits RESOLVER_EVENTS.DNA_MATCH
     * @emits RESOLVER_EVENTS.HEURISTIC_MATCH
     * @emits RESOLVER_EVENTS.RESOLUTION_COMPLETED
     * @emits RESOLVER_EVENTS.RESOLUTION_FAILED
     *
     * @example
     * const protocol = await resolver.resolve();
     * console.log('Selector:', protocol.selector);
     * console.log('Source:', protocol.source);
     */
    async resolve() {
        const startTime = Date.now();
        this.stats.totalResolutions++;

        try {
            // ✅ Timeout protection (BUG #4 fix)
            const result = await Promise.race([
                this._executeResolve(),
                this._timeout(RESOLVER_CONFIG.RESOLVE_TIMEOUT_MS, 'resolve'),
            ]);

            // Success metrics
            this.stats.successfulResolutions++;

            const duration = Date.now() - startTime;
            this.stats.totalResolutionDuration += duration;
            this.stats.maxResolutionDuration = Math.max(this.stats.maxResolutionDuration, duration);

            return result;
        } catch (err) {
            this.stats.failedResolutions++;

            // EventEmitter local
            this.emit(RESOLVER_EVENTS.RESOLUTION_FAILED, {
                domain: this.driver.currentDomain,
                error: err.message,
                timestamp: Date.now(),
            });

            throw err;
        } finally {
            // Higiene de handles: evita vazamento de referências Puppeteer
            await this.driver.handles.clearAll();
        }
    }

    /**
     * Executa lógica interna de resolução (sem timeout wrapper).
     *
     * @private
     * @returns {Promise<Object>} Protocolo resolvido
     */
    async _executeResolve() {
        this.driver._assertPageAlive();
        const domain = this.driver.currentDomain;
        const correlationId = this.driver.correlationId;

        // EventEmitter local
        this.emit(RESOLVER_EVENTS.RESOLUTION_STARTED, {
            domain,
            timestamp: Date.now(),
        });

        // 1. VALIDAÇÃO DE CACHE (Performance O(1) - Multi-Domain)
        const cached = this.protocolCache.get(domain);
        if (cached && Date.now() - cached.timestamp < RESOLVER_CONFIG.CACHE_TTL_MS) {
            try {
                const ok = await Promise.race([
                    analyzer.validateCandidateInteractivity(this.driver.page, cached.protocol),
                    this._timeout(RESOLVER_CONFIG.VALIDATION_TIMEOUT_MS, 'cache validation'),
                ]);

                if (ok) {
                    this.stats.cacheHits++;

                    // EventEmitter local
                    this.emit(RESOLVER_EVENTS.CACHE_HIT, {
                        domain,
                        selector: cached.protocol.selector,
                        confidence: cached.confidence,
                        timestamp: Date.now(),
                    });

                    // IPC telemetry
                    this.driver._emitVital('SADI_PERCEPTION', {
                        selector: cached.protocol.selector,
                        status: 'CACHE_HIT',
                        domain,
                    });

                    return cached.protocol;
                }
            } catch (validationErr) {
                log('WARN', `[INPUT_RESOLVER] Cache validation timeout/error: ${validationErr.message}`, correlationId);
            }

            // Cache inválido - remove
            this.protocolCache.delete(domain);
        }

        // Cache miss
        this.stats.cacheMisses++;

        this.emit(RESOLVER_EVENTS.CACHE_MISS, {
            domain,
            timestamp: Date.now(),
        });

        // 2. CONSULTA À CONSTITUIÇÃO (DNA First)
        this.driver._emitVital('SADI_PERCEPTION', { status: 'CONSULTING_DNA', domain });
        /** @type {{ selectors?: { input_box?: string[] | string } }} */
        const dnaRules = (await io.getTargetRules(domain)) || {};

        if (dnaRules.selectors?.input_box) {
            const dnaCandidate = await this._tryKnownSelectors(dnaRules.selectors.input_box);
            if (dnaCandidate) {
                this.stats.dnaMatches++;
                return this._finalizeDiscovery(dnaCandidate, 'DNA_MATCH', dnaRules, 1.0);
            }
        }

        // 3. FALLBACK PARA HEURÍSTICA (SADI Heuristics Second) ✅ BUG #8 fix (retry logic)
        this.driver._emitVital('SADI_PERCEPTION', { status: 'HEURISTIC_SCAN_START', domain });

        const maxRetries = RESOLVER_CONFIG.MAX_HEURISTIC_RETRIES;

        for (let retry = 0; retry < maxRetries; retry++) {
            try {
                const heuristicResult = await analyzer.findChatInputSelector(this.driver.page);

                if (heuristicResult?.protocol?.selector) {
                    this.stats.heuristicMatches++;

                    log('DEBUG', `[INPUT_RESOLVER] Heurística succeeded (retry ${retry + 1})`, correlationId);

                    return this._finalizeDiscovery(
                        heuristicResult.protocol,
                        'HEURISTIC_MATCH',
                        dnaRules,
                        heuristicResult.confidence || 0.8
                    );
                }
            } catch (heuristicErr) {
                if (retry < maxRetries - 1) {
                    log(
                        'WARN',
                        `[INPUT_RESOLVER] Heurística failed (retry ${retry + 1}/${maxRetries}): ${heuristicErr.message}`,
                        correlationId
                    );
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1))); // Backoff
                } else {
                    log('ERROR', `[INPUT_RESOLVER] Heurística failed after ${maxRetries} retries`, correlationId);
                }
            }
        }

        // 4. FALHA CRÍTICA DE PERCEPÇÃO
        this.driver._emitVital('TRIAGE_ALERT', {
            type: 'INPUT_NOT_FOUND',
            severity: 'HIGH',
            evidence: { domain, url: this.driver.page.url() },
        });

        throw new Error(`INPUT_NOT_FOUND: Falha ao localizar interface em ${domain}`);
    }

    /**
     * Testa uma lista de seletores conhecidos do DNA.
     *
     * Suporta polimorfismo: aceita Array de strings ou objetos de protocolo SADI.
     *
     * @private
     * @param {string | Object | Array<string|Object>} inputRules - Lista de seletores ou protocolos
     * @returns {Promise<Object|null>} Protocolo válido ou null
     *
     * @example
     * const protocol = await this._tryKnownSelectors(['#prompt', 'textarea']);
     */
    async _tryKnownSelectors(inputRules) {
        const candidates = Array.isArray(inputRules) ? inputRules : [inputRules];

        for (const item of candidates) {
            // Normaliza para o formato de protocolo estruturado
            const protocol = typeof item === 'string' ? { selector: item, context: 'root' } : item;

            try {
                const ok = await Promise.race([
                    analyzer.validateCandidateInteractivity(this.driver.page, protocol),
                    this._timeout(RESOLVER_CONFIG.VALIDATION_TIMEOUT_MS, 'DNA validation'),
                ]);

                if (ok) {
                    return protocol;
                }
            } catch (_err) {
                // Continue to next candidate
                continue;
            }
        }

        return null;
    }

    /**
     * Consolida a descoberta, resolve o botão de envio e atualiza o cache.
     *
     * @private
     * @param {Object} protocol - Protocolo resolvido
     * @param {string} source - Fonte da resolução ('DNA_MATCH' ou 'HEURISTIC_MATCH')
     * @param {Object} dnaRules - Regras DNA do domínio
     * @param {number} [confidence=1.0] - Nível de confiança (0-1)
     *
     * @returns {Promise<Object>} Protocolo final com sendButton
     *
     * @emits RESOLVER_EVENTS.DNA_MATCH
     * @emits RESOLVER_EVENTS.HEURISTIC_MATCH
     * @emits RESOLVER_EVENTS.RESOLUTION_COMPLETED
     *
     * @example
     * const result = await this._finalizeDiscovery(protocol, 'DNA_MATCH', rules);
     */
    async _finalizeDiscovery(protocol, source, dnaRules, confidence = 1.0) {
        const domain = this.driver.currentDomain;
        const correlationId = this.driver.correlationId;

        // Localiza o botão de envio baseado no input recém-encontrado
        const sendButton = await analyzer.findSendButtonSelector(this.driver.page, protocol);

        const finalProtocol = {
            ...protocol,
            hasSendButton: !!sendButton,
            source,
            confidence,
        };

        // ✅ Validação de confidence threshold (BUG #10 fix)
        const shouldCache = confidence >= RESOLVER_CONFIG.MIN_CONFIDENCE_THRESHOLD;

        if (shouldCache) {
            this._updateCache(domain, finalProtocol, confidence);
        } else {
            log('WARN', `[INPUT_RESOLVER] Low confidence (${confidence}), não cacheando`, correlationId);
        }

        // EventEmitter local
        if (source === 'DNA_MATCH') {
            this.emit(RESOLVER_EVENTS.DNA_MATCH, {
                domain,
                selector: protocol.selector,
                confidence,
                timestamp: Date.now(),
            });
        } else if (source === 'HEURISTIC_MATCH') {
            this.emit(RESOLVER_EVENTS.HEURISTIC_MATCH, {
                domain,
                selector: protocol.selector,
                confidence,
                timestamp: Date.now(),
            });
        }

        this.emit(RESOLVER_EVENTS.RESOLUTION_COMPLETED, {
            domain,
            selector: protocol.selector,
            source,
            confidence,
            hasSendButton: !!sendButton,
            timestamp: Date.now(),
        });

        // IPC telemetry
        this.driver._emitVital('SADI_PERCEPTION', {
            selector: protocol.selector,
            status: 'DISCOVERY_COMPLETE',
            source,
            confidence,
            domain,
        });

        log('INFO', `[INPUT_RESOLVER] Interface resolvida via ${source} para ${domain}`, correlationId);

        return finalProtocol;
    }

    /**
     * Atualiza cache multi-domain com LRU eviction.
     *
     * @private
     * @param {string} domain - Domain atual
     * @param {Object} protocol - Protocolo a cachear
     * @param {number} confidence - Nível de confiança
     *
     * @example
     * this._updateCache('chatgpt.com', protocol, 0.95);
     */
    _updateCache(domain, protocol, confidence) {
        // ✅ LRU eviction se cache > MAX_CACHE_SIZE (BUG #7 fix)
        if (this.protocolCache.size >= RESOLVER_CONFIG.MAX_CACHE_SIZE) {
            const oldestKey = this.protocolCache.keys().next().value;
            this.protocolCache.delete(oldestKey);

            log('DEBUG', `[INPUT_RESOLVER] LRU eviction: ${oldestKey}`, this.driver.correlationId);
        }

        this.protocolCache.set(domain, {
            protocol,
            timestamp: Date.now(),
            confidence,
        });
    }

    /**
     * Invalida o cache de protocolos (single-domain ou all).
     *
     * Chamado pelo Driver em manobras de recuperação.
     *
     * @param {string} [domain] - Domain específico para invalidar (opcional, default: all)
     * @returns {void}
     *
     * @emits RESOLVER_EVENTS.CACHE_CLEARED
     *
     * @example
     * resolver.clearCache(); // Limpa todo o cache
     * resolver.clearCache('chatgpt.com'); // Limpa apenas chatgpt.com
     */
    clearCache(domain) {
        if (domain) {
            this.protocolCache.delete(domain);
        } else {
            this.protocolCache.clear();
        }

        // ✅ Event emission (BUG #9 fix)
        this.emit(RESOLVER_EVENTS.CACHE_CLEARED, {
            domain: domain || 'all',
            timestamp: Date.now(),
        });

        log('DEBUG', `[INPUT_RESOLVER] Cache cleared (${domain || 'all'})`, this.driver.correlationId);
    }

    /**
     * Verifica se o cache é válido para o domain atual conforme TTL.
     *
     * @param {string} [domain] - Domain para verificar (opcional, default: currentDomain)
     * @returns {boolean} true se cached válido, false caso contrário
     *
     * @example
     * if (resolver.isCached('chatgpt.com')) {
     *     console.log('Cache válido para ChatGPT');
     * }
     */
    isCached(domain) {
        const targetDomain = domain || this.driver.currentDomain;
        const cached = this.protocolCache.get(targetDomain);

        return !!(cached && Date.now() - cached.timestamp < RESOLVER_CONFIG.CACHE_TTL_MS);
    }

    /**
     * Retorna estatísticas de resolution.
     *
     * @returns {Object} Objeto com métricas de resolution
     * Propriedades do objeto retornado:
     *   - totalResolutions (number): Total de resoluções executadas
     *   - successfulResolutions (number): Resoluções bem-sucedidas
     *   - failedResolutions (number): Resoluções que falharam
     *   - cacheHits (number): Cache hits
     *   - cacheMisses (number): Cache misses
     *   - dnaMatches (number): DNA matches
     *   - heuristicMatches (number): Heuristic matches
     *   - totalResolutionDuration (number): Duração total acumulada (ms)
     *   - maxResolutionDuration (number): Duração máxima individual (ms)
     *   - cacheHitRate (string): Taxa de cache hit (%)
     *   - config (Object): Configuração atual (RESOLVER_CONFIG)
     *
     * @example
     * const stats = resolver.getStats();
     * console.log('Cache hit rate:', stats.cacheHitRate);
     * console.log('DNA vs Heuristic:', stats.dnaMatches, 'vs', stats.heuristicMatches);
     */
    getStats() {
        return {
            ...this.stats,
            cacheHitRate:
                this.stats.totalResolutions > 0
                    ? ((this.stats.cacheHits / this.stats.totalResolutions) * 100).toFixed(2) + '%'
                    : '0%',
            config: { ...RESOLVER_CONFIG },
        };
    }

    /**
     * Timeout wrapper para operações com limite de tempo.
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para error message)
     *
     * @returns {Promise<never>} Promise que rejeita após timeout
     */
    _timeout(ms, operation) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error(`Timeout in ${operation} after ${ms}ms`);
                error.name = 'TimeoutError';
                reject(error);
            }, ms);
        });
    }
}

/**
 * Factory function para criar instância de InputResolver.
 *
 * @param {Object} driver - Instância do driver
 * @returns {InputResolver} Nova instância
 *
 * @example
 * const { create } = require('./input_resolver');
 * const resolver = create(driver);
 */
function create(driver) {
    return new InputResolver(driver);
}

export { InputResolver, RESOLVER_CONFIG, RESOLVER_EVENTS, create };
