/* ==========================================================================
   src/infra/fs/fs_utils.js
   Audit Level: 700 — Infrastructure Support Utilities (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Prover funções utilitárias para manipulação de arquivos,
                     sanitização de dados e controle de tempo.
   Sincronizado com: paths.js V700.
========================================================================== */

const fs = require('fs');
const path = require('path');
const PATHS = require('./paths');

/**
 * REGEX UNIVERSAL DE LIMPEZA (ASCII 0-31 + 127/DEL)
 * Protege o sistema de arquivos e o Puppeteer contra caracteres de controle
 * que podem causar quebras de protocolo ou falhas de injeção.
 */
// eslint-disable-next-line no-control-regex -- required to strip control chars
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/* ==========================================================================
   UTILITÁRIOS DE SISTEMA
========================================================================== */

/**
 * Garante a existência da infraestrutura física de pastas no boot.
 * Utiliza a autoridade de caminhos do paths.js.
 */
function ensureInfrastructure() {
    const criticalDirs = [PATHS.QUEUE, PATHS.RESPONSE, PATHS.LOGS, PATHS.CORRUPT, PATHS.REPORTS];

    for (const dir of criticalDirs) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (err) {
                // Falha na criação de pastas é um erro fatal de boot
                console.error(`[FS_UTILS] Falha crítica ao criar diretório ${dir}: ${err.message}`);
                throw err;
            }
        }
    }
}

/**
 * Sanitiza nomes de arquivos para evitar Path Traversal e caracteres ilegais.
 * @param {string} name - Nome sugerido para o arquivo.
 * @returns {string} Nome higienizado e seguro.
 */
function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') {
        return `unknown_${Date.now()}`;
    }
    // Remove qualquer coisa que não seja alfanumérico, ponto, traço ou sublinhado
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}

/**
 * Limpa uma string removendo caracteres de controle invisíveis.
 * @param {string} text - Texto bruto vindo da IA ou do Dashboard.
 * @returns {string} Texto limpo.
 */
function cleanText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    return text.replace(CONTROL_CHARS_REGEX, '').trim();
}

/**
 * Pausa assíncrona baseada em Promises para backoffs e sincronia biomecânica.
 * @param {number} ms - Milissegundos de espera.
 */
const sleep = ms =>
    new Promise(r => {
        setTimeout(r, ms);
    });

/**
 * [P8.7] SECURITY: Valida se path está dentro do workspace (previne path traversal)
 * @param {string} filePath - Path a validar
 * @returns {boolean} True se path é seguro
 */
function isPathSafe(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }

    // Null byte check (path injection)
    if (filePath.includes('\0')) {
        return false;
    }

    // Resolve to absolute path
    const ROOT = path.resolve(__dirname, '../..');
    const normalized = path.normalize(path.resolve(filePath));

    // Must start with workspace root
    return normalized.startsWith(ROOT);
}

module.exports = {
    // Re-exporta os caminhos para manter compatibilidade com a Fachada de IO
    ...PATHS,

    // Constantes de utilidade
    CONTROL_CHARS_REGEX,

    // Funções de suporte
    ensureInfrastructure,
    sanitizeFilename,
    cleanText,
    sleep,
    isPathSafe
};
