/* ==========================================================================
   src/shared/ipc/schemas.js
   Audit Level: 520 — IPC 2.0 Constitutional Validation
   Status: CONSTITUTIONALLY EXECUTABLE
   Responsabilidade: 
     - Validar estruturalmente e semanticamente envelopes IPC.
     - Garantir conformidade estrita com a versão do protocolo.
     - Proteger o Kernel de dados malformados (Sanitization).
   
   Dependências:
     - src/shared/ipc/constants.js
========================================================================== */

const {
  PROTOCOL_VERSION,
  MessageType,
  ActorRole
} = require('./constants');

/**
 * Helper interno para lançar violações de esquema padronizadas.
 * @param {string} message - Descrição técnica da violação.
 * @throws {Error} [IPC SCHEMA VIOLATION]
 */
function violation(message) {
  throw new Error(`[IPC SCHEMA VIOLATION] ${message}`);
}

/**
 * Verifica se o valor é um objeto plano (não null, não array).
 * @param {any} obj 
 * @returns {boolean}
 */
function isPlainObject(obj) {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !Array.isArray(obj)
  );
}

/**
 * Verifica se a string é um UUID v4 válido.
 * Regex otimizada para performance.
 * @param {string} value 
 * @returns {boolean}
 */
function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* --------------------------------------------------------------------------
 * VALIDAÇÃO ESTRUTURAL (SYNTAX)
 * ------------------------------------------------------------------------ */

/**
 * Valida a existência e tipos dos campos obrigatórios do Envelope.
 * Não verifica o conteúdo semântico profundo, apenas a forma.
 * * @param {object} envelope - O objeto candidato a envelope.
 */
function validateStructure(envelope) {
  if (!isPlainObject(envelope)) {
    violation('O envelope deve ser um objeto plano.');
  }

  // Desestruturação para verificação de chaves de topo
  const { protocol, identity, causality, type, payload } = envelope;

  // 1. Bloco de Protocolo
  if (!isPlainObject(protocol)) violation('Campo "protocol" ausente ou inválido.');
  if (typeof protocol.version !== 'string') violation('Versão do protocolo deve ser string.');
  if (typeof protocol.timestamp !== 'number') violation('Timestamp deve ser numérico.');

  // 2. Bloco de Identidade
  if (!isPlainObject(identity)) violation('Campo "identity" ausente ou inválido.');
  if (typeof identity.source !== 'string') violation('Identity source (origem) deve ser string.');
  if (typeof identity.target !== 'string') violation('Identity target (destino) deve ser string.');

  // 3. Bloco de Causalidade
  if (!isPlainObject(causality)) violation('Campo "causality" ausente ou inválido.');
  if (!isUUID(causality.msg_id)) violation('msg_id deve ser um UUID válido.');
  if (!isUUID(causality.correlation_id)) violation('correlation_id deve ser um UUID válido.');

  // 4. Bloco de Tipo
  if (!isPlainObject(type)) violation('Campo "type" ausente ou inválido.');
  if (typeof type.kind !== 'string') violation('type.kind deve ser string.');
  if (typeof type.action !== 'string') violation('type.action deve ser string.');

  // 5. Payload (Deve ser objeto, mesmo que vazio)
  if (!isPlainObject(payload)) violation('Payload deve ser um objeto (use {} para vazio).');
}

/* --------------------------------------------------------------------------
 * VALIDAÇÃO SEMÂNTICA (ONTOLOGY)
 * ------------------------------------------------------------------------ */

/**
 * Valida se os valores dentro do envelope respeitam a Constituição (constants.js).
 * Verifica versões, atores permitidos e coerência lógica.
 * * @param {object} envelope - Envelope estruturalmente válido.
 */
function validateSemantics(envelope) {
  const { protocol, identity, type } = envelope;

  // 1. Verificação de Versão (Anti-Drift)
  // O sistema rejeita versões diferentes para evitar corrupção de dados.
  if (protocol.version !== PROTOCOL_VERSION) {
    violation(`Versão de protocolo incompatível. Esperado: ${PROTOCOL_VERSION}, Recebido: ${protocol.version}`);
  }

  // 2. Verificação de Atores (Authority)
  // Permite atores definidos em ActorRole OU IDs dinâmicos de agentes (ex: agent:uuid)
  const validActors = Object.values(ActorRole);
  const isValidSource = validActors.includes(identity.source) || identity.source.startsWith('agent:');
  const isValidTarget = validActors.includes(identity.target) || identity.target.startsWith('agent:');

  if (!isValidSource) {
    violation(`Ator de origem desconhecido/não autorizado: ${identity.source}`);
  }
  if (!isValidTarget) {
    violation(`Ator de destino desconhecido/não autorizado: ${identity.target}`);
  }

  // 3. Verificação de Tipo (Ontology)
  const validTypes = Object.values(MessageType);
  if (!validTypes.includes(type.kind)) {
    violation(`Tipo de mensagem ontologicamente inválido: ${type.kind}`);
  }

  // [Regra de Ouro] Prevenção de Loop de ACKs
  // Um ACK nunca deve responder a outro ACK.
  if (type.kind === MessageType.ACK && type.action === MessageType.ACK) {
    violation('Violação Causal: ACK respondendo a ACK (risco de loop infinito).');
  }
}

/* --------------------------------------------------------------------------
 * API PÚBLICA
 * ------------------------------------------------------------------------ */

/**
 * Realiza a validação completa (Estrutural + Semântica) de um envelope.
 * * @param {object} envelope - O objeto a ser validado.
 * @returns {boolean} True se válido (ou lança erro).
 * @throws {Error} Se houver qualquer violação.
 */
function validateIPCEnvelope(envelope) {
  // Passo 1: A forma está correta?
  validateStructure(envelope);
  
  // Passo 2: O conteúdo faz sentido perante a lei?
  validateSemantics(envelope);
  
  return true;
}

/**
 * Valida apenas a identidade de um Robô para Handshake.
 * Usado pelo Servidor antes de aceitar conexão.
 * * @param {object} identityPayload - O payload do handshake.
 */
function validateRobotIdentity(identityPayload) {
  if (!isPlainObject(identityPayload)) violation('Identidade deve ser um objeto.');
  if (!identityPayload.robot_id) violation('Identidade requer "robot_id".');
  
  // Adicionar validações extras de capacidades se necessário no futuro
  return true;
}

module.exports = {
  validateIPCEnvelope,
  validateRobotIdentity
};