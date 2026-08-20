// @ts-check - Type checking rigoroso habilitado (arquivo core)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');
/** Diretório base persistente de logs operacionais, métricas e auditoria. */
const LOG_DIR = path.join(ROOT, 'logs');

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} LogLevel
 */

// --- DEFINIÇÃO DE ARQUIVOS ---
const LOG_FILE = path.join(LOG_DIR, 'agente_current.log');
const METRICS_FILE = path.join(LOG_DIR, 'metrics.log');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');

// --- POLÍTICAS DE RETENÇÃO ---
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB para logs comuns
const MAX_AUDIT_SIZE = 2 * 1024 * 1024; // 2MB para auditoria (conforme requisito server.js)
const MAX_ARCHIVES = process.env['LOG_MAX_ARCHIVES'] ? parseInt(process.env['LOG_MAX_ARCHIVES'], 10) : 5;

// BUG-02 FIX: Inicialização síncrona do diretório de logs na carga do módulo.
// Isso elimina a necessidade de `async/await` na função `log()`, que era chamada
// em todo o codebase sem `await`, resultando em Promises não tratadas.
try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (/** @type {any} */ _) {
    // Ignorar: pode já existir ou não ter permissão (fallback para console.log)
}

/* ==========================================================================
   SISTEMA DE GESTÃO DE ARQUIVOS (ROTAÇÃO E LIMPEZA)
========================================================================== */

/**
 * Apaga arquivos antigos para economizar espaço em disco. Side-effects: Remove arquivos do sistema de arquivos.
 *
 * @param {string} prefix - Prefixo dos arquivos a limpar.
 */
