/* ==========================================================================
   src/infra/storage/dna_store.js
   Audit Level: 730 — Sovereign Genomic Storage (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Gestão da persistência, integridade e evolução do genoma
                     de interface (dynamic_rules.json).
   Sincronizado com: paths.js V700, fs_core.js V700, dna_schema.js V100.
========================================================================== */

const path = require('path');
const PATHS = require('../fs/paths');
const { atomicWrite, safeReadJSON } = require('../fs/fs_core');
const { DnaSchema } = require('../../core/schemas');
const { log } = require('../../core/logger');

/**
 * ESTRUTURA BÁSICA V4 GOLD (Baseline de Segurança)
 */
const DEFAULT_DNA = {
    _meta: {
        version: 1,
        last_updated: new Date().toISOString(),
        updated_by: 'system_init',
        evolution_count: 0
    },
    targets: {},
    global_selectors: {
        input_box: ['textarea', "div[contenteditable='true']", "[role='textbox']"],
        send_button: ["button[type='submit']", "[data-testid='send-button']"]
    }
};

/**
 * Cache em RAM para performance de percepção (SADI).
 */
let cachedDna = null;

/**
 * Recupera o DNA completo do sistema.
 * Implementa cache em RAM com fallback para disco e inicialização V4 Gold.
 *
 * @returns {Promise<object>} Objeto DNA validado.
 */
async function getDna() {
    // 1. Hit de Cache (Performance O(1))
    if (cachedDna) {
        return cachedDna;
    }

    // 2. Leitura de Disco
    const rawDna = await safeReadJSON(PATHS.RULES);

    if (!rawDna) {
        log('WARN', '[DNA_STORE] dynamic_rules.json ausente. Inicializando estrutura V4 Gold.');
        await saveDna(DEFAULT_DNA, 'system_init');
        cachedDna = DEFAULT_DNA;
        return cachedDna;
    }

    try {
        // 3. Validação de Fronteira (Zod)
        cachedDna = DnaSchema.parse(rawDna);
        return cachedDna;
    } catch (e) {
        log('ERROR', `[DNA_STORE] DNA corrompido: ${e.message}. Usando baseline.`);
        return DEFAULT_DNA;
    }
}

/**
 * Persiste a evolução do DNA, atualizando metadados e invalidando o cache.
 *
 * @param {object} dna - Novo objeto de DNA.
 * @param {string} author - Identificador da entidade que evoluiu o DNA (ex: 'SADI_V19').
 */
async function saveDna(dna, author = 'system') {
    try {
        // 1. Enriquecimento de Metadados
        const newDna = { ...dna };
        newDna._meta = {
            version: (dna._meta?.version || 0) + 1,
            last_updated: new Date().toISOString(),
            updated_by: author,
            evolution_count: (dna._meta?.evolution_count || 0) + 1
        };

        // 2. Validação Estrita antes da Persistência
        const validatedDna = DnaSchema.parse(newDna);

        // 3. Escrita Atômica (Prevenção de Corrupção)
        await atomicWrite(PATHS.RULES, JSON.stringify(validatedDna, null, 2));

        // 4. Sincronia de Cache
        cachedDna = validatedDna;

        log('INFO', `[DNA_STORE] DNA Evoluído: v${validatedDna._meta.version} por ${author}`);
        return true;
    } catch (e) {
        log('ERROR', `[DNA_STORE] Falha ao persistir evolução genômica: ${e.message}`);
        throw new Error(`DNA_PERSISTENCE_FAILURE: ${e.message}`);
    }
}

/**
 * Recupera as regras específicas para um domínio IA com lógica de fallback.
 *
 * @param {string} domain - Ex: 'chatgpt.com'.
 * @returns {Promise<object>} Regras do alvo mescladas com globais.
 */
async function getTargetRules(domain) {
    const dna = await getDna();
    const targetKey = (domain || 'unknown').toLowerCase();

    const targetData = dna.targets[targetKey];

    // Se o alvo existe e possui seletores, retorna-os.
    // Caso contrário, faz o fallback para o padrão universal de chat.
    if (targetData && targetData.selectors && Object.keys(targetData.selectors).length > 0) {
        return targetData;
    }

    return {
        selectors: dna.global_selectors,
        behavior_overrides: {},
        source: 'global_fallback'
    };
}

/**
 * Invalida o cache em RAM.
 * Chamado pela fachada de IO quando sinais externos (Watchers) detectam mudanças manuais no disco.
 */
function invalidateCache() {
    cachedDna = null;
    log('DEBUG', '[DNA_STORE] Cache genômico invalidado.');
}

module.exports = {
    getDna,
    saveDna,
    getTargetRules,
    invalidateCache
};
