// @ts-check
/**
 * src/copilot/observability/logger.js
 *
 * Logger interno isolado para src/copilot. Drop-in replacement de `#core/logger`, sem dependência do workspace pai.
 *
 * - Escreve em `src/copilot/logs/agent.log` (não mais em `ROOT/logs/agente_current.log`)
 * - Nível de log controlado por `COPILOT_LOG_LEVEL` (independente de `LOG_LEVEL` global)
 * - Mesma API pública de `#core/logger`: `log`, `log.debug/info/warn/error/fatal`, `audit`, `metric`, `logMetric`
 * - Prefixo `[copilot]` nas linhas de console para distinguir de logs do workspace pai
 * - Rotação automática por tamanho (5 MB para log/metrics, 2 MB para audit)
 *
 * @module copilot/observability/logger
 */

import { COPILOT_LOG_DIR, COPILOT_LOG_LEVEL, COPILOT_LOG_MAX_ARCHIVES } from '#copilot/config/env';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Paths isolados ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Diretório de logs isolado dentro do módulo copilot. */
export const LOG_DIR = COPILOT_LOG_DIR ? path.resolve(COPILOT_LOG_DIR) : path.resolve(__dirname, '../logs');

const LOG_FILE = path.join(LOG_DIR, 'agent.log');
const METRICS_FILE = path.join(LOG_DIR, 'metrics.log');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} LogLevel
 */

// ─── Políticas de retenção ────────────────────────────────────────────────────

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIT_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_ARCHIVES = COPILOT_LOG_MAX_ARCHIVES;

// ─── Inicialização síncrona (evita race conditions na carga do módulo) ─────────

try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (/** @type {any} */ _) {
    // Ignorar: pode já existir ou não ter permissão (fallback para console)
}

// ─── Gestão de arquivos ───────────────────────────────────────────────────────

