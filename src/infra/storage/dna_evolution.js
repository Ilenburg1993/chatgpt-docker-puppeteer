// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/infra/storage/dna_evolution.js
   Audit Level: 750 — Automatic DNA Evolution Engine
   Status: NEW (Feb 2026)
   Responsabilidade: Gerenciar evolução automática do DNA quando SADI
                     descobre novos seletores funcionais.
   Sincronizado com: dna_store.js, analyzer.js (SADI V19), BaseDriver
========================================================================== */

// Lazy load para evitar circular dependency
let dnaStore = null;
const getDnaStore = async () => {
    if (!dnaStore) {
        dnaStore = await import('./dna_store.js');
    }
    return dnaStore;
};

import { log } from '#core/logger';

/**
 * Threshold de confiança mínimo para persistir selector (0-100)
 */
const MIN_CONFIDENCE_THRESHOLD = 75;

/**
 * Máximo de tentativas de evolução por domínio por sessão
 */
const MAX_EVOLUTIONS_PER_DOMAIN = 5;

/**
 * Contador de evoluções por domínio (reset a cada boot)
 */
const evolutionCounter = new Map();

/**
 * @typedef {object} EvolveWithSadiProtocolProtocol
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Evolui o DNA automaticamente quando SADI descobre novo selector.
 *
 * Critérios de Aceitação:
 * - Confidence >= MIN_CONFIDENCE_THRESHOLD
 * - Selector não existe no DNA atual
 * - Não exceder MAX_EVOLUTIONS_PER_DOMAIN por sessão
 *
 * @param {EvolveWithSadiProtocolProtocol} protocol - Protocolo SADI com selector descoberto
 * @param {string} domain - Domínio (ex: 'chatgpt.com')
 * @param {string} intent - Intenção (ex: 'input_box', 'send_button')
 * @returns {Promise<{accepted: boolean, reason?: string, stats?: object, error?: string}>}
 */
async function evolveWithSadiProtocol(protocol, domain, intent) {
    try {
        // 1. Validação de Confidence
        if (!protocol || !protocol.confidence || protocol.confidence < MIN_CONFIDENCE_THRESHOLD) {
            log(
                'DEBUG',
                `[DNA_EVOLUTION] Selector rejeitado (confidence ${protocol.confidence || 0} < ${MIN_CONFIDENCE_THRESHOLD})`
            );
            return { accepted: false, reason: 'LOW_CONFIDENCE' };
        }

        // 2. Rate Limiting por Domínio
        const count = evolutionCounter.get(domain) || 0;
        if (count >= MAX_EVOLUTIONS_PER_DOMAIN) {
            log(
                'WARN',
                `[DNA_EVOLUTION] Limite de evoluções atingido para ${domain} (${count}/${MAX_EVOLUTIONS_PER_DOMAIN})`
            );
            return { accepted: false, reason: 'RATE_LIMITED' };
        }

        // 3. Carrega DNA atual
        const dnaStore = await getDnaStore();
        const dna = await dnaStore.getDna();

        // 4. Verifica se selector já existe
        const targetRules = dna.targets[domain]?.selectors || {};
        const existingSelectors = targetRules[intent];

        if (existingSelectors) {
            // Se é array de strings, verifica se selector já está lá
            if (Array.isArray(existingSelectors) && existingSelectors.includes(protocol.selector)) {
                log('DEBUG', `[DNA_EVOLUTION] Selector ${protocol.selector} já existe para ${domain}/${intent}`);
                return { accepted: false, reason: 'DUPLICATE' };
            }

            // Se é protocolo, verifica se é idêntico
            if (typeof existingSelectors === 'object' && existingSelectors.selector === protocol.selector) {
                log('DEBUG', `[DNA_EVOLUTION] Protocolo ${protocol.selector} já existe para ${domain}/${intent}`);
                return { accepted: false, reason: 'DUPLICATE' };
            }
        }

        // 5. Cria ou atualiza target
        if (!dna.targets[domain]) {
            dna.targets[domain] = {
                selectors: {},
                behavior_overrides: {},
            };
        }

        // 6. Adiciona novo selector (prioriza protocolo sobre string)
        if (!dna.targets[domain].selectors[intent]) {
            dna.targets[domain].selectors[intent] = [];
        }

        // Se é array, adiciona no início (maior prioridade)
        if (Array.isArray(dna.targets[domain].selectors[intent])) {
            dna.targets[domain].selectors[intent].unshift(protocol.selector);
        } else {
            // Se já é protocolo, converte para array
            dna.targets[domain].selectors[intent] = [
                protocol.selector,
                dna.targets[domain].selectors[intent].selector || dna.targets[domain].selectors[intent],
            ];
        }

        // 7. Persiste evolução
        await dnaStore.saveDna(dna, `SADI_V19_AUTO (confidence: ${protocol.confidence})`);

        // 8. Atualiza contador
        evolutionCounter.set(domain, count + 1);

        log(
            'INFO',
            `[DNA_EVOLUTION] DNA evoluído: ${domain}/${intent} → ${protocol.selector} (confidence: ${protocol.confidence})`
        );

        // Retorna resultado com stats
        return {
            accepted: true,
            stats: {
                domain,
                total_rules: Array.isArray(dna.targets[domain].selectors[intent])
                    ? dna.targets[domain].selectors[intent].length
                    : 1,
                session_evolutions: count + 1,
            },
        };
    } catch (error) {
        log('ERROR', `[DNA_EVOLUTION] Falha ao evoluir DNA: ${error.message}`);
        return { accepted: false, reason: 'ERROR', error: error.message };
    }
}

