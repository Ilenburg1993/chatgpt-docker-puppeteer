// @ts-check
/**
 * src/copilot/observability/logger.js
 *
 * Logger interno isolado para src/copilot. Drop-in replacement de `#core/logger`, sem dependência do workspace pai.
 *
 * - Escreve em `var/logs/copilot/agent.log` (fora de `src/`)
 * - Nível de log controlado por `COPILOT_LOG_LEVEL` (independente de `LOG_LEVEL` global)
 * - Mesma API pública de `#core/logger`: `log`, `log.debug/info/warn/error/fatal`, `audit`, `metric`, `logMetric`
 * - Prefixo `[copilot]` nas linhas de console para distinguir de logs do workspace pai
 * - Rotação automática por tamanho (5 MB para log/metrics, 2 MB para audit)
 *
 * @module copilot/observability/logger
 * @see EventBus
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { createBoundJsonlFileWriter } from '#copilot/infra/public/persistence/jsonl';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPILOT_LOG_DIR, COPILOT_LOG_LEVEL, COPILOT_LOG_MAX_ARCHIVES } from '../config/env.js';
import { toError } from '../core/error-handlers.js';
import { redactSecretRecord, redactSecretText } from '../core/security/redaction.js';
import { SHUTDOWN_PRIORITY } from '../core/shutdown-priorities.js';
import { registerShutdownHandler } from '../core/shutdown.js';

/** @type {boolean} */
let _stdoutUnavailable = false;
/** @type {boolean} */
let _stderrUnavailable = false;

// ─── Paths isolados ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Raiz do projeto (2 níveis acima de src/copilot/observability/).
 *
 * @type {string}
 */
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/** Diretório de logs. Default: `var/logs/copilot/` na raiz do projeto (fora de `src/`). */
export const LOG_DIR = COPILOT_LOG_DIR
    ? path.resolve(COPILOT_LOG_DIR)
    : path.join(PROJECT_ROOT, 'var', 'logs', 'copilot');

const LOG_FILE = path.join(LOG_DIR, 'agent.log');
const METRICS_FILE = path.join(LOG_DIR, 'metrics.log');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');
const LOGGER_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'observability.logger.retention',
        roots: [LOG_DIR],
        operations: ['append', 'delete', 'list', 'move', 'stat'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory', 'none'],
    }),
);

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} LogLevel
 */

// ─── Políticas de retenção ────────────────────────────────────────────────────

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIT_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_ARCHIVES = COPILOT_LOG_MAX_ARCHIVES;

// ─── Gestão assíncrona de arquivos ───────────────────────────────────────────

/** @param {unknown} error */
function isMissingPathError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Remove archives antigos fora do hot path. A capability é bound uma vez ao LOG_DIR resolvido no bootstrap; nomes
 * derivados da listagem continuam sujeitos a root containment, symlink deny e locks do configured backend.
 *
 * @param {string} prefix
 * @returns {Promise<void>}
 */
async function cleanOldFiles(prefix) {
    try {
        const entries = (await LOGGER_IO.listDirectoryNamesFresh(LOG_DIR)).entries;
        const candidates = entries.filter(
            (entryName) => entryName.startsWith(prefix) && (entryName.endsWith('.log') || entryName.includes('.bak.')),
        );
        const files = (
            await Promise.all(
                candidates.map(async (entryName) => {
                    const filePath = path.join(LOG_DIR, entryName);
                    const stats = await LOGGER_IO.lstatPath(filePath)
                        .then((result) => result.stats)
                        .catch(() => null);
                    return stats?.isFile() && !stats.isSymbolicLink() ? { name: entryName, time: stats.mtimeMs } : null;
                }),
            )
        )
            .filter((entry) => entry !== null)
            .sort((left, right) => right.time - left.time);
        for (const entry of files.slice(MAX_ARCHIVES)) {
            await LOGGER_IO.deleteFile(path.join(LOG_DIR, entry.name), { ignoreMissing: true });
        }
    } catch (error) {
        if (isMissingPathError(error)) return;
        safeEmergencyConsoleWrite(
            'stderr',
            `[copilot/logger] Erro na limpeza (${prefix}): ${error instanceof Error ? toError(error).message : String(error)}`,
        );
    }
}

