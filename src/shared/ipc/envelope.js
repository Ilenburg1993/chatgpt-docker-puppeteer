/* ==========================================================================
   src/shared/ipc/envelope.js
   Audit Level: 510 — IPC 2.0 Canonical Envelope factory
   Status: CONSTITUTIONAL
   Responsabilidade: Fábrica de envelopes imutáveis e verificação de integridade
                     estrutural básica na origem.
========================================================================== */

const { v4: uuidv4 } = require('uuid');
const {
  PROTOCOL_VERSION,
  MessageType,
  ActorRole,
  ActionCode
} = require('./constants');

/**
 * Garante que uma condição é verdadeira ou explode com erro de protocolo.
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`[IPC ENVELOPE VIOLATION] ${message}`);
  }
}

/**
 * Congela o objeto profundamente para evitar mutações acidentais (Side Effects).
 * Isso garante que o envelope que sai do Kernel é IDÊNTICO ao que entra no NERV.
 */
function deepFreeze(obj) {
  // Recupera as propriedades definidas no objeto
  const propNames = Object.getOwnPropertyNames(obj);

  // Congela as propriedades antes de congelar o próprio objeto
  for (const name of propNames) {
    const value = obj[name];

    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }

  return Object.freeze(obj);
}

/**
 * FÁBRICA CANÔNICA DE ENVELOPES
 * * @param {object} params
 * @param {string} params.actor - Quem está enviando (ActorRole).
 * @param {string} params.target - Para quem é (ActorRole ou ID específico).
 * @param {string} params.messageType - Tipo ontológico (COMMAND, EVENT, ACK).
 * @param {string} params.actionCode - O que aconteceu/deve acontecer (ActionCode).
 * @param {object} params.payload - Dados úteis (puro objeto JS).
 * @param {string} [params.correlationId] - ID da transação original (Obrigatório para RESPOSTAS).
 * @param {string} [params.msgId] - ID único desta mensagem (Gerado se omitido).
 * * @returns {object} Envelope IPC 2.0 Imutável.
 */
function createEnvelope({
  actor,
  target,
  messageType,
  actionCode,
  payload = {},
  correlationId = null,
  msgId = null
}) {
  // 1. Validações de Existência (Guards)
  assert(actor, 'Actor is required');
  assert(target, 'Target is required');
  assert(messageType, 'Message Type is required');
  assert(actionCode, 'Action Code is required');
  
  // 2. Validações Constitucionais (Vocabulário)
  // Verifica se os termos usados existem no constants.js
  const validActors = Object.values(ActorRole);
  const validTypes = Object.values(MessageType);
  
  // Nota: ActionCode pode ser extensível em plugins, então validamos 
  // apenas se é uma string não vazia, mas idealmente deveria bater com ActionCode.
  // Para rigor máximo (Protocolo 11), validamos contra a lista conhecida se possível.
  
  assert(validActors.includes(actor) || actor.startsWith('agent:'), `Invalid Actor: ${actor}`);
  assert(validTypes.includes(messageType), `Invalid Message Type: ${messageType}`);
  
  // 3. Construção dos Identificadores
  const effectiveMsgId = msgId || uuidv4();
  // Se não houver correlation_id, esta mensagem INICIA uma cadeia causal.
  const effectiveCorrelationId = correlationId || effectiveMsgId; 

  // 4. Montagem da Estrutura Canônica
  const envelope = {
    protocol: {
      version: PROTOCOL_VERSION,
      timestamp: Date.now()
    },
    
    identity: {
      source: actor, // Renomeado de 'actor' para 'source' para clareza direcional
      target: target
    },
    
    causality: {
      msg_id: effectiveMsgId,
      correlation_id: effectiveCorrelationId
    },
    
    type: {
      kind: messageType,    // Mapeado para MessageType
      action: actionCode    // Mapeado para ActionCode
    },
    
    payload: payload
  };

  // 5. Blindagem (Imutabilidade)
  return deepFreeze(envelope);
}

/**
 * Cria um ACK (Confirmação) para um envelope recebido.
 * Facilita a resposta rápida exigida pelo protocolo.
 */
function createAck(originalEnvelope, actorSource) {
  return createEnvelope({
    actor: actorSource,
    target: originalEnvelope.identity.source,
    messageType: MessageType.ACK,
    actionCode: originalEnvelope.type.action, // ACK confirma a ação original
    correlationId: originalEnvelope.causality.correlation_id,
    payload: {
      original_msg_id: originalEnvelope.causality.msg_id,
      status: 'ACCEPTED'
    }
  });
}

module.exports = {
  createEnvelope,
  createAck
};