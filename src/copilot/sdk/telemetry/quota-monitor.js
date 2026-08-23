// @ts-check
/**
 * src/copilot/sdk/quota-monitor.js
 *
 * Faixa 21 — Quota monitoring periódico para o Copilot SDK.
 *
 * Inicia um timer que chama `accountGetQuota` periodicamente e mantém o último snapshot disponível via
 * `getQuotaStatus()`. Emite callbacks opcionais quando a quota é atualizada ou atinge limites críticos.
 *
 * @module copilot/sdk/quota-monitor
 * @see EventBus
 * @see module:copilot/sdk/server-rpc
 * @see module:copilot/sdk/health
 */

import { cancelApplicationTimer, registerApplicationInterval } from '#copilot/boot/process-runtime';
import { toError } from '#copilot/infra/public/platform/error';
import { accountGetQuota } from '../rpc/server.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('../rpc/server.js').CopilotClient} CopilotClient
 *
 * @typedef {import('../rpc/server.js').QuotaSnapshot} QuotaSnapshot
 *
 * @typedef {import('../rpc/server.js').AccountQuotaResult} AccountQuotaResult
 */

/**
 * @typedef {object} QuotaMonitorOptions
 * @property {CopilotClient} client - CopilotClient conectado.
 * @property {number} [intervalMs=300_000] - Intervalo de polling em millisegundos (padrão: 5 min). Default is `300_000`
 * @property {number} [warningThreshold=20] - Porcentagem restante que aciona callback de alerta (padrão: 20%). Default
 *   is `20`
 * @property {(snapshots: Record<string, QuotaSnapshot>) => void} [onUpdate] - Chamado após cada poll bem-sucedido.
 * @property {(quotaId: string, snapshot: QuotaSnapshot) => void} [onWarning] - Chamado quando quota cai abaixo do
 *   threshold.
 * @property {(error: Error) => void} [onError] - Chamado quando poll falha com erro.
 */

/**
 * @typedef {object} QuotaMonitor
 * @property {() => void} start - Inicia o timer de monitoramento.
 * @property {() => void} stop - Para o timer e limpa recursos.
 * @property {() => { snapshots: Record<string, QuotaSnapshot>; ts: number; running: boolean }} status - Retorna o
 *   estado atual do monitor.
 * @property {() => Promise<Record<string, QuotaSnapshot>>} poll - Executa um poll imediato e retorna os snapshots.
 */

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Intervalo padrão: 5 minutos. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Threshold padrão de alerta: 20% restante. */
const DEFAULT_WARNING_THRESHOLD = 20;

/**
 * Cria um monitor de quota periódico.
 *
 * @example
 *     const monitor = createQuotaMonitor({
 *         client: getClient(),
 *         onWarning: (id, snap) => console.warn('Quota baixa', id, snap),
 *     });
 *     monitor.start();
 *     // ...
 *     monitor.stop();
 *
 * @param {QuotaMonitorOptions} opts
 * @returns {QuotaMonitor}
 */
export function createQuotaMonitor(opts) {
    const {
        client,
        intervalMs = DEFAULT_INTERVAL_MS,
        warningThreshold = DEFAULT_WARNING_THRESHOLD,
        onUpdate,
        onWarning,
        onError,
    } = opts;

    if (!client || typeof client !== 'object') {
        throw new TypeError('[sdk/quota-monitor] client é obrigatório e deve ser um CopilotClient válido.');
    }
    if (typeof intervalMs !== 'number' || intervalMs < 1000) {
        throw new RangeError('[sdk/quota-monitor] intervalMs deve ser >= 1000ms.');
    }

    /** @type {Record<string, QuotaSnapshot>} */
    let _snapshots = {};
    let _ts = 0;
    /** @type {ReturnType<typeof setInterval> | null} */
    let _timer = null;
    const _timerId = `sdk.quota-monitor:${Math.random().toString(36).slice(2)}`;

    /**
     * @returns {Promise<Record<string, QuotaSnapshot>>}
     */
    async function _fetch() {
        const result = await accountGetQuota(client);
        _snapshots = result.quotaSnapshots;
        _ts = Date.now();

        if (typeof onUpdate === 'function') {
            onUpdate(_snapshots);
        }

        if (typeof onWarning === 'function') {
            for (const [quotaId, snap] of Object.entries(_snapshots)) {
                if (snap.remainingPercentage <= warningThreshold) {
                    onWarning(quotaId, snap);
                }
            }
        }

        return _snapshots;
    }

    return {
        start() {
            if (_timer !== null) return;
            // Poll imediato ao iniciar
            _fetch().catch((err) => {
                if (typeof onError === 'function') {
                    onError(toError(err));
                }
            });
            _timer = registerApplicationInterval(
                _timerId,
                () => {
                    _fetch().catch((err) => {
                        if (typeof onError === 'function') {
                            onError(toError(err));
                        }
                    });
                },
                intervalMs,
            );
            // Não bloquear processo
            if (
                typeof _timer === 'object' &&
                _timer !== null &&
                typeof (/** @type {{ unref?: () => void }} */ (_timer).unref) === 'function'
            ) {
                /** @type {{ unref: () => void }} */ (_timer).unref();
            }
        },

        stop() {
            if (_timer !== null) {
                cancelApplicationTimer(_timerId);
                _timer = null;
            }
        },

        status() {
            return { snapshots: _snapshots, ts: _ts, running: _timer !== null };
        },

        poll() {
            return _fetch();
        },
    };
}