/** @param {string} prefix @param {string} filePath */
function archivePath(prefix, filePath) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(filePath) || '.log';
    return path.join(LOG_DIR, `${prefix}${ts}.bak${ext}`);
}

/**
 * @param {string} filePath
 * @param {string} prefix
 * @param {number} maxBytes
 * @param {import('#copilot/infra/public/policy').IoDurabilityMode} durability
 */
function createLogWriter(filePath, prefix, maxBytes, durability) {
    return createBoundJsonlFileWriter({
        filePath,
        io: LOGGER_IO,
        maxBytes,
        batchLines: 256,
        maxQueueLines: 50_000,
        softQueueLines: 40_000,
        durability,
        resolveRotatedPath: (activePath) => archivePath(prefix, activePath),
        onPhase: async (phase) => {
            if (phase === 'after-rotate') await cleanOldFiles(prefix);
        },
        onError: (error) => {
            safeEmergencyConsoleWrite(
                'stderr',
                `[copilot/logger] persistência falhou (${prefix}): ${error instanceof Error ? toError(error).message : String(error)}`,
            );
        },
    });
}

const agentLogWriter = createLogWriter(LOG_FILE, 'copilot_agent_', MAX_LOG_SIZE, 'none');
const metricsLogWriter = createLogWriter(METRICS_FILE, 'copilot_metrics_', MAX_LOG_SIZE, 'none');
const auditLogWriter = createLogWriter(AUDIT_FILE, 'copilot_audit_', MAX_AUDIT_SIZE, 'file-and-directory');

