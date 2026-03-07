// @ts-check
import { log } from '#core/logger';
import { DnaSchema } from '#core/schemas';
import { atomicWrite, safeReadJSON } from '../fs/fs_core.js';
import * as PATHS from '../fs/paths.js';

/**
 * ESTRUTURA BÁSICA V4 GOLD (Baseline de Segurança)
 */
const DEFAULT_DNA = {
    _meta: {
        version: 1,
        last_updated: new Date().toISOString(),
        updated_by: 'system_init',
        evolution_count: 0,
    },
    targets: {},
    global_selectors: {
        input_box: ['textarea', "div[contenteditable='true']", "[role='textbox']"],
        send_button: ["button[type='submit']", "[data-testid='send-button']"],
    },
};

/**
 * Cache em RAM para performance de percepção (SADI).
 */
/** @type {any} */
let cachedDna = null;

/**
 * Cria backup do DNA atual antes de evolução.
 * Mantém últimas 10 versões em memory (hot backup).
 *
 * @private
 * @param {any} dna - DNA atual a ser backupeado
 * @returns {boolean} - true se backup foi criado
 */
/** @type {any[]} */
const DNA_HISTORY = [];
const MAX_HISTORY = 10;

function backupDna(/** @type {any} */ dna) {
    try {
        const backup = {
            snapshot: structuredClone(dna),
            timestamp: new Date().toISOString(),
            version: dna._meta?.version || 0,
        };

        DNA_HISTORY.unshift(backup);

        // Mantém apenas as últimas MAX_HISTORY versões
        if (DNA_HISTORY.length > MAX_HISTORY) {
            DNA_HISTORY.pop();
        }

        log('DEBUG', `[DNA_STORE] Backup criado: v${backup.version} (${DNA_HISTORY.length}/${MAX_HISTORY})`);
        return true;
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        log('WARN', `[DNA_STORE] Falha ao criar backup: ${_ce.message}`);
        return false;
    }
}

/**
 * Recupera o DNA completo do sistema.
 * Implementa cache em RAM com fallback para disco e inicialização V4 Gold.
 *
 * @returns {Promise<any>} Objeto DNA validado.
 */
async function getDna() {
    // 1. Hit de Cache (Performance O(1))
    if (cachedDna) {
        return cachedDna;
    }

    // 2. Leitura de Disco
    const rawDna = /** @type {any} */ (await safeReadJSON(PATHS.RULES));

    if (!rawDna) {
        log('WARN', '[DNA_STORE] dynamic_rules.json ausente. Inicializando estrutura V4 Gold.');
        await saveDna(DEFAULT_DNA, 'system_init');

        cachedDna = DEFAULT_DNA;
        return cachedDna;
    }

    try {
        // 3. Validação de Fronteira (Zod)
        cachedDna = DnaSchema.parse(rawDna);

        // 4. Backup imediato após leitura bem-sucedida
        backupDna(cachedDna);

        return cachedDna;
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        log('ERROR', `[DNA_STORE] DNA corrompido: ${_ce.message}`);

        // 5. Tentativa de Recovery do Histórico
        if (DNA_HISTORY.length > 0) {
            log('WARN', `[DNA_STORE] Tentando recovery do backup mais recente (v${DNA_HISTORY[0].version})`);
            const recovered = DNA_HISTORY[0].snapshot;

            try {
                // Valida backup antes de usar
                cachedDna = DnaSchema.parse(recovered);

                // Persiste DNA recuperado
                await saveDna(cachedDna, 'auto_recovery');

                log('INFO', `[DNA_STORE] DNA recuperado com sucesso do backup v${DNA_HISTORY[0].version}`);
                return cachedDna;
            } catch (/** @type {any} */ recoveryError) {
                const _ce = /** @type {any} */ (recoveryError);
                log('ERROR', `[DNA_STORE] Falha no recovery: ${_ce.message}. Usando baseline.`);
            }
        }

        // 6. Fallback Final: DEFAULT_DNA
        log('WARN', '[DNA_STORE] Usando DNA baseline V4 Gold como último recurso.');
        return DEFAULT_DNA;
    }
}

