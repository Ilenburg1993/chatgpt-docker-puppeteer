// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { saveResponseV2, loadResponseV2 } from './response_store_v2.js';
import * as logger from '#core/logger';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from '#infra/fs/paths';

const RESPONSE_DIR = path.join(ROOT, 'respostas');

/**
 * Salva response (detecta V1 ou V2 automaticamente)
 *
 * @param {string} taskId - Task ID
 * @param {string|Object} response - Response V1 (string) ou V2 (object)
 * @param {Object} task - Task object (para preencher result)
 * @returns {Promise<Object>} - { storage, format }
 */
async function saveResponse(taskId, response, task) {
    try {
        // Detectar formato
        const isV2 = isResponseV2(response);

        if (isV2) {
            // Response V2 (object completo)
            return await saveResponseV2Format(taskId, response, task);
        } else {
            // Response V1 (string simples) - converter para V2
            logger.debug('[RESPONSE_ADAPTER] Response V1 detectada, convertendo para V2', {
                taskId,
                responseLength: typeof response === 'string' ? response.length : 0,
            });

            const responseV2 = convertV1toV2(response, task);
            return await saveResponseV2Format(taskId, responseV2, task);
        }
    } catch (error) {
        logger.error('[RESPONSE_ADAPTER] Erro ao salvar response', {
            taskId,
            error: error.message,
            stack: error.stack,
        });
        throw error;
    }
}

/**
 * Salva response V2 e preenche task.result
 *
 * @param {string} taskId - Task ID
 * @param {Object} responseV2 - Response V2 object
 * @param {Object} task - Task object
 * @returns {Promise<Object>} - { storage, format }
 * @private
 */
async function saveResponseV2Format(taskId, responseV2, task) {
    // Salvar em 4 formatos
    const storage = await saveResponseV2(taskId, responseV2);

    // Preencher task.result V5
    if (task && task.result) {
        // Storage paths (4 arquivos)
        task.result.storage = {
            text_file: storage.textFile,
            markdown_file: storage.markdownFile,
            json_file: storage.jsonFile,
            html_file: storage.htmlFile,
        };

        // Generation metadata
        task.result.generation = responseV2.generation || {};

        // Preview estruturado
        task.result.preview = responseV2.preview || {};

        // Validation (nullable)
        task.result.validation = responseV2.validation || null;

        // Backward compatibility (V4 fields)
        task.result.file_path = storage.textFile; // V4 compatibilidade
        task.result.raw_output_preview = responseV2.content?.text?.slice(0, 200) || '';
        task.result.finish_reason = 'success';
    }

    logger.info('[RESPONSE_ADAPTER] Response V2 salva com sucesso', {
        taskId,
        formats: 4,
        storageSize: {
            text: responseV2.content?.text?.length || 0,
            markdown: responseV2.content?.markdown?.length || 0,
            html: responseV2.content?.html?.length || 0,
        },
    });

    return { storage, format: 'v2' };
}

/**
 * Detecta se response é V2 (object) ou V1 (string)
 *
 * @param {any} response - Response para verificar
 * @returns {boolean} - true se V2, false se V1
 * @private
 */
function isResponseV2(response) {
    if (!response) return false;
    if (typeof response === 'string') return false;

    // Response V2 tem estrutura: { content, generation, validation, preview }
    return (
        typeof response === 'object' &&
        response.content !== undefined &&
        (response.generation !== undefined || response.preview !== undefined)
    );
}

/**
 * Converte response V1 (string) para V2 (object)
 *
 * @param {string} responseText - Response V1 (texto plano)
 * @param {Object} task - Task object (para metadata)
 * @returns {Object} - Response V2
 * @private
 */
function convertV1toV2(responseText, task) {
    const text = typeof responseText === 'string' ? responseText : String(responseText || '');

    // Criar response V2 básica
    return {
        content: {
            text,
            markdown: text, // V1 não tem markdown separado
            html: `<pre>${escapeHtml(text)}</pre>`,
            json: {
                sections: [],
                codeBlocks: [],
                links: [],
                images: [],
                tables: [],
            },
        },
        generation: {
            model: task?.spec?.model || 'unknown',
            started_at: task?.state?.started_at || new Date().toISOString(),
            completed_at: task?.state?.completed_at || new Date().toISOString(),
            duration_ms: task?.state?.metrics?.duration_ms || 0,
            tokens_estimate: Math.ceil(text.length / 4), // Heurística
            continuations: 0,
            thought_blocks_pruned: 0,
            retry_attempts: task?.state?.attempts || 0,
        },
        validation: null, // V1 não tem validação
        preview: {
            text: text.slice(0, 500),
            sections_count: 0,
            code_blocks_count: 0,
            links_count: 0,
            images_count: 0,
        },
    };
}

/**
 * Carrega response (backward compatible)
 * Tenta V2 primeiro, fallback para V1
 *
 * @param {string} taskId - Task ID
 * @param {string} format - Formato desejado ('text', 'markdown', 'json', 'html')
 * @returns {Promise<string|Object|null>} - Response content
 */
async function loadResponse(taskId, format) {
    format = format || 'text';

    try {
        // Tentar carregar V2
        return await loadResponseV2(taskId, format);
    } catch (error) {
        // Fallback: tentar carregar V1 (apenas .txt)
        logger.debug('[RESPONSE_ADAPTER] V2 não encontrada, tentando V1', { taskId });

        if (format === 'text' || format === 'json') {
            try {
                const v1Path = path.join(RESPONSE_DIR, `${taskId}.txt`);
                const text = await fs.readFile(v1Path, 'utf-8');

                if (format === 'json') {
                    // Converter V1 para V2 JSON
                    return convertV1toV2(text, { meta: { id: taskId } });
                }

                return text;
            } catch (_) {
                logger.warn('[RESPONSE_ADAPTER] Response não encontrada (V1 e V2)', {
                    taskId,
                    format,
                });
                return null;
            }
        }

        return null;
    }
}

/**
 * Escape HTML (utility)
 *
 * @param {string} text - Texto para escapar
 * @returns {string} - Texto escapado
 * @private
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export { saveResponse, loadResponse, isResponseV2, convertV1toV2 };
