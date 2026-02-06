import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from '#infra/fs/paths';
import * as logger from '#core/logger';
import { atomicWrite } from '#infra/io';

// Diretório de respostas
const RESPONSE_DIR = path.join(ROOT, 'respostas');

/**
 * Salva resposta em múltiplos formatos
 *
 * @param {string} taskId - Task ID
 * @param {Object} responseData - Response V2 data
 * @param {Object} responseData.content - { text, markdown, html, json }
 * @param {Object} responseData.generation - Generation metadata
 * @param {Object} responseData.validation - Validation (nullable)
 * @param {Object} responseData.preview - Preview estruturado
 * @returns {Promise<Object>} - { textFile, markdownFile, jsonFile, htmlFile }
 */
async function saveResponseV2(taskId, responseData) {
    try {
        // Criar diretório se não existe
        await fs.mkdir(RESPONSE_DIR, { recursive: true });

        const basePath = path.join(RESPONSE_DIR, taskId);

        // Salvar cada formato (atomic writes)
        await Promise.all([
            // 1. Texto plano (compatibilidade V1)
            atomicWrite(`${basePath}.txt`, responseData.content.text, 'utf-8'),

            // 2. Markdown (estruturado)
            atomicWrite(`${basePath}.md`, responseData.content.markdown, 'utf-8'),

            // 3. JSON (dados estruturados + metadata completo)
            atomicWrite(`${basePath}.json`, JSON.stringify(responseData, null, 2), 'utf-8'),

            // 4. HTML (renderizável)
            atomicWrite(`${basePath}.html`, wrapHTML(responseData.content.html, taskId), 'utf-8'),
        ]);

        logger.info(`[RESPONSE_STORE_V2] Resposta salva em 4 formatos para task ${taskId}`, {
            textSize: responseData.content.text.length,
            markdownSize: responseData.content.markdown.length,
            htmlSize: responseData.content.html.length,
            codeBlocks: responseData.content.json.codeBlocks?.length || 0,
        });

        return {
            textFile: `${basePath}.txt`,
            markdownFile: `${basePath}.md`,
            jsonFile: `${basePath}.json`,
            htmlFile: `${basePath}.html`,
        };
    } catch (error) {
        logger.error('[RESPONSE_STORE_V2] Erro ao salvar resposta', {
            taskId,
            error: error.message,
            stack: error.stack,
        });
        throw new Error(`Falha ao salvar resposta V2: ${error.message}`);
    }
}

/**
 * Carrega resposta (backward compatible)
 *
 * @param {string} taskId - Task ID
 * @param {string} format - Formato desejado ('text', 'markdown', 'json', 'html')
 * @returns {Promise<string|Object>} - Conteúdo da resposta
 */
async function loadResponseV2(taskId, format) {
    format = format || 'text';

    const basePath = path.join(RESPONSE_DIR, taskId);
    const formatMap = {
        text: `${basePath}.txt`,
        markdown: `${basePath}.md`,
        json: `${basePath}.json`,
        html: `${basePath}.html`,
    };

    const filePath = formatMap[format];

    if (!filePath) {
        throw new Error(`Formato inválido: ${format}. Use 'text', 'markdown', 'json' ou 'html'.`);
    }

    try {
        // Carrega formato solicitado
        if (format === 'json') {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        }

        return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
        // Fallback para .txt (compatibilidade V1)
        if (format !== 'text') {
            logger.warn(`[RESPONSE_STORE_V2] Formato ${format} não encontrado, fallback para .txt`, {
                taskId,
                requestedFormat: format,
            });
            return await loadResponseV2(taskId, 'text');
        }

        // Arquivo não existe
        logger.error('[RESPONSE_STORE_V2] Resposta não encontrada', {
            taskId,
            format,
            filePath,
        });
        return null;
    }
}

/**
 * Lista formatos disponíveis para task
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<Array<string>>} - Formatos disponíveis
 */
async function listAvailableFormats(taskId) {
    const basePath = path.join(RESPONSE_DIR, taskId);
    const formats = ['text', 'markdown', 'json', 'html'];
    const available = [];

    for (const format of formats) {
        const filePath = `${basePath}.${format === 'text' ? 'txt' : format}`;
        try {
            await fs.access(filePath);
            available.push(format);
        } catch (err) {
            // Arquivo não existe
        }
    }

    return available;
}

/**
 * Verifica se resposta V2 existe
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<boolean>}
 */
async function responseExists(taskId) {
    const basePath = path.join(RESPONSE_DIR, taskId);
    const txtPath = `${basePath}.txt`;

    try {
        await fs.access(txtPath);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Deleta resposta (todos os formatos)
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<number>} - Número de arquivos deletados
 */
async function deleteResponseV2(taskId) {
    const basePath = path.join(RESPONSE_DIR, taskId);
    const extensions = ['txt', 'md', 'json', 'html'];
    let deletedCount = 0;

    for (const ext of extensions) {
        const filePath = `${basePath}.${ext}`;
        try {
            await fs.unlink(filePath);
            deletedCount++;
        } catch (err) {
            // Arquivo não existe (ok)
        }
    }

    if (deletedCount > 0) {
        logger.info(`[RESPONSE_STORE_V2] Resposta deletada para task ${taskId}`, {
            filesDeleted: deletedCount,
        });
    }

    return deletedCount;
}

/**
 * Wraps HTML com template completo (renderizável)
 *
 * @param {string} htmlContent - HTML snippet
 * @param {string} taskId - Task ID
 * @returns {string} - HTML completo
 * @private
 */
function wrapHTML(htmlContent, taskId) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Response - ${taskId}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 2rem auto;
            padding: 0 2rem;
            color: #333;
        }
        pre {
            background: #f5f5f5;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f0f0f0;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Monaco', 'Courier New', monospace;
        }
        pre code {
            background: none;
            padding: 0;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 0.5rem;
            text-align: left;
        }
        th {
            background: #f0f0f0;
            font-weight: bold;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        .metadata {
            background: #f9f9f9;
            border-left: 4px solid #0066cc;
            padding: 1rem;
            margin: 1rem 0;
            font-size: 0.9rem;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="metadata">
        <strong>Task ID:</strong> ${taskId}<br>
        <strong>Generated:</strong> ${new Date().toISOString()}<br>
        <strong>Format:</strong> Response Capture V2.0
    </div>
    <div class="content">
        ${htmlContent}
    </div>
</body>
</html>`;
}

export { saveResponseV2, loadResponseV2, listAvailableFormats, responseExists, deleteResponseV2 };
