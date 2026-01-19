FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\shared\ipc\constants.js
PASTA_BASE: shared
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/shared/ipc/constants.js
   Audit Level: 500 — IPC 2.0 Canonical Vocabulary
   Status: CONSTITUTIONALLY STABLE
   Responsabilidade: Gramática formal e imutável do IPC 2.0.
   Nota: Este arquivo é a ÚNICA fonte de verdade. Não edite sem consenso.
========================================================================== */

/**
 * --------------------------------------------------------------------------
 * PROTOCOL
 * --------------------------------------------------------------------------
 * Versão explícita do protocolo IPC.
 * Usada para Handshake e validação de compatibilidade.
 */
const PROTOCOL_VERSION = '2.0.0';

/**
 * --------------------------------------------------------------------------
 * ACTOR ROLE (IDENTITY)
 * --------------------------------------------------------------------------
 * Quem tem permissão de falar no barramento.
 */
const ActorRole = Object.freeze({
  SERVER: 'SERVER',         // Mission Control (O Comandante)
  MAESTRO: 'MAESTRO',       // O Agente/Robô (O Executor)
  SUPERVISOR: 'SUPERVISOR', // O Monitor de Autocura (O Médico)
  GUEST: 'GUEST'            // Conexão não autenticada
});

/**
 * --------------------------------------------------------------------------
 * MESSAGE TYPE (ONTOLOGICAL)
 * --------------------------------------------------------------------------
 * Define a natureza fundamental da mensagem.
 */
const MessageType = Object.freeze({
  COMMAND: 'COMMAND', // Intenção imperativa (Requer ACK)
  EVENT: 'EVENT',     // Fato consumado (Fire-and-forget ou Stream)
  ACK: 'ACK'          // Confirmação técnica de recebimento
});

/**
 * --------------------------------------------------------------------------
 * ACTION CODE (SEMANTICS)
 * --------------------------------------------------------------------------
 * O verbo da frase. Define o que deve ser feito ou o que aconteceu.
 */
const ActionCode = Object.freeze({
  // -- SISTEMA NERVOSO (Conexão & Diagnóstico) --
  HANDSHAKE: 'HANDSHAKE',
  HEARTBEAT: 'HEARTBEAT',
  DISCONNECT: 'DISCONNECT',
  
  // -- GESTÃO DE TAREFAS (Comandos do Servidor) --
  PROPOSE_TASK: 'PROPOSE_TASK',     // Servidor oferece tarefa
  ABORT_TASK: 'ABORT_TASK',         // Servidor manda matar tarefa
  
  // -- CICLO DE VIDA (Eventos do Maestro) --
  TASK_ACCEPTED: 'TASK_ACCEPTED',   // Maestro aceitou o desafio
  TASK_REJECTED: 'TASK_REJECTED',   // Maestro recusou (ocupado/incapaz)
  TASK_UPDATE: 'TASK_UPDATE',       // Progresso parcial
  TASK_COMPLETED: 'TASK_COMPLETED', // Sucesso final
  TASK_FAILED: 'TASK_FAILED',       // Falha irrecuperável
  
  // -- TELEMETRIA & OBSERVAÇÃO --
  OBSERVATION: 'OBSERVATION',       // Dado sensorial bruto (logs, métricas)
  STATE_SNAPSHOT: 'STATE_SNAPSHOT'  // Dump completo do estado interno
});

/**
 * --------------------------------------------------------------------------
 * TECHNICAL CODE (DIAGNOSTIC)
 * --------------------------------------------------------------------------
 * Códigos para ACKs e NACKs.
 */
const TechnicalCode = Object.freeze({
  // Sucessos
  ACCEPTED: 'ACCEPTED',
  QUEUED: 'QUEUED',
  
  // Erros de Protocolo (NACKs)
  UNKNOWN_ACTOR: 'UNKNOWN_ACTOR',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  RATE_LIMITED: 'RATE_LIMITED',
  
  // Erros de Estado
  BUSY: 'BUSY',
  IDLE: 'IDLE'
});

/**
 * --------------------------------------------------------------------------
 * CHANNEL STATE
 * --------------------------------------------------------------------------
 * Estados da máquina de conexão do NERV.
 */
const ChannelState = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  HANDSHAKING: 'HANDSHAKING',
  READY: 'READY',
  DRAINING: 'DRAINING' // Encerrando, não aceita novos comandos
});

// Exportação Congelada (Imutabilidade garantida em Runtime)
module.exports = Object.freeze({
  PROTOCOL_VERSION,
  ActorRole,
  MessageType,
  ActionCode,
  TechnicalCode,
  ChannelState
});