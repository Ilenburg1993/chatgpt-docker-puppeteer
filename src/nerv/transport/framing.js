/* ==========================================================================
   src/nerv/transport/framing.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: transport/
   Arquivo: framing.js

   Papel:
   - Empacotar dados opacos em frames transportáveis
   - Reconstruir frames a partir de chunks recebidos
   - Garantir delimitação física entre mensagens

   IMPORTANTE:
   - NÃO interpreta conteúdo
   - NÃO valida envelopes
   - NÃO decide lógica de transporte
   - NÃO conhece COMMAND/EVENT/ACK
   - Atua exclusivamente no nível físico

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Converte inteiro para buffer de 4 bytes (big-endian).
 */
function intToBuffer(value) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

/**
 * Lê inteiro de buffer de 4 bytes (big-endian).
 */
function bufferToInt(buf) {
  return buf.readUInt32BE(0);
}

/* ===========================
   Empacotamento (outbound)
=========================== */

/**
 * Empacota um frame opaco adicionando prefixo de tamanho.
 *
 * @param {Buffer|Uint8Array} payload
 * @returns {Buffer}
 */
function pack(payload) {
  if (!Buffer.isBuffer(payload)) {
    payload = Buffer.from(payload);
  }

  const length = payload.length;
  const header = intToBuffer(length);

  return Buffer.concat([header, payload]);
}

/* ===========================
   Desempacotamento (inbound)
=========================== */

/**
 * Cria um desempacotador de frames.
 *
 * Mantém buffer interno apenas para reconstrução física.
 */
function createUnpacker() {
  let buffer = Buffer.alloc(0);

  /**
   * Processa chunk recebido do meio físico.
   *
   * @param {Buffer|Uint8Array} chunk
   * @param {Function} onFrame
   * Callback chamado para cada frame completo reconstruído.
   */
  function push(chunk, onFrame) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }

    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const frameLength = bufferToInt(buffer.slice(0, 4));

      if (buffer.length < 4 + frameLength) {
        // aguarda mais dados
        return;
      }

      const frame = buffer.slice(4, 4 + frameLength);
      buffer = buffer.slice(4 + frameLength);

      onFrame(frame);
    }
  }

  return Object.freeze({
    push
  });
}

/* ===========================
   Exportação canônica
=========================== */

module.exports = Object.freeze({
  pack,
  createUnpacker
});
