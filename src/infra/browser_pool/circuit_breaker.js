// @ts-check
import { log } from '#core/logger';

/**
 * Causas de falha (7 cenários)
 */
const FailureCause = Object.freeze({
    USER_CLOSED: 'USER_CLOSED',
    TECHNICAL_CRASH: 'TECHNICAL_CRASH',
    CHROME_RESTARTED: 'CHROME_RESTARTED',
    NETWORK_ISSUE: 'NETWORK_ISSUE',
    PROXY_FAILURE: 'PROXY_FAILURE',
    OUT_OF_MEMORY: 'OUT_OF_MEMORY',
    PROCESS_SUSPENDED: 'PROCESS_SUSPENDED',
    UNKNOWN: 'UNKNOWN',
});

/**
 * Estados do Circuit Breaker
 */
const CircuitState = Object.freeze({
    OPERATIONAL: 'OPERATIONAL', // 3/3 healthy
    DEGRADED: 'DEGRADED', // 1-2 healthy
    CIRCUIT_OPEN: 'CIRCUIT_OPEN', // 0 healthy, sistema pausado
});

// Gerenciador inteligente de falhas do Chrome.
/** Classe exportada: CircuitBreakerManager. */
class CircuitBreakerManager {
    constructor({ poolSize = 3, nerv = null }) {
        this.poolSize = poolSize;
        this.nerv = nerv; // NERV bus para emitir eventos

        // Estado atual
        /** @type {string} */
        this.state = CircuitState.OPERATIONAL;
        this.lastStateChange = Date.now();

        // Histórico de falhas (últimas 10)
        this.failureHistory = [];
        this.maxHistorySize = 10;

        // Tracking de tentativas de recovery
        this.recoveryAttempts = 0;
        this.maxRecoveryAttempts = 3;

        // Timestamps de falhas (para detectar simultaneidade)
        this.instanceFailures = new Map(); // instanceId -> { timestamp, error }

        // Última causa detectada
        this.lastCause = null;

        // Políticas por causa
        this.policies = {
            [FailureCause.USER_CLOSED]: {
                shouldPause: true,
                autoRestart: false,
                pollingInterval: 5000,
                maxRetries: Infinity,
            },
            [FailureCause.TECHNICAL_CRASH]: {
                shouldPause: true,
                autoRestart: true,
                pollingInterval: 10000,
                maxRetries: 3,
            },
            [FailureCause.CHROME_RESTARTED]: {
                shouldPause: false, // Momentâneo
                autoRestart: true,
                pollingInterval: 1000,
                maxRetries: 5,
            },
            [FailureCause.NETWORK_ISSUE]: {
                shouldPause: false, // Degraded mode OK
                autoRestart: false,
                pollingInterval: 2000,
                maxRetries: Infinity, // Por instância
            },
            [FailureCause.PROXY_FAILURE]: {
                shouldPause: true,
                autoRestart: true, // PM2 restart
                pollingInterval: 5000,
                maxRetries: 3,
            },
            [FailureCause.OUT_OF_MEMORY]: {
                shouldPause: true,
                autoRestart: false, // Requer intervenção manual
                pollingInterval: 0, // Manual recovery
                maxRetries: 0,
            },
            [FailureCause.PROCESS_SUSPENDED]: {
                shouldPause: false, // Momentâneo
                autoRestart: false,
                pollingInterval: 10000,
                maxRetries: 10,
            },
            [FailureCause.UNKNOWN]: {
                shouldPause: true,
                autoRestart: false,
                pollingInterval: 5000,
                maxRetries: 3,
            },
        };
    }

    /**
     * Registra falha de uma instância e detecta causa.
     *
     * @param {string} instanceId - ID da instância (ex: "browser-0")
     * @param {Error} error - Erro capturado
     * @param {object} context - Contexto adicional (browser version, PID, etc.)
     * @returns {object} - { cause, shouldPause, policy }
     */
    registerFailure(instanceId, error, context = {}) {
        const timestamp = Date.now();

        // Registra falha no histórico
        this.instanceFailures.set(instanceId, { timestamp, error, context });

        // Detecta causa da falha
        const cause = this._detectFailureCause(error, context);
        this.lastCause = cause;

        // Adiciona ao histórico
        this.failureHistory.push({
            instanceId,
            cause,
            error: error.message,
            timestamp,
            context,
        });

        // Limita histórico
        if (this.failureHistory.length > this.maxHistorySize) {
            this.failureHistory.shift();
        }

        // Atualiza estado do Circuit Breaker
        const healthyCount = this._getHealthyCount();
        const previousState = this.state;

        if (healthyCount === 0) {
            this.state = CircuitState.CIRCUIT_OPEN;
        } else if (healthyCount < this.poolSize) {
            this.state = CircuitState.DEGRADED;
        } else {
            this.state = CircuitState.OPERATIONAL;
        }

        // Emite evento se estado mudou
        if (previousState !== this.state) {
            this._emitStateChange(previousState, this.state, cause);
        }

        // Obtém política para esta causa
        const policy = this.policies[cause];

        log('WARN', `[CircuitBreaker] Falha registrada: ${instanceId} - Causa: ${cause} - Estado: ${this.state}`);
        log(
            'DEBUG',
            `[CircuitBreaker] Política: pause=${policy.shouldPause}, autoRestart=${policy.autoRestart}, polling=${policy.pollingInterval}ms`
        );

        return {
            cause,
            shouldPause: policy.shouldPause,
            policy,
            state: this.state,
        };
    }

