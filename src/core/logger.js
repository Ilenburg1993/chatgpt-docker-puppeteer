/* ==========================================================================
   src/core/logger.js
   Audit Level: 40 — Unified Logging & Audit System (NASA Standard)
   Responsabilidade: Centralizar Logs, Métricas e Auditoria com Rotação Automática.
   Sincronizado com: server.js (V40), io.js (V36), doctor.js (V38).
========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const LOG_DIR = path.join(ROOT, 'logs');

// --- DEFINIÇÃO DE ARQUIVOS ---
const LOG_FILE = path.join(LOG_DIR, 'agente_current.log');
const METRICS_FILE = path.join(LOG_DIR, 'metrics.log');
const AUDIT_FILE = path.join(LOG_DIR, 'audit.log');

// --- POLÍTICAS DE RETENÇÃO ---
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB para logs comuns
const MAX_AUDIT_SIZE = 2 * 1024 * 1024; // 2MB para auditoria (conforme requisito server.js)
const MAX_ARCHIVES = 5; // Mantém 5 arquivos de histórico por tipo

// Garante a existência do diretório de logs
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/* ==========================================================================
   SISTEMA DE GESTÃO DE ARQUIVOS (ROTAÇÃO E LIMPEZA)
========================================================================== */

/**
 * Apaga arquivos antigos para economizar espaço em disco.
 */
function cleanOldFiles(prefix) {
    try {
        const files = fs
            .readdirSync(LOG_DIR)
            .filter(f => f.startsWith(prefix) && (f.endsWith('.log') || f.endsWith('.bak') || f.endsWith('.json')))
            .map(f => ({ name: f, time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (files.length > MAX_ARCHIVES) {
            files.slice(MAX_ARCHIVES).forEach(f => {
                try {
                    fs.unlinkSync(path.join(LOG_DIR, f.name));
                } catch (_e) {
                    // Ignore cleanup errors
                }
            });
        }
    } catch (e) {
        console.error(`[LOGGER] Erro na limpeza de arquivos (${prefix}): ${e.message}`);
    }
}

/**
 * Rotaciona um arquivo se ele exceder o limite definido.
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
    } catch (e) {
        console.error(`[LOGGER] Erro ao rotacionar ${prefix}: ${e.message}`);
    }
}

/* ==========================================================================
   API PÚBLICA DE REGISTRO
========================================================================== */

/**
 * Log Operacional: Registra eventos do fluxo de trabalho.
 */
function log(level, msg, taskId = '-') {
    rotateFile(LOG_FILE, 'agente_', MAX_LOG_SIZE);

    const ts = new Date().toISOString();
    let content = msg;
    if (msg instanceof Error) {
        content = `${msg.message}\n${msg.stack}`;
    } else if (typeof msg === 'object') {
        try {
            content = JSON.stringify(msg);
        } catch (_) {
            /* Use String fallback */ content = String(msg);
        }
    }

    const line = `[${ts}] ${level.padEnd(5)} [${taskId}] ${content}`;
    console.log(line);
    try {
        fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf-8');
    } catch (_e) {
        // Silent failure - console.log already logged
    }
}

/**
 * Auditoria Governamental: Registra ações administrativas e mudanças de estado.
 * Absorvido do server.js para centralização de soberania.
 */
function audit(action, details) {
    rotateFile(AUDIT_FILE, 'audit_', MAX_AUDIT_SIZE);

    const ts = new Date().toISOString();
    const entry = `[${ts}] [AUDIT] ${action} | ${JSON.stringify(details)}\n`;

    try {
        fs.appendFileSync(AUDIT_FILE, entry, 'utf-8');
    } catch (_e) {
        // Fallback para console em caso de falha crítica de I/O na auditoria
        console.error(`[CRITICAL_AUDIT_FAIL] ${entry}`);
    }
}

/**
 * Métricas de Performance: Registra dados para análise estatística futura.
 */
function metric(name, payload) {
    rotateFile(METRICS_FILE, 'metrics_', MAX_LOG_SIZE);

    try {
        const entry = JSON.stringify(
            Object.assign(
                {
                    ts: new Date().toISOString(),
                    metric: name
                },
                payload || {}
            )
        );
        fs.appendFileSync(METRICS_FILE, `${entry}\\n`, 'utf-8');
    } catch (_e) {
        // Silent failure - metrics are non-critical
    }
}

// --- INICIALIZAÇÃO (HYGIENE CHECK) ---
cleanOldFiles('agente_');
cleanOldFiles('metrics_');
cleanOldFiles('audit_');

module.exports = { log, audit, metric, LOG_DIR };
