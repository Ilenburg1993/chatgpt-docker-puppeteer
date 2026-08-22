// @ts-check
/**
 * Prioridades canônicas do graceful shutdown Copilot.
 *
 * Menor número executa primeiro. A ordem preserva o comportamento histórico atual, mas deixa o contrato explícito para
 * novos handlers não escolherem números mágicos.
 *
 * @module copilot/core/shutdown-priorities
 */

export const SHUTDOWN_PRIORITY = Object.freeze({
    COMPAT_RUNTIME_HOST: 0,
    TIMERS_EARLY: 5,
    RUNTIME_CRITICAL: 10,
    RUNTIME_STATE_DRAIN: 5,
    APPLICATION_INFRA: 13,
    TERMINAL_RESOURCE: 15,
    TERMINAL_ACTIVITY: 16,
    NETWORK: 20,
    CACHE_PERSISTENCE: 14,
    DATABASE: 15,
    OBSERVABILITY_BUS: 40,
    OBSERVABILITY_TRACKER: 45,
    OBSERVABILITY_DETACH: 46,
    DEFAULT: 50,
    AUDIT_FINALIZER: 90,
});