    /**
     * Detecta causa da falha baseado em sintomas.
     *
     * @param {Error} error - Erro capturado
     * @param {object} context - Contexto (browser, version, PID, etc.)
     * @returns {string} - FailureCause
     */
    _detectFailureCause(error, context = {}) {
        const errorMsg = error.message || '';
        const errorStack = error.stack || '';

        // 1. PROXY_FAILURE - Erro de conexão na porta 9224
        if (errorMsg.includes('ECONNREFUSED') && errorMsg.includes('9224')) {
            return FailureCause.PROXY_FAILURE;
        }

        // 2. USER_CLOSED - Todas instâncias falharam simultaneamente (< 5s)
        if (this._isSimultaneousFailure()) {
            if (errorMsg.includes('Browser disconnected') || errorMsg.includes('Target closed')) {
                return FailureCause.USER_CLOSED;
            }
        }

        // 3. TECHNICAL_CRASH - Crash interno do Chrome
        if (errorMsg.includes('crashed') || errorStack.includes('browser crashed')) {
            return FailureCause.TECHNICAL_CRASH;
        }

        // 4. CHROME_RESTARTED - Versão ou PID mudou mas porta OK
        if (context.versionChanged || context.pidChanged) {
            return FailureCause.CHROME_RESTARTED;
        }

        // 5. OUT_OF_MEMORY - Cannot create page ou memória alta
        if (errorMsg.includes('Cannot create') || context.memoryHigh) {
            return FailureCause.OUT_OF_MEMORY;
        }

        // 6. NETWORK_ISSUE - Timeout mas não disconnect
        if (errorMsg.includes('timeout') && !errorMsg.includes('disconnect')) {
            return FailureCause.NETWORK_ISSUE;
        }

        // 7. PROCESS_SUSPENDED - PID existe mas porta não responde
        if (context.pidExists && context.portNotResponding && !errorMsg.includes('disconnect')) {
            return FailureCause.PROCESS_SUSPENDED;
        }

        return FailureCause.UNKNOWN;
    }

    /**
     * Verifica se falhas foram simultâneas (< 5s diferença).
     * Indica fechamento manual do Chrome.
     */
    _isSimultaneousFailure() {
        if (this.instanceFailures.size < 2) {
            return false;
        }

        const timestamps = Array.from(this.instanceFailures.values()).map(f => f.timestamp);
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);