export async function flushObservabilityLogs() {
    const results = await Promise.allSettled([
        agentLogWriter.flush(),
        metricsLogWriter.flush(),
        auditLogWriter.flush(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
}

registerShutdownHandler('observability.logger.flush', flushObservabilityLogs, SHUTDOWN_PRIORITY.AUDIT_FINALIZER, {
    timeoutMs: 10_000,
});

void Promise.all([cleanOldFiles('copilot_agent_'), cleanOldFiles('copilot_metrics_'), cleanOldFiles('copilot_audit_')]);

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isBrokenConsoleError(error) {
    const candidate = /** @type {{ code?: string; message?: string; name?: string }} */ (error);
    const code = typeof candidate?.code === 'string' ? candidate.code : '';
    const message = String(candidate?.message ?? error ?? '');
    return (
        code === 'EIO' ||
        code === 'EPIPE' ||
        code === 'ERR_STREAM_DESTROYED' ||
        message.includes('write EIO') ||
        message.includes('broken pipe')
    );
}

/**
 * @param {'stdout' | 'stderr'} channel
 * @param {string} line
 * @returns {void}
 */
function safeEmergencyConsoleWrite(channel, line) {
    const stream = channel === 'stderr' ? process.stderr : process.stdout;
    if (!stream) return;
    if (channel === 'stdout' && _stdoutUnavailable) return;
    if (channel === 'stderr' && _stderrUnavailable) return;

    try {
        stream.write(`${line}\n`);
    } catch (error) {
        if (isBrokenConsoleError(error)) {
            if (channel === 'stdout') _stdoutUnavailable = true;
            else _stderrUnavailable = true;
        }
    }
}

/**
 * @param {string | Error | Record<string, unknown>} msg
 * @returns {string}
 */
function formatRedactedLogMessage(msg) {
    if (msg instanceof Error) {
        const e = toError(msg);
        return redactSecretText(`${e.message}\n${e.stack ?? ''}`);
    }
    if (typeof msg === 'object') {
        try {
            return JSON.stringify(redactSecretRecord(msg));
        } catch (_) {
            return redactSecretText(String(msg));
        }
    }
    return redactSecretText(msg);
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
let configuredConsoleLevel = configuredLevel;
let consoleMinLevel = minLevel;

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
    return entries.slice(-Math.min(n, RING_BUFFER_SIZE)).map((entry) => ({
        ...entry,
        taskId: redactSecretText(entry.taskId),
        msg: redactSecretText(entry.msg),
    }));
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

    const ts = new Date().toISOString();

    // Resolve metadata vs taskId legado
    /** @type {LogMetadata} */
    const meta = typeof metaOrTaskId === 'object' && metaOrTaskId !== null ? metaOrTaskId : { taskId: metaOrTaskId };
    const taskId = meta.taskId ?? '-';
    const sessionId = meta.sessionId ?? '';

    let content = formatRedactedLogMessage(msg);

    // F110.2: inclui stack trace em WARN quando msg é Error
    if (level.toUpperCase() === 'WARN' && msg instanceof Error && msg.stack) {
        content = redactSecretText(`${msg.message}\n${msg.stack}`);
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
            ...(meta.extra ? redactSecretRecord(meta.extra) : {}),
        };
        const jsonLine = JSON.stringify(jsonEntry);
        _logRingBuffer.push({ ts, level, taskId, msg: String(content) });
        if (_logRingBuffer.length > RING_BUFFER_SIZE) _logRingBuffer.shift();
        agentLogWriter.enqueueLine(jsonLine);
        if (levelValue >= (consoleMinLevel ?? LOG_LEVELS['INFO'] ?? 1)) {
            safeEmergencyConsoleWrite(levelValue >= (LOG_LEVELS['ERROR'] ?? 3) ? 'stderr' : 'stdout', jsonLine);
        }
    } else {
        // F110.4: human-readable para dev
        // GAP-ERR-COLOR: Apply red ANSI for ERROR and FATAL messages
        const sidTag = sessionId ? ` [sid:${sessionId}]` : '';
        const isError = level.toUpperCase() === 'ERROR' || level.toUpperCase() === 'FATAL';
        const colorCode = isError ? '\x1b[31m' : ''; // Red for errors
        const resetCode = isError ? '\x1b[0m' : ''; // Reset after error
        const line = `${colorCode}[${ts}] ${level.padEnd(5)} [${taskId}]${sidTag} [copilot] ${content}${resetCode}`;
        _logRingBuffer.push({ ts, level, taskId, msg: String(content) });
        if (_logRingBuffer.length > RING_BUFFER_SIZE) _logRingBuffer.shift();
        agentLogWriter.enqueueLine(line);
        if (levelValue >= (consoleMinLevel ?? LOG_LEVELS['INFO'] ?? 1)) {
            safeEmergencyConsoleWrite(isError ? 'stderr' : 'stdout', line);
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
 * Retorna o nível atualmente visível no console.
 *
 * @returns {string}
 */
log.getConsoleLevel = () => configuredConsoleLevel;

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

/**
 * Define o nível mínimo apenas para saída de console, preservando o nível completo de arquivo.
 *
 * @param {LogLevel} newLevel
 * @returns {void}
 */
log.setConsoleLevel = (newLevel) => {
    const upper = newLevel.toUpperCase();
    if (LOG_LEVELS[upper] !== undefined) {
        configuredConsoleLevel = upper;
        consoleMinLevel = LOG_LEVELS[upper];
        log('INFO', `[copilot/logger] Console log level alterado para: ${upper}`);
        return;
    }
    log('WARN', `[copilot/logger] Console log level inválido: ${newLevel}. Válidos: DEBUG, INFO, WARN, ERROR, FATAL`);
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
    const ts = new Date().toISOString();
    const entry = `[${ts}] [AUDIT] ${action} | ${JSON.stringify(redactSecretRecord(details))}`;
    auditLogWriter.enqueueLine(entry);
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
    try {
        const entry = JSON.stringify({
            ts: new Date().toISOString(),
            metric: name,
            ...(payload ? redactSecretRecord(payload) : {}),
        });
        metricsLogWriter.enqueueLine(entry);
    } catch (_) {
        // Silencioso — métricas não são críticas
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const debug = log.debug;
export const info = log.info;
export const warn = log.warn;
export const error = log.error;
export const fatal = log.fatal;

export { audit, log, metric as logMetric, metric };
