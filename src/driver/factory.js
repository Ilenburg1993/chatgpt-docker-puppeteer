/* ==========================================================================
   src/driver/factory.js
   Audit Level: 700 — Reactive Driver Factory (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Descoberta, instanciação Lazy-Load e gestão reativa de
                     cache de drivers com suporte a sinais soberanos.
   Sincronizado com: TargetDriver.js V700, BaseDriver V700,
                     DriverLifecycleManager V700.
========================================================================== */

const fs = require('fs');
const path = require('path');
const TargetDriver = require('./core/TargetDriver');
const { log } = require('../core/logger');

/**
 * Localização dos drivers específicos (targets).
 */
const TARGETS_DIR = path.join(__dirname, 'targets');
const DEFAULT_TARGET = 'chatgpt';

/**
 * Registro de Metadados (DNA de Descoberta).
 * Mapeia a chave do alvo para o caminho físico e nome da classe.
 */
const driverRegistry = Object.create(null);

/**
 * Cache de instâncias vivas (WeakMap).
 * Chave: page (Puppeteer Page) -> Valor: Map<targetName, DriverInstance>
 * O WeakMap garante que, se a aba fechar, o lixo seja coletado automaticamente.
 */
const pageInstanceCache = new WeakMap();

/* ==========================================================================
   1. FASE DE DESCOBERTA (BOOT TIME)
========================================================================== */
try {
    if (fs.existsSync(TARGETS_DIR)) {
        const files = fs.readdirSync(TARGETS_DIR);
        for (const file of files) {
            if (file.endsWith('Driver.js')) {
                const targetKey = file.replace('Driver.js', '').toLowerCase();
                driverRegistry[targetKey] = {
                    path: path.join(TARGETS_DIR, file),
                    className: file.replace('.js', '')
                };
            }
        }
        log('INFO', `[FACTORY] ${Object.keys(driverRegistry).length} targets mapeados no diretório.`);
    }
} catch (e) {
    log('FATAL', `[FACTORY] Erro catastrófico no mapeamento de drivers: ${e.message}`);
}

/* ==========================================================================
   2. API PÚBLICA (GESTÃO DE INSTÂNCIAS)
========================================================================== */

/**
 * Obtém ou cria a instância do driver com injeção de sinal e sincronia de config.
 *
 * @param {string} targetName - Nome da IA alvo (ex: 'chatgpt').
 * @param {object} page - Instância ativa da página do Puppeteer.
 * @param {object} config - Configuração da tarefa (clonada para imutabilidade).
 * @param {AbortSignal} signal - Sinal soberano de cancelamento da tarefa.
 * @returns {object} Instância de TargetDriver pronta para execução.
 */
function getDriver(targetName, page, config, signal) {
    const key = (targetName || DEFAULT_TARGET).toLowerCase();

    // A. LIVENESS GUARD: Impede o acoplamento em abas mortas
    if (!page || page.isClosed()) {
        throw new Error(`[FACTORY] Falha: Tentativa de acoplar driver em aba encerrada (${key}).`);
    }

    // B. RESOLUÇÃO DE CACHE (Nível 1: Página)
    if (!pageInstanceCache.has(page)) {
        pageInstanceCache.set(page, new Map());
    }
    const instances = pageInstanceCache.get(page);

    // C. REAPROVEITAMENTO (Nível 2: Target)
    if (instances.has(key)) {
        const cachedInstance = instances.get(key);

        if (!cachedInstance.destroyed) {
            // [R5] Sincronia Paramétrica: Atualiza a configuração para a nova missão
            if (config && typeof config === 'object') {
                cachedInstance.config = { ...config };
            }

            // [R3] Sincronia de Sinal: O driver deve obedecer ao novo sinal de aborto
            cachedInstance.signal = signal;

            log('DEBUG', `[FACTORY] Reaproveitando driver em cache: ${cachedInstance.name}`);
            return cachedInstance;
        }
        // Se a instância estava marcada como destruída, removemos do mapa
        instances.delete(key);
    }

    // D. INSTANCIAÇÃO (Lazy-Loading dinâmico)
    const meta = driverRegistry[key];
    if (!meta) {
        throw new Error(`[FACTORY] Target '${key}' não suportado pela infraestrutura.`);
    }

    try {
        // Carrega a classe apenas no momento da primeira necessidade
        const DriverClass = require(meta.path);

        // Injeção de dependências no construtor
        const instance = new DriverClass(page, { ...config }, signal);

        if (!(instance instanceof TargetDriver)) {
            throw new Error(`[FACTORY] '${meta.className}' viola o contrato TargetDriver.`);
        }

        // [R2] AUTO-EVIÇÃO REATIVA: A Factory limpa o cache assim que o driver morre
        instance.once('destroyed', () => {
            const currentMap = pageInstanceCache.get(page);
            if (currentMap) {
                currentMap.delete(key);
                log('DEBUG', `[FACTORY] Cache removido para: ${key} (Ciclo encerrado)`);
            }
        });

        instances.set(key, instance);
        log('INFO', `[FACTORY] Novo Driver '${instance.name}' acoplado com sucesso.`);

        return instance;

    } catch (e) {
        log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${e.message}`);
        throw e;
    }
}

/**
 * Invalidação Global (R4): Limpeza profunda de uma sessão.
 * Garante que todos os drivers vinculados a uma aba sejam destruídos.
 *
 * @param {object} page - Instância da página do Puppeteer.
 */
async function invalidatePageCache(page) {
    if (pageInstanceCache.has(page)) {
        const instances = pageInstanceCache.get(page);
        log('DEBUG', `[FACTORY] Invalidação forçada: Limpando ${instances.size} drivers da aba.`);

        for (const [name, driver] of instances.entries()) {
            try {
                if (!driver.destroyed) {
                    await driver.destroy();
                }
            } catch (e) {
                log('WARN', `[FACTORY] Erro no descarte do driver '${name}': ${e.message}`);
            }
        }

        instances.clear();
        pageInstanceCache.delete(page);
    }
}

module.exports = {
    getDriver,
    invalidatePageCache,
    availableTargets: Object.keys(driverRegistry)
};