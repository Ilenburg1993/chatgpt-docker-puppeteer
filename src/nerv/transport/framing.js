// @ts-check - Type checking rigoroso habilitado (arquivo core)
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
 *
 * @param {any} value
 */
function intToBuffer(value) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32BE(value, 0);
    return buf;
}

/**
 * Lê inteiro de buffer de 4 bytes (big-endian).
 *
 * @param {any} buf
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
 * **Side-effects:** Aloca novos buffers para header e concatenação. **Semântica:** Adiciona delimitação física (4 bytes
 * big-endian) para transporte. **Unidades:** Tamanho em bytes como inteiro de 32 bits.
 *
 * @param {Buffer | Uint8Array} payload - Dados opacos a serem empacotados
 * @returns {Buffer} Frame com header de tamanho + payload
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
 * Cria um unpacker para processar stream de frames delimitados por tamanho.
 *
 * **Side-effects:** Mantém estado interno (buffer acumulado, estado de parsing). **Semântica:** Processa frames de
 * forma incremental, emitindo frames completos via callback. **Unidades:** Tamanho em bytes como inteiro de 32 bits
 * big-endian.
 *
 * @property {(chunk: Buffer | Uint8Array, onFrame: (frame: Buffer) => void) => void} push - Processa chunk e invoca
 *   callback para frames completos
 * @returns {any} Unpacker com método push
 */
function createUnpacker() {
    let buffer = Buffer.alloc(0);

    /**
     * Processa chunk recebido do meio físico.
     *
     * **Side-effects:** Modifica buffer interno, invoca callback para frames completos. **Semântica:** Reconstrói
     * frames de forma incremental até ter dados suficientes. **Unidades:** Tamanho em bytes como inteiro de 32 bits
     * big-endian.
     *
     * @param {Buffer | Uint8Array} chunk - Dados recebidos do transporte
     * @param {(frame: Buffer) => void} onFrame - Callback invocado para cada frame completo
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
        push,
    });
}

export { createUnpacker, pack };