/**
 * @typedef {object} EvolveWithFullProtocolFullProtocol
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Evolui DNA com protocolo SADI completo (incluindo metadata).
 * Substitui array de strings por protocolo estruturado.
 *
 * @param {EvolveWithFullProtocolFullProtocol} fullProtocol - Protocolo completo com context, isShadow, etc
 * @param {string} domain - Domínio
 * @param {string} intent - Intenção
 * @returns {Promise<boolean>} - true se evoluiu
 */
async function evolveWithFullProtocol(fullProtocol, domain, intent) {
    try {
        // Valida campos obrigatórios
        if (!fullProtocol.selector || !fullProtocol.context) {
            log('WARN', '[DNA_EVOLUTION] Protocolo inválido (faltam campos obrigatórios)');
            return false;
        }

        const dnaStore = await getDnaStore();
        const dna = await dnaStore.getDna();

        if (!dna.targets[domain]) {
            dna.targets[domain] = { selectors: {}, behavior_overrides: {} };
        }

        // Substitui por protocolo estruturado
        dna.targets[domain].selectors[intent] = {
            selector: fullProtocol.selector,
            context: fullProtocol.context,
            isShadow: fullProtocol.isShadow || false,
            frameSelector: fullProtocol.frameSelector || null,
            framePath: fullProtocol.framePath || null,
            timestamp: Date.now(),
        };

        await dnaStore.saveDna(dna, 'SADI_V19_PROTOCOL_UPGRADE');

        log('INFO', `[DNA_EVOLUTION] Protocolo estruturado salvo: ${domain}/${intent}`);
        return true;
    } catch (error) {
        log('ERROR', `[DNA_EVOLUTION] Falha ao salvar protocolo: ${error.message}`);
        return false;
    }
}

/**
 * Reseta contadores de evolução (chamado no boot).
  * @returns {void}
 */
function resetEvolutionCounters() {
    evolutionCounter.clear();
    log('DEBUG', '[DNA_EVOLUTION] Contadores de evolução resetados');
}

/**
 * Retorna estatísticas de evolução da sessão atual.
 *
 * @returns {object} - {domain: count}
 */
function getEvolutionStats() {
    const stats = {};
    evolutionCounter.forEach((count, domain) => {
        stats[domain] = count;
    });
    return stats;
}

export {
    evolveWithSadiProtocol,
    evolveWithFullProtocol,
    resetEvolutionCounters,
    getEvolutionStats,
    MIN_CONFIDENCE_THRESHOLD,
    MAX_EVOLUTIONS_PER_DOMAIN,
};