function cleanOldFiles(prefix) {
    try {
        const files = fs
            .readdirSync(LOG_DIR)
            .filter((f) => f.startsWith(prefix) && (f.endsWith('.log') || f.endsWith('.bak') || f.endsWith('.json')))
            .map((f) => ({ name: f, time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (files.length > MAX_ARCHIVES) {
            files.slice(MAX_ARCHIVES).forEach((f) => {
                try {
                    fs.unlinkSync(path.join(LOG_DIR, f.name));
                } catch (/** @type {any} */ _) {
                    // Ignore cleanup errors
                }
            });
        }
    } catch (/** @type {any} */ e) {
        console.error(
            `[LOGGER] Erro na limpeza de arquivos (${prefix}): ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}

/**
 * Rotaciona um arquivo se ele exceder o limite definido. Rotaciona arquivo de log quando excede tamanho máximo.
 * Side-effects: Renomeia arquivo atual para .bak e limpa arquivos antigos.
 *
 * @param {string} filePath - Caminho do arquivo a rotacionar.
 * @param {string} prefix - Prefixo para arquivos de backup.
 * @param {number} maxSize - Tamanho máximo em bytes.
 * @throws {Error} Nunca lança erro - opera em modo fail-safe.
 */
function rotateFile(filePath, prefix, maxSize) {
    try {
        if (!fs.existsSync(filePath)) {
            return;
        }
        const stats = fs.statSync(filePath);

        if (stats.size > maxSize) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = path.extname(filePath) || '.log';
            const archivePath = path.join(LOG_DIR, `${prefix}${timestamp}.bak${ext}`);

            fs.renameSync(filePath, archivePath);
            cleanOldFiles(prefix);
        }
    } catch (/** @type {any} */ e) {
        console.error(`[LOGGER] Erro ao rotacionar ${prefix}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/* ==========================================================================
   API PÚBLICA DE REGISTRO
========================================================================== */

// Log level hierarchy (lower number = more verbose)
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
};

// Read LOG_LEVEL from environment (default: INFO)
const configuredLevel = process.env['LOG_LEVEL']?.toUpperCase() || 'INFO';
let minLevel = /** @type {Record<string, number>} */ (LOG_LEVELS)[configuredLevel] ?? LOG_LEVELS.INFO;

/**
 * Log Operacional: Registra eventos do fluxo de trabalho com filtragem por nível. BUG-02 FIX: Refatorado para função
 * síncrona. O diretório de logs é criado na carga do módulo. Side-effects: Escreve no console e arquivo de log,
 * rotaciona arquivos se necessário.
 *
 * @param {LogLevel} level - Nível do log.
 * @param {string | Error | Record<string, unknown>} msg - Mensagem ou objeto a logar.
 * @param {string | null} [taskId='-'] - ID da tarefa associada. Default is `'-'`
 * @returns {void}
 * @throws {Error} Nunca lança erro - opera em modo fail-safe.
 */
function log(level, msg, taskId = '-') {
    // Filter: Only log if level >= configured threshold
    const levelValue = /** @type {Record<string, number>} */ (LOG_LEVELS)[level.toUpperCase()] ?? LOG_LEVELS.INFO;
    if (levelValue < minLevel) {
        return; // Skip this log
    }

    rotateFile(LOG_FILE, 'agente_', MAX_LOG_SIZE);

    const ts = new Date().toISOString();
    let content = msg;
    if (msg instanceof Error) {
        content = `${msg.message}\n${msg.stack}`;
    } else if (typeof msg === 'object') {
        try {
            content = JSON.stringify(msg);
        } catch (/** @type {any} */ _) {
            /* Use String fallback */ content = String(msg);
        }
    }

    const line = `[${ts}] ${level.padEnd(5)} [${taskId}] ${content}`;
    console.log(line);
    try {
        fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf-8');
    } catch (/** @type {any} */ _) {
        // Silent failure - console.log already logged
    }
}

/**
 * Retorna o nível de log configurado atualmente.
 *
 * @returns {string} Nível de log atual.
 */
log.getLevel = () => configuredLevel;

/**
 * Define o nível de log dinamicamente em runtime. Side-effects: Altera o filtro de logs globalmente.
 *
 * @param {LogLevel} newLevel - Novo nível de log.
 * @throws {Error} Nunca lança erro - valida entrada e loga avisos.
 */
log.setLevel = (newLevel) => {
    const upperLevel = newLevel.toUpperCase();
    const nextLevel = /** @type {Record<string, number>} */ (LOG_LEVELS)[upperLevel];
    if (nextLevel !== undefined) {
        minLevel = nextLevel;
        log('INFO', `Log level changed to: ${upperLevel}`);
    } else {
        log('WARN', `Invalid log level: ${newLevel}. Valid levels: DEBUG, INFO, WARN, ERROR, FATAL`);
    }
};

/**
 * Auditoria Governamental: Registra ações administrativas e mudanças de estado. Side-effects: Escreve no arquivo de
 * auditoria, rotaciona se necessário.
 *
 * @param {string} action - Ação auditada.
 * @param {Record<string, unknown>} details - Detalhes da ação.
 * @returns {void}
 * @throws {Error} Nunca lança erro - opera em modo fail-safe com fallback para console.
 */
function audit(action, details) {
    rotateFile(AUDIT_FILE, 'audit_', MAX_AUDIT_SIZE);

    const ts = new Date().toISOString();
    const entry = `[${ts}] [AUDIT] ${action} | ${JSON.stringify(details)}\n`;

    try {
        fs.appendFileSync(AUDIT_FILE, entry, 'utf-8');
    } catch (/** @type {any} */ _) {
        // Fallback para console em caso de falha crítica de I/O na auditoria
        console.error(`[CRITICAL_AUDIT_FAIL] ${entry}`);
    }
}

/**
 * Métricas de Performance: Registra dados para análise estatística futura. Side-effects: Escreve no arquivo de
 * métricas, rotaciona se necessário.
 *
 * @param {string} name - Nome da métrica.
 * @param {Record<string, unknown>} [payload] - Payload da métrica.
 * @returns {void}
 * @throws {Error} Nunca lança erro - opera em modo fail-safe.
 */
function metric(name, payload) {
    rotateFile(METRICS_FILE, 'metrics_', MAX_LOG_SIZE);

    try {
        const entry = JSON.stringify(
            Object.assign(
                {
                    ts: new Date().toISOString(),
                    metric: name,
                },
                payload || {},
            ),
        );
        fs.appendFileSync(METRICS_FILE, `${entry}\n`, 'utf-8');
    } catch (/** @type {any} */ _) {
        // Silent failure - metrics are non-critical
    }
}

/* ==========================================================================
   CONVENIENCE WRAPPERS (DX Improvement)
========================================================================== */

/**
 * Wrappers de conveniência para níveis de log mais comuns. Uso: log.debug('Mensagem', taskId) log.info('Mensagem',
 * taskId) log.warn('Mensagem', taskId) log.error('Mensagem', taskId) log.fatal('Mensagem', taskId)
 */
log.debug = (/** @type {string | Error | Record<string, unknown>} */ msg, /** @type {string} */ taskId = '-') =>
    log('DEBUG', msg, taskId);
log.info = (/** @type {string | Error | Record<string, unknown>} */ msg, /** @type {string} */ taskId = '-') =>
    log('INFO', msg, taskId);
log.warn = (/** @type {string | Error | Record<string, unknown>} */ msg, /** @type {string} */ taskId = '-') =>
    log('WARN', msg, taskId);
log.error = (/** @type {string | Error | Record<string, unknown>} */ msg, /** @type {string} */ taskId = '-') =>
    log('ERROR', msg, taskId);
log.fatal = (/** @type {string | Error | Record<string, unknown>} */ msg, /** @type {string} */ taskId = '-') =>
    log('FATAL', msg, taskId);

// --- INICIALIZAÇÃO (HYGIENE CHECK) ---
cleanOldFiles('agente_');
cleanOldFiles('metrics_');
cleanOldFiles('audit_');

/**
 * Wrapper para log.debug.
 *
 * @param {string | Error | Record<string, unknown>} msg - Mensagem.
 * @param {string} [taskId] - ID da tarefa.
 */
export const debug = log.debug;

/**
 * Wrapper para log.info.
 *
 * @param {string | Error | Record<string, unknown>} msg - Mensagem.
 * @param {string} [taskId] - ID da tarefa.
 */
export const info = log.info;

/**
 * Wrapper para log.warn.
 *
 * @param {string | Error | Record<string, unknown>} msg - Mensagem.
 * @param {string} [taskId] - ID da tarefa.
 */
export const warn = log.warn;

/**
 * Wrapper para log.error.
 *
 * @param {string | Error | Record<string, unknown>} msg - Mensagem.
 * @param {string} [taskId] - ID da tarefa.
 */
export const error = log.error;

/**
 * Wrapper para log.fatal.
 *
 * @param {string | Error | Record<string, unknown>} msg - Mensagem.
 * @param {string} [taskId] - ID da tarefa.
 */
export const fatal = log.fatal;

/**
 * Função principal de logging com métodos auxiliares. Side-effects: Escreve logs, rotaciona arquivos, filtra por nível.
 *
 * @type {((level: LogLevel, msg: string | Error | Record<string, unknown>, taskId?: string) => void) & {
 *     getLevel: () => string;
 *     setLevel: (newLevel: LogLevel) => void;
 *     debug: (msg: string | Error | Record<string, unknown>, taskId?: string) => void;
 *     info: (msg: string | Error | Record<string, unknown>, taskId?: string) => void;
 *     warn: (msg: string | Error | Record<string, unknown>, taskId?: string) => void;
 *     error: (msg: string | Error | Record<string, unknown>, taskId?: string) => void;
 *     fatal: (msg: string | Error | Record<string, unknown>, taskId?: string) => void;
 * }}
 */
export { log };

/**
 * Função de auditoria. Side-effects: Escreve auditoria em arquivo.
 */
export { audit };

/**
 * Função de métricas. Side-effects: Escreve métricas em arquivo.
 */
export { metric };

/**
 * Alias para metric. Side-effects: Escreve métricas em arquivo.
 */
export { metric as logMetric };

/**
 * Diretório de logs.
 */
/**
 * Diretório raiz de logs do processo (operacional, métricas e auditoria).
 */
export { LOG_DIR };
