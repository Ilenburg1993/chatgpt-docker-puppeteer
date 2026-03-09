// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as driverFactory from '#driver/factory';

/**
 * Resolve ambiente/target a partir do contexto de página para seleção de driver.
 */
class EnvironmentResolver {
    /**
     * Resolve o ambiente atual com base no contexto do navegador. Implementa análise multi-fatorial para garantir
     * precisão industrial.
     *
     * @param {any} ctx - Contexto de execução { browser, page }.
     * @returns {any} { target, confidence, reason, metadata }
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
            const availableTargets =
                typeof driverFactory.getAvailableTargets === 'function'
                    ? driverFactory.getAvailableTargets()
                    : driverFactory.availableTargets || [];
            let identifiedTarget = null;
            let matchQuality = 0;

            for (const target of availableTargets) {
                /**
                 * Lógica de Correspondência Estrita: Verificamos se o nome do alvo (ex: 'chatgpt') é um segmento exato
                 * do domínio ou se é o sufixo principal.
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
                        timestamp: Date.now(),
                    },
                };
            }

            // 5. CASO DE BAIXA CONFIANÇA (Ambiente Desconhecido)
            return this._reject('TARGET_NOT_SUPPORTED', 0.2, { hostname });
        } catch (/** @type {any} */ _rawE) {
            const e = /** @type {any} */ (_rawE);
            // Falha no parsing da URL ou erro de acesso à página
            return this._reject('PERCEPTION_CRASH', 0, { error: e.message });
        }
    }

    /**
     * Helper para padronizar rejeições de percepção.
     */
    _reject(/** @type {any} */ reason, /** @type {any} */ confidence, metadata = {}) {
        return {
            target: /** @type {any} */ (null),
            confidence,
            reason,
            metadata: {
                ...metadata,
                timestamp: Date.now(),
            },
        };
    }
}

/**
 * Resolutor de ambiente baseado em URL/hostname para selecionar target de driver.
 */
export default EnvironmentResolver;
