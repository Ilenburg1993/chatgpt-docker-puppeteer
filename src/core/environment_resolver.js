/* ==========================================================================
   src/core/environment_resolver.js
   Audit Level: 700 — Sovereign Environment Decision Protocol (Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Identificar o alvo operacional (IA) com base no contexto
                     do navegador e metadados de domínio.
   Sincronizado com: driver/factory.js V50, execution_engine.js V1.4.0.
========================================================================== */

const driverFactory = require('../driver/factory');

class EnvironmentResolver {
    /**
     * Resolve o ambiente atual com base no contexto do navegador.
     * Implementa análise multi-fatorial para garantir precisão industrial.
     *
     * @param {object} ctx - Contexto de execução { browser, page }.
     * @returns {object} { target, confidence, reason, metadata }
     */
    resolve(ctx) {
        // 1. VALIDAÇÃO DE CONTEXTO (Guardião de Integridade)
        if (!ctx?.page) {
            return this._reject('MISSING_CONTEXT', 0);
        }

        try {
            const urlString = ctx.page.url();

            // 2. FILTRO DE RUÍDO (Páginas Internas / Vazio)
            if (!urlString || urlString === 'about:blank' || !urlString.startsWith('http')) {
                return this._reject('INVALID_URL_PROTOCOL', 0, { url: urlString });
            }

            const url = new URL(urlString);
            const hostname = url.hostname.toLowerCase();
            const domainSegments = hostname.split('.');

            // 3. DESCOBERTA POR SEGMENTAÇÃO (Target Matching)
            // Buscamos o melhor match entre os alvos suportados pela Factory
            const availableTargets = driverFactory.availableTargets;
            let identifiedTarget = null;
            let matchQuality = 0;

            for (const target of availableTargets) {
                /**
                 * Lógica de Correspondência Estrita:
                 * Verificamos se o nome do alvo (ex: 'chatgpt') é um segmento
                 * exato do domínio ou se é o sufixo principal.
                 */
                if (domainSegments.includes(target)) {
                    identifiedTarget = target;
                    matchQuality = 1.0; // Segmento exato (ex: chatgpt.com)
                    break;
                }

                if (hostname.endsWith(`.${target}`)) {
                    identifiedTarget = target;
                    matchQuality = 0.9; // Sufixo (ex: openai.chatgpt)
                    break;
                }
            }

            // 4. VEREDITO DE PERCEPÇÃO
            if (identifiedTarget && matchQuality >= 0.9) {
                return {
                    target: identifiedTarget,
                    confidence: matchQuality,
                    reason: 'DOMAIN_MATCH_SUCCESS',
                    metadata: {
                        hostname,
                        path: url.pathname,
                        timestamp: Date.now()
                    }
                };
            }

            // 5. CASO DE BAIXA CONFIANÇA (Ambiente Desconhecido)
            return this._reject('TARGET_NOT_SUPPORTED', 0.2, { hostname });
        } catch (e) {
            // Falha no parsing da URL ou erro de acesso à página
            return this._reject('PERCEPTION_CRASH', 0, { error: e.message });
        }
    }

    /**
     * Helper para padronizar rejeições de percepção.
     */
    _reject(reason, confidence, metadata = {}) {
        return {
            target: null,
            confidence,
            reason,
            metadata: {
                ...metadata,
                timestamp: Date.now()
            }
        };
    }
}

module.exports = EnvironmentResolver;
