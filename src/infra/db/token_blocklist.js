// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { getDb } from './sqlite.js';
import { log } from '#core/logger';

/**
 * @fileoverview Blocklist de tokens JWT revogados.
 *
 * Implementa invalidação de tokens JWT após logout, prevenindo re-uso
 * de tokens roubados dentro do período de expiração.
 *
 * A tabela `revoked_tokens` é limpa automaticamente via `cleanExpired()`,
 * que deve ser chamado periodicamente (ex: a cada hora via AgentLoop ou cron).
 *
 * @module infra/db/token_blocklist
 */

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
let _cleanupTimer = /** @type {any} */ (null);

/**
 * Garante que a tabela de tokens revogados existe no banco de dados.
 * Idempotente — seguro para chamar múltiplas vezes.
 * @returns {void}
 */
export function ensureTokenBlocklistTable() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            jti TEXT PRIMARY KEY,
            revoked_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires
            ON revoked_tokens(expires_at_ms);
    `);
}

/**
 * Adiciona um token à blocklist de tokens revogados.
 *
 * @param {string} jti - JWT ID (claim `jti`) do token a revogar.
 * @param {number} expiresAtMs - Timestamp de expiração do token em ms (epoch).
 * @returns {boolean} `true` se inserido com sucesso, `false` se já existia.
 */
export function revokeToken(jti, expiresAtMs) {
    if (!jti || typeof jti !== 'string') {
        log('WARN', '[TOKEN_BLOCKLIST] revokeToken chamado sem jti válido');
        return false;
    }
    try {
        ensureTokenBlocklistTable();
        const db = getDb();
        const result = db
            .prepare('INSERT OR IGNORE INTO revoked_tokens (jti, revoked_at_ms, expires_at_ms) VALUES (?, ?, ?)')
            .run(jti, Date.now(), Number(expiresAtMs) || Date.now() + 86400000);
        return result.changes > 0;
    } catch (/** @type {any} */ err) {
        log('ERROR', `[TOKEN_BLOCKLIST] Erro ao revogar token: ${/** @type {any} */ (err).message}`);
        return false;
    }
}

/**
 * Verifica se um token está na blocklist (foi revogado).
 *
 * @param {string} jti - JWT ID (claim `jti`) a verificar.
 * @returns {boolean} `true` se o token está revogado e ainda não expirou.
 */
export function isTokenRevoked(jti) {
    if (!jti || typeof jti !== 'string') return false;
    try {
        ensureTokenBlocklistTable();
        const db = getDb();
        const row = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at_ms > ?').get(jti, Date.now());
        return !!row;
    } catch (/** @type {any} */ err) {
        log('WARN', `[TOKEN_BLOCKLIST] Erro ao verificar token: ${/** @type {any} */ (err).message}`);
        return false; // Fail-open: se não conseguimos verificar, permitir (log gerado)
    }
}

/**
 * Remove tokens expirados da blocklist para manter o banco enxuto.
 * @returns {number} Número de registros removidos.
 */
export function cleanExpiredTokens() {
    try {
        ensureTokenBlocklistTable();
        const db = getDb();
        const result = db.prepare('DELETE FROM revoked_tokens WHERE expires_at_ms <= ?').run(Date.now());
        const removed = result.changes;
        if (removed > 0) {
            log('DEBUG', `[TOKEN_BLOCKLIST] Limpeza: ${removed} tokens expirados removidos`);
        }
        return removed;
    } catch (/** @type {any} */ err) {
        log('WARN', `[TOKEN_BLOCKLIST] Erro na limpeza de tokens: ${/** @type {any} */ (err).message}`);
        return 0;
    }
}

/**
 * Inicia limpeza periódica automática de tokens expirados.
 * Seguro para chamar múltiplas vezes — só registra um timer por vez.
 * @returns {void}
 */
export function startPeriodicCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        cleanExpiredTokens();
    }, CLEANUP_INTERVAL_MS);
    // Permite que o processo encerre sem aguardar o timer
    if (_cleanupTimer.unref) _cleanupTimer.unref();
    log('DEBUG', '[TOKEN_BLOCKLIST] Limpeza periódica iniciada (intervalo: 1h)');
}

/**
 * Para a limpeza periódica (usado em testes e shutdown).
 * @returns {void}
 */
export function stopPeriodicCleanup() {
    if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
    }
}

/**
 * Exposto para testes/regressão de import-safety.
 * @returns {boolean}
 */
export function isPeriodicCleanupRunning() {
    return Boolean(_cleanupTimer);
}
