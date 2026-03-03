// @ts-check

import { retryWithBackoff } from '#core/retry_policy';

/** @typedef {'ready'|'degraded'|'not-ready'|'stopped'} OllamaHostState */
/**
 * @typedef {object} OllamaHostSupervisorOptions
 * @property {string} [baseUrl]
 * @property {typeof fetch} [fetch]
 * @property {number} [pollMs]
 * @property {number} [requestTimeoutMs]
 * @property {boolean} [circuitEnabled]
 * @property {number} [circuitThreshold]
 * @property {number} [circuitTimeoutMs]
 * @property {boolean} [retryEnabled]
 * @property {() => number} [now]
 * @property {typeof setInterval} [setIntervalFn]
 * @property {typeof clearInterval} [clearIntervalFn]
 * @property {(level: string, message: string, data?: unknown) => void | null} [logger]
 * @property {(state: ReturnType<OllamaHostSupervisor['getState']>) => void | null} [onStateChange]
 * @property {{ upsert?: (payload: unknown) => unknown, setState?: (id: string, state: unknown, details?: unknown) => unknown } | null} [resourceHooks]
 */

function parseBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const v = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return fallback;
}

function parseIntPos(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {string} baseUrl
 */
function buildVersionUrl(baseUrl) {
    return `${String(baseUrl || '').replace(/\/$/, '')}/api/version`;
}

/**
 * Supervisor de saúde do host Ollama local.
 * Monitora disponibilidade, estado do circuit breaker e publica mudanças de estado.
 */
export class OllamaHostSupervisor {
    /**
     * @param {OllamaHostSupervisorOptions} [options]
     */
    constructor(options = {}) {
        this.baseUrl =
            options.baseUrl ||
            process.env.OLLAMA_LOCAL_BASE_URL ||
            process.env.OLLAMA_BASE_URL ||
            'http://host.docker.internal:11434';
        this.fetch = options.fetch || globalThis.fetch;
        this.pollMs = parseIntPos(options.pollMs ?? process.env.OLLAMA_HEALTH_POLL_MS, 5000);
        this.requestTimeoutMs = parseIntPos(options.requestTimeoutMs ?? process.env.OLLAMA_HEALTH_TIMEOUT, 5000);
        this.circuitEnabled = parseBool(options.circuitEnabled ?? process.env.OLLAMA_CIRCUIT_BREAKER_ENABLED, true);
        this.circuitThreshold = parseIntPos(
            options.circuitThreshold ?? process.env.OLLAMA_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            5
        );
        this.circuitTimeoutMs = parseIntPos(
            options.circuitTimeoutMs ?? process.env.OLLAMA_CIRCUIT_BREAKER_TIMEOUT,
            60000
        );
        this.retryEnabled = parseBool(options.retryEnabled, true);
        this.now = options.now || (() => Date.now());
        this.setIntervalFn = options.setIntervalFn || setInterval;
        this.clearIntervalFn = options.clearIntervalFn || clearInterval;
        this.logger = options.logger || null;
        this.onStateChange = options.onStateChange || null;
        this.resourceHooks = options.resourceHooks || null;

        this._timer = null;
        this._running = false;
        this._pollInFlight = false;
        this._consecutiveFailures = 0;
        this._circuitOpenUntil = 0;
        this._state = /** @type {OllamaHostState} */ ('stopped');
        this._last = {
            ok: false,
            version: null,
            statusCode: null,
            checkedAt: 0,
            error: null,
            circuitOpen: false,
        };
    }

    _log(level, message, data) {
        if (this.logger) this.logger(level, message, data);
    }

    _emitState() {
        const state = this.getState();
        if (this.onStateChange) this.onStateChange(state);
        if (this.resourceHooks?.upsert) {
            this.resourceHooks.upsert({
                id: 'ollama_host',
                owner: 'dashboard-web',
                criticality: 'optional',
                state: state.state,
                reasonCode: state.reasonCode,
                message: state.message,
                health: () => this.getState(),
            });
        } else if (this.resourceHooks?.setState) {
            this.resourceHooks.setState('ollama_host', state.state, {
                owner: 'dashboard-web',
                criticality: 'optional',
                reasonCode: state.reasonCode,
                message: state.message,
            });
        }
    }

    getState() {
        const circuitOpen = this.circuitEnabled && this.now() < this._circuitOpenUntil;
        const reasonCode =
            this._state === 'ready'
                ? null
                : circuitOpen
                  ? 'OLLAMA_CIRCUIT_OPEN'
                  : this._last.error
                    ? 'OLLAMA_HOST_UNREACHABLE'
                    : this._state === 'stopped'
                      ? 'OLLAMA_SUPERVISOR_STOPPED'
                      : 'OLLAMA_HOST_DEGRADED';
        return {
            state: this._state,
            reasonCode,
            message: this._last.error || (circuitOpen ? 'circuit open' : null),
            baseUrl: this.baseUrl,
            pollMs: this.pollMs,
            requestTimeoutMs: this.requestTimeoutMs,
            circuitEnabled: this.circuitEnabled,
            circuitThreshold: this.circuitThreshold,
            circuitTimeoutMs: this.circuitTimeoutMs,
            consecutiveFailures: this._consecutiveFailures,
            circuitOpenUntil: this._circuitOpenUntil,
            last: { ...this._last },
            running: this._running,
        };
    }

    async _probeOnce() {
        if (typeof this.fetch !== 'function') {
            throw new Error('Fetch API indisponível no runtime');
        }
        const url = buildVersionUrl(this.baseUrl);
        const response = await this.fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => 'unknown');
            throw Object.assign(new Error(`HTTP ${response.status}: ${text}`), { statusCode: response.status });
        }
        const json = await response.json().catch(() => ({}));
        return {
            version: typeof json?.version === 'string' ? json.version : null,
            statusCode: response.status,
        };
    }

    async pollOnce() {
        if (this._pollInFlight) {
            return this.getState();
        }
        this._pollInFlight = true;
        try {
            const now = this.now();
            if (this.circuitEnabled && now < this._circuitOpenUntil) {
                this._state = 'degraded';
                this._last = {
                    ...this._last,
                    ok: false,
                    checkedAt: now,
                    circuitOpen: true,
                    error: 'circuit open',
                };
                this._emitState();
                return this.getState();
            }

            const probe = async () => this._probeOnce();
            const result = this.retryEnabled
                ? await retryWithBackoff(probe, {
                      maxAttempts: 2,
                      baseDelayMs: 200,
                      maxDelayMs: 500,
                  })
                : await probe();

            this._consecutiveFailures = 0;
            this._state = 'ready';
            this._last = {
                ok: true,
                version: result.version,
                statusCode: result.statusCode,
                checkedAt: this.now(),
                error: null,
                circuitOpen: false,
            };
            this._emitState();
            return this.getState();
        } catch (error) {
            this._consecutiveFailures += 1;
            if (this.circuitEnabled && this._consecutiveFailures >= this.circuitThreshold) {
                this._circuitOpenUntil = this.now() + this.circuitTimeoutMs;
            }
            this._state = 'degraded';
            this._last = {
                ok: false,
                version: null,
                statusCode: /** @type {any} */ (error)?.statusCode ?? null,
                checkedAt: this.now(),
                error: error?.message || String(error),
                circuitOpen: this.circuitEnabled && this.now() < this._circuitOpenUntil,
            };
            this._emitState();
            this._log('WARN', '[OllamaHostSupervisor] probe failed', { error: this._last.error });
            return this.getState();
        } finally {
            this._pollInFlight = false;
        }
    }

    async start() {
        if (this._running) return this.getState();
        this._running = true;
        this._state = 'degraded';
        this._emitState();
        await this.pollOnce();
        this._timer = this.setIntervalFn(() => {
            void this.pollOnce();
        }, this.pollMs);
        return this.getState();
    }

    async stop() {
        this._running = false;
        if (this._timer) {
            this.clearIntervalFn(this._timer);
            this._timer = null;
        }
        this._state = 'stopped';
        this._last = {
            ...this._last,
            ok: false,
            checkedAt: this.now(),
            error: null,
            circuitOpen: false,
        };
        this._emitState();
        return this.getState();
    }
}

/**
 * Cria uma instância do supervisor de host Ollama.
 * @param {OllamaHostSupervisorOptions} [options]
 * @returns {OllamaHostSupervisor}
 */
export function createOllamaHostSupervisor(options = {}) {
    return new OllamaHostSupervisor(options);
}