/**
 * Remove arquivos antigos de log para economizar espaço em disco.
 *
 * @param {string} prefix - Prefixo dos arquivos a limpar.
 * @returns {void}
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
                    // Ignorar erros de limpeza
                }
            });
        }
    } catch (/** @type {any} */ e) {
        console.error(`[copilot/logger] Erro na limpeza (${prefix}): ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * Rotaciona um arquivo se ele exceder o limite de tamanho.
 *
 * @param {string} filePath - Caminho do arquivo.
 * @param {string} prefix - Prefixo para arquivos de backup.
 * @param {number} maxSize - Tamanho máximo em bytes.
 * @returns {void}
 */
function rotateFile(filePath, prefix, maxSize) {
    try {
        if (!fs.existsSync(filePath)) return;
        const stats = fs.statSync(filePath);
        if (stats.size > maxSize) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = path.extname(filePath) || '.log';
            const archivePath = path.join(LOG_DIR, `${prefix}${ts}.bak${ext}`);
            fs.renameSync(filePath, archivePath);
            cleanOldFiles(prefix);
        }
    } catch (/** @type {any} */ e) {
        console.error(`[copilot/logger] Erro ao rotacionar ${prefix}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ─── Nível de log ──────────────────────────────────────────────────────────────

const LOG_LEVELS = /** @type {Record<string, number>} */ ({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
});

let configuredLevel = COPILOT_LOG_LEVEL;
let minLevel = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS['INFO'];

// ─── API pública — log ────────────────────────────────────────────────────────

/**
 * Ring buffer interno dos últimos 1000 logs para consulta via API.
 *
 * @type {{ ts: string; level: string; taskId: string; msg: string }[]}
 */
const _logRingBuffer = [];
const RING_BUFFER_SIZE = 1000;

/**
 * Retorna as últimas N entradas do ring buffer de logs, opcionalmente filtradas por nível.
 *
 * @param {number} [n=50] - Número de entradas. Default is `50`
 * @param {string} [level] - Filtro de nível (ex: 'ERROR', 'WARN'). Opcional.
 * @returns {{ ts: string; level: string; taskId: string; msg: string }[]}
 */
export function getRecentLogs(n = 50, level) {
    const entries = level ? _logRingBuffer.filter((e) => e.level === level.toUpperCase()) : _logRingBuffer;
    return entries.slice(-Math.min(n, RING_BUFFER_SIZE));
}

/**
 * @typedef {object} LogMetadata
 * @property {string} [taskId] - ID da tarefa
 * @property {string} [sessionId] - Correlation ID da sessão
 * @property {string} [component] - Componente de origem (ex: 'git-bridge', 'agent')
 * @property {Record<string, unknown>} [extra] - Dados adicionais
 */

/** Detecta modo produção para output JSON-line. */
const _isProduction = process.env['NODE_ENV'] === 'production';

/**
 * Log operacional isolado do copilot. Mesma assinatura de `#core/logger → log`.
 *
 * Aceita taskId (string) ou metadata (object) como terceiro parâmetro para retrocompatibilidade.
 *
 * @param {LogLevel} level - Nível do log.
 * @param {string | Error | Record<string, unknown>} msg - Mensagem ou objeto.
 * @param {string | LogMetadata} [metaOrTaskId='-'] - ID da tarefa (string) ou metadata (object). Default is `'-'`
 * @returns {void}
 */
function log(level, msg, metaOrTaskId = '-') {
    const levelValue = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS['INFO'] ?? 1;
    const _minLevel = minLevel ?? LOG_LEVELS['INFO'] ?? 1;
    if (levelValue < _minLevel) return;

    rotateFile(LOG_FILE, 'copilot_agent_', MAX_LOG_SIZE);

    const ts = new Date().toISOString();

    // Resolve metadata vs taskId legado
    /** @type {LogMetadata} */
    const meta = typeof metaOrTaskId === 'object' && metaOrTaskId !== null ? metaOrTaskId : { taskId: metaOrTaskId };
    const taskId = meta.taskId ?? '-';
    const sessionId = meta.sessionId ?? '';

    let content = msg;
    if (msg instanceof Error) {
        content = `${msg.message}\n${msg.stack}`;
    } else if (typeof msg === 'object') {
        try {
            content = JSON.stringify(msg);
        } catch (/** @type {any} */ _) {
            content = String(msg);
        }
    }

    // F110.2: inclui stack trace em WARN quando msg é Error
    if (level.toUpperCase() === 'WARN' && msg instanceof Error && msg.stack) {
        content = `${msg.message}\n${msg.stack}`;
    }

    if (_isProduction) {
        // F110.4: JSON-line para prod
        const jsonEntry = {
            ts,
            level,
            taskId,
            ...(sessionId ? { sessionId } : {}),
            ...(meta.component ? { component: meta.component } : {}),
            msg: String(content),
            ...(meta.extra ?? {}),
        };
        const jsonLine = JSON.stringify(jsonEntry);
        console.log(jsonLine);
        _logRingBuffer.push({ ts, level, taskId, msg: String(content) });
        if (_logRingBuffer.length > RING_BUFFER_SIZE) _logRingBuffer.shift();
        try {
            fs.appendFileSync(LOG_FILE, `${jsonLine}\n`, 'utf-8');
        } catch (/** @type {any} */ _) {
            // Silencioso — console.log já logou
        }
    } else {
        // F110.4: human-readable para dev
        const sidTag = sessionId ? ` [sid:${sessionId}]` : '';
        const line = `[${ts}] ${level.padEnd(5)} [${taskId}]${sidTag} [copilot] ${content}`;
        console.log(line);
        _logRingBuffer.push({ ts, level, taskId, msg: String(content) });
        if (_logRingBuffer.length > RING_BUFFER_SIZE) _logRingBuffer.shift();
        try {
            fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf-8');
        } catch (/** @type {any} */ _) {
            // Silencioso — console.log já logou
        }
    }
}

/**
 * Retorna o nível de log configurado atualmente.
 *
 * @returns {string}
 */
log.getLevel = () => configuredLevel;

/**
 * Define o nível de log dinamicamente.
 *
 * @param {LogLevel} newLevel
 * @returns {void}
 */
log.setLevel = (newLevel) => {
    const upper = newLevel.toUpperCase();
    if (LOG_LEVELS[upper] !== undefined) {
        configuredLevel = upper;
        minLevel = LOG_LEVELS[upper];
        log('INFO', `[copilot/logger] Log level alterado para: ${upper}`);
    } else {
        log('WARN', `[copilot/logger] Nível inválido: ${newLevel}. Válidos: DEBUG, INFO, WARN, ERROR, FATAL`);
    }
};

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

// ─── API pública — audit ──────────────────────────────────────────────────────

/**
 * Auditoria: registra ações administrativas em `audit.log`.
 *
 * @param {string} action - Ação auditada.
 * @param {Record<string, unknown>} details - Detalhes da ação.
 * @returns {void}
 */
function audit(action, details) {
    rotateFile(AUDIT_FILE, 'copilot_audit_', MAX_AUDIT_SIZE);
    const ts = new Date().toISOString();
    const entry = `[${ts}] [AUDIT] ${action} | ${JSON.stringify(details)}\n`;
    try {
        fs.appendFileSync(AUDIT_FILE, entry, 'utf-8');
    } catch (/** @type {any} */ _) {
        console.error(`[copilot/logger] [CRITICAL_AUDIT_FAIL] ${entry}`);
    }
}

// ─── API pública — metric ──────────────────────────────────────────────────────

/**
 * Métricas: registra dados de performance em `metrics.log`.
 *
 * @param {string} name - Nome da métrica.
 * @param {Record<string, unknown>} [payload] - Payload.
 * @returns {void}
 */
function metric(name, payload) {
    rotateFile(METRICS_FILE, 'copilot_metrics_', MAX_LOG_SIZE);
    try {
        const entry = JSON.stringify({ ts: new Date().toISOString(), metric: name, ...(payload ?? {}) });
        fs.appendFileSync(METRICS_FILE, `${entry}\n`, 'utf-8');
    } catch (/** @type {any} */ _) {
        // Silencioso — métricas não são críticas
    }
}

// ─── Inicialização (hygiene) ──────────────────────────────────────────────────

cleanOldFiles('copilot_agent_');
cleanOldFiles('copilot_metrics_');
cleanOldFiles('copilot_audit_');

// ─── Exports ──────────────────────────────────────────────────────────────────

export const debug = log.debug;
export const info = log.info;
export const warn = log.warn;
export const error = log.error;
export const fatal = log.fatal;

export { audit, log, metric as logMetric, metric };