/**
 * @typedef {object} SaveDnaDna
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Persiste a evolução do DNA, atualizando metadados e invalidando o cache.
 *
 * @param {any} dna - Novo objeto de DNA.
 * @param {string} author - Identificador da entidade que evoluiu o DNA (ex: 'SADI_V19').
  * @returns {Promise<any>}
 */
async function saveDna(dna, author = 'system') {
    try {
        // 1. Backup do DNA atual (se existir)
        if (cachedDna) {
            backupDna(cachedDna);
        }

        // 2. Enriquecimento de Metadados
        const newDna = { ...dna };
        newDna._meta = {
            version: (dna._meta?.version || 0) + 1,
            last_updated: new Date().toISOString(),
            updated_by: author,
            evolution_count: (dna._meta?.evolution_count || 0) + 1,
        };

        // 3. Validação Estrita antes da Persistência
        const validatedDna = DnaSchema.parse(newDna);

        // 4. Escrita Atômica (Prevenção de Corrupção)
        await atomicWrite(PATHS.RULES, JSON.stringify(validatedDna, null, 2));

        // 5. Sincronia de Cache
        cachedDna = validatedDna;

        log(
            'INFO',
            `[DNA_STORE] DNA Evoluído: v${validatedDna._meta.version} por ${author} (${validatedDna._meta.evolution_count} evoluções totais)`
        );
        return true;
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        log('ERROR', `[DNA_STORE] Falha ao persistir evolução genômica: ${_ce.message}`);
        throw new Error(`DNA_PERSISTENCE_FAILURE: ${_ce.message}`); // eslint-disable-line preserve-caught-error
    }
}

/**
 * Recupera as regras específicas para um domínio IA com lógica de fallback.
 *
 * @param {string} domain - Ex: 'chatgpt.com'.
 * @returns {Promise<any>} Regras do alvo mescladas com globais.
 */
async function getTargetRules(domain) {
    const dna = /** @type {any} */ (await getDna());
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
        source: 'global_fallback',
    };
}

/**
 * Invalida o cache em RAM.
 * Chamado pela fachada de IO quando sinais externos (Watchers) detectam mudanças manuais no disco.
  * @returns {any}
 */
function invalidateCache() {
    cachedDna = null;
    log('DEBUG', '[DNA_STORE] Cache genômico invalidado.');
}

/**
 * Restaura DNA de uma versão anterior do histórico.
 *
 * @param {number} versionIndex - Índice no histórico (0 = mais recente)
 * @returns {Promise<any>} - DNA restaurado
 * @throws {Error} - Se versão não existir
 */
async function rollbackDna(versionIndex = 0) {
    if (versionIndex < 0 || versionIndex >= DNA_HISTORY.length) {
        throw new Error(
            `DNA_ROLLBACK_FAILED: Versão ${versionIndex} não existe no histórico (disponíveis: 0-${DNA_HISTORY.length - 1})`
        );
    }

    const backup = DNA_HISTORY[versionIndex];
    log('INFO', `[DNA_STORE] Executando rollback para v${backup.version} (${backup.timestamp})`);

    // Persiste DNA restaurado
    await saveDna(backup.snapshot, `rollback_to_v${backup.version}`);

    return cachedDna;
}

/**
 * Retorna histórico de versões do DNA (somente metadados).
 *
 * @returns {Array<object>} - Array com {version, timestamp, evolution_count}
 */
function getDnaHistory() {
    return DNA_HISTORY.map(backup => ({
        version: backup.version,
        timestamp: backup.timestamp,
        evolution_count: backup.snapshot._meta?.evolution_count || 0,
        updated_by: backup.snapshot._meta?.updated_by || 'unknown',
    }));
}

export { getDna, getDnaHistory, getTargetRules, invalidateCache, rollbackDna, saveDna };
