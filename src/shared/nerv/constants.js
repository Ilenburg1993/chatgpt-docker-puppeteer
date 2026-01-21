/* ==========================================================================
   src/shared/nerv/constants.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: Protocol (Linguagem Universal)
   Audit Level: 500 — NERV Protocol Canonical Vocabulary
   Status: CONSTITUTIONAL (Singularity Edition)

   Responsabilidade: Gramática formal do protocolo NERV
   - Define MessageType (ontologia: COMMAND, EVENT, ACK)
   - Define ActionCode (vocabulário semântico extensível)
   - Define ActorRole (identidade dos subsistemas)
   - Estabelece versão do protocolo (PROTOCOL_VERSION: '2.0.0')
========================================================================== */

/**
 * --------------------------------------------------------------------------
 * PROTOCOL
 * --------------------------------------------------------------------------
 * Versão explícita do protocolo IPC.
 * Nunca inferida. Nunca omitida.
 */
const PROTOCOL_VERSION = '2.0.0';

/**
 * --------------------------------------------------------------------------
 * MESSAGE TYPE (ONTOLOGICAL)
 * --------------------------------------------------------------------------
 * Define O QUE a mensagem É.
 * Conjunto fechado. Nunca extensível.
 */
const MessageType = Object.freeze({
    COMMAND: 'COMMAND', // Intenção declarada de ação futura
    EVENT: 'EVENT', // Observação registrada de algo ocorrido
    ACK: 'ACK' // Confirmação técnica de transporte
});

/**
 * --------------------------------------------------------------------------
 * ACTION CODE (REFERENTIAL)
 * --------------------------------------------------------------------------
 * Define SOBRE O QUE a mensagem fala.
 * Extensível apenas por adição explícita.
 * Nunca redefine o tipo ontológico.
 */
const ActionCode = Object.freeze({
    // ---- TASK / EXECUTION ----
    TASK_START: 'TASK_START',
    TASK_CANCEL: 'TASK_CANCEL',
    TASK_RETRY: 'TASK_RETRY',
    TASK_FAILED: 'TASK_FAILED', // Task execution failed
    TASK_REJECTED: 'TASK_REJECTED', // Task rejected by policy
    TASK_OBSERVED: 'TASK_OBSERVED', // (Planned for future use)
    TASK_FAILED_OBSERVED: 'TASK_FAILED_OBSERVED', // (Planned for future use)

    // ---- PROPOSAL / POLICY ----
    PROPOSE_TASK: 'PROPOSE_TASK', // Policy engine task proposal

    // ---- ENGINE CONTROL ----
    ENGINE_PAUSE: 'ENGINE_PAUSE',
    ENGINE_RESUME: 'ENGINE_RESUME',
    ENGINE_STOP: 'ENGINE_STOP',

    // ---- DRIVER / TASK EXECUTION ----
    DRIVER_EXECUTE_TASK: 'DRIVER_EXECUTE_TASK',
    DRIVER_ABORT: 'DRIVER_ABORT',
    DRIVER_TASK_STARTED: 'DRIVER_TASK_STARTED',
    DRIVER_TASK_COMPLETED: 'DRIVER_TASK_COMPLETED',
    DRIVER_TASK_FAILED: 'DRIVER_TASK_FAILED',
    DRIVER_TASK_ABORTED: 'DRIVER_TASK_ABORTED',

    // ---- DRIVER / HEALTH & MONITORING ----
    DRIVER_HEALTH_CHECK: 'DRIVER_HEALTH_CHECK',
    DRIVER_HEALTH_REPORT: 'DRIVER_HEALTH_REPORT',
    DRIVER_STATE_OBSERVED: 'DRIVER_STATE_OBSERVED',
    DRIVER_VITAL: 'DRIVER_VITAL',
    DRIVER_ANOMALY: 'DRIVER_ANOMALY',
    DRIVER_ERROR: 'DRIVER_ERROR',

    // ---- KERNEL / SYSTEM ----
    KERNEL_HEALTH_CHECK: 'KERNEL_HEALTH_CHECK',
    KERNEL_TELEMETRY: 'KERNEL_TELEMETRY',
    KERNEL_INTERNAL_ERROR: 'KERNEL_INTERNAL_ERROR',

    // ---- BROWSER / INFRA ----
    BROWSER_REBOOT: 'BROWSER_REBOOT',
    CACHE_CLEAR: 'CACHE_CLEAR',
    STALL_DETECTED: 'STALL_DETECTED',

    // ---- SECURITY ----
    SECURITY_VIOLATION: 'SECURITY_VIOLATION',

    // ---- TELEMETRY ----
    TELEMETRY_DISCARDED: 'TELEMETRY_DISCARDED',

    // ---- TRANSPORT / IPC (technical events - planned) ----
    TRANSPORT_TIMEOUT: 'TRANSPORT_TIMEOUT', // (Planned for future use)
    TRANSPORT_RETRYING: 'TRANSPORT_RETRYING', // (Planned for future use)
    CHANNEL_DEGRADED: 'CHANNEL_DEGRADED', // (Planned for future use)

    // ---- ACK (technical only - planned) ----
    ACK_RECEIVED: 'ACK_RECEIVED' // (Planned for future use)
});

/**
 * --------------------------------------------------------------------------
 * ACTOR ROLE
 * --------------------------------------------------------------------------
 * Define QUEM emite a mensagem.
 * Não define soberania. Não define decisão.
 */
const ActorRole = Object.freeze({
    KERNEL: 'KERNEL',
    SERVER: 'SERVER',
    INFRA: 'INFRA',
    OBSERVER: 'OBSERVER',
    MAESTRO: 'MAESTRO', // Policy Engine (decision maker)
    DRIVER: 'DRIVER' // Driver adapters (ChatGPT/Gemini)
});

/**
 * --------------------------------------------------------------------------
 * CHANNEL STATE (TECHNICAL)
 * --------------------------------------------------------------------------
 * Estados técnicos do cliente IPC.
 * Não possuem semântica de mundo.
 */
const ChannelState = Object.freeze({
    INACTIVE: 'INACTIVE',
    HANDSHAKE: 'HANDSHAKE',
    ACTIVE: 'ACTIVE',
    DEGRADED: 'DEGRADED',
    SILENT: 'SILENT'
});

/**
 * --------------------------------------------------------------------------
 * TECHNICAL CODE (DIAGNOSTIC)
 * --------------------------------------------------------------------------
 * Códigos auxiliares puramente técnicos.
 * Nunca utilizados para decisão de negócio.
 */
const TechnicalCode = Object.freeze({
    BUFFERED: 'BUFFERED',
    REPLAYED: 'REPLAYED',
    DELIVERED: 'DELIVERED',
    DROPPED: 'DROPPED',
    HANDSHAKE_FAILED: 'HANDSHAKE_FAILED'
});

/**
 * --------------------------------------------------------------------------
 * EXPLICIT PROHIBITIONS (DOCUMENTARY, NOT ENUMERABLE)
 * --------------------------------------------------------------------------
 * Não existem no vocabulário do IPC 2.0:
 * - RESPONSE
 * - RESULT
 * - SUCCESS
 * - FAILURE (semântico)
 * - RETURN_VALUE
 * - EXCEPTION (de negócio)
 *
 * A ausência estrutural desses termos é constitucional.
 */

module.exports = Object.freeze({
    PROTOCOL_VERSION,
    MessageType,
    ActionCode,
    ActorRole,
    ChannelState,
    TechnicalCode
});
