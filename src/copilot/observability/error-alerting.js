// @ts-check
/**
 * src/copilot/observability/error-alerting.js
 *
 * F39: Error Alerting Proativo — monitora ErrorTracker e emite alertas quando a taxa de erros em uma janela de tempo
 * excede thresholds configuráveis.
 *
 * Funcionalidades:
 *
 * - F39.1: Threshold engine com janela de tempo deslizante
 * - F39.2: Eventos NERV para alertas (`copilot:error:alert`)
 * - F39.3: Banner de alerta no terminal via println
 * - F39.4: Webhook HTTP opcional para alertas críticos
 * - F39.5: Cooldown para evitar flooding de alertas
 *
 * @module copilot/observability/error-alerting
 * @see EventBus
 */

import { log } from './logger.js';

import { cancel as cancelTimer, registerTimer } from '../core/timer-registry.js';

const WEBHOOK_TIMEOUT_MS = 5_000;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} AlertingConfig
 * @property {number} [windowMs] - Janela de tempo em ms (padrão: 60000 = 1min).
 * @property {number} [warningThreshold] - Erros na janela para WARNING (padrão: 5).
 * @property {number} [criticalThreshold] - Erros na janela para CRITICAL (padrão: 15).
 * @property {number} [cooldownMs] - Cooldown entre alertas do mesmo nível (padrão: 120000 = 2min).
 * @property {string | null} [webhookUrl] - URL para POST de alertas críticos (null = desativado).
 * @property {((msg: string) => void) | null} [terminalPrint] - Função para exibir no terminal.
 * @property {((actionCode: string, payload: Record<string, unknown>) => void) | null} [nervEmit] - Emitter NERV.
 */

/**
 * @typedef {object} Alert
 * @property {'warning' | 'critical'} level
 * @property {number} errorCount
 * @property {number} windowMs
 * @property {number} ts
 * @property {string} message
 */

/**
 * @typedef {object} ErrorAlerter
 * @property {() => void} check - Avalia erros na janela e dispara alertas se necessário.
 * @property {() => Alert | null} getLastAlert - Retorna o último alerta emitido.
 * @property {() => { warnings: number; criticals: number }} getAlertStats - Contadores acumulados.
 * @property {() => void} reset - Limpa estado de cooldown e contadores.
 * @property {() => void} destroy - Remove timers ativos.
 */

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria instância do Error Alerter.
 *
 * @param {import('./error-tracker.js').ErrorTracker} tracker - ErrorTracker a monitorar.
 * @param {AlertingConfig} [config={}] Default is `{}`
 * @returns {ErrorAlerter}
 */
export function createErrorAlerter(tracker, config = {}) {
    const {
        windowMs = 60_000,
        warningThreshold = 5,
        criticalThreshold = 15,
        cooldownMs = 120_000,
        webhookUrl = null,
        terminalPrint = null,
        nervEmit = null,
    } = config;

    /** @type {Alert | null} */
    let _lastAlert = null;
    let _lastWarningTs = 0;
    let _lastCriticalTs = 0;
    let _warningCount = 0;
    let _criticalCount = 0;

    /** @type {ReturnType<typeof setInterval> | null} */
    let _interval = null;

    /**
     * Conta erros dentro da janela de tempo.
     *
     * @returns {number}
     */
    function _countErrorsInWindow() {
        const cutoff = Date.now() - windowMs;
        const all = tracker.getErrors(200);
        return all.filter((e) => e.timestamp >= cutoff).length;
    }

    /**
     * F39.4: Envia webhook para alertas críticos (fire-and-forget).
     *
     * @param {Alert} alert
     */
    function _sendWebhook(alert) {
        if (!webhookUrl) return;

        // Validar URL antes de fetch (SSRF prevention)
        try {
            const parsedUrl = new URL(webhookUrl);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                log('WARN', `[error-alerting] F39.4: webhook URL inválida (protocolo): ${parsedUrl.protocol}`);
                return;
            }
        } catch {
            log('WARN', '[error-alerting] F39.4: webhook URL malformada');
            return;
        }

        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'copilot_error_alert', ...alert }),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        }).catch((err) => {
            log('WARN', `[error-alerting] F39.4: webhook falhou: ${err.message}`);
        });
    }

    /**
     * F39.1: Avalia erros na janela de tempo e emite alertas se above threshold.
     */
    function check() {
        const now = Date.now();
        const count = _countErrorsInWindow();

        if (count >= criticalThreshold && now - _lastCriticalTs > cooldownMs) {
            _lastCriticalTs = now;
            _criticalCount++;

            /** @type {Alert} */
            const alert = {
                level: 'critical',
                errorCount: count,
                windowMs,
                ts: now,
                message: `⚠️  CRITICAL: ${count} erros nos últimos ${Math.round(windowMs / 1000)}s (threshold: ${criticalThreshold})`,
            };
            _lastAlert = alert;
            _emit(alert);
            return;
        }

        if (count >= warningThreshold && now - _lastWarningTs > cooldownMs) {
            _lastWarningTs = now;
            _warningCount++;

            /** @type {Alert} */
            const alert = {
                level: 'warning',
                errorCount: count,
                windowMs,
                ts: now,
                message: `⚡ WARNING: ${count} erros nos últimos ${Math.round(windowMs / 1000)}s (threshold: ${warningThreshold})`,
            };
            _lastAlert = alert;
            _emit(alert);
        }
    }

    /**
     * Emite alerta via todos os canais configurados.
     *
     * @param {Alert} alert
     */
    function _emit(alert) {
        log(alert.level === 'critical' ? 'ERROR' : 'WARN', `[error-alerting] ${alert.message}`);

        // F39.2: NERV event
        if (nervEmit) {
            nervEmit(
                'copilot:error:alert',
                /** @type {Record<string, unknown>} */ ({
                    level: alert.level,
                    errorCount: alert.errorCount,
                    windowMs: alert.windowMs,
                }),
            );
        }

        // F39.3: Terminal banner
        if (terminalPrint) {
            const color = alert.level === 'critical' ? '\x1b[31m' : '\x1b[33m';
            terminalPrint(`${color}  ┃ ${alert.message}\x1b[0m`);
        }

        // F39.4: Webhook
        if (alert.level === 'critical') {
            _sendWebhook(alert);
        }
    }

    /**
     * @returns {Alert | null}
     */
    function getLastAlert() {
        return _lastAlert;
    }

    /**
     * @returns {{ warnings: number; criticals: number }}
     */
    function getAlertStats() {
        return { warnings: _warningCount, criticals: _criticalCount };
    }

    function reset() {
        _lastAlert = null;
        _lastWarningTs = 0;
        _lastCriticalTs = 0;
        _warningCount = 0;
        _criticalCount = 0;
    }

    function destroy() {
        if (_interval) {
            clearInterval(_interval);
            _interval = null;
            // F156: cancelar também no registry (idempotente)
            cancelTimer('observability.errorAlerting');
        }
        reset();
    }

    // F39.5: Check periódico automático (a cada 30s)
    _interval = setInterval(check, 30_000);
    if (typeof _interval === 'object' && 'unref' in _interval) {
        _interval.unref();
    }
    // F156: registrar no timer-registry para cleanup automático via shutdown
    registerTimer('observability.errorAlerting', 'interval', _interval);

    return { check, getLastAlert, getAlertStats, reset, destroy };
}
