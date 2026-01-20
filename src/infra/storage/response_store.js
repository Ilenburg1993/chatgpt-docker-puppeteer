/* ==========================================================================
   src/infra/storage/response_store.js
   Audit Level: 700 — Sovereign Response Storage (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Recuperação segura, resiliente e higienizada de arquivos 
                     de resposta (.txt) gerados pelas IAs.
   Sincronizado com: paths.js V700, fs_utils.js V700.
========================================================================== */

const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');

// [V700] Importações de baixo nível para evitar dependências circulares
const PATHS = require('../fs/paths');
const { sleep, cleanText } = require('../fs/fs_utils');

/**
 * Lê o conteúdo de uma resposta anterior com blindagem de memória e I/O.
 * Utiliza loop iterativo para garantir estabilidade da pilha em retries.
 * 
 * @param {string} taskId - ID da tarefa alvo.
 * @param {AbortSignal} signal - Sinal para interromper leitura longa.
 * @returns {Promise<string|null>} Conteúdo limpo ou null se não localizado.
 */
async function loadResponse(taskId, signal = null) {
    const filename = taskId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.txt';
    const filepath = path.join(PATHS.RESPONSE, filename);

    if (!fss.existsSync(filepath)) return null;

    let attempts = 0;
    while (attempts < 5) {
        try {
            // 1. Check de Aborto Precoce (Soberania do Kernel)
            if (signal?.aborted) throw new Error('OPERATION_ABORTED');

            // 2. Validação de Tamanho (Proteção contra Out-of-Memory)
            const stats = await fs.stat(filepath);
            if (stats.size > PATHS.MAX_JSON_SIZE) {
                console.warn(`[IO] Resposta ${taskId} excede o teto de 1MB. Leitura parcial executada.`);
            }

            // 3. Leitura Assíncrona com suporte a sinal de cancelamento
            const content = await fs.readFile(filepath, { 
                encoding: 'utf-8', 
                signal: signal 
            });

            // 4. Sanitização Universal (Remoção de caracteres de controle)
            return cleanText(content);

        } catch (err) {
            // Tratamento de interrupção externa
            if (err.name === 'AbortError' || err.message === 'OPERATION_ABORTED') {
                throw new Error('READ_ABORTED');
            }

            // Tratamento de Concorrência (Arquivo travado pelo SO ou Logger)
            if (err.code === 'EBUSY' || err.code === 'EPERM') {
                attempts++;
                await sleep(200 * attempts); // Backoff progressivo (200ms, 400ms...)
                continue;
            }

            // Erros fatais ou arquivo corrompido
            return null;
        }
    }
    return null;
}

/**
 * Deleta um arquivo de resposta de forma assíncrona.
 * @param {string} taskId - ID da tarefa cujo resultado deve ser removido.
 */
async function deleteResponse(taskId) {
    const filename = taskId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.txt';
    const filepath = path.join(PATHS.RESPONSE, filename);
    
    try {
        if (fss.existsSync(filepath)) {
            await fs.unlink(filepath);
        }
    } catch (e) {
        // Falha no delete não deve interromper o fluxo principal (Best-effort)
    }
}

module.exports = { loadResponse, deleteResponse };