        return maxTime - minTime < 5000; // 5 segundos
    }

    /**
     * Conta instâncias saudáveis.
     * (Assume que instâncias NÃO em instanceFailures estão OK)
     */
    _getHealthyCount() {
        return this.poolSize - this.instanceFailures.size;
    }

    /**
     * Registra recovery de uma instância.
     */
    registerRecovery(instanceId) {
        this.instanceFailures.delete(instanceId);

        const healthyCount = this._getHealthyCount();
        const previousState = this.state;

        if (healthyCount === this.poolSize) {
            this.state = CircuitState.OPERATIONAL;
            this.recoveryAttempts = 0; // Reset tentativas
        } else if (healthyCount > 0) {
            this.state = CircuitState.DEGRADED;
        }

        if (previousState !== this.state) {
            this._emitStateChange(previousState, this.state, 'RECOVERED');
        }

        log(
            'INFO',
            `[CircuitBreaker] Recovery: ${instanceId} - Estado: ${this.state} (${healthyCount}/${this.poolSize})`
        );
    }

    /**
     * Verifica se deve pausar o sistema.
     */
    shouldPauseSystem() {
        if (this.state !== CircuitState.CIRCUIT_OPEN) {
            return false;
        }

        if (!this.lastCause) {
            return true; // Pausa por padrão se causa desconhecida
        }

        const policy = this.policies[this.lastCause];
        return policy.shouldPause;
    }

    /**
     * Verifica se deve tentar auto-restart.
     */
    shouldAttemptRestart() {
        if (!this.lastCause) {
            return false;
        }

        const policy = this.policies[this.lastCause];

        if (!policy.autoRestart) {
            return false;
        }

        if (this.recoveryAttempts >= policy.maxRetries) {
            log(
                'WARN',
                `[CircuitBreaker] Max recovery attempts (${policy.maxRetries}) atingido para ${this.lastCause}`
            );
            return false;
        }

        return true;
    }

    /**
     * Incrementa contador de tentativas de recovery.
     */
    incrementRecoveryAttempts() {
        this.recoveryAttempts++;
        log('INFO', `[CircuitBreaker] Recovery attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts}`);
    }

    /**
     * Obtém intervalo de polling para recovery.
     */
    getPollingInterval() {
        if (!this.lastCause) {
            return 5000; // Default 5s
        }

        const policy = this.policies[this.lastCause];
        return policy.pollingInterval;
    }

    /**
     * Emite evento NERV quando estado muda.
     */
    _emitStateChange(previousState, newState, cause) {
        this.lastStateChange = Date.now();

        const event = {
            type: 'CHROME_CIRCUIT_BREAKER',
            action: 'STATE_CHANGE',
            payload: {
                previousState,
                newState,
                cause,
                timestamp: this.lastStateChange,
                healthyCount: this._getHealthyCount(),
                totalInstances: this.poolSize,
            },
        };

        log('WARN', `[CircuitBreaker] 🔴 Estado mudou: ${previousState} → ${newState} (Causa: ${cause})`);

        if (this.nerv) {
            this.nerv.emit(event);
        }

        // Mensagem específica para usuário
        if (newState === CircuitState.CIRCUIT_OPEN) {
            this._logUserMessage(cause);
        }
    }

    /**
     * Mensagens amigáveis para usuário por causa.
     */
    _logUserMessage(cause) {
        const messages = {
            [FailureCause.USER_CLOSED]: `
┌────────────────────────────────────────────────────────────┐
│ ⚠️  CHROME FECHADO                                         │
├────────────────────────────────────────────────────────────┤
│ Detectado: Você fechou o Chrome manualmente                │
│ Ação: Sistema PAUSADO (não irá reabrir automaticamente)   │
│ Retomar: Reabra o Chrome com START-CHROME-SIMPLE.bat      │
│          Sistema retomará automaticamente                  │
└────────────────────────────────────────────────────────────┘`,

            [FailureCause.TECHNICAL_CRASH]: `
┌────────────────────────────────────────────────────────────┐
│ 💥 CHROME CRASHOU                                          │
├────────────────────────────────────────────────────────────┤
│ Detectado: Crash técnico do Chrome                         │
│ Ação: Tentando auto-recovery (máx 3x)                     │
│ Manual: Se continuar, reinicie Chrome manualmente          │
└────────────────────────────────────────────────────────────┘`,

            [FailureCause.PROXY_FAILURE]: `
┌────────────────────────────────────────────────────────────┐
│ 🔌 CHROME PROXY DOWN                                       │
├────────────────────────────────────────────────────────────┤
│ Detectado: Chrome Proxy Service não responde (porta 9224) │
│ Ação: Verificando PM2 chrome-proxy                        │
│ Manual: pm2 restart chrome-proxy                           │
└────────────────────────────────────────────────────────────┘`,

            [FailureCause.OUT_OF_MEMORY]: `
┌────────────────────────────────────────────────────────────┐
│ 💾 MEMÓRIA INSUFICIENTE                                    │
├────────────────────────────────────────────────────────────┤
│ Detectado: Chrome sem memória para criar páginas          │
│ Ação: PAUSADO - Requer intervenção manual                 │
│ Solução: Feche abas do Chrome ou reinicie o processo      │
└────────────────────────────────────────────────────────────┘`,
        };

        const message =
            messages[cause] ||
            `
┌────────────────────────────────────────────────────────────┐
│ ❓ FALHA DESCONHECIDA                                      │
├────────────────────────────────────────────────────────────┤
│ Causa: ${cause}                                             │
│ Ação: Sistema PAUSADO                                     │
│ Manual: Investigue logs e reinicie Chrome                  │
└────────────────────────────────────────────────────────────┘`;

        log('WARN', message);
    }

    /**
     * Retorna status atual completo.
     */
    getStatus() {
        return {
            state: this.state,
            lastCause: this.lastCause,
            healthyCount: this._getHealthyCount(),
            totalInstances: this.poolSize,
            recoveryAttempts: this.recoveryAttempts,
            maxRecoveryAttempts: this.maxRecoveryAttempts,
            lastStateChange: this.lastStateChange,
            failureHistory: this.failureHistory.slice(-5), // Últimas 5
            isPaused: this.shouldPauseSystem(),
        };
    }

    /**
     * Reset manual do Circuit Breaker.
     */
    reset() {
        log('INFO', '[CircuitBreaker] 🔄 Reset manual solicitado');
        this.instanceFailures.clear();
        this.recoveryAttempts = 0;
        this.state = CircuitState.OPERATIONAL;
        this.lastCause = null;
    }
}

export { CircuitBreakerManager, FailureCause, CircuitState };
