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
  EVENT: 'EVENT',     // Observação registrada de algo ocorrido
  ACK: 'ACK'          // Confirmação técnica de transporte
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
  // ---- TASK / EXECUTION (examples) ----
  TASK_START: 'TASK_START',
  TASK_CANCEL: 'TASK_CANCEL',
  TASK_OBSERVED: 'TASK_OBSERVED',
  TASK_FAILED_OBSERVED: 'TASK_FAILED_OBSERVED',

  // ---- DRIVER / ENVIRONMENT (observational) ----
  DRIVER_ANOMALY: 'DRIVER_ANOMALY',
  DRIVER_STATE_OBSERVED: 'DRIVER_STATE_OBSERVED',

  // ---- TRANSPORT / IPC (technical events) ----
  TRANSPORT_TIMEOUT: 'TRANSPORT_TIMEOUT',
  TRANSPORT_RETRYING: 'TRANSPORT_RETRYING',
  CHANNEL_DEGRADED: 'CHANNEL_DEGRADED',

  // ---- ACK (technical only) ----
  ACK_RECEIVED: 'ACK_RECEIVED'
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
  OBSERVER: 'OBSERVER'
  // Explicitamente ausentes:
  // - DRIVER
  // - DASHBOARD
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